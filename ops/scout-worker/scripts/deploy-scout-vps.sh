#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCOUT_HOST="${SCOUT_HOST:?set SCOUT_HOST}"
SCOUT_USER="${SCOUT_USER:-root}"
SSH_TARGET="${SCOUT_USER}@${SCOUT_HOST}"

echo "[deploy-scout-vps] target: ${SSH_TARGET}"

ssh "${SSH_TARGET}" "mkdir -p /usr/local/bin /etc/systemd/system /etc/scout /var/log/scout /srv/scout"
scp "${ROOT_DIR}/scout-worker/scout-vps/bootstrap-scout-vps.sh" "${SSH_TARGET}:/usr/local/bin/bootstrap-scout-vps.sh"
scp "${ROOT_DIR}/scout-worker/scout-vps/scout_worker.py" "${SSH_TARGET}:/usr/local/bin/scout_worker.py"
scp "${ROOT_DIR}/scout-worker/scout-vps/push-raw-to-sanitizer.sh" "${SSH_TARGET}:/usr/local/bin/push-raw-to-sanitizer.sh"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-poll.service" "${SSH_TARGET}:/etc/systemd/system/scout-poll.service"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-poll.timer" "${SSH_TARGET}:/etc/systemd/system/scout-poll.timer"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-poll.path" "${SSH_TARGET}:/etc/systemd/system/scout-poll.path"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-scan.service" "${SSH_TARGET}:/etc/systemd/system/scout-scan.service"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-scan.timer" "${SSH_TARGET}:/etc/systemd/system/scout-scan.timer"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-push.service" "${SSH_TARGET}:/etc/systemd/system/scout-push.service"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-push.timer" "${SSH_TARGET}:/etc/systemd/system/scout-push.timer"
scp "${ROOT_DIR}/scout-worker/scout-vps/systemd/scout-push.path" "${SSH_TARGET}:/etc/systemd/system/scout-push.path"

ssh "${SSH_TARGET}" "chmod 755 /usr/local/bin/bootstrap-scout-vps.sh /usr/local/bin/scout_worker.py /usr/local/bin/push-raw-to-sanitizer.sh"
ssh "${SSH_TARGET}" "/usr/local/bin/bootstrap-scout-vps.sh"
if [[ -n "${SAN_HOST:-}" ]]; then
  ssh "${SSH_TARGET}" "cat > /etc/scout/push.env" <<EOF
SAN_HOST=${SAN_HOST}
SAN_USER=${SAN_USER:-sanitizer}
SAN_RAW_INBOX=${SAN_RAW_INBOX:-/srv/sanitizer/inbox/raw}
EOF
fi
ssh "${SSH_TARGET}" "systemctl daemon-reload && systemctl enable --now scout-poll.timer scout-poll.path scout-scan.timer scout-push.timer scout-push.path"
ssh "${SSH_TARGET}" "systemctl is-active scout-poll.timer scout-poll.path scout-scan.timer scout-push.timer scout-push.path"

echo "[deploy-scout-vps] done"
