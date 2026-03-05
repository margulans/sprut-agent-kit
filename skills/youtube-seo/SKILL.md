---
name: youtube-seo
description: "Generate YouTube titles, descriptions, timecodes and hashtags from video transcripts."
triggers:
  - YouTube описание
  - сделай описание для видео
  - тайм-коды
  - хештеги для YouTube
  - SEO для ролика
  - метаданные youtube
  - timecodes
---
---

# YouTube SEO Generator

Generate click-worthy, SEO-optimized titles, descriptions, timecodes and hashtags for YouTube videos.

## ✍️ Правила текста (стиль владельца)

**Обязательно:**
- Дефис (-) вместо длинного тире (—). ВСЕГДА
- Сильные глаголы, короткие предложения
- Личный опыт, метафоры из жизни
- Хук в заголовке, интрига в первых 2 строках описания

**Запрещено:**
- Длинное тире (—) - заменять на дефис (-)
- "Конечно", "Безусловно", "Стоит отметить", "Является"
- Канцелярит и пассивный залог
- Больше 1 эмодзи в описании

> Полные правила: `skills/copywriter/SKILL.md`

---

## Workflow

### Step 1: Get transcript

**If user provides video/audio file:**
```bash
# Extract audio if needed (video → audio)
ffmpeg -i video.mp4 -vn -acodec libmp3lame audio.mp3

# Transcribe via OpenAI Whisper API
{skillsDir}/openai-whisper-api/scripts/transcribe.sh audio.mp3 --language ru --json --out transcript.json
```

**If user provides transcript text:** Use directly.

### Step 2: Analyze transcript

1. **Identify main topic and goal**
2. **Extract key insights, numbers, facts**
3. **Map narrative structure** (for timecodes)
4. **Determine content type:**
   - Tutorial → focus on value and steps
   - Case study / research → focus on results and insights
   - Review / comparison → focus on comparison and choice
   - Interview → focus on expert and their opinion

### Step 3: Generate metadata

---

## Style Guide

- First person (as channel author)
- Tone: sincere, professional, not pushy
- **ONE emoji maximum** in entire description
- Avoid clichés: "В этом видео я расскажу..."
- Natural keyword integration, no spam

## Target Keywords (use contextually)

- Автоматизация, n8n, AI-агент
- Искусственный интеллект / AI
- Промпт / prompt engineering
- Additional keywords from transcript content

## Avoid (YouTube demonetization triggers)

- Violence, weapons, drugs, gambling
- Forex/crypto (unless educational)
- Profanity, discrimination
- Misleading clickbait
- Pushy "подпишись/лайкни" — use neutral alternatives

---

## Output Format (STRICT)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📹 НАЗВАНИЕ И ОПИСАНИЕ ДЛЯ YOUTUBE-РОЛИКА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 ПЯТЬ ВАРИАНТОВ НАЗВАНИЯ:

Вариант 1: [Название]
Обоснование: [Текст]

Вариант 2: [Название]
Обоснование: [Текст]

[... до 5 вариантов]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ РЕКОМЕНДУЕМОЕ НАЗВАНИЕ:
[Твой выбор]

Обоснование выбора: [Почему именно это название]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 ОПИСАНИЕ РОЛИКА:

[Полный текст описания]

🔗 ОБЩАЕМСЯ ТУТ: https://t.me/YOUR_CHANNEL

⏱ Тайм-коды:
0:00 - Введение
[...]

#SPRUT #SPRUTAI [остальные хештеги]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏷 ХЕШТЕГИ ДЛЯ ЗАГРУЗКИ РОЛИКА (через запятую, до 500 символов):
[список без решёток, через запятую]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Title Requirements

- **70-75 chars optimal**, max 100
- First 70 chars = most engaging part
- Include 1-2 target keywords
- Use numbers when relevant ("7 принципов...")
- Intrigue + specificity + value
- Each variant needs rationale: SEO value, clickability, emotional trigger

## Description Requirements

Structure (in order):
1. **Hook** — powerful first sentence, NO "В этом видео..."
2. **What viewer learns** — key insights, methods, specific value
3. **Topic blocks** — structured content overview
4. **Soft CTA** — non-pushy
5. **Community link:** `🔗 ОБЩАЕМСЯ ТУТ: https://t.me/YOUR_CHANNEL`
6. **Timecodes**
7. **Hashtags for description**

## Timecode Requirements

Format: `ММ:СС - Название секции`

- Based on actual transcript content and timestamps
- Clear, informative section names (Russian)
- 8-15 sections depending on length
- First: `0:00 - Введение` or similar

## Hashtag Requirements

### Основные хештеги (для описания)
- Format: `#хештег1 #хештег2 ...`
- **Mandatory branded:** `#SPRUT #SPRUTAI`
- Thematic based on content
- **15-20 hashtags total**
- Mixed language (Russian + English for reach)

Example:
```
#SPRUT #SPRUTAI #искусственныйинтеллект #ai #автоматизация #n8n #prompting #GPT4 #нейросети #aiagent #promptengineering
```

### Хештеги для загрузки (upload tags)
- Format: comma-separated, **NO # symbol**
- **Max 500 characters**
- Can overlap with description hashtags
- Add mid/low-frequency queries
- Mixed language

Example:
```
искусственный интеллект, автоматизация, n8n, AI, агент, промпт инженеринг, ChatGPT, GPT-4, нейросети, AI автоматизация, prompt engineering
```

---

## Key Reminders

- Specificity and value over abstract promises
- First 70 chars of title = strongest part
- Description should be "tasty" but not pushy
- ONE emoji in entire description (max!)
- Timecodes must match actual video structure
- Avoid all YouTube stop-words and restricted topics

## 🔗 Связанные скиллы

| Скилл | Зачем |
|-------|-------|
| `analytics` | Перед оптимизацией SEO - посмотри yt-deep-stats.py: какие видео в топе, откуда трафик (поиск vs рекомендации), ср. удержание. Оптимизируй под реальные данные |
| `copywriter` | Описание и заголовок в стиле владельца |
| `creator-marketing` | Стратегия продвижения видео |
