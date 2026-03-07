#!/usr/bin/env bash
set -euo pipefail

# End-to-end test:
# Scout request -> Scout outbox -> transport to Sanitizer raw -> sanitize -> export/push -> Bot import -> checked/canonical.

SCOUT_HOST="${SCOUT_HOST:?set SCOUT_HOST}"
SAN_HOST="${SAN_HOST:?set SAN_HOST}"
BOT_HOST="${BOT_HOST:?set BOT_HOST}"

SCOUT_USER="${SCOUT_USER:-root}"
SAN_USER="${SAN_USER:-root}"
BOT_USER="${BOT_USER:-root}"

SCOUT_SSH="${SCOUT_USER}@${SCOUT_HOST}"
SAN_SSH="${SAN_USER}@${SAN_HOST}"
BOT_SSH="${BOT_USER}@${BOT_HOST}"

RID="weather-$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)-e2e"
REQ_FILE="/srv/scout/inbox/requests/${RID}.json"
REQ_PAYLOAD="$(cat <<EOF
{
  "schema_version": "1.0",
  "request_id": "${RID}",
  "task_type": "weather_lookup",
  "source_bot": "e2e",
  "provenance": "owner_direct",
  "trust_level": "trusted_owner",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "chat_id": null,
  "query": "weather in Almaty"
}
EOF
)"

echo "[e2e] creating request on Scout VPS: ${RID}"
ssh "${SCOUT_SSH}" "cat > '${REQ_FILE}'" <<< "${REQ_PAYLOAD}"

echo "[e2e] running Scout poll + push"
ssh "${SCOUT_SSH}" "systemctl start scout-poll.service && systemctl start scout-push.service"

echo "[e2e] running Sanitizer pipeline"
ssh "${SAN_SSH}" "systemctl start sanitizer-sanitize.service && systemctl start sanitizer-export.service"

echo "[e2e] running Bot import"
ssh "${BOT_SSH}" "systemctl start sanitizer-import.service"

echo "[e2e] checking result in Bot checked/canonical"
if ssh "${BOT_SSH}" "python3 - <<'PY'
from pathlib import Path
rid = '${RID}'
for p in Path('/home/claudeclaw/checked/canonical').glob('*.json'):
    try:
        text = p.read_text(encoding='utf-8')
    except Exception:
        continue
    if rid in text:
        print(p)
        raise SystemExit(0)
raise SystemExit(1)
PY"; then
  echo "[e2e] SUCCESS: request_id ${RID} found in checked/canonical"
  exit 0
fi

echo "[e2e] FAILED: request_id ${RID} not found in checked/canonical" >&2
exit 1
