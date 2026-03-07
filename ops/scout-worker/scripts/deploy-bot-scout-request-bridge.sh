#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOT_HOST="${BOT_HOST:-136.244.83.50}"
BOT_USER="${BOT_USER:-root}"
SSH_TARGET="${BOT_USER}@${BOT_HOST}"
SCOUT_HOST="${SCOUT_HOST:?set SCOUT_HOST}"

echo "[deploy-bot-scout-bridge] target: ${SSH_TARGET}"

ssh "${SSH_TARGET}" "mkdir -p /usr/local/bin /etc/systemd/system /etc /home/claudeclaw/inbox/requests /home/claudeclaw/inbox/sent /home/claudeclaw/inbox/failed"
scp "${ROOT_DIR}/scout-worker/bot-vps/push-requests-to-scout.sh" "${SSH_TARGET}:/usr/local/bin/push-requests-to-scout.sh"
scp "${ROOT_DIR}/scout-worker/bot-vps/systemd/scout-request-push.service" "${SSH_TARGET}:/etc/systemd/system/scout-request-push.service"
scp "${ROOT_DIR}/scout-worker/bot-vps/systemd/scout-request-push.timer" "${SSH_TARGET}:/etc/systemd/system/scout-request-push.timer"
scp "${ROOT_DIR}/scout-worker/bot-vps/systemd/scout-request-push.path" "${SSH_TARGET}:/etc/systemd/system/scout-request-push.path"

ssh "${SSH_TARGET}" "chmod 755 /usr/local/bin/push-requests-to-scout.sh && chown claudeclaw:claudeclaw /home/claudeclaw/inbox/requests /home/claudeclaw/inbox/sent /home/claudeclaw/inbox/failed"
ssh "${SSH_TARGET}" "cat > /etc/scout-request-bridge.env" <<EOF
SCOUT_HOST=${SCOUT_HOST}
SCOUT_USER=${SCOUT_USER:-scout}
SCOUT_INBOX_DIR=${SCOUT_INBOX_DIR:-/srv/scout/inbox/requests}
BOT_SCOUT_PUSH_KEY=${BOT_SCOUT_PUSH_KEY:-/home/claudeclaw/.ssh/id_ed25519_scout_requests}
EOF

ssh "${SSH_TARGET}" "systemctl daemon-reload && systemctl enable --now scout-request-push.timer scout-request-push.path"
ssh "${SSH_TARGET}" "systemctl is-active scout-request-push.timer scout-request-push.path"

echo "[deploy-bot-scout-bridge] done"
