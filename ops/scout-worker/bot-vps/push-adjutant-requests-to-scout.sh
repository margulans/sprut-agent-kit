#!/usr/bin/env bash
set -euo pipefail

# Push Adjutant-side Scout requests to Scout VPS inbox.
# Same logic as push-requests-to-scout.sh but for /home/adjutant paths
# and adjutant SSH key.

BOT_SCOUT_REQUEST_DIR="${BOT_SCOUT_REQUEST_DIR:-/home/adjutant/inbox/requests}"
BOT_SCOUT_SENT_DIR="${BOT_SCOUT_SENT_DIR:-/home/adjutant/inbox/sent}"
BOT_SCOUT_FAILED_DIR="${BOT_SCOUT_FAILED_DIR:-/home/adjutant/inbox/failed}"

SCOUT_HOST="${SCOUT_HOST:?set SCOUT_HOST}"
SCOUT_USER="${SCOUT_USER:-scout}"
SCOUT_INBOX_DIR="${SCOUT_INBOX_DIR:-/srv/scout/inbox/requests}"
BOT_SCOUT_PUSH_KEY="${BOT_SCOUT_PUSH_KEY:-/home/adjutant/.ssh/id_ed25519_scout_requests}"

mkdir -p "${BOT_SCOUT_REQUEST_DIR}" "${BOT_SCOUT_SENT_DIR}" "${BOT_SCOUT_FAILED_DIR}"

shopt -s nullglob
files=("${BOT_SCOUT_REQUEST_DIR}"/*.json)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "no adjutant scout requests to push"
  exit 0
fi

ts="$(date -u +%Y%m%d_%H%M%S)"
for file in "${files[@]}"; do
  base="$(basename "${file}")"
  if scp -i "${BOT_SCOUT_PUSH_KEY}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${file}" "${SCOUT_USER}@${SCOUT_HOST}:${SCOUT_INBOX_DIR}/${base}"; then
    mv "${file}" "${BOT_SCOUT_SENT_DIR}/${ts}_${base}"
    echo "pushed ${base}"
  else
    mv "${file}" "${BOT_SCOUT_FAILED_DIR}/${ts}_${base}"
    echo "failed ${base}" >&2
  fi
done
