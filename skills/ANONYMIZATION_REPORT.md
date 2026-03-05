# Отчёт об анонимизации скиллов

**Дата:** 2026-03-05
**Анонимизировано скиллов:** 9

## Скиллы

1. ✅ **analytics** — статистика Telegram и YouTube
2. ✅ **business-architect** — валидация бизнес-идей, MVP, unit economics
3. ✅ **copywriter-agent** — копирайтинг в персональном стиле
4. ✅ **creator-marketing** — маркетинг для контент-криейторов
5. ✅ **gemini** — Gemini CLI для быстрых запросов
6. ✅ **gog** — Google Workspace CLI (Gmail, Calendar, Drive)
7. ✅ **marketing-mode** — комплексный маркетинг-стратег
8. ✅ **methodologist** — создание учебных материалов для premium community
9. ✅ **youtube-seo** — SEO-оптимизация для YouTube

## Правила анонимизации

### Заменено:
- "Алексей", "Алексей Ульянов", "Ульянов" → "владелец" или убрано
- "КРАБ", "🦀" → "агент" или "основной агент"
- "@Sprut_AI", "Sprut_AI" → "YOUR_CHANNEL"
- "AI ОПЕРАЦИОНКА" → "premium community"
- "Кайдзен", "Маруся", "Алёна", "Буся" → убрано
- "Тбилиси", "Грузия", "Варкетили" → убрано
- "277478969" (Telegram ID) → убрано
- "AI_CENTER" → убрано или generic path
- "Mac mini M4" → "local server"
- `/Users/aleksejulanov/` → `~/`
- API ключи, токены, ID каналов → `YOUR_*` заглушки

### НЕ скопировано (личные данные):
- `voice-dictionary.md`
- `psychology-profile.md`
- `sprut-ai-strategy-2026-02.md`
- Все файлы в `data/` (кроме универсальных references)

## Структура

Каждый скилл содержит:
- ✅ `SKILL.md` — анонимизированный
- 📜 `scripts/` — анонимизированные (где применимо)
- 📚 `references/` — только универсальные материалы

## Проверка качества

```bash
# Проверка на личные данные (выполнено)
grep -ri "алексей|ульянов|буся|маруся|алёна|277478969|AI_CENTER|КРАБ|sprut_ai|тбилиси|aleksejulanov|варкетили|кайдзен" skills/ --include="*.md" --include="*.json" --include="*.js" --include="*.py" --include="*.sh"
# Результат: ✅ Чисто
```

## Для пользователей

Чтобы адаптировать скиллы под себя:
1. Замените `YOUR_CHANNEL` на свой @username
2. Замените `YOUR_*` заглушки на свои API ключи
3. Создайте свои `voice-dictionary.md` и `profile.md` в `data/`
4. Настройте `analytics` скрипты под свои каналы

## Готово к публикации

Все 9 скиллов полностью анонимизированы и готовы к публикации на GitHub.
