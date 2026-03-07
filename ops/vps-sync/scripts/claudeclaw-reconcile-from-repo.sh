#!/usr/bin/env bash
set -euo pipefail

REPO="/home/claudeclaw/sprut-agent-kit"
CANON="${REPO}/ops/vps-sync/canonical"
RUNTIME="${REPO}/ops/vps-sync/runtime"
PLUGIN_BASE="/home/claudeclaw/.claude/plugins/cache/claudeclaw/claudeclaw"
PLUGIN_VERSION="1.0.0"
PLUGIN_SRC="${PLUGIN_BASE}/${PLUGIN_VERSION}/src"
MODE="${1:---apply}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [reconcile] $*"; }

if [[ "${MODE}" != "--apply" && "${MODE}" != "--dry-run" ]]; then
  log "usage: $0 [--apply|--dry-run]"
  exit 1
fi

if [[ ! -d "${CANON}" ]]; then
  log "canonical dir not found: ${CANON}"
  exit 1
fi

if [[ ! -f "${CANON}/checksums.sha256" ]]; then
  log "checksums file not found: ${CANON}/checksums.sha256"
  exit 1
fi

log "verifying canonical checksums"
( cd "${CANON}" && sha256sum -c checksums.sha256 )

if [[ ! -d "${PLUGIN_SRC}" ]]; then
  log "pinned plugin src not found: ${PLUGIN_SRC}"
  exit 1
fi

if [[ "${MODE}" == "--dry-run" ]]; then
  log "dry-run passed: checksums and pinned plugin version are valid"
  log "would apply files from ${CANON}, sync runtime from ${RUNTIME}, re-apply firewall, restart claudeclaw"
  exit 0
fi

install -m 750 -o sanitizer -g claudeclaw "${CANON}/sanitizer.py" /home/claudeclaw/sanitizer/sanitizer.py
install -m 750 -o claudeclaw -g claudeclaw "${CANON}/ingest-checked.sh" /home/claudeclaw/sanitizer/ingest-checked.sh
install -m 755 -o root -g root "${CANON}/claudeclaw-firewall.sh" /usr/local/bin/claudeclaw-firewall.sh

python3 - <<'PY'
import json
from pathlib import Path

canon_path = Path("/home/claudeclaw/sprut-agent-kit/ops/vps-sync/canonical/claudeclaw-settings.json")
remote_path = Path("/home/claudeclaw/.claude/claudeclaw/settings.json")

canon = json.loads(canon_path.read_text(encoding="utf-8"))
remote = json.loads(remote_path.read_text(encoding="utf-8")) if remote_path.exists() else {}

if canon.get("telegram", {}).get("token") == "__KEEP_REMOTE__":
    canon.setdefault("telegram", {})["token"] = remote.get("telegram", {}).get("token", "")

remote_path.write_text(json.dumps(canon, indent=2, ensure_ascii=False), encoding="utf-8")
print("settings merged")
PY

export PLUGIN_SRC
python3 - <<'PY'
import os
from pathlib import Path
plugin_src = Path(os.environ["PLUGIN_SRC"])
runtime_dir = Path("/home/claudeclaw/sprut-agent-kit/ops/vps-sync/runtime")
runtime_telegram = runtime_dir / "telegram.ts"
runtime_preflight = runtime_dir / "preflight.ts"

target_telegram = plugin_src / "commands" / "telegram.ts"
target_preflight = plugin_src / "preflight.ts"

if runtime_telegram.exists():
    target_telegram.write_text(runtime_telegram.read_text(encoding="utf-8"), encoding="utf-8")

if runtime_preflight.exists():
    target_preflight.write_text(runtime_preflight.read_text(encoding="utf-8"), encoding="utf-8")
PY

/usr/local/bin/claudeclaw-firewall.sh >/tmp/claudeclaw-firewall-last-apply.log
netfilter-persistent save >/dev/null 2>&1 || true
systemctl restart claudeclaw
log "reconcile complete"

