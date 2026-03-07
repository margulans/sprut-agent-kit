# RUNBOOK — Separate Sanitizer VPS

## 1) Key rotation

### Подготовка (Sanitizer VPS)

1. Сгенерировать новый ключ:
   - `ssh-keygen -q -t ed25519 -N "" -f /etc/sanitizer/signing_key.new`
2. Показать новый публичный:
   - `cat /etc/sanitizer/signing_key.new.pub`

### Переключение (Bot VPS)

1. Добавить новую строку в `/etc/sanitizer/allowed_signers`:
   - `sanitizer-bundle <new_pubkey>`
2. Не удалять старый ключ до успешного тестового импорта.

### Завершение

1. На Sanitizer VPS:
   - `mv /etc/sanitizer/signing_key.new /etc/sanitizer/signing_key`
   - `mv /etc/sanitizer/signing_key.new.pub /etc/sanitizer/signing_key.pub`
2. Принудительный прогон:
   - `systemctl start sanitizer-export.service`
   - `systemctl start sanitizer-import.service` (на Bot VPS)
3. Удалить старый pubkey из `allowed_signers`.

## 2) Incident: signature mismatch

Признаки:
- `import-verify.log` содержит `checksum mismatch` или ошибки verify.
- `checked-health.service` переходит в `failed`.

Действия:
1. Остановить автоимпорт:
   - `systemctl stop sanitizer-import.timer`
2. Сохранить артефакты:
   - `cp -R /home/claudeclaw/import/inbox/<bundle_id> /root/forensics/<bundle_id>`
3. Проверить:
   - актуальность `/etc/sanitizer/allowed_signers`
   - совпадение `bundle_sha256` в `manifest.json` и реального tarball
4. После устранения причины:
   - `systemctl start sanitizer-import.timer`
   - `systemctl start sanitizer-import.service`

## 3) Incident: quarantine spike

Признаки:
- Быстрый рост `/srv/sanitizer/quarantine`.
- Падение количества успешных импортов.

Действия:
1. Проверить последние quarantine report:
   - `ls -1t /srv/sanitizer/quarantine/*.report.json | head -n 20`
2. Идентифицировать массовый источник/паттерн.
3. Временно блокировать проблемный worker upstream.
4. При необходимости ослабить слишком агрессивное правило только после ревью.

## 4) Rollback до предыдущего verified bundle

На Bot VPS:

1. Остановить импорт:
   - `systemctl stop sanitizer-import.timer`
2. Найти предыдущий bundle в backup/forensics.
3. Положить bundle обратно в `/home/claudeclaw/import/inbox/<bundle_id>/`.
4. Выполнить:
   - `systemctl start sanitizer-import.service`
5. Проверить состояние:
   - `cat /home/claudeclaw/checked/state/claudeclaw.json`
   - `cat /home/claudeclaw/checked/state/openclaw.json`
6. Включить таймер обратно:
   - `systemctl start sanitizer-import.timer`

## 5) Operational checks

Bot VPS:
- `systemctl status sanitizer-import.timer checked-health.timer twin-orchestrator.timer twin-runtime-bridge.timer twin-proposals-digest.timer`
- `tail -n 50 /var/log/claudeclaw/import-verify.log`
- `tail -n 50 /var/log/claudeclaw/checked-health.log`
- `cat /home/<agent_user>/twin-sync/state/metrics.json`
- `cat /home/<agent_user>/twin-sync/state/runtime-bridge-stats.json`
- `cat /home/<agent_user>/twin-sync/state/proposal-digest-state.json`

Sanitizer VPS:
- `systemctl status sanitizer-sanitize.timer sanitizer-export.timer`
- `tail -n 50 /var/log/sanitizer/sanitize.log`
- `ls -la /srv/sanitizer/export | tail -n 20`

## 6) Incident: twin drift spike

Признаки:
- Резкий рост proposal-файлов в `/home/claudeclaw/twin-sync/outbox/proposals`.
- Частые повторяющиеся diff по одним и тем же ключам.

Действия:
1. Проверить метрики:
   - `cat /home/claudeclaw/twin-sync/state/metrics.json`
2. Проверить последние snapshots:
   - `ls -la /home/claudeclaw/twin-sync/state/snapshots/claudeclaw`
   - `ls -la /home/claudeclaw/twin-sync/state/snapshots/openclaw`
3. Убедиться, что не утекают секретные пути в changes (`token/secret/password/...`).
4. Временно остановить таймер:
   - `systemctl stop twin-orchestrator.timer`
5. После фикса источника дрейфа:
   - `systemctl start twin-orchestrator.timer`
   - `systemctl start twin-orchestrator.service`

## 7) Incident: p2p mailbox overload

Признаки:
- Рост `quarantine` по причинам `hint_too_large`/`ttl_too_long`.
- Рост `mailbox/outgoing/*` без доставки в `incoming/*`.

Действия:
1. Проверить quarantine reports:
   - `ls -1t /home/claudeclaw/twin-sync/quarantine/*.report.json | head -n 20`
2. Проверить размер/ttl исходящих hints в `mailbox/outgoing`.
3. Очистить явно просроченные hints.
4. Запустить оркестратор вручную:
   - `python3 /home/claudeclaw/sprut-agent-kit/ops/twin-sync/bot-vps/twin_orchestrator.py --once`

## 8) Incident: proposal digest не отправляется в Telegram

Признаки:
- Новые proposal-файлы есть, но уведомлений в Telegram нет.
- `proposal-digest-state.json` не обновляется.

Действия:
1. Проверить юниты:
   - `systemctl status twin-proposals-digest.timer twin-proposals-digest.service --no-pager`
2. Проверить dry-run:
   - `python3 /home/claudeclaw/sprut-agent-kit/ops/twin-sync/bot-vps/send_proposals_digest.py --dry-run --limit 3`
3. Проверить валидность токена/allowedUserIds в `/home/claudeclaw/.claude/claudeclaw/settings.json`.
4. Принудительный запуск:
   - `systemctl start twin-proposals-digest.service`
5. Проверить callback map:
   - `cat /home/<agent_user>/twin-sync/state/proposal-callback-map.json`
6. Учесть TTL:
   - callback token живет 24 часа (по умолчанию), после чего кнопка вернет `Proposal token expired`.

## 9) Incident: approve/reject команда не применяется

Признаки:
- В Telegram приходит `Twin proposal error: ...`.
- Конфиг не изменился после `approve`.

Действия:
1. Проверить наличие скрипта и права:
   - `ls -la /home/claudeclaw/sprut-agent-kit/ops/twin-sync/bot-vps/apply_twin_proposal.py`
2. Ручной dry-run:
   - `python3 /home/<agent_user>/sprut-agent-kit/ops/twin-sync/bot-vps/apply_twin_proposal.py --proposal-id <id> --decision approve --dry-run`
3. Проверить decision state:
   - `cat /home/<agent_user>/twin-sync/state/proposal-status.json`
   - `tail -n 20 /home/<agent_user>/twin-sync/state/proposal-decisions.jsonl`
4. Проверить backup/apply:
   - `ls -la /home/<agent_user>/twin-sync/state/config-backups`
5. Если ошибка `Proposal token expired` в inline-кнопке:
   - отправить свежий digest `systemctl start twin-proposals-digest.service`
