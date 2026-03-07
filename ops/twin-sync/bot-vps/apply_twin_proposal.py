#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

AGENTS = ("claudeclaw", "openclaw")
SENSITIVE_PATH = re.compile(r"(token|secret|password|private[_-]?key|api[_-]?key|auth|credential)", re.IGNORECASE)
PROPOSAL_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._:-]{7,127}$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file_handle:
        file_handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


@dataclass
class Paths:
    base: Path

    @property
    def proposals(self) -> Path:
        return self.base / "outbox" / "proposals"

    @property
    def state(self) -> Path:
        return self.base / "state"

    @property
    def decisions_log(self) -> Path:
        return self.state / "proposal-decisions.jsonl"

    @property
    def status_file(self) -> Path:
        return self.state / "proposal-status.json"

    @property
    def backups(self) -> Path:
        return self.state / "config-backups"

    @property
    def inbox_memory(self) -> Path:
        return self.base / "inbox" / "memory"


def candidate_target_paths(agent_id: str) -> List[Path]:
    home = Path.home()
    home_agent = home.name
    if agent_id == "claudeclaw":
        return [
            home / ".claude" / "claudeclaw" / "settings.json",
            home / ".claude" / "settings.json",
            Path("/home/claudeclaw/.claude/claudeclaw/settings.json"),
            Path("/home/claudeclaw/.claude/settings.json"),
            Path(f"/home/{home_agent}/.claude/claudeclaw/settings.json"),
            Path(f"/home/{home_agent}/.claude/settings.json"),
        ]
    return [
        home / ".openclaw" / "settings.json",
        home / ".claude" / "openclaw" / "settings.json",
        Path("/home/openclaw/.openclaw/settings.json"),
        Path("/home/openclaw/.claude/openclaw/settings.json"),
        Path("/home/claudeclaw/.openclaw/settings.json"),
        Path("/home/claudeclaw/.claude/openclaw/settings.json"),
        Path(f"/home/{home_agent}/.openclaw/settings.json"),
        Path(f"/home/{home_agent}/.claude/openclaw/settings.json"),
    ]


def resolve_target_config(agent_id: str, override_path: Optional[str]) -> Optional[Path]:
    if override_path:
        path = Path(override_path)
        return path if path.exists() else None
    for candidate in candidate_target_paths(agent_id):
        if candidate.exists():
            return candidate
    return None


def find_proposal_file(paths: Paths, proposal_id: str) -> Optional[Path]:
    direct = paths.proposals / f"{proposal_id}.json"
    if direct.exists():
        return direct
    for file_path in sorted(paths.proposals.glob("*.json")):
        if file_path.stem == proposal_id:
            return file_path
        payload = load_json(file_path, default={})
        if isinstance(payload, dict) and str(payload.get("proposal_id", "")) == proposal_id:
            return file_path
    return None


def split_path(path: str) -> List[str]:
    return [part for part in path.split(".") if part]


def set_by_path(data: Dict[str, Any], path: str, value: Any) -> None:
    parts = split_path(path)
    if not parts:
        return
    current: Dict[str, Any] = data
    for key in parts[:-1]:
        node = current.get(key)
        if not isinstance(node, dict):
            node = {}
            current[key] = node
        current = node
    current[parts[-1]] = value


def remove_by_path(data: Dict[str, Any], path: str) -> bool:
    parts = split_path(path)
    if not parts:
        return False
    current: Any = data
    for key in parts[:-1]:
        if not isinstance(current, dict) or key not in current:
            return False
        current = current[key]
    if not isinstance(current, dict) or parts[-1] not in current:
        return False
    del current[parts[-1]]
    return True


def build_memory_event(proposal_id: str, decision: str, target_agent: str, applied: int, skipped: int, comment: str) -> Dict[str, Any]:
    return {
        "schema_version": "1.0",
        "event_id": f"event-{target_agent}-proposal-{decision}-{int(datetime.now(timezone.utc).timestamp())}",
        "agent_id": target_agent,
        "timestamp": utc_now_iso(),
        "domain": "configuration",
        "fact_type": "observation",
        "fact_payload": {
            "kind": "proposal_decision",
            "proposal_id": proposal_id,
            "decision": decision,
            "applied_changes": applied,
            "skipped_changes": skipped,
            "comment": comment,
        },
        "confidence": 1.0,
        "source_provenance": "owner_direct",
        "trust_level": "trusted_owner",
        "tags": ["proposal", decision],
    }


def validate_proposal(payload: Dict[str, Any], expected_id: str) -> Tuple[bool, str]:
    if payload.get("schema_version") != "1.0":
        return False, "invalid proposal schema_version"
    proposal_id = str(payload.get("proposal_id", ""))
    if proposal_id != expected_id:
        return False, "proposal_id mismatch"
    if payload.get("target_agent") not in AGENTS:
        return False, "invalid target_agent"
    changes = payload.get("changes")
    if not isinstance(changes, list) or not changes:
        return False, "proposal has no changes"
    return True, ""


def apply_changes(config: Dict[str, Any], changes: List[Dict[str, Any]]) -> Tuple[int, int, List[str]]:
    applied = 0
    skipped = 0
    notes: List[str] = []
    for change in changes:
        path = str(change.get("path", ""))
        action = str(change.get("action", "review"))
        source_value = change.get("source_value")
        if not path:
            skipped += 1
            notes.append("skip: empty path")
            continue
        if SENSITIVE_PATH.search(path):
            skipped += 1
            notes.append(f"skip: sensitive path {path}")
            continue
        if action == "set":
            set_by_path(config, path, source_value)
            applied += 1
            continue
        if action == "remove":
            if remove_by_path(config, path):
                applied += 1
            else:
                skipped += 1
                notes.append(f"skip: remove missing path {path}")
            continue
        skipped += 1
        notes.append(f"skip: unsupported action {action} for {path}")
    return applied, skipped, notes


def run_decision(
    paths: Paths,
    proposal_id: str,
    decision: str,
    comment: str,
    dry_run: bool,
    target_config_override: Optional[str],
) -> Dict[str, Any]:
    if decision not in {"approve", "reject"}:
        raise RuntimeError("decision must be approve or reject")
    if not PROPOSAL_ID_PATTERN.match(proposal_id):
        raise RuntimeError("invalid proposal_id format")

    proposal_file = find_proposal_file(paths, proposal_id)
    if proposal_file is None:
        raise RuntimeError(f"proposal not found: {proposal_id}")
    proposal = load_json(proposal_file, default={})
    if not isinstance(proposal, dict):
        raise RuntimeError(f"invalid proposal file: {proposal_file}")
    ok, reason = validate_proposal(proposal, proposal_id)
    if not ok:
        raise RuntimeError(reason)

    target_agent = str(proposal["target_agent"])
    status = load_json(paths.status_file, default={})
    if not isinstance(status, dict):
        status = {}

    now = utc_now_iso()
    decision_record: Dict[str, Any] = {
        "timestamp": now,
        "proposal_id": proposal_id,
        "decision": decision,
        "comment": comment,
        "target_agent": target_agent,
        "proposal_file": str(proposal_file),
        "dry_run": dry_run,
    }

    if decision == "reject":
        status[proposal_id] = {
            "status": "rejected",
            "updated_at": now,
            "comment": comment,
        }
        write_json(paths.status_file, status)
        append_jsonl(paths.decisions_log, decision_record)
        return {
            "ok": True,
            "decision": "reject",
            "proposal_id": proposal_id,
            "message": "Proposal rejected and logged.",
            "applied_changes": 0,
            "skipped_changes": len(proposal.get("changes", [])),
            "dry_run": dry_run,
        }

    target_config = resolve_target_config(target_agent, target_config_override)
    if target_config is None:
        raise RuntimeError(f"target config for {target_agent} not found")
    current_cfg = load_json(target_config, default=None)
    if not isinstance(current_cfg, dict):
        raise RuntimeError(f"invalid target config json: {target_config}")

    next_cfg = json.loads(json.dumps(current_cfg, ensure_ascii=False))
    changes = [c for c in proposal.get("changes", []) if isinstance(c, dict)]
    applied, skipped, notes = apply_changes(next_cfg, changes)

    if not dry_run and applied > 0:
        backup_dir = paths.backups / target_agent
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_file = backup_dir / f"{proposal_id}-{int(datetime.now(timezone.utc).timestamp())}.json"
        shutil.copy2(target_config, backup_file)
        write_json(target_config, next_cfg)
        decision_record["backup_file"] = str(backup_file)
        decision_record["target_config"] = str(target_config)

    status[proposal_id] = {
        "status": "approved_dry_run" if dry_run else "approved",
        "updated_at": now,
        "comment": comment,
        "applied_changes": applied,
        "skipped_changes": skipped,
        "notes": notes[:20],
    }
    write_json(paths.status_file, status)

    event = build_memory_event(
        proposal_id=proposal_id,
        decision=decision,
        target_agent=target_agent,
        applied=applied,
        skipped=skipped,
        comment=comment,
    )
    if not dry_run:
        write_json(paths.inbox_memory / f"{event['event_id']}.json", event)

    decision_record["applied_changes"] = applied
    decision_record["skipped_changes"] = skipped
    decision_record["notes"] = notes[:20]
    append_jsonl(paths.decisions_log, decision_record)

    return {
        "ok": True,
        "decision": decision,
        "proposal_id": proposal_id,
        "target_agent": target_agent,
        "target_config": str(target_config),
        "applied_changes": applied,
        "skipped_changes": skipped,
        "dry_run": dry_run,
        "notes": notes[:10],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Approve/reject and optionally apply twin config proposal")
    parser.add_argument("--base-dir", default=os.getenv("TWIN_BASE_DIR", str(Path.home() / "twin-sync")))
    parser.add_argument("--proposal-id", required=True)
    parser.add_argument("--decision", required=True, choices=["approve", "reject"])
    parser.add_argument("--comment", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--target-config", default=None, help="override target config path")
    args = parser.parse_args()

    paths = Paths(base=Path(args.base_dir))
    result = run_decision(
        paths=paths,
        proposal_id=args.proposal_id,
        decision=args.decision,
        comment=args.comment,
        dry_run=args.dry_run,
        target_config_override=args.target_config,
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
