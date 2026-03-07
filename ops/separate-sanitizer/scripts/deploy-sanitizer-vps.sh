#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAN_HOST="${SAN_HOST:?set SAN_HOST}"
SAN_USER="${SAN_USER:-root}"
SSH_TARGET="${SAN_USER}@${SAN_HOST}"

echo "[deploy-sanitizer-vps] target: ${SSH_TARGET}"

ssh "${SSH_TARGET}" "mkdir -p /usr/local/bin /etc/systemd/system /etc/sanitizer /var/log/sanitizer /srv/sanitizer"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/bootstrap-sanitizer-vps.sh" "${SSH_TARGET}:/usr/local/bin/bootstrap-sanitizer-vps.sh"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/sanitizer_service.py" "${SSH_TARGET}:/usr/local/bin/sanitizer_service.py"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/export-signed-bundle.sh" "${SSH_TARGET}:/usr/local/bin/export-signed-bundle.sh"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/push-signed-bundle.sh" "${SSH_TARGET}:/usr/local/bin/push-signed-bundle.sh"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/systemd/sanitizer-sanitize.service" "${SSH_TARGET}:/etc/systemd/system/sanitizer-sanitize.service"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/systemd/sanitizer-sanitize.timer" "${SSH_TARGET}:/etc/systemd/system/sanitizer-sanitize.timer"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/systemd/sanitizer-sanitize.path" "${SSH_TARGET}:/etc/systemd/system/sanitizer-sanitize.path"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/systemd/sanitizer-export.service" "${SSH_TARGET}:/etc/systemd/system/sanitizer-export.service"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/systemd/sanitizer-export.timer" "${SSH_TARGET}:/etc/systemd/system/sanitizer-export.timer"
scp "${ROOT_DIR}/separate-sanitizer/sanitizer-vps/systemd/sanitizer-export.path" "${SSH_TARGET}:/etc/systemd/system/sanitizer-export.path"

ssh "${SSH_TARGET}" "chmod 755 /usr/local/bin/bootstrap-sanitizer-vps.sh /usr/local/bin/sanitizer_service.py /usr/local/bin/export-signed-bundle.sh /usr/local/bin/push-signed-bundle.sh"
ssh "${SSH_TARGET}" "/usr/local/bin/bootstrap-sanitizer-vps.sh"
ssh "${SSH_TARGET}" "systemctl daemon-reload && systemctl enable --now sanitizer-sanitize.timer sanitizer-sanitize.path sanitizer-export.timer sanitizer-export.path"
ssh "${SSH_TARGET}" "systemctl is-active sanitizer-sanitize.timer sanitizer-sanitize.path sanitizer-export.timer sanitizer-export.path"

echo "[deploy-sanitizer-vps] done"
