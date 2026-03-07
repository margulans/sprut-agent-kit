---
name: scout-deep-research
description: Мультизапросный ресерч с fetch ключевых страниц и итоговым summary.
---

# Scout Skill: Deep Research

## Цель

Собрать более глубокую картину темы: несколько подзапросов, дедуп ссылок, чтение ключевых страниц, итоговая выжимка.

## Task type

`deep_research`

## Вход

- `query`
- `max_queries` (опционально, 1..8)
- `fetch_top` (опционально, 1..8)

## Выход

- `result.summary`
- `result.subqueries[]`
- `result.deep_reads[]` (title, url, summary)
- `result.citations[]`
