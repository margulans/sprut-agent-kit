# Twin Sync (ClaudeClaw + OpenClaw)

Минимальная реализация «агентов-близнецов»:

- общий append-only журнал памяти;
- обмен некритичными подсказками через p2p mailbox;
- снимки конфигов без секретов и авто-генерация proposal-файлов;
- owner approval loop (`auto_apply=false`).

## Что добавлено

- Оркестратор: `ops/twin-sync/bot-vps/twin_orchestrator.py`
- Публикатор артефактов: `ops/twin-sync/bot-vps/publish_twin_artifact.py`
- Runtime bridge: `ops/twin-sync/bot-vps/twin_runtime_bridge.py`
- Proposal applier: `ops/twin-sync/bot-vps/apply_twin_proposal.py`
- Digest sender: `ops/twin-sync/bot-vps/send_proposals_digest.py`
- systemd units:
  - `ops/twin-sync/bot-vps/systemd/twin-orchestrator.service`
  - `ops/twin-sync/bot-vps/systemd/twin-orchestrator.timer`
  - `ops/twin-sync/bot-vps/systemd/twin-runtime-bridge.service`
  - `ops/twin-sync/bot-vps/systemd/twin-runtime-bridge.timer`
  - `ops/twin-sync/bot-vps/systemd/twin-proposals-digest.service`
  - `ops/twin-sync/bot-vps/systemd/twin-proposals-digest.timer`
- deploy script:
  - `ops/twin-sync/scripts/deploy-twin-orchestrator.sh`
- Контракты:
  - `ops/vps-sync/contracts/twin-memory-event.schema.json`
  - `ops/vps-sync/contracts/twin-config-snapshot.schema.json`
  - `ops/vps-sync/contracts/twin-config-proposal.schema.json`

## Директории на Bot VPS

Базовый путь: `/home/<agent_user>/twin-sync` (или `TWIN_BASE_DIR`)

- `inbox/memory/` — входящие memory events от обоих агентов
- `inbox/config/` — входящие config snapshots
- `mailbox/outgoing/{claudeclaw,openclaw}/` — исходящие p2p hints
- `mailbox/incoming/{claudeclaw,openclaw}/` — доставленные p2p hints
- `outbox/proposals/` — предложения по выравниванию конфигов
- `outbox/views/knowledge-view.json` — агрегированный knowledge view
- `state/` — ledger, snapshots, метрики, дедуп-индексы
- `archive/` — обработанные файлы
- `quarantine/` — отклоненные/битые файлы

Runtime bridge пишет:
- `state/runtime-bridge-hashes.json`
- `state/runtime-bridge-stats.json`

## Быстрый старт

1. Bootstrap чистого VPS (если нет пользователя и репозитория):

```bash
BOT_HOST=<ip> BOT_USER=root BOT_AGENT_USER=adjutant \
bash ops/twin-sync/scripts/bootstrap-twin-vps.sh
```

2. Деплой на уже подготовленный VPS:

```bash
BOT_HOST=<ip> BOT_USER=root BOT_AGENT_USER=adjutant \
bash ops/twin-sync/scripts/deploy-twin-orchestrator.sh
```

3. Проверить запуск:

```bash
ssh root@<ip> 'systemctl status twin-orchestrator.timer twin-orchestrator.service --no-pager'
ssh root@<ip> 'systemctl status twin-runtime-bridge.timer twin-runtime-bridge.service --no-pager'
ssh root@<ip> 'systemctl status twin-proposals-digest.timer twin-proposals-digest.service --no-pager'
```

4. Посмотреть метрики:

```bash
ssh root@<ip> 'cat /home/<agent_user>/twin-sync/state/metrics.json'
ssh root@<ip> 'cat /home/<agent_user>/twin-sync/state/runtime-bridge-stats.json'
ssh root@<ip> 'cat /home/<agent_user>/twin-sync/state/proposal-digest-state.json'
```

## Примеры публикации артефактов

Memory event:

```bash
python3 ops/twin-sync/bot-vps/publish_twin_artifact.py memory \
  --agent-id claudeclaw \
  --domain interaction \
  --fact-type best_practice \
  --payload-json /tmp/fact.json \
  --tags owner_style concise
```

Config snapshot:

```bash
python3 ops/twin-sync/bot-vps/publish_twin_artifact.py config \
  --agent-id openclaw \
  --config-version runtime-2026-03-07 \
  --config-json /tmp/openclaw-redacted-config.json
```

P2P hint:

```bash
python3 ops/twin-sync/bot-vps/publish_twin_artifact.py hint \
  --from-agent claudeclaw \
  --to-agent openclaw \
  --title "Новая эвристика ответа" \
  --message "Если запрос про свежие факты, форсируй внешний контур Scout." \
  --ttl-hours 24 \
  --tags heuristic routing
```

## Автопубликация runtime сигналов

`twin_runtime_bridge.py` каждые 5 минут:

- ищет конфиг `claudeclaw` и `openclaw` по known path candidates;
- делает redacted snapshot (маскирует чувствительные ключи);
- если hash изменился — публикует:
  - config snapshot в `inbox/config`
  - memory event `config_snapshot_published` в `inbox/memory`

Override путей (если нестандартный хост):

```bash
python3 ops/twin-sync/bot-vps/twin_runtime_bridge.py --once \
  --claudeclaw-config /path/to/claudeclaw/settings.json \
  --openclaw-config /path/to/openclaw/settings.json
```

## Telegram digest по proposal

`twin-proposals-digest.timer` каждые 10 минут:

- читает новые файлы из `outbox/proposals/*.json`;
- отправляет compact digest в Telegram `allowedUserIds`;
- добавляет inline-кнопки `Approve/Reject` для каждого proposal;
- дедуплицирует отправки через `state/proposal-digest-state.json`.

Callback map:

- `state/proposal-callback-map.json` (token -> proposal_id)
- token TTL по умолчанию: 24 часа
- авто-очистка просроченных token-ов при каждом digest запуске
- hard cap размера callback map: 500 token-ов (старые обрезаются)

Dry-run без отправки:

```bash
python3 ops/twin-sync/bot-vps/send_proposals_digest.py --dry-run --limit 3
```

## Approve/reject из Telegram

В Telegram runtime добавлен парсер решений:

- `approve <proposal_id> [comment]`
- `reject <proposal_id> [comment]`
- `/twin` — подсказка по командам

Также поддержан one-tap flow через inline callback кнопки digest-сообщения.

Команды вызывают:

```bash
python3 ops/twin-sync/bot-vps/apply_twin_proposal.py \
  --proposal-id <proposal_id> \
  --decision approve|reject \
  --comment "<optional>"
```

`approve`:
- применяет только non-sensitive changes (`set/remove`);
- создает backup target config в `state/config-backups/*`;
- пишет decision log в `state/proposal-decisions.jsonl`;
- создает memory event в `inbox/memory`.

## Ограничения безопасности

- Оркестратор не применяет изменения автоматически.
- Proposal всегда с `auto_apply=false`.
- Секретные ключи (`token`, `secret`, `password`, `api_key`, и т.д.) фильтруются из diff.
- P2P mailbox ограничен по размеру и TTL; просроченные hints не доставляются.

## Параметры окружения (без хардкода путей)

- `BOT_AGENT_USER` — системный пользователь агента на VPS.
- `BOT_AGENT_GROUP` — группа для systemd units (по умолчанию = user).
- `BOT_HOME` — home директория агента (`/home/$BOT_AGENT_USER` по умолчанию).
- `REPO_DIR` — путь до репозитория `sprut-agent-kit`.
- `TWIN_BASE_DIR` — базовый путь twin state (`$HOME/twin-sync` по умолчанию).
- `TWIN_SETTINGS_PATH` — путь к settings для digest sender.

