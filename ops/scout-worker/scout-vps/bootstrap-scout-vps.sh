#!/usr/bin/env bash
set -euo pipefail

SCOUT_USER="${SCOUT_USER:-scout}"
SCOUT_GROUP="${SCOUT_GROUP:-scout}"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  python3 python3-venv python3-pip jq rsync fail2ban ufw unattended-upgrades curl

id -u "${SCOUT_USER}" >/dev/null 2>&1 || useradd -m -s /bin/bash "${SCOUT_USER}"
getent group "${SCOUT_GROUP}" >/dev/null 2>&1 || groupadd "${SCOUT_GROUP}"
usermod -a -G "${SCOUT_GROUP}" "${SCOUT_USER}"

mkdir -p /srv/scout/inbox/requests /srv/scout/outbox/raw /srv/scout/outbox/sent /srv/scout/outbox/failed /srv/scout/processed /srv/scout/error /srv/scout/state
mkdir -p /etc/scout /var/log/scout /usr/local/bin

chown -R "${SCOUT_USER}:${SCOUT_GROUP}" /srv/scout /var/log/scout
chmod -R 750 /srv/scout
chmod 750 /var/log/scout

# SSH hardening: root доступ только по ключу.
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

systemctl enable --now fail2ban
systemctl enable --now unattended-upgrades || true

# Опциональные Python-зависимости для расширенных скиллов.
python3 -m pip install --break-system-packages --upgrade youtube-transcript-api >/var/log/scout/pip-install.log 2>&1 || true

echo "Scout VPS bootstrap complete"
