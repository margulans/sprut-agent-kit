#!/usr/bin/env bash
set -euo pipefail

# RO-доступ ботов к verified mirror.

MIRROR_DIR="/home/claudeclaw/checked/canonical"
STATE_DIR="/home/claudeclaw/checked/state"
READ_GROUP="checkedreaders"

getent group "${READ_GROUP}" >/dev/null 2>&1 || groupadd "${READ_GROUP}"
id -u claudeclaw >/dev/null 2>&1 && usermod -aG "${READ_GROUP}" claudeclaw || true
id -u openclaw >/dev/null 2>&1 && usermod -aG "${READ_GROUP}" openclaw || true

mkdir -p "${MIRROR_DIR}" "${STATE_DIR}"
chown -R root:"${READ_GROUP}" "${MIRROR_DIR}" "${STATE_DIR}"
find "${MIRROR_DIR}" -type d -exec chmod 750 {} \;
find "${STATE_DIR}" -type d -exec chmod 750 {} \;
find "${MIRROR_DIR}" -type f -exec chmod 640 {} \; || true
find "${STATE_DIR}" -type f -exec chmod 640 {} \; || true

echo "readonly permissions applied for ${MIRROR_DIR} and ${STATE_DIR}"
