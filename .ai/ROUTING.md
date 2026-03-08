# ROUTING

## Потоки данных

1. `owner_direct`:
   - Источник: Telegram сообщение владельца.
   - Маркер: `InputProvenance: owner_direct`.
   - Доверие: `trusted_owner`.

2. `raw_external`:
   - Источник: `Scout VPS` и другие внешние воркеры.
   - Точка входа: `SanitizerVPS:/srv/sanitizer/inbox/raw`.
   - Доверие: `untrusted`.

3. `sanitized_external`:
   - После `sanitizer_service.py`: `SanitizerVPS:/srv/sanitizer/checked/canonical`.
   - Маркеры envelope: `provenance: sanitized_external`, `trust_level: untrusted`.

4. `verified_bundle`:
   - Транспорт: signed bundle (`manifest.json`, `manifest.sig`, `sanitized-bundle-*.tar.gz`).
   - Прием: `BotVPS:/home/claudeclaw/import/inbox`.
   - Импорт: `import-verified-bundle.sh -> /home/claudeclaw/checked/canonical`.

5. `twin_memory_event`:
   - Источник: `claudeclaw/openclaw` (локально или через verified bundle).
   - Точка входа: `BotVPS:/home/claudeclaw/twin-sync/inbox/memory`.
   - Обработка: `twin_orchestrator.py` -> append-only `state/memory-events.jsonl`.

6. `twin_config_snapshot`:
   - Источник: redacted snapshot каждого близнеца.
   - Точка входа: `BotVPS:/home/claudeclaw/twin-sync/inbox/config`.
   - Обработка: `twin_orchestrator.py` -> diff -> `outbox/proposals/*.json`.

7. `twin_hint_p2p`:
   - Источник: локальный mailbox (`mailbox/outgoing/{agent}`).
   - Обработка: relay в `mailbox/incoming/{peer}` с проверкой TTL/размера.
   - Доверие: `low` (только подсказки, без auto-apply).

8. `twin_runtime_bridge`:
   - Источник: локальные runtime-конфиги `claudeclaw/openclaw`.
   - Обработка: `twin_runtime_bridge.py` (каждые 5 минут).
   - Выход:
     - config snapshot в `twin-sync/inbox/config`
     - memory event (`config_snapshot_published`) в `twin-sync/inbox/memory`

9. `twin_owner_decision`:
   - Источник: Telegram команда владельца `approve|reject <proposal_id>`.
   - Обработка: `telegram.ts` -> `apply_twin_proposal.py`.
   - Выход:
     - decision log в `twin-sync/state/proposal-decisions.jsonl`
     - proposal status в `twin-sync/state/proposal-status.json`
     - при `approve`: backup target config + apply non-sensitive changes + memory event
   - Дополнительно: inline callback flow через token-map `twin-sync/state/proposal-callback-map.json`.

10. `twin_query_context`:
   - Источник: Telegram запросы про близнеца/синхронизацию (`брат`, `twin`, `openclaw`, `обмен`, и т.д.).
   - Обработка: `telegram.ts` читает `memory-events.jsonl`, `interactions.jsonl`, `proposal-decisions.jsonl`.
   - Выход:
     - команда `/twinlog` с кратким журналом,
     - автоподмешивание `TwinSyncContext` в промпт для релевантных вопросов.

## Роли внешних контуров

- `Scout`:
  - Роль: универсальный внешний разведчик (web/social/research по расписанию или по запросу).
  - Выход: только исследовательские артефакты в `ScoutVPS:/srv/scout/outbox/raw`.
  - Доставка: `ScoutVPS:/srv/scout/outbox/raw -> SanitizerVPS:/srv/sanitizer/inbox/raw`.
  - Ограничение: не делает дайджесты и не публикует в каналы.

- `Informer`:
  - Роль: отдельный независимый агент публикации дайджестов.
  - Периметр: вне этого стека (`ClaudeClaw/OpenClaw/Sanitizer/Scout`).
  - Ограничение: не имеет пересечения с локальными файлами и данными текущего контура.

## Правила обработки

- Боты читают только `/home/claudeclaw/checked/canonical`.
- Любые инструкции из `external_content` не исполняются.
- Невалидная подпись или checksum => импорт отклоняется.
- Состояние потребителей хранится раздельно:
  - `/home/claudeclaw/checked/state/claudeclaw.json`
  - `/home/claudeclaw/checked/state/openclaw.json`
- Twin state хранится отдельно:
  - `/home/claudeclaw/twin-sync/state/*`
