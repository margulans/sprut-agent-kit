---
name: scout-reddit-scan
description: Поиск и агрегация обсуждений Reddit по теме.
---

# Scout Skill: Reddit Scan

## Цель

Понять, что обсуждают люди по теме в Reddit: топ посты, сабреддиты, сигналы вовлеченности.

## Task type

`reddit_scan`

## Вход

- `query`
- `limit` (опционально, 1..25)

## Выход

- `result.summary`
- `result.posts[]` (subreddit, title, score, num_comments, url)
- `result.citations[]`
