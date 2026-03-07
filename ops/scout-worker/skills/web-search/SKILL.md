---
name: scout-web-search
description: Быстрый поиск по вебу с цитатами и сниппетами.
---

# Scout Skill: Web Search

## Цель

Найти релевантные источники в сети по теме и вернуть компактный список ссылок с коротким контекстом.

## Task type

`web_search`

## Вход

- `query` — строка запроса
- `max_results` (опционально, 1..20)

## Выход

- `result.summary`
- `result.results[]` (title, url, snippet)
- `result.citations[]`
