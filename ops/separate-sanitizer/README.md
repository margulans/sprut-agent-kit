# Separate Sanitizer VPS

Набор скриптов для архитектуры из двух VPS:

- **Sanitizer VPS**: принимает raw, санитизирует, формирует и подписывает бандл.
- **Bot VPS**: принимает только подписанные бандлы, верифицирует и атомарно обновляет mirror.

## Структура

- `sanitizer-vps/` — bootstrap, sanitizer pipeline, export/sign/transfer.
- `bot-vps/` — import+verify, readonly-permissions, healthcheck.
- `contracts/` — контракты manifest и состояния импорта.
- `scripts/` — удаленный деплой на соответствующие VPS.

## Минимальный порядок запуска

1. На Sanitizer VPS:
   - `scripts/deploy-sanitizer-vps.sh`
   - сгенерировать ключ подписи (`ssh-keygen -t ed25519`)
   - настроить `push-signed-bundle.sh` на Bot VPS deploy user.
2. На Bot VPS:
   - `scripts/deploy-bot-vps.sh`
   - установить публичный ключ в `/etc/sanitizer/allowed_signers`.
3. Проверка:
   - `systemctl status sanitizer-sanitize.timer sanitizer-sanitize.path sanitizer-export.timer sanitizer-export.path`
   - `systemctl status sanitizer-import.timer sanitizer-import.path checked-health.timer`

## Инварианты безопасности

- ClaudeClaw/OpenClaw читают **только** `/home/claudeclaw/checked/canonical`.
- Mirror обновляется только через `verify -> checksum -> atomic move`.
- Невалидные подписи/хеши не импортируются.
- Доступ к mirror для ботов только read-only.
