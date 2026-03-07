#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANON_DIR="${ROOT_DIR}/vps-sync/canonical"
RUNTIME_DIR="${ROOT_DIR}/vps-sync/runtime"
CONTRACTS_DIR="${ROOT_DIR}/vps-sync/contracts"
PLUGIN_VERSION="${PLUGIN_VERSION:-1.0.0}"

VPS_HOST="${VPS_HOST:-136.244.83.50}"
VPS_USER="${VPS_USER:-root}"
SSH_TARGET="${VPS_USER}@${VPS_HOST}"

echo "[sync-from-vps] source: ${SSH_TARGET}"

mkdir -p "${CANON_DIR}" "${RUNTIME_DIR}" "${CONTRACTS_DIR}"

scp "${SSH_TARGET}:/home/claudeclaw/.claude/claudeclaw/settings.json" "${CANON_DIR}/claudeclaw-settings.json"
scp "${SSH_TARGET}:/home/claudeclaw/sanitizer/sanitizer.py" "${CANON_DIR}/sanitizer.py"
scp "${SSH_TARGET}:/home/claudeclaw/sanitizer/ingest-checked.sh" "${CANON_DIR}/ingest-checked.sh"
scp "${SSH_TARGET}:/usr/local/bin/claudeclaw-firewall.sh" "${CANON_DIR}/claudeclaw-firewall.sh"
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/checksums.sha256" "${CANON_DIR}/checksums.remote.sha256" || true

scp "${SSH_TARGET}:/home/claudeclaw/.claude/plugins/cache/claudeclaw/claudeclaw/${PLUGIN_VERSION}/src/commands/telegram.ts" "${RUNTIME_DIR}/telegram.ts" || true
scp "${SSH_TARGET}:/home/claudeclaw/.claude/plugins/cache/claudeclaw/claudeclaw/${PLUGIN_VERSION}/src/preflight.ts" "${RUNTIME_DIR}/preflight.ts" || true
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/scout-request.schema.json" "${CONTRACTS_DIR}/scout-request.schema.json" || \
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/informer-request.schema.json" "${CONTRACTS_DIR}/scout-request.schema.json" || true
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/scout-response.schema.json" "${CONTRACTS_DIR}/scout-response.schema.json" || \
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/informer-response.schema.json" "${CONTRACTS_DIR}/scout-response.schema.json" || true
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/twin-memory-event.schema.json" "${CONTRACTS_DIR}/twin-memory-event.schema.json" || true
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/twin-config-snapshot.schema.json" "${CONTRACTS_DIR}/twin-config-snapshot.schema.json" || true
scp "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/twin-config-proposal.schema.json" "${CONTRACTS_DIR}/twin-config-proposal.schema.json" || true

# Redact secrets before saving to git history
python3 - <<'PY'
import json
from pathlib import Path

p = Path("ops/vps-sync/canonical/claudeclaw-settings.json")
cfg = json.loads(p.read_text(encoding="utf-8"))
cfg.setdefault("telegram", {})["token"] = "__KEEP_REMOTE__"
p.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
print("settings token redacted")
PY

# Recompute local checksums after token redaction
(
  cd "${CANON_DIR}"
  shasum -a 256 claudeclaw-settings.json sanitizer.py ingest-checked.sh claudeclaw-firewall.sh \
    | awk '{print $1"  "$2}' > checksums.sha256
)

echo "[sync-from-vps] done"

