# ARCHITECTURE — ClaudeClaw Sterile Agent

## Цель

Стерильный ClaudeClaw на VPS: не ходит в интернет произвольно, принимает только данные после санитайзера.

## Контур

- `Telegram -> ClaudeClaw` — владелец отправляет запросы боту
- `Workers -> /home/claudeclaw/inbox/` — внешние боты складывают сырые данные
- `sanitizer.py` — проверяет и пропускает только безопасные данные
- `/home/claudeclaw/checked/` — единственный вход внешнего контента в контур ClaudeClaw
- `ingest-checked.sh` — переносит checked в processed, строит wrapped-контент и provenance-индекс

## Границы доверия

- `owner_direct` — прямые сообщения владельца из Telegram (доверенные)
- `sanitized_external` — внешние данные после санитайзера (все еще недоверенные)

## Defense in Depth

1. Санитайзер блокирует injection/обфускацию до попадания в checked.
2. В checked-данные добавляется `external_content`-обертка с security notice.
3. `disallowedTools` запрещает `WebSearch`, `WebFetch`, `Bash`.
4. Firewall ограничивает egress для пользователя `claudeclaw`:
   - Anthropic API (443)
   - Telegram API (443)
   - DNS только к resolver IP из `resolv.conf`
   - localhost

## Известные ограничения

- ClaudeClaw работает через spawn `claude -p`, поэтому latency ответа зависит от запуска CLI + API roundtrip.
- Без отдельного worker-пула сбор внешних данных выполняется внешними ботами, не в этом контуре.
