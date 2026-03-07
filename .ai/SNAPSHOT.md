# SNAPSHOT

Обновлено: 2026-03-07

## Хост

- Bot VPS: Vultr (Frankfurt)
- Scout VPS: `159.223.23.107` (clean cutover completed)
- Sanitizer VPS: `46.101.248.197` (pipeline active)
- OS: Ubuntu 24.04
- Пользователь агента: `claudeclaw`
- Telegram bot: `@AdjutantClaude_bot`

## Модели

- Primary: `claude-sonnet-4-6`
- Fallback: `claude-opus-4-6`

## Separate Sanitizer контур

- Sanitizer VPS:
  - `/srv/sanitizer/inbox/raw` -> `sanitizer_service.py` -> `/srv/sanitizer/checked/canonical` или `/srv/sanitizer/quarantine`
  - `export-signed-bundle.sh` + `push-signed-bundle.sh`
- Bot VPS:
  - `/home/claudeclaw/import/inbox` -> `import-verified-bundle.sh` -> `/home/claudeclaw/checked/canonical`
  - consumer state: `/home/claudeclaw/checked/state/{claudeclaw,openclaw}.json`
- Telegram prompt добавляет provenance:
  - `InputProvenance: owner_direct`
  - `TrustLevel: trusted_owner`

## Ролевое разделение внешних агентов

- `Scout`: внешний ресерч-агент (scheduled + on-demand), без функций дайджеста/публикации.
- `Informer`: независимый отдельный publishing-контур для 3 дайджестов, вне текущего стерильного стека.

## Scout контур

- `ops/scout-worker/*` добавлен:
  - bootstrap `scout-vps/bootstrap-scout-vps.sh`
  - worker `scout-vps/scout_worker.py`
  - transport: `scout-vps/push-raw-to-sanitizer.sh`
  - timers/paths: `scout-poll.timer|path`, `scout-push.timer|path`, `scout-scan.timer`
  - deploy: `scripts/deploy-scout-vps.sh`
  - e2e: `scripts/e2e-weather.sh`
  - skills: `web_search`, `youtube_search`, `social_search`, `messenger_channels_search`, `deep_research`, `reddit_scan`, `youtube_transcribe`, `summarize_text`, `analyze_topic`, `skills_catalog`
- Данные:
  - inbox: `/srv/scout/inbox/requests`
  - outbox raw: `/srv/scout/outbox/raw`
  - state: `/srv/scout/state`
- Transport:
  - bridge `Bot:/home/claudeclaw/inbox/requests -> Scout:/srv/scout/inbox/requests` активен (`scout-request-push.timer|path`)
  - `scout-push.timer` и `scout-push.path` активны
  - SSH trust `scout -> sanitizer` восстановлен (key-based)
  - SSH trust `bot(claudeclaw) -> scout` активен (key-based)
- E2E:
  - `weather_lookup` успешно прошел до `BotVPS:/home/claudeclaw/checked/canonical`
  - `web_search` успешно прошел до `BotVPS:/home/claudeclaw/checked/canonical`
- Legacy:
  - Scout timers на старом хосте `89.167.81.12` отключены

## Безопасность

- Firewall chain `CLAUDECLAW` активна
- DNS egress ограничен системными resolvers
- Разрешен egress `claudeclaw -> ScoutVPS:22` для request bridge
- `disallowedTools`: `Bash`, `WebSearch`, `WebFetch`
- Подготовлен signed-transfer: `manifest + signature + checksum verify`
- RO-права на mirror для ботов применены

## Cron

- `*/5 * * * *` sanitizer
- `*/15 * * * *` ingest checked
- `0 */6 * * *` firewall refresh
- `0 */3 * * *` reconcile from repo

## Systemd timers (Bot VPS)

- `sanitizer-import.timer` — active
- `sanitizer-import.path` — active (event-driven fast lane)
- `checked-health.timer` — active (bootstrap WARN до первого успешного import)

## Twin Sync (Bot VPS)

- В репозитории добавлен модуль `ops/twin-sync/*`:
  - `twin_orchestrator.py` (append-only memory ledger + config diff proposals + p2p relay)
  - `publish_twin_artifact.py` (memory/config/hint publisher)
  - `twin_runtime_bridge.py` (автопубликация config snapshots + config_change events)
  - `send_proposals_digest.py` (Telegram digest новых proposals)
  - `apply_twin_proposal.py` (approve/reject + apply non-sensitive changes)
  - systemd units `twin-orchestrator.service|timer`
  - systemd units `twin-runtime-bridge.service|timer`
  - systemd units `twin-proposals-digest.service|timer`
- Контракты добавлены:
  - `ops/vps-sync/contracts/twin-memory-event.schema.json`
  - `ops/vps-sync/contracts/twin-config-snapshot.schema.json`
  - `ops/vps-sync/contracts/twin-config-proposal.schema.json`
- Runtime статус на боевом хосте: `pending deploy` (через `ops/twin-sync/scripts/deploy-twin-orchestrator.sh`)
- В `ops/vps-sync/runtime/telegram.ts` добавлены owner-команды:
  - `approve <proposal_id> [comment]`
  - `reject <proposal_id> [comment]`
  - `/twin`

## Fast lane status

- Event-driven units включены на Scout VPS, Sanitizer VPS и Bot VPS.
- E2E (`weather_lookup`) подтверждён после восстановления trust и обновления SAN_HOST.
- Сквозной замер `Bot -> Scout -> Sanitizer -> Bot checked` для `web_search`: `~88.9s`.

## Skills

- Офлайн-скиллы включены
- Добавлен `healthcheck` (VPS hardening / audit)
