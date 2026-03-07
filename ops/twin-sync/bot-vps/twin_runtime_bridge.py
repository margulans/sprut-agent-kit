#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

AGENTS = ("claudeclaw", "openclaw")
SENSITIVE_RE = re.compile(r"(token|secret|password|private[_-]?key|api[_-]?key|auth|credential)", re.IGNORECASE)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def stable_hash(payload: Any) -> str:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


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


def sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        result: Dict[str, Any] = {}
        for key in sorted(value.keys()):
            if SENSITIVE_RE.search(key):
                result[key] = "__REDACTED__"
            else:
                result[key] = sanitize_value(value[key])
        return result
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    return value


@dataclass
class BridgePaths:
    base: Path

    @property
    def inbox_memory(self) -> Path:
        return self.base / "inbox" / "memory"

    @property
    def inbox_config(self) -> Path:
        return self.base / "inbox" / "config"

    @property
    def state(self) -> Path:
        return self.base / "state"

    @property
    def state_hashes(self) -> Path:
        return self.state / "runtime-bridge-hashes.json"

    @property
    def state_stats(self) -> Path:
        return self.state / "runtime-bridge-stats.json"


def ensure_dirs(paths: BridgePaths) -> None:
    paths.inbox_memory.mkdir(parents=True, exist_ok=True)
    paths.inbox_config.mkdir(parents=True, exist_ok=True)
    paths.state.mkdir(parents=True, exist_ok=True)


def candidate_config_paths(agent_id: str) -> List[Path]:
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


def resolve_config_path(agent_id: str, explicit: Optional[str]) -> Optional[Path]:
    if explicit:
        path = Path(explicit)
        return path if path.exists() else None
    for path in candidate_config_paths(agent_id):
        if path.exists():
            return path
    return None


def build_snapshot(agent_id: str, sanitized_config: Dict[str, Any], config_version: str) -> Dict[str, Any]:
    ts = utc_now_iso()
    digest = stable_hash(sanitized_config)
    return {
        "schema_version": "1.0",
        "snapshot_id": f"snapshot-{agent_id}-{int(datetime.now(timezone.utc).timestamp())}",
        "agent_id": agent_id,
        "captured_at": ts,
        "config_version": config_version,
        "config_hash": f"sha256:{digest}",
        "redacted": True,
        "redaction": {
            "strategy": "hybrid",
            "rules": [
                "token",
                "secret",
                "password",
                "private_key",
                "api_key",
                "auth",
                "credential",
            ],
        },
        "config": sanitized_config,
    }


def build_config_change_event(agent_id: str, config_hash: str, config_path: str) -> Dict[str, Any]:
    return {
        "schema_version": "1.0",
        "event_id": f"event-{agent_id}-config-{int(datetime.now(timezone.utc).timestamp())}",
        "agent_id": agent_id,
        "timestamp": utc_now_iso(),
        "domain": "configuration",
        "fact_type": "observation",
        "fact_payload": {
            "kind": "config_snapshot_published",
            "config_hash": config_hash,
            "config_path": config_path,
        },
        "confidence": 1.0,
        "source_provenance": "internal_inference",
        "trust_level": "internal",
        "tags": ["runtime_bridge", "config_change"],
    }


def run_once(
    paths: BridgePaths,
    claudeclaw_config: Optional[str],
    openclaw_config: Optional[str],
    config_version: str,
) -> Dict[str, Any]:
    ensure_dirs(paths)
    state = load_json(paths.state_hashes, default={})
    if not isinstance(state, dict):
        state = {}

    stats = {
        "timestamp": utc_now_iso(),
        "published_snapshots": 0,
        "published_memory_events": 0,
        "skipped_no_config": 0,
        "skipped_unchanged": 0,
    }

    explicit_map = {
        "claudeclaw": claudeclaw_config,
        "openclaw": openclaw_config,
    }

    for agent_id in AGENTS:
        cfg_path = resolve_config_path(agent_id, explicit_map[agent_id])
        if cfg_path is None:
            stats["skipped_no_config"] += 1
            continue
        raw_config = load_json(cfg_path, default=None)
        if not isinstance(raw_config, dict) or not raw_config:
            stats["skipped_no_config"] += 1
            continue

        sanitized = sanitize_value(raw_config)
        digest = stable_hash(sanitized)
        prev_digest = str(state.get(agent_id, ""))
        if digest == prev_digest:
            stats["skipped_unchanged"] += 1
            continue

        snapshot = build_snapshot(agent_id, sanitized, config_version)
        snapshot_file = paths.inbox_config / f"{snapshot['snapshot_id']}.json"
        write_json(snapshot_file, snapshot)
        stats["published_snapshots"] += 1

        event = build_config_change_event(agent_id, snapshot["config_hash"], str(cfg_path))
        event_file = paths.inbox_memory / f"{event['event_id']}.json"
        write_json(event_file, event)
        stats["published_memory_events"] += 1

        state[agent_id] = digest

    write_json(paths.state_hashes, state)
    write_json(paths.state_stats, stats)
    return stats


def main() -> int:
    default_base_dir = str(Path(os.getenv("TWIN_BASE_DIR", str(Path.home() / "twin-sync"))))
    parser = argparse.ArgumentParser(description="Publish runtime twin artifacts automatically")
    parser.add_argument("--base-dir", default=default_base_dir)
    parser.add_argument("--claudeclaw-config", default=None)
    parser.add_argument("--openclaw-config", default=None)
    parser.add_argument("--config-version", default="runtime-auto")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    if not args.once:
        print("Only --once mode is supported in this release.")
        return 2

    paths = BridgePaths(base=Path(args.base_dir))
    stats = run_once(
        paths=paths,
        claudeclaw_config=args.claudeclaw_config,
        openclaw_config=args.openclaw_config,
        config_version=args.config_version,
    )
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
