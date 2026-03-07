---
name: scout-messenger-channels
description: Поиск каналов в мессенджерах (Telegram/Discord).
---

# Scout Skill: Messenger Channels

## Task type

`messenger_channels_search`

## Вход

- `query`
- `max_results` (опционально)

## Выход

- `result.summary`
- `result.channels[]` (url, snippet, platform, handle если найден)
- `result.citations[]`
