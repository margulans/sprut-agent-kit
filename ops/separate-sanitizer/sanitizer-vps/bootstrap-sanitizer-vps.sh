#!/usr/bin/env bash
set -euo pipefail

# Bootstrap нового Sanitizer VPS (Ubuntu 24.04).

SAN_USER="${SAN_USER:-sanitizer}"
SAN_GROUP="${SAN_GROUP:-sanitizer}"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  python3 python3-venv python3-pip jq rsync fail2ban ufw unattended-upgrades

id -u "${SAN_USER}" >/dev/null 2>&1 || useradd -m -s /bin/bash "${SAN_USER}"
getent group "${SAN_GROUP}" >/dev/null 2>&1 || groupadd "${SAN_GROUP}"
usermod -a -G "${SAN_GROUP}" "${SAN_USER}"

mkdir -p /srv/sanitizer/inbox/raw /srv/sanitizer/checked/canonical /srv/sanitizer/quarantine /srv/sanitizer/export
mkdir -p /etc/sanitizer /var/log/sanitizer
chown -R "${SAN_USER}:${SAN_GROUP}" /srv/sanitizer /var/log/sanitizer
chmod -R 750 /srv/sanitizer

# SSH hardening: root только по SSH-ключу (без пароля), чтобы не потерять доступ.
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

# Базовый firewall.
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades || true

if [[ ! -f /etc/sanitizer/signing_key ]]; then
  ssh-keygen -q -t ed25519 -N "" -f /etc/sanitizer/signing_key
  chgrp "${SAN_GROUP}" /etc/sanitizer/signing_key
  chmod 640 /etc/sanitizer/signing_key
  chmod 644 /etc/sanitizer/signing_key.pub
fi

echo "Sanitizer VPS bootstrap complete"
echo "Public key (install on Bot VPS /etc/sanitizer/allowed_signers):"
echo "sanitizer-bundle $(cat /etc/sanitizer/signing_key.pub)"
