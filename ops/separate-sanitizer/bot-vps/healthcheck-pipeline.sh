#!/usr/bin/env bash
set -euo pipefail

# Healthcheck по lag/verify/quarantine для двух-VPS пайплайна.

STATE_DIR="/home/claudeclaw/checked/state"
MIRROR_DIR="/home/claudeclaw/checked/canonical"
IMPORT_LOG="/var/log/claudeclaw/import-verify.log"
HEALTH_LOG="/var/log/claudeclaw/checked-health.log"
MAX_IMPORT_LAG_MIN="${MAX_IMPORT_LAG_MIN:-180}"
BOOTSTRAP_GRACE_HOURS="${BOOTSTRAP_GRACE_HOURS:-24}"

now_epoch="$(date -u +%s)"
status=0
message=()
bootstrap_mode=0

bootstrap_file="${STATE_DIR}/.bootstrapped_at"
if [[ -f "${bootstrap_file}" ]]; then
  bootstrap_epoch="$(date -u -d "$(cat "${bootstrap_file}")" +%s 2>/dev/null || echo 0)"
  if [[ "${bootstrap_epoch}" != "0" ]]; then
    bootstrap_age_h=$(( (now_epoch - bootstrap_epoch) / 3600 ))
    if (( bootstrap_age_h < BOOTSTRAP_GRACE_HOURS )); then
      bootstrap_mode=1
    fi
  fi
fi

check_state_file() {
  local state_file="$1"
  local consumer="$2"
  if [[ ! -f "${state_file}" ]]; then
    if (( bootstrap_mode == 1 )); then
      message+=("${consumer}: missing state (bootstrap)")
    else
      status=1
      message+=("${consumer}: missing state")
    fi
    return
  fi
  local imported_at
  imported_at="$(python3 - "${state_file}" <<'PY'
import json,sys
obj=json.load(open(sys.argv[1],encoding="utf-8"))
print(obj.get("imported_at",""))
PY
)"
  if [[ -z "${imported_at}" ]]; then
    status=1
    message+=("${consumer}: empty imported_at")
    return
  fi
  local imported_epoch
  imported_epoch="$(date -u -d "${imported_at}" +%s 2>/dev/null || echo 0)"
  local lag_min=$(( (now_epoch - imported_epoch) / 60 ))
  if (( lag_min > MAX_IMPORT_LAG_MIN )); then
    status=1
    message+=("${consumer}: stale mirror lag=${lag_min}m")
  fi
}

mkdir -p "$(dirname "${HEALTH_LOG}")"
check_state_file "${STATE_DIR}/claudeclaw.json" "claudeclaw"
check_state_file "${STATE_DIR}/openclaw.json" "openclaw"

if id -u claudeclaw >/dev/null 2>&1; then
  if ! sudo -u claudeclaw test -r "${STATE_DIR}/claudeclaw.json"; then
    status=1
    message+=("claudeclaw: cannot read state file")
  fi

  if ! sudo -u claudeclaw python3 - "${MIRROR_DIR}" <<'PY'
from pathlib import Path
import sys

mirror = Path(sys.argv[1])
files = sorted(mirror.glob("*.json"))
if not files:
    raise SystemExit(0)

probe = files[0]
probe.read_text(encoding="utf-8", errors="ignore")
PY
  then
    status=1
    message+=("claudeclaw: cannot read checked mirror files")
  fi
fi

if [[ -f "${IMPORT_LOG}" ]]; then
  if python3 - "${IMPORT_LOG}" <<'PY'
import re
import sys
text = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
pat = re.compile(r"checksum mismatch|missing file from manifest|sha mismatch")
raise SystemExit(0 if pat.search(text) else 1)
PY
  then
    status=1
    message+=("import log has verification failures")
  fi
fi

if (( status == 0 )); then
  if (( bootstrap_mode == 1 )) && [[ "${#message[@]}" -gt 0 ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) WARN ${message[*]}" >> "${HEALTH_LOG}"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) OK pipeline health" >> "${HEALTH_LOG}"
  fi
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) FAIL ${message[*]}" >> "${HEALTH_LOG}"
  exit 1
fi
