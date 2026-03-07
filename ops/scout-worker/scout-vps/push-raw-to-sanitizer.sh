#!/usr/bin/env bash
set -euo pipefail

# Push raw scout outputs to Sanitizer VPS raw inbox.

SCOUT_OUTBOX_RAW="${SCOUT_OUTBOX_RAW:-/srv/scout/outbox/raw}"
SCOUT_OUTBOX_SENT="${SCOUT_OUTBOX_SENT:-/srv/scout/outbox/sent}"
SCOUT_OUTBOX_FAILED="${SCOUT_OUTBOX_FAILED:-/srv/scout/outbox/failed}"
SAN_HOST="${SAN_HOST:?set SAN_HOST}"
SAN_USER="${SAN_USER:-sanitizer}"
SAN_RAW_INBOX="${SAN_RAW_INBOX:-/srv/sanitizer/inbox/raw}"
SCOUT_PUSH_KEY="${SCOUT_PUSH_KEY:-/home/scout/.ssh/id_ed25519_sanitizer_push}"

mkdir -p "${SCOUT_OUTBOX_RAW}" "${SCOUT_OUTBOX_SENT}" "${SCOUT_OUTBOX_FAILED}"

shopt -s nullglob
files=("${SCOUT_OUTBOX_RAW}"/*.json)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "no raw files to push"
  exit 0
fi

ts="$(date -u +%Y%m%d_%H%M%S)"

for file in "${files[@]}"; do
  base="$(basename "${file}")"
  if scp -i "${SCOUT_PUSH_KEY}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${file}" "${SAN_USER}@${SAN_HOST}:${SAN_RAW_INBOX}/${base}"; then
    mv "${file}" "${SCOUT_OUTBOX_SENT}/${ts}_${base}"
    echo "pushed ${base}"
  else
    mv "${file}" "${SCOUT_OUTBOX_FAILED}/${ts}_${base}"
    echo "failed ${base}" >&2
  fi
done
