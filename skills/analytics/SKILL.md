---
name: analytics
description: "Статистика Telegram-канала и YouTube. Просмотры, подписчики, ERR, топ постов/видео."
triggers:
  - статистика
  - analytics
  - telegram stats
  - youtube stats
  - подписчики
  - просмотры
  - ERR
  - engagement
  - стата
  - аналитика
---

# Analytics - Статистика каналов

## Возможности

### Telegram (YOUR_CHANNEL)
- Подписчики (точное число)
- Просмотры, репосты, реакции каждого поста
- ERR (Engagement Rate by Reactions)
- Топ постов за период
- Фильтр по периоду: 24h, 7d, 30d

### YouTube (@alekseiulianov)
- Просмотры, лайки по каждому видео (RSS, бесплатно)
- С API-ключом: подписчики, комментарии, полная стата

## Скрипты

### Telegram
```bash
# Полная статистика за 7 дней
python3 skills/analytics/scripts/tg-stats.py --period=7d

# За сутки
python3 skills/analytics/scripts/tg-stats.py --period=24h

# За месяц, топ-10
python3 skills/analytics/scripts/tg-stats.py --period=30d --top=10

# JSON формат (для парсинга)
python3 skills/analytics/scripts/tg-stats.py --period=7d --json
```

### YouTube (RSS - быстрый)
```bash
python3 skills/analytics/scripts/yt-stats.py
python3 skills/analytics/scripts/yt-stats.py --json
```

### YouTube (Analytics API - полная стата)
```bash
# За 30 дней (по умолчанию)
python3 skills/analytics/scripts/yt-deep-stats.py

# За 7 дней
python3 skills/analytics/scripts/yt-deep-stats.py --days=7

# JSON
python3 skills/analytics/scripts/yt-deep-stats.py --days=30 --json
```

Глубокая аналитика: подписчики gained/lost, watch time, avg view duration, источники трафика, топ видео с удержанием.

## Настройка

### Telegram (готово ✅)
- Авторизация: Telethon session в `~/.openclaw/tg-stats-session`
- Скрипт авторизации: `scripts/tg-stats-auth.py`
- API ID: 30942990
- Канал: YOUR_CHANNEL (ID: -1002484275132)

### YouTube (готово ✅)
- OAuth2 токен: `~/.openclaw/yt-analytics-token.pickle`
- Скрипт авторизации: `scripts/yt-analytics-auth.py`
- Channel ID: UCi5bDAJ_I4shONrU-au_zRA
- Google OAuth client: тот же что для gog (calendar)

## Безопасность
- Все данные read-only
- Telethon session локально на local server
- Никакие данные не отправляются наружу
- Бот в канале с минимальными правами (только can_post_messages)

## 🔗 Связанные скиллы

| Скилл | Связь |
|-------|-------|
| `creator-marketing` | Маркетолог использует данные analytics для рекомендаций по контенту |
| `copywriter` | Смотрит какие посты лучше заходят перед написанием новых |
| `youtube-seo` | Оптимизирует SEO на основе реальных данных (источники трафика, топ видео) |

## Примеры использования
- "покажи статистику Telegram за неделю"
- "топ постов за месяц"
- "статистика YouTube"
- "сравни просмотры за эту и прошлую неделю"
- "какой пост лучше всего зашёл?"
