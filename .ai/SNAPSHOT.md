# SNAPSHOT

Обновлено: 2026-03-06

## Хост

- VPS: Vultr (Frankfurt)
- OS: Ubuntu 24.04
- Пользователь агента: `claudeclaw`
- Telegram bot: `@AdjutantClaude_bot`

## Модели

- Primary: `claude-sonnet-4-6`
- Fallback: `claude-opus-4-6`

## Стерильный контур

- `inbox/` -> `sanitizer.py` -> `checked/` -> `processed/`
- Санитайзер добавляет:
  - `provenance: sanitized_external`
  - `trust_level: untrusted`
  - `external_content_wrapped`
- Telegram prompt добавляет:
  - `InputProvenance: owner_direct`
  - `TrustLevel: trusted_owner`

## Безопасность

- Firewall chain `CLAUDECLAW` активна
- DNS egress ограничен системными resolvers
- `disallowedTools`: `Bash`, `WebSearch`, `WebFetch`

## Cron

- `*/5 * * * *` sanitizer
- `*/15 * * * *` ingest checked
- `0 */6 * * *` firewall refresh

## Skills

- Офлайн-скиллы включены
- Добавлен `healthcheck` (VPS hardening / audit)
