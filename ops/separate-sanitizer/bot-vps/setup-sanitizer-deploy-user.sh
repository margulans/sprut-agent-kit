#!/usr/bin/env bash
set -euo pipefail

# Создает минимального SSH-пользователя для приема bundle от Sanitizer VPS.

DEPLOY_USER="${DEPLOY_USER:-sanitizerdeploy}"
IMPORT_BASE="${IMPORT_BASE:-/home/claudeclaw/import/inbox}"

id -u "${DEPLOY_USER}" >/dev/null 2>&1 || useradd -m -s /bin/bash "${DEPLOY_USER}"
mkdir -p "/home/${DEPLOY_USER}/.ssh" "${IMPORT_BASE}"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
chmod 700 "/home/${DEPLOY_USER}/.ssh"

touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"

mkdir -p /etc/sanitizer
touch /etc/sanitizer/allowed_signers
chmod 644 /etc/sanitizer/allowed_signers

# deploy user может только писать в inbox.
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${IMPORT_BASE}"
chmod 750 "${IMPORT_BASE}"
chmod 751 /home/claudeclaw
mkdir -p /home/claudeclaw/checked/state
date -u +%Y-%m-%dT%H:%M:%SZ > /home/claudeclaw/checked/state/.bootstrapped_at

echo "deploy user ready: ${DEPLOY_USER}"
echo "add sanitizer public key to /home/${DEPLOY_USER}/.ssh/authorized_keys"
echo "add signer mapping to /etc/sanitizer/allowed_signers:"
echo "  sanitizer-bundle <sanitizer-signing-public-key>"
