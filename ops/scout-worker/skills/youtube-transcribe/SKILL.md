---
name: scout-youtube-transcribe
description: Транскрипт YouTube-видео и короткое summary.
---

# Scout Skill: YouTube Transcribe

## Цель

Извлечь текст из YouTube-видео и получить быстрый саммари для анализа.

## Task type

`youtube_transcribe`

## Вход

- `query` — URL YouTube или video_id
- `languages` (опционально, например `["ru","en"]`)

## Выход

- `result.summary`
- `result.video_id`
- `result.transcript_preview`
- `result.citations[]`
