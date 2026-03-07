#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANON_DIR="${ROOT_DIR}/vps-sync/canonical"
RUNTIME_DIR="${ROOT_DIR}/vps-sync/runtime"
CONTRACTS_DIR="${ROOT_DIR}/vps-sync/contracts"
LOCAL_SCRIPT_DIR="${ROOT_DIR}/vps-sync/scripts"

VPS_HOST="${VPS_HOST:-136.244.83.50}"
VPS_USER="${VPS_USER:-root}"
SSH_TARGET="${VPS_USER}@${VPS_HOST}"

echo "[sync-to-vps] target: ${SSH_TARGET}"

# 1) Upload canonical files into VPS repo (source of truth for reconcile)
ssh "${SSH_TARGET}" 'mkdir -p /home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical'
ssh "${SSH_TARGET}" 'mkdir -p /home/claudeclaw/sprut-agent-kit/ops/vps-sync/runtime'
ssh "${SSH_TARGET}" 'mkdir -p /home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts'
scp "${CANON_DIR}/claudeclaw-settings.json" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/claudeclaw-settings.json"
scp "${CANON_DIR}/sanitizer.py" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/sanitizer.py"
scp "${CANON_DIR}/ingest-checked.sh" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/ingest-checked.sh"
scp "${CANON_DIR}/claudeclaw-firewall.sh" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/claudeclaw-firewall.sh"
scp "${CANON_DIR}/checksums.sha256" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/checksums.sha256"
scp "${RUNTIME_DIR}/telegram.ts" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/runtime/telegram.ts"
scp "${RUNTIME_DIR}/preflight.ts" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/runtime/preflight.ts"
scp "${CONTRACTS_DIR}/scout-request.schema.json" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/scout-request.schema.json"
scp "${CONTRACTS_DIR}/scout-response.schema.json" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/scout-response.schema.json"
scp "${CONTRACTS_DIR}/twin-memory-event.schema.json" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/twin-memory-event.schema.json"
scp "${CONTRACTS_DIR}/twin-config-snapshot.schema.json" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/twin-config-snapshot.schema.json"
scp "${CONTRACTS_DIR}/twin-config-proposal.schema.json" "${SSH_TARGET}:/home/claudeclaw/sprut-agent-kit/ops/vps-sync/contracts/twin-config-proposal.schema.json"

# 2) Upload reconcile script and apply from VPS repo canonical
scp "${LOCAL_SCRIPT_DIR}/claudeclaw-reconcile-from-repo.sh" "${SSH_TARGET}:/usr/local/bin/claudeclaw-reconcile-from-repo.sh"

ssh "${SSH_TARGET}" 'bash -s' <<'REMOTE'
set -euo pipefail

chmod +x /usr/local/bin/claudeclaw-reconcile-from-repo.sh
/usr/local/bin/claudeclaw-reconcile-from-repo.sh --apply
systemctl is-active claudeclaw

echo "sync-to-vps applied"
REMOTE

echo "[sync-to-vps] done"

