# BACKLOG — ClaudeClaw Sterile Agent

Бэклог проекта стерильного AI-агента на VPS (Vultr, Frankfurt).
VPS IP: 136.244.83.50 | User: claudeclaw | Bot: @AdjutantClaude_bot

---

## Выполнено

### Фаза 0: Базовая установка
- [x] Развернуть VPS (Vultr, Frankfurt, Ubuntu 24.04, 2 vCPU / 4 GB RAM / 80 GB SSD)
- [x] Установить Claude Code, Bun, Node.js для пользователя `claudeclaw`
- [x] Установить ClaudeClaw плагин + SPRUT Agent Kit
- [x] Настроить Telegram бот (@AdjutantClaude_bot)
- [x] Настроить systemd daemon с автозапуском
- [x] Персонализировать CLAUDE.md (Маргулан Сейсембаев, Asia/Almaty, русский)
- [x] Настроить модели: Sonnet 4.6 (основная) + Opus 4.6 (fallback)

### Фаза 1: Изоляция (стерильный агент)
- [x] Удалить 16 сетевых skills (осталось 9 офлайн)
- [x] Настроить iptables: claudeclaw → только Anthropic API, Telegram, DNS, localhost
- [x] Ужесточить DNS egress: разрешить DNS только к resolver IP из `resolv.conf`
- [x] Создать структуру `/checked/`, `/inbox/`, `/quarantine/`
- [x] Создать пользователя `sanitizer` с доступом к папкам
- [x] Написать `sanitizer.py` (prompt injection, unicode, base64, homoglyphs, HTML/JS)
- [x] Настроить cron: санитайзер */5 мин, ingest */15 мин, firewall refresh */6 часов
- [x] Отключить инструменты WebSearch и WebFetch через `disallowedTools`
- [x] Усилить deny-list инструментов: добавить `Bash` в `disallowedTools`

### Фаза 2: Оптимизация контекста
- [x] Сжать промпт-файлы: 8,881 → 2,923 байт (−67%, ~1,500 токенов/запрос)
- [x] Заполнить IDENTITY.md и USER.md (были пустые шаблоны)
- [x] Убрать дублирование SOUL.md (англ) и CLAUDE.md (рус)
- [x] Обновить SOUL.md и AGENTS.md под стерильную архитектуру
- [x] Удалить 6 ненужных плагинов (осталось 4: claudeclaw, claude-mem, ralph-loop, hookify)
- [x] Патч preflight.ts: убрать git clone с GitHub (заблокирован firewall)
- [x] Добавить provenance-маркировку в Telegram prompt (`owner_direct`)
- [x] Добавить provenance (`sanitized_external`) и trust-level (`untrusted`) в sanitizer envelope
- [x] Добавить `external_content`-обертку для checked-контента (defense in depth)
- [x] Добавить provenance index (`/checked/processed/provenance-index.jsonl`)

### Фаза 2.5: Документация архитектуры
- [x] Создать структуру `.ai/`: `INDEX`, `ARCHITECTURE`, `SNAPSHOT`, `ROUTING`, `EVOLUTION`, `INFRA`
- [x] Добавить офлайн-скилл `skills/healthcheck` для аудита VPS

### Фаза 2.6: Двусторонняя синхронизация локально ↔ VPS
- [x] Создать `ops/vps-sync/` с canonical-конфигами и runtime snapshot
- [x] Добавить `sync-to-vps.sh` (деплой canonical-файлов на сервер)
- [x] Добавить `sync-from-vps.sh` (обратная синхронизация с сервера в репо)
- [x] Добавить `apply-runtime-patches.sh` (идемпотентные патчи plugin runtime)
- [x] Убрать секреты из Git: `telegram.token = __KEEP_REMOTE__`, при deploy сохранять токен сервера
- [x] Синхронизировать `CLAUDE.md`, `SOUL.md`, `AGENTS.md` с боевым VPS 1-в-1
- [x] Настроить VPS cron синхронизацию каждые 3 часа (`claudeclaw-reconcile-from-repo.sh`)
- [x] Сделать sync детерминированным: pinned plugin version + checksum validation + dry-run
- [x] Добавить двухшаговый Telegram flow для внешних запросов (Scout ack -> final/timeout)

### Принятое архитектурное разделение ролей
- [x] Зафиксировать, что `Scout` = только внешний поиск/ресерч (без дайджестов и публикаций)
- [x] Зафиксировать, что `Informer` = отдельный независимый publishing-контур вне текущего стека

### Фаза 3: Separate Sanitizer VPS (двух-VPS контур)
- [x] Добавить deploy stack для отдельного Sanitizer VPS (`ops/separate-sanitizer/sanitizer-vps/*`)
- [x] Добавить signed bundle transfer (manifest + signature + checksum contract)
- [x] Добавить verify+atomic import pipeline на Bot VPS
- [x] Включить RO-права к `/home/claudeclaw/checked/canonical` для ботов
- [x] Настроить Bot VPS timers: `sanitizer-import.timer`, `checked-health.timer`
- [x] Добавить runbook и обновить `.ai` документацию под two-VPS архитектуру

---

## В работе

_(пусто)_

---

## Запланировано

### Фаза 3.1: Доведение Separate Sanitizer VPS до прода
- [ ] Поднять отдельный VPS и выполнить `ops/separate-sanitizer/scripts/deploy-sanitizer-vps.sh` с реальным `SAN_HOST`
- [ ] Установить sanitizer signing pubkey в `/etc/sanitizer/allowed_signers` на Bot VPS
- [ ] Добавить sanitizer SSH pubkey в `/home/sanitizerdeploy/.ssh/authorized_keys` на Bot VPS
- [ ] Прогнать e2e тест signed import (1 clean bundle + 1 tampered bundle)

### Фаза 4: Рабочие боты
- [ ] Выбрать и запустить `Scout` как первого рабочего бота (ресёрч / Reddit / YouTube)
- [ ] Реализовать Docker-песочницу для рабочего бота
- [ ] Написать `Scout`: сбор данных → JSON → `/inbox/`
- [ ] Протестировать полный цикл: `Scout` → inbox → sanitizer → checked → ClaudeClaw
- [ ] Добавить Telegram-уведомления от санитайзера при карантине

### Фаза 4.1: Scout (чистый ресерч-контур)
- [x] Контракт `scout-request`/`scout-response` для on-demand и scheduled режимов
- [ ] Источники: web/social/video/news с дедупликацией и traceability
- [x] Подключены core источники: web (DuckDuckGo), Reddit, YouTube transcript, weather
- [x] Добавлены поисковые task types по YouTube, соцсетям и мессенджер-каналам
- [x] В Telegram-router добавлен fast/research трек и late-delivery для тяжёлых Scout-запросов
- [x] Добавлен event-driven fast lane через systemd path units (Scout/Sanitizer/Bot)
- [x] Добавлен hard guardrail: актуальные факты не отвечаются из памяти без Scout
- [x] Добавлен bridge Bot -> Scout request transport (path/timer + SSH trust)
- [x] Исправлены fast-lane path-триггеры (`sanitizer-export.path`, `sanitizer-import.path`) и таймауты доставки
- [x] SLA: fast-path/fallback/timeout для запросов владельца (через Telegram runtime flow)
- [x] Явно запретить в Scout функции дайджеста и публикации
- [x] Добавить deploy stack `ops/scout-worker/*` (bootstrap, worker, systemd, deploy script)
- [x] Реализовать core skill-движок Scout: web_search, deep_research, reddit_scan, youtube_transcribe, summarize_text, analyze_topic, skills_catalog
- [x] Поднять отдельный Scout VPS и выполнить `ops/scout-worker/scripts/deploy-scout-vps.sh`
- [x] Реализовать transport stack (`push-raw-to-sanitizer.sh` + `scout-push.timer`)
- [x] Настроить transport `ScoutVPS:/srv/scout/outbox/raw -> SanitizerVPS:/srv/sanitizer/inbox/raw` на боевых VPS
- [x] Восстановить SSH trust `Scout -> Sanitizer` после ротации ключей/хоста (устранено `Permission denied (publickey)`)
- [x] Прогнать e2e `ops/scout-worker/scripts/e2e-weather.sh` до `BotVPS:/home/claudeclaw/checked/canonical`
- [x] Прогнать ad-hoc e2e `web_search` до `BotVPS:/home/claudeclaw/checked/canonical`
- [x] Мигрировать Scout на новый чистый VPS через `ops/scout-worker/scripts/cutover-scout-host.sh`
- [x] Отключить legacy Scout на старом хосте после успешного cutover

### Фаза 4.2: Informer (внешний независимый publishing-контур)
- [ ] Вынести в отдельный репозиторий/инфраструктуру (без общих секретов и файлов)
- [ ] Реализовать 3 потока: дайджест новостей, мнений, интересов
- [ ] Автопубликация в отдельные Telegram-каналы по расписанию
- [ ] Ввести publish-gates: дедуп, лимиты, quality checks, аварийный стоп

### Фаза 4.3: Twin Sync (ClaudeClaw + OpenClaw)
- [x] Добавить контракты: `twin-memory-event`, `twin-config-snapshot`, `twin-config-proposal`
- [x] Реализовать `ops/twin-sync/bot-vps/twin_orchestrator.py` (memory ledger + knowledge view + p2p relay + config proposals)
- [x] Реализовать `publish_twin_artifact.py` для публикации memory/config/hint
- [x] Реализовать auto runtime bridge (`twin_runtime_bridge.py`) для автопубликации snapshots/events
- [x] Добавить systemd units `twin-orchestrator.service|timer` и deploy script
- [x] Добавить systemd units `twin-runtime-bridge.service|timer`
- [x] Добавить Telegram digest sender (`send_proposals_digest.py`) + `twin-proposals-digest.timer`
- [x] Добавить owner approve/reject loop через Telegram (`apply_twin_proposal.py` + parser в `telegram.ts`)
- [ ] Развернуть twin-orchestrator на Bot VPS и проверить `state/metrics.json`
- [ ] Подключить обе стороны (ClaudeClaw/OpenClaw) к регулярной публикации memory events и config snapshots
- [ ] Добавить Telegram digest с предложениями `outbox/proposals/*` для owner approval

### Фаза 5: Горячие скиллы
- [ ] Механизм автоподхвата скиллов из `/checked/skills/`
- [ ] ClaudeClaw автоматически читает и активирует новые скиллы без перезапуска
- [ ] Версионирование скиллов (откат к предыдущей версии)

### Фаза 6: Улучшение санитайзера
- [ ] LLM-проверка подозрительных файлов (отдельная Claude-сессия)
- [ ] Расширить паттерны: multi-language injection, image-based injection
- [ ] Статистика и дашборд: сколько файлов проверено / на карантине / пропущено
- [ ] Rate limiting: защита от спама во inbox

### Фаза 7: Безопасность и мониторинг
- [ ] DM pairing модель (гибкий доступ без хардкода Telegram ID)
- [ ] Мониторинг здоровья: алерты если daemon упал, диск полный, память кончается
- [ ] Ротация логов (logrotate для daemon, sanitizer, ingest)
- [ ] Бэкап памяти SQLite на внешнее хранилище

### Фаза 8: Масштабирование
- [ ] Второй рабочий бот (другой источник данных)
- [ ] Docker Compose для управления всеми ботами
- [ ] Общий дашборд: статус всех ботов + санитайзер + ClaudeClaw
- [ ] Очередь сообщений с приоритетами (из OpenClaw)

---

## Идеи (не приоритизированы)

- TOOLS.md — явное описание доступных инструментов для агента
- Паттерн сессий из OpenClaw (изоляция, очереди, reply-back)
- Webhook-интерфейс для внешних триггеров (GitHub Actions, CI/CD)
- Второй ClaudeClaw на локальном Mac для синхронной работы
- Шифрование данных at rest в `/checked/` и `/quarantine/`
- Аудит-лог: кто и когда клал файлы в inbox

---

_Последнее обновление: 2026-03-07_
