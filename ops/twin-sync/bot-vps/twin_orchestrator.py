#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

AGENTS = ("claudeclaw", "openclaw")
MAX_HINT_BYTES = 64 * 1024
MAX_HINT_TTL_HOURS = 72
MAX_PROPOSAL_CHANGES = 200


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_dt(value: str) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def stable_hash(payload: Any) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


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
class TwinPaths:
    base: Path

    @property
    def inbox_memory(self) -> Path:
        return self.base / "inbox" / "memory"

    @property
    def inbox_config(self) -> Path:
        return self.base / "inbox" / "config"

    @property
    def mailbox_outgoing(self) -> Path:
        return self.base / "mailbox" / "outgoing"

    @property
    def mailbox_incoming(self) -> Path:
        return self.base / "mailbox" / "incoming"

    @property
    def archive(self) -> Path:
        return self.base / "archive"

    @property
    def quarantine(self) -> Path:
        return self.base / "quarantine"

    @property
    def state(self) -> Path:
        return self.base / "state"

    @property
    def state_seen_events(self) -> Path:
        return self.state / "seen-event-ids.txt"

    @property
    def state_proposal_hashes(self) -> Path:
        return self.state / "proposal-hashes.json"

    @property
    def state_snapshots(self) -> Path:
        return self.state / "snapshots"

    @property
    def outbox_proposals(self) -> Path:
        return self.base / "outbox" / "proposals"

    @property
    def outbox_views(self) -> Path:
        return self.base / "outbox" / "views"

    @property
    def memory_ledger(self) -> Path:
        return self.state / "memory-events.jsonl"

    @property
    def metrics(self) -> Path:
        return self.state / "metrics.json"


def ensure_dirs(paths: TwinPaths) -> None:
    for agent in AGENTS:
        (paths.mailbox_outgoing / agent).mkdir(parents=True, exist_ok=True)
        (paths.mailbox_incoming / agent).mkdir(parents=True, exist_ok=True)
        (paths.state_snapshots / agent).mkdir(parents=True, exist_ok=True)
    for folder in [
        paths.inbox_memory,
        paths.inbox_config,
        paths.archive / "memory",
        paths.archive / "config",
        paths.archive / "mailbox",
        paths.quarantine,
        paths.state,
        paths.outbox_proposals,
        paths.outbox_views,
    ]:
        folder.mkdir(parents=True, exist_ok=True)


def quarantine_file(paths: TwinPaths, source: Path, reason: str) -> None:
    target = paths.quarantine / f"{source.name}.{int(datetime.now(timezone.utc).timestamp())}"
    shutil.move(str(source), str(target))
    write_json(
        target.with_suffix(target.suffix + ".report.json"),
        {
            "reason": reason,
            "source_file": source.name,
            "timestamp": utc_now_iso(),
        },
    )


def required_string(payload: Dict[str, Any], key: str) -> Optional[str]:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def validate_memory_event(payload: Dict[str, Any]) -> Tuple[bool, str]:
    if payload.get("schema_version") != "1.0":
        return False, "invalid schema_version"
    if required_string(payload, "event_id") is None:
        return False, "missing event_id"
    if payload.get("agent_id") not in AGENTS:
        return False, "invalid agent_id"
    ts = required_string(payload, "timestamp")
    if ts is None or parse_dt(ts) is None:
        return False, "invalid timestamp"
    if required_string(payload, "domain") is None:
        return False, "missing domain"
    if required_string(payload, "fact_type") is None:
        return False, "missing fact_type"
    if not isinstance(payload.get("fact_payload"), dict) or not payload.get("fact_payload"):
        return False, "invalid fact_payload"
    confidence = payload.get("confidence")
    if not isinstance(confidence, (float, int)) or confidence < 0 or confidence > 1:
        return False, "invalid confidence"
    return True, ""


def load_seen_event_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    with path.open("r", encoding="utf-8") as file_handle:
        return {line.strip() for line in file_handle if line.strip()}


def save_seen_event_ids(path: Path, event_ids: Iterable[str]) -> None:
    ordered = sorted(set(event_ids))
    path.write_text("\n".join(ordered) + ("\n" if ordered else ""), encoding="utf-8")


def process_memory_events(paths: TwinPaths) -> Dict[str, int]:
    stats = {"processed": 0, "duplicates": 0, "quarantined": 0}
    seen_ids = load_seen_event_ids(paths.state_seen_events)
    event_files = sorted(paths.inbox_memory.glob("*.json"))
    for event_file in event_files:
        payload = load_json(event_file, default=None)
        if not isinstance(payload, dict):
            stats["quarantined"] += 1
            quarantine_file(paths, event_file, "invalid_json")
            continue
        ok, reason = validate_memory_event(payload)
        if not ok:
            stats["quarantined"] += 1
            quarantine_file(paths, event_file, reason)
            continue
        event_id = str(payload["event_id"])
        if event_id in seen_ids:
            stats["duplicates"] += 1
            shutil.move(str(event_file), str(paths.archive / "memory" / event_file.name))
            continue
        append_jsonl(paths.memory_ledger, payload)
        seen_ids.add(event_id)
        stats["processed"] += 1
        shutil.move(str(event_file), str(paths.archive / "memory" / event_file.name))
    save_seen_event_ids(paths.state_seen_events, seen_ids)
    return stats


def build_knowledge_view(paths: TwinPaths) -> Dict[str, Any]:
    by_agent: Dict[str, int] = {agent: 0 for agent in AGENTS}
    by_domain: Dict[str, int] = {}
    by_fact_type: Dict[str, int] = {}
    latest: List[Dict[str, Any]] = []
    total = 0

    if paths.memory_ledger.exists():
        with paths.memory_ledger.open("r", encoding="utf-8") as file_handle:
            for line in file_handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except Exception:
                    continue
                total += 1
                agent_id = str(event.get("agent_id", "unknown"))
                by_agent[agent_id] = by_agent.get(agent_id, 0) + 1
                domain = str(event.get("domain", "unknown"))
                by_domain[domain] = by_domain.get(domain, 0) + 1
                fact_type = str(event.get("fact_type", "unknown"))
                by_fact_type[fact_type] = by_fact_type.get(fact_type, 0) + 1
                latest.append(
                    {
                        "event_id": event.get("event_id"),
                        "agent_id": agent_id,
                        "timestamp": event.get("timestamp"),
                        "domain": domain,
                        "fact_type": fact_type,
                    }
                )

    latest_sorted = sorted(latest, key=lambda item: item.get("timestamp", ""), reverse=True)[:100]
    view = {
        "schema_version": "1.0",
        "generated_at": utc_now_iso(),
        "total_events": total,
        "by_agent": by_agent,
        "by_domain": by_domain,
        "by_fact_type": by_fact_type,
        "latest_events": latest_sorted,
    }
    write_json(paths.outbox_views / "knowledge-view.json", view)
    return view


SENSITIVE_SEGMENTS = re.compile(r"(token|secret|password|private_key|api_key|auth|credential)", re.IGNORECASE)

# Paths that are intentionally different between agents (deployment/engine-specific).
# Config alignment proposals for these paths are meaningless — each agent has its own
# channel setup, plugin list, gateway config, tool permissions, and agent roster.
ALIGNMENT_EXCLUDED_PREFIXES: tuple[str, ...] = (
    "agents.",
    "channels.",
    "gateway.",
    "messages.",
    "plugins.",
    "telegram.",
    "tools.",
)


def is_alignment_excluded_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in ALIGNMENT_EXCLUDED_PREFIXES)


def normalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: normalize_value(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [normalize_value(item) for item in value]
    return value


def is_sensitive_path(path: str) -> bool:
    return bool(SENSITIVE_SEGMENTS.search(path))


def flatten_dict(data: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in sorted(data.keys()):
        current = f"{prefix}.{key}" if prefix else key
        value = data[key]
        if isinstance(value, dict):
            out.update(flatten_dict(value, current))
        else:
            out[current] = value
    return out


def validate_config_snapshot(payload: Dict[str, Any]) -> Tuple[bool, str]:
    if payload.get("schema_version") != "1.0":
        return False, "invalid schema_version"
    if payload.get("agent_id") not in AGENTS:
        return False, "invalid agent_id"
    captured_at = required_string(payload, "captured_at")
    if captured_at is None or parse_dt(captured_at) is None:
        return False, "invalid captured_at"
    if not isinstance(payload.get("config"), dict) or not payload["config"]:
        return False, "invalid config"
    if payload.get("redacted") is not True:
        return False, "redacted must be true"
    config_hash = required_string(payload, "config_hash")
    if config_hash is None or not re.match(r"^sha256:[a-fA-F0-9]{64}$", config_hash):
        return False, "invalid config_hash"
    return True, ""


def process_config_snapshots(paths: TwinPaths) -> Dict[str, int]:
    stats = {"processed": 0, "quarantined": 0}
    snapshot_files = sorted(paths.inbox_config.glob("*.json"))
    for snapshot_file in snapshot_files:
        payload = load_json(snapshot_file, default=None)
        if not isinstance(payload, dict):
            stats["quarantined"] += 1
            quarantine_file(paths, snapshot_file, "invalid_json")
            continue
        ok, reason = validate_config_snapshot(payload)
        if not ok:
            stats["quarantined"] += 1
            quarantine_file(paths, snapshot_file, reason)
            continue
        agent_id = str(payload["agent_id"])
        target = paths.state_snapshots / agent_id / "latest.json"
        previous = load_json(target, default=None)
        should_update = True
        if isinstance(previous, dict):
            prev_dt = parse_dt(str(previous.get("captured_at", "")))
            new_dt = parse_dt(str(payload.get("captured_at", "")))
            should_update = bool(new_dt and (not prev_dt or new_dt >= prev_dt))
        if should_update:
            normalized_payload = dict(payload)
            normalized_payload["config"] = normalize_value(payload["config"])
            write_json(target, normalized_payload)
            stats["processed"] += 1
        shutil.move(str(snapshot_file), str(paths.archive / "config" / snapshot_file.name))
    return stats


def build_proposals(paths: TwinPaths, max_changes: int = MAX_PROPOSAL_CHANGES) -> Dict[str, int]:
    stats = {"generated": 0}
    snapshots: Dict[str, Dict[str, Any]] = {}
    for agent in AGENTS:
        payload = load_json(paths.state_snapshots / agent / "latest.json", default=None)
        if isinstance(payload, dict):
            snapshots[agent] = payload

    if len(snapshots) < 2:
        return stats

    proposal_hashes = load_json(paths.state_proposal_hashes, default={})
    if not isinstance(proposal_hashes, dict):
        proposal_hashes = {}

    def generate_for(source: str, target: str) -> None:
        nonlocal stats, proposal_hashes
        source_cfg = flatten_dict(snapshots[source].get("config", {}))
        target_cfg = flatten_dict(snapshots[target].get("config", {}))
        changes: List[Dict[str, Any]] = []
        for key in sorted(set(source_cfg.keys()) | set(target_cfg.keys())):
            if is_sensitive_path(key):
                continue
            if is_alignment_excluded_path(key):
                continue
            src_value = source_cfg.get(key, "__missing__")
            dst_value = target_cfg.get(key, "__missing__")
            if src_value == dst_value:
                continue
            action = "set" if src_value != "__missing__" else "remove"
            reason = "Value differs between twins; align target with source baseline."
            changes.append(
                {
                    "path": key,
                    "source_value": src_value if src_value != "__missing__" else None,
                    "target_value": dst_value if dst_value != "__missing__" else None,
                    "action": action,
                    "reason": reason,
                }
            )
            if len(changes) >= max_changes:
                break

        if not changes:
            return

        digest = stable_hash(changes)
        pair_key = f"{source}->{target}"
        if proposal_hashes.get(pair_key) == digest:
            return

        ts = utc_now_iso()
        proposal_id = f"proposal-{source}-to-{target}-{int(datetime.now(timezone.utc).timestamp())}"
        proposal = {
            "schema_version": "1.0",
            "proposal_id": proposal_id,
            "created_at": ts,
            "source_agent": source,
            "target_agent": target,
            "proposal_type": "config_alignment",
            "title": f"Align {target} config with {source}",
            "rationale": "Diff found in sanitized snapshots. Auto-apply disabled; owner approval required.",
            "risk_level": "low",
            "auto_apply": False,
            "changes": changes,
            "evidence_event_ids": [],
            "apply_hints": [
                "Run dry-run patch first",
                "Apply only non-sensitive keys",
                "Rollback using previous snapshot hash",
            ],
        }
        write_json(paths.outbox_proposals / f"{proposal_id}.json", proposal)
        proposal_hashes[pair_key] = digest
        stats["generated"] += 1

    generate_for("claudeclaw", "openclaw")
    generate_for("openclaw", "claudeclaw")
    write_json(paths.state_proposal_hashes, proposal_hashes)
    return stats


def process_mailbox(paths: TwinPaths) -> Dict[str, int]:
    stats = {"relayed": 0, "expired": 0, "quarantined": 0}

    for source_agent in AGENTS:
        outgoing_dir = paths.mailbox_outgoing / source_agent
        for msg_file in sorted(outgoing_dir.glob("*.json")):
            try:
                if msg_file.stat().st_size > MAX_HINT_BYTES:
                    stats["quarantined"] += 1
                    quarantine_file(paths, msg_file, "hint_too_large")
                    continue
            except OSError:
                stats["quarantined"] += 1
                quarantine_file(paths, msg_file, "hint_stat_failed")
                continue

            payload = load_json(msg_file, default=None)
            if not isinstance(payload, dict):
                stats["quarantined"] += 1
                quarantine_file(paths, msg_file, "invalid_json")
                continue

            from_agent = payload.get("from_agent")
            to_agent = payload.get("to_agent")
            created_at = required_string(payload, "created_at")
            expires_at = required_string(payload, "expires_at")
            message = required_string(payload, "message")

            if from_agent not in AGENTS or from_agent != source_agent or to_agent not in AGENTS or to_agent == from_agent:
                stats["quarantined"] += 1
                quarantine_file(paths, msg_file, "invalid_agents")
                continue
            if created_at is None or expires_at is None or message is None:
                stats["quarantined"] += 1
                quarantine_file(paths, msg_file, "missing_fields")
                continue

            created_dt = parse_dt(created_at)
            expires_dt = parse_dt(expires_at)
            if created_dt is None or expires_dt is None:
                stats["quarantined"] += 1
                quarantine_file(paths, msg_file, "invalid_datetime")
                continue
            if expires_dt <= datetime.now(timezone.utc):
                stats["expired"] += 1
                shutil.move(str(msg_file), str(paths.archive / "mailbox" / msg_file.name))
                continue
            ttl_hours = (expires_dt - created_dt).total_seconds() / 3600.0
            if ttl_hours > MAX_HINT_TTL_HOURS:
                stats["quarantined"] += 1
                quarantine_file(paths, msg_file, "ttl_too_long")
                continue

            out_payload = {
                "schema_version": "1.0",
                "hint_id": payload.get("hint_id") or f"hint-{stable_hash(payload)[:12]}",
                "from_agent": from_agent,
                "to_agent": to_agent,
                "created_at": created_at,
                "expires_at": expires_at,
                "title": payload.get("title", "Twin hint"),
                "message": message,
                "tags": payload.get("tags", []),
            }
            destination = paths.mailbox_incoming / str(to_agent) / f"{int(datetime.now(timezone.utc).timestamp())}-{msg_file.name}"
            write_json(destination, out_payload)
            shutil.move(str(msg_file), str(paths.archive / "mailbox" / msg_file.name))
            stats["relayed"] += 1

    return stats


def run_once(paths: TwinPaths) -> Dict[str, Any]:
    ensure_dirs(paths)
    memory_stats = process_memory_events(paths)
    config_stats = process_config_snapshots(paths)
    mailbox_stats = process_mailbox(paths)
    knowledge = build_knowledge_view(paths)
    proposal_stats = build_proposals(paths)
    metrics = {
        "timestamp": utc_now_iso(),
        "memory": memory_stats,
        "config": config_stats,
        "mailbox": mailbox_stats,
        "proposal": proposal_stats,
        "knowledge_total_events": knowledge.get("total_events", 0),
    }
    write_json(paths.metrics, metrics)
    return metrics


def main() -> int:
    default_base_dir = str(Path(os.getenv("TWIN_BASE_DIR", str(Path.home() / "twin-sync"))))
    parser = argparse.ArgumentParser(description="Twin orchestrator for ClaudeClaw/OpenClaw")
    parser.add_argument("--base-dir", default=default_base_dir, help="Twin sync base directory")
    parser.add_argument("--once", action="store_true", help="Run one iteration and exit")
    args = parser.parse_args()

    paths = TwinPaths(base=Path(args.base_dir))
    if not args.once:
        print("Only --once mode is supported in this release.", file=sys.stderr)
        return 2

    metrics = run_once(paths)
    print(json.dumps(metrics, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
