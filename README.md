# SPRUT Agent Kit ⚡

**Готовый AI-агент с "душой" для ClaudeClaw**

Одна команда - и у вас настроенный персональный ассистент с памятью, skills и автоматикой.

## Что это?

Starter kit для [ClaudeClaw](https://github.com/moazbuilds/claudeclaw) - готовая конфигурация агента с:
- **Душой** (SOUL.md + AGENTS.md) - идентичность, принципы, правила работы
- **Памятью** (SQLite + embeddings) - векторный поиск + FTS5, decay система
- **23 готовых skills** - копирайтинг, исследования, YouTube SEO, debugging и т.д.
- **Crons** - автоматические задачи (backup, health check, memory cleanup)
- **Progress-система** - технические сообщения в Telegram
- **Security layer** - защита личных данных

## Быстрый старт

```bash
# Клонируем репозиторий
git clone https://github.com/AlekseiUL/sprut-agent-kit.git
cd sprut-agent-kit

# Запускаем установку (всё одной командой)
./install.sh
```

Скрипт:
1. Проверит зависимости (bun, git)
2. Установит ClaudeClaw (если ещё не стоит)
3. Настроит конфиг (спросит Telegram ID, timezone)
4. Установит душу агента (SOUL.md, AGENTS.md)
5. Опционально: импортирует память, настроит автозапуск

После установки агент готов к работе через Claude Code Desktop.

## Структура репозитория

```
sprut-agent-kit/
├── install.sh          # Установка ClaudeClaw + надстройка
├── claudeclaw.json     # Конфиг (owner, models, memory, skills, crons)
├── SOUL.md             # Душа агента (идентичность, принципы)
├── AGENTS.md           # Правила работы (память, безопасность, skills)
├── CLAUDE.md.example   # Шаблон персонализации
└── README.md           # Документация
```

## Конфигурация

**Основной конфиг:** `~/.claude/claudeclaw/settings.json`

```json
{
  "model": "claude-opus-4-6",
  "telegram": {
    "token": "YOUR_BOT_TOKEN",
    "allowedUserIds": [YOUR_TELEGRAM_ID]
  },
  "web": {
    "enabled": true,
    "port": 4632
  },
  "memory": {
    "enabled": true,
    "maxResults": 5,
    "vectorWeight": 0.7,
    "textWeight": 0.3
  }
}
```

**Полный конфиг:** `claudeclaw.json` (документация для переноса)

## Архитектура "Переносимой души"

ClaudeClaw спроектирован для переноса между платформами:

1. **SOUL.md** - идентичность агента (кто я, во что верю, как дружу)
2. **AGENTS.md** - рабочие правила (память, безопасность, skills)
3. **claudeclaw.json** - полная конфигурация (модели, пути, crons)
4. **Skills** - специализированные агенты с data-файлами
5. **Memory** - экспорт/импорт фактов между агентами

Установка на новый Mac = `./install.sh` + настройка конфига

## Память

**SQLite + embeddings (text-embedding-3-small)**

- Hybrid search: векторный (0.7) + FTS5 (0.3)
- Decay система: semantic -0.01/день, episodic -0.05/день
- Auto-extract: автоматическое извлечение фактов из диалогов
- Import/export: миграция памяти между агентами

```typescript
// Сохранить факт
await storeMemory("Владелец предпочитает краткость", "semantic", "manual");

// Поиск
const results = await searchMemory("стиль общения", { maxResults: 5 });
```

## Skills

Skills - специализированные агенты запускаемые через `/skill-name`:

```bash
~/.claude/skills/
├── copywriter-agent/       # Копирайтер
├── deep-research-pro/      # Глубокое исследование
├── youtube-seo/            # YouTube оптимизация
├── weather/                # Погода и прогнозы
└── subagent-runner/        # Параллельные субагенты
```

Установка нового skill:
```bash
cp -r skill-name ~/.claude/skills/
```

## Daemon & Web UI

**REST API:**
- `POST /api/subagent/run` - запуск субагента
- `GET /api/subagent/status/:id` - статус
- `GET /api/subagent/wait/:id` - ждать результат

**Web UI:** http://localhost:4632
- Дашборд агента
- Логи в реальном времени
- Управление субагентами
- Статистика памяти

**Запуск:**
```bash
bun run src/index.ts start --web
```

**Автозапуск через launchd:**
```bash
# Создаётся при установке через install.sh
~/Library/LaunchAgents/com.claudeclaw.daemon.plist
```

## Telegram интеграция

**Progress сообщения:**
```bash
bun commands/progress.ts "⚙️" "Создаю файл"
```

Эмодзи:
- ⚙️ - действие
- 🔍 - поиск/чтение
- 🤖 - субагент
- 📦 - установка
- ✅ - готово
- ❌ - ошибка

**Настройка:**
1. Создать бота через @BotFather
2. Получить token
3. Добавить в `settings.json`:
```json
{
  "telegram": {
    "token": "YOUR_BOT_TOKEN",
    "allowedUserIds": [YOUR_TELEGRAM_ID]
  }
}
```

## Crons

Автоматические задачи в `claudeclaw.json`:

```json
{
  "crons": {
    "enabled": true,
    "jobs": [
      {
        "name": "memory-cleanup",
        "schedule": "0 3 * * *",
        "command": "bun crons/memory-cleanup.ts",
        "enabled": true
      }
    ]
  }
}
```

## Импорт из другого агента

Миграция памяти и skills из основного агента:

```bash
# Память (импорт фактов)
bun scripts/import-memory.ts

# Skills (копирование структуры)
cp -r /path/to/main-agent/skills/* ~/.claude/skills/

# Конфиг (адаптация)
# Сравните конфиг основного агента и claudeclaw.json
```

## Сравнение с основным агентом

| Фича | Основной агент (OpenClaw) | ClaudeClaw |
|------|---------------------------|------------|
| Платформа | Custom server | Claude Code Desktop |
| Модели | Multi-model (Claude, OpenAI, etc) | Только Claude |
| Persistent агенты | ✅ | ❌ (только skills) |
| Skills | ✅ | ✅ |
| Memory | ✅ SQLite + embeddings | ✅ SQLite + embeddings |
| Crons | ✅ | ✅ |
| Web UI | ✅ | ✅ |
| Telegram | ✅ | ✅ |
| Роль | Основной | Резервный |

## Безопасность

**Критические правила:**
- 🔒 Никогда не хранить личные данные (паспорта, карты, адреса)
- 🔒 Никогда не передавать медицинские данные наружу
- 🔒 Общение только с владельцем (Telegram ID whitelist)
- 🔒 Не трогать файлы основного агента без явного запроса

**Security levels:**
- `locked` - только чтение
- `strict` - чтение + whitelist команд
- `moderate` - чтение + запись (default)
- `unrestricted` - полный доступ

## Разработка

```bash
# Установка зависимостей
bun install

# Запуск в dev режиме
bun run dev:web

# Тесты
bun test

# Сборка
bun build
```

## Философия

ClaudeClaw - это эксперимент "переносимой души агента". Идея:
1. AI-агент = код + конфиг + идентичность (душа)
2. Душу можно описать в текстовых файлах (SOUL.md, AGENTS.md)
3. Установка агента = копирование души + запуск кода
4. Два агента с одной душой = резервирование без потери идентичности

**Позиционирование:**
- Основной агент - главный (мультимодельность, persistent агенты, custom платформа)
- ClaudeClaw ⚡ - резервный (Claude Code, простота, стабильность)
- Два агента лучше одного - один ломается, другой чинит

## Community & Support

- 📺 **YouTube:** [youtube.com/@alekseiulianov](https://youtube.com/@alekseiulianov) - туториалы, демо, разбор архитектуры
- 📢 **Telegram:** [t.me/Sprut_AI](https://t.me/Sprut_AI) - обновления, советы, обсуждения
- 💎 **AI ОПЕРАЦИОНКА** (Premium): [web.tribute.tg/s/Jyg](https://web.tribute.tg/s/Jyg) или [через Telegram](https://t.me/tribute/app?startapp=sJyg)
  - Расширенные инструкции и новые skills
  - Архитектурные воркшопы
  - Приоритетная поддержка
  - Ранний доступ к экспериментальным фичам

## Contributing

Контрибуции приветствуются!

1. Fork репозитория
2. Создайте feature branch (`git checkout -b feature/new-skill`)
3. Commit (`git commit -am 'Add new skill'`)
4. Push (`git push origin feature/new-skill`)
5. Откройте Pull Request

## Лицензия

MIT
