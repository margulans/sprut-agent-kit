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

---

## В работе

_(пусто)_

---

## Запланировано

### Фаза 3: Рабочие боты
- [ ] Выбрать первого рабочего бота (ресёрч / Reddit / YouTube)
- [ ] Реализовать Docker-песочницу для рабочего бота
- [ ] Написать бота: сбор данных → JSON → `/inbox/`
- [ ] Протестировать полный цикл: бот → inbox → sanitizer → checked → ClaudeClaw
- [ ] Добавить Telegram-уведомления от санитайзера при карантине

### Фаза 4: Горячие скиллы
- [ ] Механизм автоподхвата скиллов из `/checked/skills/`
- [ ] ClaudeClaw автоматически читает и активирует новые скиллы без перезапуска
- [ ] Версионирование скиллов (откат к предыдущей версии)

### Фаза 5: Улучшение санитайзера
- [ ] LLM-проверка подозрительных файлов (отдельная Claude-сессия)
- [ ] Расширить паттерны: multi-language injection, image-based injection
- [ ] Статистика и дашборд: сколько файлов проверено / на карантине / пропущено
- [ ] Rate limiting: защита от спама во inbox

### Фаза 6: Безопасность и мониторинг
- [ ] DM pairing модель (гибкий доступ без хардкода Telegram ID)
- [ ] Мониторинг здоровья: алерты если daemon упал, диск полный, память кончается
- [ ] Ротация логов (logrotate для daemon, sanitizer, ingest)
- [ ] Бэкап памяти SQLite на внешнее хранилище

### Фаза 7: Масштабирование
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

_Последнее обновление: 2026-03-06_
