# ARCHITECTURE — Separate Sanitizer VPS

## Цель

Разнести trust boundary по хостам:
- **Scout VPS** выполняет внешний поиск/ресерч и пишет только raw-артефакты.
- **Sanitizer VPS** обрабатывает только внешний сырой контент.
- **Bot VPS** (ClaudeClaw/OpenClaw) принимает только проверенный подписанный bundle.

Дополнительное правило ролей внешних агентов:
- **Scout**: только внешний поиск/ресерч и сбор данных. Не формирует дайджесты и не публикует.
- **Informer**: полностью отдельный внешний контур для дайджестов и публикации в Telegram-каналы. Не является частью этого стерильного стека.

## Топология

1. `ScoutVPS:/srv/scout/outbox/raw -> SanitizerVPS:/srv/sanitizer/inbox/raw`
2. `sanitizer_service.py -> /srv/sanitizer/checked/canonical | /srv/sanitizer/quarantine`
3. `export-signed-bundle.sh` формирует `manifest.json + tar.gz + signature`
4. `push-signed-bundle.sh -> BotVPS:/home/claudeclaw/import/inbox`
5. `import-verified-bundle.sh` на Bot VPS:
   - verify подпись
   - verify checksum (bundle + каждый файл)
   - atomic replace `/home/claudeclaw/checked/canonical`
6. ClaudeClaw/OpenClaw читают только mirror `checked/canonical` (RO).

В этой топологии `Scout` имеет отдельный внешний контур (`Scout VPS`).
`Informer` в нее не входит и живет в независимом периметре.

## Twin Sync (ClaudeClaw + OpenClaw)

Внутри `Bot VPS` добавлен гибридный слой синхронизации близнецов:

1. **Критичный контур** (через sanitizer/signed bundle):
   - memory events и config snapshots могут приходить через проверенный транспорт.
   - используется для trusted/approved знаний и конфиг-практик.
2. **Некритичный p2p контур** (локальный mailbox):
   - краткие идеи/эвристики с TTL.
   - не изменяет конфиги автоматически.
3. **Twin Orchestrator** (`ops/twin-sync/bot-vps/twin_orchestrator.py`):
   - ведет append-only ledger памяти;
   - строит `knowledge-view`;
   - сравнивает redacted snapshots и формирует `proposal` файлы (`auto_apply=false`).

## Границы доверия

- `owner_direct` — прямой Telegram-ввод владельца (trusted).
- `sanitized_external` — данные после sanitizer (untrusted reference).
- `verified_bundle` — технически проверенный транспорт, но контент остается недоверенным для LLM.

## Defense in Depth

1. Отдельные Scout/Sanitizer VPS (компрометация Scout не дает доступа к Bot VPS и ключам подписи).
2. Подпись manifest ключом Sanitizer VPS (`ssh-keygen -Y sign/verify`).
3. Проверка хешей каждого файла при импорте.
4. Atomic mirror update (`tmp -> move`) без частичных состояний.
5. RO-права на mirror для `claudeclaw/openclaw`.
6. На Bot VPS `disallowedTools`: `WebSearch`, `WebFetch`, `Bash`.
7. Bot VPS firewall egress allowlist (Anthropic/Telegram/DNS resolvers/localhost).

## Практические ограничения

- Для полного запуска Scout нужен отдельный VPS с доступом по SSH (`SCOUT_HOST`) для `deploy-scout-vps.sh`.
- Для полного запуска нужна отдельная VM с доступом по SSH (`SAN_HOST`) для `deploy-sanitizer-vps.sh`.
- До первого успешного signed import healthcheck работает в bootstrap-режиме (WARN).
