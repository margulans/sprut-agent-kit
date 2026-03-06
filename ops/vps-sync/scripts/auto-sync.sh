#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOCK_DIR="${ROOT_DIR}/ops/vps-sync/.auto-sync.lock"
SYNC_TO="${ROOT_DIR}/ops/vps-sync/scripts/sync-to-vps.sh"
SYNC_FROM="${ROOT_DIR}/ops/vps-sync/scripts/sync-from-vps.sh"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "$(timestamp) [auto-sync] skip: lock exists"
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" >/dev/null 2>&1 || true' EXIT

echo "$(timestamp) [auto-sync] start"

# Если есть несохраненные локальные изменения — не тянем с сервера, чтобы не перетереть локальную работу.
if git -C "${ROOT_DIR}" diff --quiet && git -C "${ROOT_DIR}" diff --cached --quiet; then
  echo "$(timestamp) [auto-sync] workspace clean -> sync-from + sync-to"
  bash "${SYNC_FROM}"
else
  echo "$(timestamp) [auto-sync] workspace dirty -> skip sync-from, run sync-to only"
fi

bash "${SYNC_TO}"
echo "$(timestamp) [auto-sync] done"

