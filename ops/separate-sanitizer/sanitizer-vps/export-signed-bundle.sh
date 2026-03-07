#!/usr/bin/env bash
set -euo pipefail

# Формирует подписанный бандл из checked/canonical.

BASE_DIR="/srv/sanitizer"
CHECKED_DIR="${BASE_DIR}/checked/canonical"
EXPORT_DIR="${BASE_DIR}/export"
KEY_FILE="/etc/sanitizer/signing_key"
SIGNER_ID="sanitizer-bundle"

mkdir -p "${EXPORT_DIR}"

if [[ ! -d "${CHECKED_DIR}" ]]; then
  echo "checked dir not found: ${CHECKED_DIR}" >&2
  exit 1
fi

if [[ ! -f "${KEY_FILE}" ]]; then
  echo "signing key not found: ${KEY_FILE}" >&2
  exit 1
fi

BUNDLE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(hostname -s)"
WORK_DIR="${EXPORT_DIR}/${BUNDLE_ID}"
mkdir -p "${WORK_DIR}/payload"

# Копируем snapshot checked/canonical в payload.
cp -R "${CHECKED_DIR}/." "${WORK_DIR}/payload/" 2>/dev/null || true

BUNDLE_FILE="sanitized-bundle-${BUNDLE_ID}.tar.gz"
tar -C "${WORK_DIR}/payload" -czf "${WORK_DIR}/${BUNDLE_FILE}" .
BUNDLE_SHA="$(sha256sum "${WORK_DIR}/${BUNDLE_FILE}" | awk '{print $1}')"

python3 - "${WORK_DIR}/payload" "${WORK_DIR}/manifest.json" "${BUNDLE_ID}" "${BUNDLE_FILE}" "${BUNDLE_SHA}" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

payload = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
bundle_id = sys.argv[3]
bundle_file = sys.argv[4]
bundle_sha = sys.argv[5]

files = []
for p in sorted(payload.rglob("*")):
    if p.is_file():
        rel = p.relative_to(payload).as_posix()
        files.append({
            "path": rel,
            "sha256": __import__("hashlib").sha256(p.read_bytes()).hexdigest(),
            "size": p.stat().st_size,
        })

manifest = {
    "schema_version": "1.0",
    "bundle_id": bundle_id,
    "created_at": datetime.now(timezone.utc).isoformat(),
    "source_host": os.uname().nodename,
    "bundle_file": bundle_file,
    "bundle_sha256": bundle_sha,
    "files": files,
    "quarantine_count": len(list(Path("/srv/sanitizer/quarantine").glob("*"))),
}

manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
PY

# Подпись manifest (ssh-keygen -Y format).
ssh-keygen -Y sign -f "${KEY_FILE}" -n file "${WORK_DIR}/manifest.json" >/dev/null
mv "${WORK_DIR}/manifest.json.sig" "${WORK_DIR}/manifest.sig"

echo "${BUNDLE_ID}"
