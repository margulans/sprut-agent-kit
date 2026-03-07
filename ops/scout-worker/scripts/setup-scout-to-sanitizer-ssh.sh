#!/usr/bin/env bash
set -euo pipefail

# Configure SSH trust for Scout VPS -> Sanitizer VPS transport.

SCOUT_HOST="${SCOUT_HOST:?set SCOUT_HOST}"
SAN_HOST="${SAN_HOST:?set SAN_HOST}"
SCOUT_ROOT_USER="${SCOUT_ROOT_USER:-root}"
SAN_ROOT_USER="${SAN_ROOT_USER:-root}"
SCOUT_PUSH_USER="${SCOUT_PUSH_USER:-scout}"
SAN_PUSH_USER="${SAN_PUSH_USER:-sanitizer}"

SCOUT_SSH="${SCOUT_ROOT_USER}@${SCOUT_HOST}"
SAN_SSH="${SAN_ROOT_USER}@${SAN_HOST}"
KEY_PATH="/home/${SCOUT_PUSH_USER}/.ssh/id_ed25519_sanitizer_push"
PUB_PATH="${KEY_PATH}.pub"

echo "[ssh-setup] generating key on Scout if absent"
ssh "${SCOUT_SSH}" "mkdir -p /home/${SCOUT_PUSH_USER}/.ssh && chown ${SCOUT_PUSH_USER}:${SCOUT_PUSH_USER} /home/${SCOUT_PUSH_USER}/.ssh && chmod 700 /home/${SCOUT_PUSH_USER}/.ssh"
ssh "${SCOUT_SSH}" "sudo -u ${SCOUT_PUSH_USER} bash -lc '[[ -f ${KEY_PATH} ]] || ssh-keygen -t ed25519 -N \"\" -f ${KEY_PATH} -C scout-to-sanitizer'"

PUB_KEY="$(ssh "${SCOUT_SSH}" "cat ${PUB_PATH}")"
if [[ -z "${PUB_KEY}" ]]; then
  echo "[ssh-setup] failed to read generated public key" >&2
  exit 1
fi

echo "[ssh-setup] installing key to Sanitizer user authorized_keys"
ssh "${SAN_SSH}" "id -u ${SAN_PUSH_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash ${SAN_PUSH_USER}"
ssh "${SAN_SSH}" "mkdir -p /home/${SAN_PUSH_USER}/.ssh && touch /home/${SAN_PUSH_USER}/.ssh/authorized_keys && chown -R ${SAN_PUSH_USER}:${SAN_PUSH_USER} /home/${SAN_PUSH_USER}/.ssh && chmod 700 /home/${SAN_PUSH_USER}/.ssh && chmod 600 /home/${SAN_PUSH_USER}/.ssh/authorized_keys"
ssh "${SAN_SSH}" "grep -F \"${PUB_KEY}\" /home/${SAN_PUSH_USER}/.ssh/authorized_keys >/dev/null 2>&1 || echo '${PUB_KEY}' >> /home/${SAN_PUSH_USER}/.ssh/authorized_keys"

echo "[ssh-setup] testing outbound SSH from Scout to Sanitizer"
ssh "${SCOUT_SSH}" "sudo -u ${SCOUT_PUSH_USER} ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i ${KEY_PATH} ${SAN_PUSH_USER}@${SAN_HOST} 'echo sanitizer-link-ok'"

echo "[ssh-setup] done"
