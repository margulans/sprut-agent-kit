#!/usr/bin/env bash
set -euo pipefail

PLUGIN_BASE="/home/claudeclaw/.claude/plugins/cache/claudeclaw/claudeclaw"

PLUGIN_SRC="$(python3 - <<'PY'
from pathlib import Path
base = Path("/home/claudeclaw/.claude/plugins/cache/claudeclaw/claudeclaw")
candidates = sorted([p / "src" for p in base.iterdir() if (p / "src").exists()], key=lambda p: p.parent.name)
print(candidates[-1] if candidates else "")
PY
)"

if [[ -z "${PLUGIN_SRC}" || ! -d "${PLUGIN_SRC}" ]]; then
  echo "Plugin src not found under ${PLUGIN_BASE}"
  exit 1
fi

export PLUGIN_SRC
python3 - <<'PY'
import os
from pathlib import Path

plugin_src = Path(os.environ["PLUGIN_SRC"])

# 1) telegram.ts provenance labels
telegram = plugin_src / "commands" / "telegram.ts"
if telegram.exists():
    text = telegram.read_text(encoding="utf-8")
    old = '    const promptParts = [`[Telegram from ${label}]`];\\n'
    new = '    const promptParts = ["[InputProvenance: owner_direct]", "[TrustLevel: trusted_owner]", `[Telegram from ${label}]`];\\n'
    if old in text and new not in text:
        text = text.replace(old, new, 1)
        telegram.write_text(text, encoding="utf-8")
        print("Patched telegram.ts provenance")
    else:
        print("telegram.ts provenance already patched")
else:
    print("telegram.ts not found")

# 2) preflight.ts disable internet-heavy plugin installs
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
        print("Patched preflight.ts plugin list")
    else:
        print("preflight.ts already patched")
else:
    print("preflight.ts not found")
PY

