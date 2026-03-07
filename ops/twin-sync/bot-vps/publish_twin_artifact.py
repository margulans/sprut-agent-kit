#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict

AGENTS = ("claudeclaw", "openclaw")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def stable_hash(payload: Any) -> str:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def load_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: normalize(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [normalize(x) for x in value]
    return value


def build_memory_event(args: argparse.Namespace) -> Dict[str, Any]:
    payload = load_json(Path(args.payload_json))
    now = utc_now_iso()
    event = {
        "schema_version": "1.0",
        "event_id": args.event_id or f"event-{args.agent_id}-{int(datetime.now(timezone.utc).timestamp())}",
        "agent_id": args.agent_id,
        "timestamp": args.timestamp or now,
        "domain": args.domain,
        "fact_type": args.fact_type,
        "fact_payload": payload,
        "confidence": args.confidence,
        "source_provenance": args.source_provenance,
        "trust_level": args.trust_level,
        "tags": args.tags,
    }
    if args.supersedes:
        event["supersedes"] = args.supersedes
    return event


def build_config_snapshot(args: argparse.Namespace) -> Dict[str, Any]:
    raw_config = load_json(Path(args.config_json))
    normalized = normalize(raw_config)
    digest = stable_hash(normalized)
    return {
        "schema_version": "1.0",
        "snapshot_id": args.snapshot_id or f"snapshot-{args.agent_id}-{int(datetime.now(timezone.utc).timestamp())}",
        "agent_id": args.agent_id,
        "captured_at": args.captured_at or utc_now_iso(),
        "config_version": args.config_version,
        "config_hash": f"sha256:{digest}",
        "redacted": True,
        "redaction": {
            "strategy": "hybrid",
            "rules": [
                "token",
                "secret",
                "password",
                "private_key",
                "api_key"
            ]
        },
        "config": normalized
    }


def build_hint(args: argparse.Namespace) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=args.ttl_hours)
    return {
        "schema_version": "1.0",
        "hint_id": args.hint_id or f"hint-{args.from_agent}-{int(now.timestamp())}",
        "from_agent": args.from_agent,
        "to_agent": args.to_agent,
        "created_at": now.replace(microsecond=0).isoformat(),
        "expires_at": expires.replace(microsecond=0).isoformat(),
        "title": args.title,
        "message": args.message,
        "tags": args.tags,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Publish twin artifacts")
    parser.add_argument("--base-dir", default=os.getenv("TWIN_BASE_DIR", str(Path.home() / "twin-sync")))

    subparsers = parser.add_subparsers(dest="kind", required=True)

    memory = subparsers.add_parser("memory", help="Publish memory event")
    memory.add_argument("--agent-id", required=True, choices=AGENTS)
    memory.add_argument("--event-id")
    memory.add_argument("--timestamp")
    memory.add_argument("--domain", required=True)
    memory.add_argument("--fact-type", required=True)
    memory.add_argument("--payload-json", required=True)
    memory.add_argument("--confidence", type=float, default=0.8)
    memory.add_argument("--source-provenance", default="internal_inference")
    memory.add_argument("--trust-level", default="internal")
    memory.add_argument("--tags", nargs="*", default=[])
    memory.add_argument("--supersedes", nargs="*", default=[])

    config = subparsers.add_parser("config", help="Publish config snapshot")
    config.add_argument("--agent-id", required=True, choices=AGENTS)
    config.add_argument("--snapshot-id")
    config.add_argument("--captured-at")
    config.add_argument("--config-version", default="manual")
    config.add_argument("--config-json", required=True)

    hint = subparsers.add_parser("hint", help="Publish p2p hint")
    hint.add_argument("--from-agent", required=True, choices=AGENTS)
    hint.add_argument("--to-agent", required=True, choices=AGENTS)
    hint.add_argument("--hint-id")
    hint.add_argument("--title", required=True)
    hint.add_argument("--message", required=True)
    hint.add_argument("--ttl-hours", type=int, default=24)
    hint.add_argument("--tags", nargs="*", default=[])

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    base = Path(args.base_dir)

    if args.kind == "memory":
        payload = build_memory_event(args)
        target = base / "inbox" / "memory" / f"{payload['event_id']}.json"
    elif args.kind == "config":
        payload = build_config_snapshot(args)
        target = base / "inbox" / "config" / f"{payload['snapshot_id']}.json"
    else:
        if args.from_agent == args.to_agent:
            raise SystemExit("--from-agent and --to-agent must be different")
        payload = build_hint(args)
        target = base / "mailbox" / "outgoing" / args.from_agent / f"{payload['hint_id']}.json"

    write_json(target, payload)
    print(str(target))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
