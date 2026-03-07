#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOT_HOST="${BOT_HOST:-136.244.83.50}"
BOT_USER="${BOT_USER:-root}"
SSH_TARGET="${BOT_USER}@${BOT_HOST}"

echo "[deploy-bot-vps] target: ${SSH_TARGET}"

ssh "${SSH_TARGET}" "mkdir -p /usr/local/bin /etc/sanitizer /home/claudeclaw/import/inbox /home/claudeclaw/import/tmp /var/log/claudeclaw"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/import-verified-bundle.sh" "${SSH_TARGET}:/usr/local/bin/import-verified-bundle.sh"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/enforce-checked-readonly.sh" "${SSH_TARGET}:/usr/local/bin/enforce-checked-readonly.sh"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/healthcheck-pipeline.sh" "${SSH_TARGET}:/usr/local/bin/healthcheck-pipeline.sh"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/setup-sanitizer-deploy-user.sh" "${SSH_TARGET}:/usr/local/bin/setup-sanitizer-deploy-user.sh"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/systemd/sanitizer-import.service" "${SSH_TARGET}:/etc/systemd/system/sanitizer-import.service"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/systemd/sanitizer-import.timer" "${SSH_TARGET}:/etc/systemd/system/sanitizer-import.timer"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/systemd/sanitizer-import.path" "${SSH_TARGET}:/etc/systemd/system/sanitizer-import.path"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/systemd/checked-health.service" "${SSH_TARGET}:/etc/systemd/system/checked-health.service"
scp "${ROOT_DIR}/separate-sanitizer/bot-vps/systemd/checked-health.timer" "${SSH_TARGET}:/etc/systemd/system/checked-health.timer"

ssh "${SSH_TARGET}" "chmod 755 /usr/local/bin/import-verified-bundle.sh /usr/local/bin/enforce-checked-readonly.sh /usr/local/bin/healthcheck-pipeline.sh /usr/local/bin/setup-sanitizer-deploy-user.sh"
ssh "${SSH_TARGET}" "/usr/local/bin/setup-sanitizer-deploy-user.sh"
ssh "${SSH_TARGET}" "/usr/local/bin/enforce-checked-readonly.sh"
ssh "${SSH_TARGET}" "systemctl daemon-reload && systemctl enable --now sanitizer-import.timer sanitizer-import.path checked-health.timer"
ssh "${SSH_TARGET}" "systemctl is-active sanitizer-import.timer sanitizer-import.path checked-health.timer"

echo "[deploy-bot-vps] done"
