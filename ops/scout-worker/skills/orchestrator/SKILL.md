---
name: scout-orchestrator
description: Оркестрация комплексного ресерча через несколько task_type.
---

# Scout Skill: Orchestrator

## Цель

Запускать цепочки скиллов под задачу и получать полный пакет артефактов для санитайзера.

## Рекомендуемая цепочка

1. `web_search` — собрать первичные источники.
2. `reddit_scan` — добавить общественные сигналы.
3. `deep_research` — дочитать и синтезировать.
4. `summarize_text` / `analyze_topic` — финальная выжимка.

## Нотация

- Для задач с YouTube добавлять `youtube_transcribe`.
- Для быстрых запросов ограничивать глубину (`max_queries=2`, `fetch_top=2`).
