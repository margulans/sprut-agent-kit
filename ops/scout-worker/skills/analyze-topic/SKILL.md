---
name: scout-analyze-topic
description: Анализ темы по web+reddit с выделением паттернов.
---

# Scout Skill: Analyze Topic

## Цель

Сделать быстрый сквозной анализ темы: источники, сигналы обсуждений, ключевые слова, первичные выводы.

## Task type

`analyze_topic`

## Вход

- `query`

## Выход

- `result.summary`
- `result.top_keywords[]`
- `result.web_sample[]`
- `result.reddit_sample[]`
- `result.citations[]`
