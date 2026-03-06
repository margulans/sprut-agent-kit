# INFRA

## Runtime

- VPS: Vultr (Frankfurt), Ubuntu 24.04
- Daemon: `claudeclaw.service` (systemd)
- Python: sanitizer/ingest scripts
- Firewall: iptables + netfilter-persistent

## LLM

- Anthropic via Claude Code OAuth
- Primary model: `claude-sonnet-4-6`
- Fallback model: `claude-opus-4-6`

## Surface area

- Вход: Telegram bot (allowlist user IDs)
- Внешний data ingress: только файловый (`/home/claudeclaw/inbox`)
- Веб-поиск/веб-фетч: отключены

## Security controls

- Egress allowlist (API + DNS resolvers + localhost)
- `disallowedTools` deny-list
- Sanitizer rules (prompt injection, unicode, base64, html/js)
- Quarantine pipeline
- Canonical checksums validation (`checksums.sha256`) перед reconcile apply
- Pinned plugin patch target: `claudeclaw/1.0.0`

## Operability

- Cron jobs:
  - sanitizer: каждые 5 минут
  - ingest: каждые 15 минут
  - reconcile from repo: каждые 3 часа
  - firewall refresh: каждые 6 часов
