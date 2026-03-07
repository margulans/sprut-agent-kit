#!/usr/bin/env bash
set -euo pipefail

# Full cutover flow:
# 1) Deploy Scout stack to NEW_SCOUT_HOST
# 2) Configure SSH trust NEW_SCOUT_HOST -> SAN_HOST
# 3) Run E2E weather test on NEW_SCOUT_HOST
# 4) Disable Scout services on OLD_SCOUT_HOST (optional)

NEW_SCOUT_HOST="${NEW_SCOUT_HOST:?set NEW_SCOUT_HOST}"
SAN_HOST="${SAN_HOST:?set SAN_HOST}"
BOT_HOST="${BOT_HOST:-136.244.83.50}"

NEW_SCOUT_USER="${NEW_SCOUT_USER:-root}"
OLD_SCOUT_HOST="${OLD_SCOUT_HOST:-}"
OLD_SCOUT_USER="${OLD_SCOUT_USER:-root}"
SAN_USER="${SAN_USER:-sanitizer}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[cutover] step 1/4: deploy scout stack to ${NEW_SCOUT_HOST}"
SCOUT_HOST="${NEW_SCOUT_HOST}" SCOUT_USER="${NEW_SCOUT_USER}" SAN_HOST="${SAN_HOST}" SAN_USER="${SAN_USER}" \
  bash "${ROOT_DIR}/scout-worker/scripts/deploy-scout-vps.sh"

echo "[cutover] step 2/4: setup SSH trust scout -> sanitizer"
SCOUT_HOST="${NEW_SCOUT_HOST}" SCOUT_ROOT_USER="${NEW_SCOUT_USER}" SAN_HOST="${SAN_HOST}" SAN_ROOT_USER="root" SAN_PUSH_USER="${SAN_USER}" \
  bash "${ROOT_DIR}/scout-worker/scripts/setup-scout-to-sanitizer-ssh.sh"

echo "[cutover] step 3/4: run E2E weather test"
SCOUT_HOST="${NEW_SCOUT_HOST}" SCOUT_USER="${NEW_SCOUT_USER}" SAN_HOST="${SAN_HOST}" SAN_USER="root" BOT_HOST="${BOT_HOST}" BOT_USER="root" \
  bash "${ROOT_DIR}/scout-worker/scripts/e2e-weather.sh"

if [[ -n "${OLD_SCOUT_HOST}" ]]; then
  echo "[cutover] step 4/4: disable scout services on old host ${OLD_SCOUT_HOST}"
  ssh "${OLD_SCOUT_USER}@${OLD_SCOUT_HOST}" \
    "systemctl disable --now scout-poll.timer scout-push.timer scout-scan.timer || true; \
     systemctl stop scout-poll.service scout-push.service scout-scan.service || true; \
     systemctl reset-failed scout-poll.service scout-push.service scout-scan.service || true"
  echo "[cutover] old host disabled: ${OLD_SCOUT_HOST}"
else
  echo "[cutover] step 4/4 skipped: OLD_SCOUT_HOST not provided"
fi

echo "[cutover] done"
