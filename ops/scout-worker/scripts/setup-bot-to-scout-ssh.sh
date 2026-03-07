#!/usr/bin/env bash
set -euo pipefail

# Configure SSH trust for Bot VPS (claudeclaw) -> Scout VPS (scout) request push.

BOT_HOST="${BOT_HOST:-136.244.83.50}"
BOT_ROOT_USER="${BOT_ROOT_USER:-root}"
SCOUT_HOST="${SCOUT_HOST:?set SCOUT_HOST}"
SCOUT_ROOT_USER="${SCOUT_ROOT_USER:-root}"
BOT_PUSH_USER="${BOT_PUSH_USER:-claudeclaw}"
SCOUT_PUSH_USER="${SCOUT_PUSH_USER:-scout}"

BOT_SSH="${BOT_ROOT_USER}@${BOT_HOST}"
SCOUT_SSH="${SCOUT_ROOT_USER}@${SCOUT_HOST}"
KEY_PATH="/home/${BOT_PUSH_USER}/.ssh/id_ed25519_scout_requests"
PUB_PATH="${KEY_PATH}.pub"

echo "[ssh-setup] generating key on Bot if absent"
ssh "${BOT_SSH}" "mkdir -p /home/${BOT_PUSH_USER}/.ssh && chown ${BOT_PUSH_USER}:${BOT_PUSH_USER} /home/${BOT_PUSH_USER}/.ssh && chmod 700 /home/${BOT_PUSH_USER}/.ssh"
ssh "${BOT_SSH}" "sudo -u ${BOT_PUSH_USER} bash -lc '[[ -f ${KEY_PATH} ]] || ssh-keygen -t ed25519 -N \"\" -f ${KEY_PATH} -C bot-to-scout'"

PUB_KEY="$(ssh "${BOT_SSH}" "cat ${PUB_PATH}")"
if [[ -z "${PUB_KEY}" ]]; then
  echo "[ssh-setup] failed to read generated public key" >&2
  exit 1
fi

echo "[ssh-setup] installing key to Scout user authorized_keys"
ssh "${SCOUT_SSH}" "id -u ${SCOUT_PUSH_USER} >/dev/null 2>&1 || useradd -m -s /bin/bash ${SCOUT_PUSH_USER}"
ssh "${SCOUT_SSH}" "mkdir -p /home/${SCOUT_PUSH_USER}/.ssh && touch /home/${SCOUT_PUSH_USER}/.ssh/authorized_keys && chown -R ${SCOUT_PUSH_USER}:${SCOUT_PUSH_USER} /home/${SCOUT_PUSH_USER}/.ssh && chmod 700 /home/${SCOUT_PUSH_USER}/.ssh && chmod 600 /home/${SCOUT_PUSH_USER}/.ssh/authorized_keys"
ssh "${SCOUT_SSH}" "grep -F \"${PUB_KEY}\" /home/${SCOUT_PUSH_USER}/.ssh/authorized_keys >/dev/null 2>&1 || echo '${PUB_KEY}' >> /home/${SCOUT_PUSH_USER}/.ssh/authorized_keys"

echo "[ssh-setup] testing outbound SSH from Bot to Scout"
ssh "${BOT_SSH}" "sudo -u ${BOT_PUSH_USER} ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i ${KEY_PATH} ${SCOUT_PUSH_USER}@${SCOUT_HOST} 'echo scout-link-ok'"

echo "[ssh-setup] done"
