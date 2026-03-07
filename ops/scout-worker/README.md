# Scout Worker VPS

Отдельный стек для внешнего агента `Scout`.

Роль `Scout`:
- внешний поиск и ресерч (scheduled + on-demand);
- формирование исследовательских артефактов;
- отправка результатов в raw inbox санитайзера.

`Scout` не делает дайджесты и не публикует в Telegram-каналы.

## Текущие возможности Scout

- `weather_lookup` — погода и базовая метрика.
- `web_search` — поиск в сети по запросу.
- `youtube_search` — поиск видео/каналов YouTube по теме.
- `social_search` — поиск по соцсетям (X/LinkedIn/Reddit).
- `messenger_channels_search` — поиск каналов в мессенджерах (Telegram/Discord).
- `deep_research` — мультизапросный ресерч с чтением top-источников.
- `reddit_scan` — сбор обсуждений Reddit.
- `youtube_transcribe` — транскрипт YouTube + summary.
- `summarize_text` — сжатие длинного текста.
- `analyze_topic` — анализ темы по web+reddit.
- `skills_catalog` — выдача каталога скиллов.

## Структура

- `contracts/` — JSON Schema входящего задания и результата.
- `scout-vps/` — bootstrap, worker, systemd units.
- `scripts/` — удаленный deploy на Scout VPS.

## Поток данных

1. Bot VPS пишет задание в `/home/claudeclaw/inbox/requests`.
2. Bridge `push-requests-to-scout.sh` доставляет request в `ScoutVPS:/srv/scout/inbox/requests`.
3. `scout_worker.py` обрабатывает задание и формирует ответ.
4. Ответ сохраняется в `/srv/scout/outbox/raw`.
5. Transport `push-raw-to-sanitizer.sh` доставляет raw-файлы в `SanitizerVPS:/srv/sanitizer/inbox/raw`.

## Примеры заданий (inbox request)

```json
{
  "schema_version": "1.0",
  "request_id": "job-001",
  "task_type": "web_search",
  "created_at": "2026-03-07T06:00:00Z",
  "query": "best AI agent frameworks 2026",
  "max_results": 10
}
```

```json
{
  "schema_version": "1.0",
  "request_id": "job-002",
  "task_type": "youtube_transcribe",
  "created_at": "2026-03-07T06:00:00Z",
  "query": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "languages": ["ru", "en"]
}
```

```json
{
  "schema_version": "1.0",
  "request_id": "job-003",
  "task_type": "social_search",
  "created_at": "2026-03-07T06:00:00Z",
  "query": "best AI coding creators on X",
  "max_results": 12
}
```

```json
{
  "schema_version": "1.0",
  "request_id": "job-004",
  "task_type": "messenger_channels_search",
  "created_at": "2026-03-07T06:00:00Z",
  "query": "AI robotics telegram channels",
  "max_results": 12
}
```

```json
{
  "schema_version": "1.0",
  "request_id": "job-005",
  "task_type": "skills_catalog",
  "created_at": "2026-03-07T06:00:00Z",
  "query": "list skills"
}
```

## Минимальный запуск

1. Поднять отдельный Scout VPS (не совмещать с Bot/Sanitizer VM).
2. Выполнить:

```bash
SCOUT_HOST=<ip> SCOUT_USER=root bash ops/scout-worker/scripts/deploy-scout-vps.sh
```

С автонастройкой transport на санитайзер:

```bash
SCOUT_HOST=<scout_ip> SAN_HOST=<san_ip> SAN_USER=sanitizer \
bash ops/scout-worker/scripts/deploy-scout-vps.sh
```

Настроить SSH-доверие для transport (Scout user -> Sanitizer user):

```bash
SCOUT_HOST=<scout_ip> SAN_HOST=<san_ip> \
bash ops/scout-worker/scripts/setup-scout-to-sanitizer-ssh.sh
```

3. Проверить таймеры и path units:

```bash
systemctl status scout-poll.timer scout-poll.path scout-scan.timer
systemctl status scout-push.timer scout-push.path
```

4. Настроить bridge Bot -> Scout (обязательно для Telegram-flow):

```bash
SCOUT_HOST=<scout_ip> BOT_HOST=136.244.83.50 \
bash ops/scout-worker/scripts/setup-bot-to-scout-ssh.sh

SCOUT_HOST=<scout_ip> BOT_HOST=136.244.83.50 \
bash ops/scout-worker/scripts/deploy-bot-scout-request-bridge.sh
```

## E2E тест weather_lookup

```bash
SCOUT_HOST=<scout_ip> SAN_HOST=<san_ip> BOT_HOST=136.244.83.50 \
bash ops/scout-worker/scripts/e2e-weather.sh
```

## Cutover на новый Scout VPS

Единый скрипт миграции на новый чистый хост:

```bash
NEW_SCOUT_HOST=<new_scout_ip> SAN_HOST=<san_ip> BOT_HOST=136.244.83.50 \
OLD_SCOUT_HOST=<old_scout_ip> \
bash ops/scout-worker/scripts/cutover-scout-host.sh
```

Если старый хост отключать позже:

```bash
NEW_SCOUT_HOST=<new_scout_ip> SAN_HOST=<san_ip> BOT_HOST=136.244.83.50 \
bash ops/scout-worker/scripts/cutover-scout-host.sh
```

## Инварианты безопасности

- Отдельный пользователь `scout`.
- Отдельные ключи и токены (без пересечений с Bot/Sanitizer).
- Никаких общих файловых томов с Bot/Sanitizer.
- Внешний трафик только для поиска/ресерча + доставка raw в санитайзер.
