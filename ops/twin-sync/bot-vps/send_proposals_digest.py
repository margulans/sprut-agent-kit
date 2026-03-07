#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

MAX_MESSAGE_LEN = 3800
DEFAULT_LIMIT = 3
DEFAULT_CALLBACK_TTL_HOURS = 24
MAX_CALLBACK_TOKENS = 500


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


def telegram_send_message(bot_token: str, chat_id: int, text: str) -> None:
    data = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    payload = json.loads(body)
    if not payload.get("ok"):
        raise RuntimeError(f"telegram api sendMessage failed: {payload}")


def telegram_send_message_with_keyboard(
    bot_token: str, chat_id: int, text: str, keyboard: Dict[str, Any]
) -> None:
    data = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
            "reply_markup": json.dumps(keyboard, ensure_ascii=False),
        }
    ).encode("utf-8")
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    payload = json.loads(body)
    if not payload.get("ok"):
        raise RuntimeError(f"telegram api sendMessage failed: {payload}")


def escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def parse_proposal(path: Path) -> Dict[str, Any]:
    payload = load_json(path, default={})
    if not isinstance(payload, dict):
        return {}
    return payload


AGENT_LABELS: Dict[str, str] = {
    "claudeclaw": "ClaudeClaw (семейный агент)",
    "openclaw": "OpenClaw / Adjutant (приватный агент)",
}

GROUP_LABELS: Dict[str, str] = {
    "agents": "настройки агентов",
    "channels": "настройки Telegram-канала",
    "gateway": "настройки шлюза",
    "plugins": "настройки плагинов",
    "tools": "настройки инструментов",
    "messages": "настройки сообщений",
    "telegram": "настройки Telegram",
}

ACTION_LABELS: Dict[str, str] = {
    "set": "установить",
    "remove": "удалить",
    "add": "добавить",
    "update": "обновить",
}


def risk_label(risk: str) -> str:
    mapping = {
        "low": "низкий",
        "medium": "средний",
        "high": "высокий",
        "critical": "критический",
    }
    return mapping.get(risk.lower(), risk)


def group_changes(changes: List[Any]) -> Dict[str, List[Dict[str, Any]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for change in changes:
        if not isinstance(change, dict):
            continue
        path = str(change.get("path", ""))
        prefix = path.split(".")[0]
        groups.setdefault(prefix, []).append(change)
    return groups


def render_single_proposal(path: Path, payload: Dict[str, Any]) -> str:
    title = str(payload.get("title", "Предложение об изменении"))
    source = str(payload.get("source_agent", ""))
    target = str(payload.get("target_agent", ""))
    risk = str(payload.get("risk_level", "неизвестно"))
    rationale = str(payload.get("rationale", ""))
    changes = payload.get("changes", []) if isinstance(payload.get("changes"), list) else []
    apply_hints = payload.get("apply_hints", []) if isinstance(payload.get("apply_hints"), list) else []

    source_label = AGENT_LABELS.get(source, source)
    target_label = AGENT_LABELS.get(target, target)

    lines: List[str] = []
    lines.append(f"<b>{escape_html(title)}</b>")
    lines.append("")

    # 1. Кем предлагается
    lines.append(f"👤 <b>Кем предлагается:</b>")
    lines.append(f"{escape_html(source_label)} → {escape_html(target_label)}")
    lines.append("")

    # 2. Что предлагается — сгруппировано по разделам
    if changes:
        grouped = group_changes(changes)
        lines.append(f"📋 <b>Что предлагается:</b>")
        for prefix, group_items in grouped.items():
            group_label = GROUP_LABELS.get(prefix, prefix)
            actions_in_group = set(
                ACTION_LABELS.get(str(c.get("action", "")), str(c.get("action", "")))
                for c in group_items
            )
            actions_str = ", ".join(sorted(actions_in_group))
            lines.append(f"• {escape_html(group_label)} — {actions_str} ({len(group_items)} пар.)")
        lines.append("")

    # 3. Чем лучше
    lines.append(f"✅ <b>Чем лучше:</b>")
    if rationale:
        lines.append(escape_html(rationale))
    else:
        lines.append("Не указано")
    lines.append("")

    # 4. Как улучшит работу
    lines.append(f"🚀 <b>Как улучшит работу:</b>")
    if apply_hints:
        for hint in apply_hints[:3]:
            lines.append(f"• {escape_html(str(hint))}")
    else:
        lines.append("Не указано")
    lines.append("")

    lines.append(f"⚠️ Риск: <b>{escape_html(risk_label(risk))}</b>")

    text = "\n".join(lines).strip()
    if len(text) > MAX_MESSAGE_LEN:
        text = text[: MAX_MESSAGE_LEN - 64] + "\n...\n(сообщение обрезано)"
    return text


def make_callback_token(proposal_id: str) -> str:
    seed = f"{proposal_id}:{utc_now_iso()}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


def parse_dt(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def cleanup_callback_map(raw_map: Dict[str, Any], ttl_hours: int) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    out: Dict[str, Any] = {}
    for token, value in raw_map.items():
        if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{12}", token):
            continue
        if not isinstance(value, dict):
            continue
        created_at = value.get("created_at")
        dt = parse_dt(str(created_at)) if created_at else None
        if dt is None:
            continue
        age_hours = (now - dt).total_seconds() / 3600.0
        if age_hours > max(1, ttl_hours):
            continue
        proposal_id = value.get("proposal_id")
        if not isinstance(proposal_id, str) or not proposal_id:
            continue
        out[token] = {
            "proposal_id": proposal_id,
            "created_at": value.get("created_at"),
            "expires_at": value.get("expires_at"),
        }
    return out


def trim_callback_map(raw_map: Dict[str, Any], max_items: int) -> Dict[str, Any]:
    if len(raw_map) <= max_items:
        return raw_map
    sortable: List[Tuple[str, Dict[str, Any], datetime]] = []
    for token, value in raw_map.items():
        created = parse_dt(str(value.get("created_at", "")))
        if created is None:
            created = datetime.fromtimestamp(0, tz=timezone.utc)
        sortable.append((token, value, created))
    sortable.sort(key=lambda x: x[2], reverse=True)
    trimmed = sortable[:max_items]
    return {token: value for token, value, _ in trimmed}


def load_settings(path: Path) -> Tuple[str, List[int]]:
    settings = load_json(path, default={})
    if not isinstance(settings, dict):
        raise RuntimeError(f"invalid settings file: {path}")
    telegram = settings.get("telegram")
    if not isinstance(telegram, dict):
        raise RuntimeError("settings.telegram not found")
    bot_token = telegram.get("token")
    if not isinstance(bot_token, str) or not bot_token or bot_token == "__KEEP_REMOTE__":
        raise RuntimeError("telegram token is empty or placeholder")
    users = telegram.get("allowedUserIds")
    if not isinstance(users, list):
        raise RuntimeError("settings.telegram.allowedUserIds must be list")
    allowed_ids: List[int] = []
    for value in users:
        if isinstance(value, int):
            allowed_ids.append(value)
        elif isinstance(value, str) and re.fullmatch(r"-?\d+", value):
            allowed_ids.append(int(value))
    if not allowed_ids:
        raise RuntimeError("no allowed telegram user ids configured")
    return bot_token, allowed_ids


def main() -> int:
    default_base_dir = os.getenv("TWIN_BASE_DIR", str(Path.home() / "twin-sync"))
    default_settings = os.getenv(
        "TWIN_SETTINGS_PATH",
        str(Path.home() / ".claude" / "claudeclaw" / "settings.json"),
    )
    parser = argparse.ArgumentParser(description="Send Telegram digest for twin proposals")
    parser.add_argument("--base-dir", default=default_base_dir)
    parser.add_argument("--settings", default=default_settings)
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--callback-ttl-hours", type=int, default=DEFAULT_CALLBACK_TTL_HOURS)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    base = Path(args.base_dir)
    proposal_dir = base / "outbox" / "proposals"
    state_file = base / "state" / "proposal-digest-state.json"
    callback_map_file = base / "state" / "proposal-callback-map.json"
    proposal_dir.mkdir(parents=True, exist_ok=True)

    state = load_json(state_file, default={"sent_ids": [], "last_sent_at": None})
    if not isinstance(state, dict):
        state = {"sent_ids": [], "last_sent_at": None}
    sent_ids = set(state.get("sent_ids", [])) if isinstance(state.get("sent_ids"), list) else set()

    all_files = sorted(proposal_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    pending: List[Tuple[Path, Dict[str, Any]]] = []
    for path in all_files:
        payload = parse_proposal(path)
        proposal_id = str(payload.get("proposal_id", path.stem))
        if proposal_id in sent_ids:
            continue
        pending.append((path, payload))
        if len(pending) >= max(1, args.limit):
            break

    if not pending:
        print(json.dumps({"timestamp": utc_now_iso(), "sent": 0, "pending": 0}, ensure_ascii=False))
        return 0

    # Build callback map and per-proposal keyboards
    callback_map = load_json(callback_map_file, default={})
    if not isinstance(callback_map, dict):
        callback_map = {}
    callback_map = cleanup_callback_map(callback_map, args.callback_ttl_hours)

    proposal_data: List[Tuple[Path, Dict[str, Any], str, Dict[str, Any]]] = []
    for _path, payload in pending:
        proposal_id = str(payload.get("proposal_id", _path.stem))
        cb_token = make_callback_token(proposal_id)
        created_at = utc_now_iso()
        expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=max(1, args.callback_ttl_hours))
        ).replace(microsecond=0).isoformat()
        callback_map[cb_token] = {
            "proposal_id": proposal_id,
            "created_at": created_at,
            "expires_at": expires_at,
        }
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "✅ Одобрить", "callback_data": f"twin_yes_{cb_token}"},
                    {"text": "❌ Отклонить", "callback_data": f"twin_no_{cb_token}"},
                ]
            ]
        }
        proposal_data.append((_path, payload, proposal_id, keyboard))

    callback_map = trim_callback_map(callback_map, MAX_CALLBACK_TOKENS)
    write_json(callback_map_file, callback_map)

    sent_count = 0
    if args.dry_run:
        if len(pending) > 1:
            print(f"=== {len(pending)} предложений ===\n")
        for _path, payload, _pid, keyboard in proposal_data:
            print(render_single_proposal(_path, payload))
            print(f"[кнопки: ✅ Одобрить | ❌ Отклонить]")
            print()
    else:
        bot_token, chat_ids = load_settings(Path(args.settings))

        # Send header if multiple proposals
        if len(pending) > 1:
            header = f"📋 Новых предложений: <b>{len(pending)}</b>"
            for chat_id in chat_ids:
                try:
                    telegram_send_message(bot_token, chat_id, header)
                except urllib.error.HTTPError as exc:
                    body = exc.read().decode("utf-8", errors="replace")
                    raise RuntimeError(
                        f"telegram send failed for chat_id={chat_id}: {exc.code} {body}"
                    ) from exc

        # Send each proposal as a separate message
        for _path, payload, _pid, keyboard in proposal_data:
            message = render_single_proposal(_path, payload)
            for chat_id in chat_ids:
                try:
                    telegram_send_message_with_keyboard(bot_token, chat_id, message, keyboard)
                except urllib.error.HTTPError as exc:
                    body = exc.read().decode("utf-8", errors="replace")
                    raise RuntimeError(
                        f"telegram send failed for chat_id={chat_id}: {exc.code} {body}"
                    ) from exc
            sent_count += 1

    if not args.dry_run:
        for _path, payload, proposal_id, _keyboard in proposal_data:
            sent_ids.add(proposal_id)
        new_state = {
            "sent_ids": sorted(sent_ids),
            "last_sent_at": utc_now_iso(),
            "last_batch_size": len(pending),
            "last_chat_count": sent_count,
        }
        write_json(state_file, new_state)
    print(json.dumps({"timestamp": utc_now_iso(), "sent": sent_count, "pending": len(pending)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
