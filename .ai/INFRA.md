# INFRA

## Runtime

- Bot VPS: Vultr (Frankfurt), Ubuntu 24.04
- Scout VPS: отдельный Ubuntu 24.04 (новый внешний контур, `ops/scout-worker`)
- Sanitizer VPS: отдельный Ubuntu 24.04 (подготовлен deploy stack)
- Daemon: `claudeclaw.service` (systemd)
- Python/Bash pipeline: sanitize/export/import/health
- Python pipeline: scout poll/scheduled scan + raw outbox
- Python pipeline: twin orchestrator (memory/config sync + p2p mailbox relay)
- Scout deps: `youtube-transcript-api` (optional, install in bootstrap)
- Search backends: DuckDuckGo HTML, Reddit JSON API, YouTube transcript API
- Firewall: iptables + netfilter-persistent (Bot VPS), ufw/fail2ban (Sanitizer VPS bootstrap)

## LLM

- Anthropic via Claude Code OAuth
- Primary model: `claude-sonnet-4-6`
- Fallback model: `claude-opus-4-6`

## Surface area

- Вход: Telegram bot (allowlist user IDs)
- Внешний сбор данных: Scout VPS (отдельный контур)
- Внешний ingress в Bot VPS: только signed bundles (`/home/claudeclaw/import/inbox`)
- Веб-поиск/веб-фетч: отключены

## Security controls

- Egress allowlist (API + DNS resolvers + localhost)
- `disallowedTools` deny-list
- Sanitizer rules (prompt injection, unicode, base64, homoglyph)
- Scout role boundary: только поиск/ресерч, без дайджестов и публикации
- Signed manifest verification (`ssh-keygen -Y verify`)
- File-by-file checksum verification + atomic mirror replace
- Quarantine pipeline on Sanitizer VPS
- Canonical checksums validation (`checksums.sha256`) перед reconcile apply
- Pinned plugin patch target: `claudeclaw/1.0.0`
- Twin config diff filters sensitive keys (`token|secret|password|private_key|api_key|auth`)
- Twin proposals immutable by default (`auto_apply=false`)

## Operability

- Bot VPS timers/jobs:
  - `sanitizer-import.timer`: каждые 5 минут
  - `sanitizer-import.path`: event-driven импорт сразу при новом бандле
  - `scout-request-push.timer`: каждые 1 минуту (bridge Bot -> Scout)
  - `scout-request-push.path`: event-driven push request сразу при новом файле
  - `checked-health.timer`: каждые 15 минут
  - `twin-orchestrator.timer`: каждую минуту
  - `twin-runtime-bridge.timer`: каждые 5 минут (автопубликация config snapshots/events)
  - `twin-proposals-digest.timer`: каждые 10 минут (Telegram digest owner-approval)
  - `reconcile from repo`: каждые 3 часа (cron)
  - `firewall refresh`: каждые 6 часов (cron)
- Sanitizer VPS timers (из deploy stack):
  - `sanitizer-sanitize.timer`: каждые 5 минут
  - `sanitizer-sanitize.path`: event-driven sanitize при новом raw-файле
  - `sanitizer-export.timer`: каждые 5 минут
  - `sanitizer-export.path`: event-driven export/push при новом checked-файле
- Scout VPS timers (из deploy stack):
  - `scout-poll.timer`: каждую минуту
  - `scout-poll.path`: event-driven poll при новом request
  - `scout-push.timer`: каждую минуту
  - `scout-push.path`: event-driven push при новом raw-ответе
  - `scout-scan.timer`: еженедельно (Sun 02:00)
