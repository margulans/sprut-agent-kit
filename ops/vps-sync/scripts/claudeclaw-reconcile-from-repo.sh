#!/usr/bin/env bash
set -euo pipefail

REPO="/home/claudeclaw/sprut-agent-kit"
CANON="${REPO}/ops/vps-sync/canonical"
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
  log "would apply files from ${CANON}, patch plugin ${PLUGIN_VERSION}, re-apply firewall, restart claudeclaw"
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

telegram = plugin_src / "commands" / "telegram.ts"
if telegram.exists():
    text = telegram.read_text(encoding="utf-8")
    old_prefix = "    const promptParts = [`[Telegram from "
    if old_prefix in text and "[InputProvenance: owner_direct]" not in text:
        replacement = "    const promptParts = [\"[InputProvenance: owner_direct]\", \"[TrustLevel: trusted_owner]\", `[Telegram from $" + "{label}]`];"
        text = text.replace(
            "    const promptParts = [`[Telegram from ${label}]`];",
            replacement,
            1,
        )
        telegram.write_text(text, encoding="utf-8")

preflight = plugin_src / "preflight.ts"
if preflight.exists():
    text = preflight.read_text(encoding="utf-8")
    replacements = {
        '"https://github.com/SawyerHood/dev-browser",': '// "https://github.com/SawyerHood/dev-browser", // disabled: firewall blocks github',
        '"https://github.com/thedotmack/claude-mem",': '// "https://github.com/thedotmack/claude-mem", // disabled: already installed, firewall blocks github',
        '"https://github.com/obra/superpowers-marketplace",': '// "https://github.com/obra/superpowers-marketplace", // disabled: not needed',
        '"code-review",': '// "code-review", // disabled',
        '"pr-review-toolkit",': '// "pr-review-toolkit", // disabled',
        '"commit-commands",': '// "commit-commands", // disabled',
        '"plugin-dev",': '// "plugin-dev", // disabled',
    }
    changed = False
    for src, dst in replacements.items():
        if src in text:
            text = text.replace(src, dst)
            changed = True
    if changed:
        preflight.write_text(text, encoding="utf-8")
PY

/usr/local/bin/claudeclaw-firewall.sh >/tmp/claudeclaw-firewall-last-apply.log
netfilter-persistent save >/dev/null 2>&1 || true
systemctl restart claudeclaw
log "reconcile complete"

