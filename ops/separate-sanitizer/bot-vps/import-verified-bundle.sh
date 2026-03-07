#!/usr/bin/env bash
set -euo pipefail

# Импортирует только подписанный и проверенный bundle в checked mirror.

IMPORT_INBOX="/home/claudeclaw/import/inbox"
MIRROR_DIR="/home/claudeclaw/checked/canonical"
STATE_DIR="/home/claudeclaw/checked/state"
TMP_BASE="/home/claudeclaw/import/tmp"
ALLOWED_SIGNERS="/etc/sanitizer/allowed_signers"
VERIFY_LOG="/var/log/claudeclaw/import-verify.log"
READ_GROUP="${READ_GROUP:-checkedreaders}"
IMPORT_LAYOUT_WAIT_SEC="${IMPORT_LAYOUT_WAIT_SEC:-20}"
IMPORT_LAYOUT_POLL_SEC="${IMPORT_LAYOUT_POLL_SEC:-2}"

apply_readonly_permissions() {
  getent group "${READ_GROUP}" >/dev/null 2>&1 || groupadd "${READ_GROUP}"
  id -u claudeclaw >/dev/null 2>&1 && usermod -aG "${READ_GROUP}" claudeclaw || true
  id -u openclaw >/dev/null 2>&1 && usermod -aG "${READ_GROUP}" openclaw || true

  chown -R root:"${READ_GROUP}" "${MIRROR_DIR}" "${STATE_DIR}"
  find "${MIRROR_DIR}" -type d -exec chmod 750 {} \;
  find "${STATE_DIR}" -type d -exec chmod 750 {} \;
  find "${MIRROR_DIR}" -type f -exec chmod 640 {} \; || true
  find "${STATE_DIR}" -type f -exec chmod 640 {} \; || true
}

mkdir -p "${IMPORT_INBOX}" "${STATE_DIR}" "${TMP_BASE}" "$(dirname "${VERIFY_LOG}")"

bundle_is_complete() {
  local dir="$1"
  local manifest="${dir}/manifest.json"
  local signature="${dir}/manifest.sig"
  local bundle_file
  bundle_file="$(ls "${dir}"/sanitized-bundle-*.tar.gz 2>/dev/null | head -n 1 || true)"
  [[ -f "${manifest}" && -f "${signature}" && -n "${bundle_file}" ]]
}

pick_complete_bundle() {
  local d
  for d in $(ls -1dt "${IMPORT_INBOX}"/*/ 2>/dev/null || true); do
    d="${d%/}"
    if bundle_is_complete "${d}"; then
      echo "${d}"
      return 0
    fi
  done
  return 1
}

if ! bundle_dir="$(pick_complete_bundle)"; then
  latest="$(ls -1dt "${IMPORT_INBOX}"/*/ 2>/dev/null | head -n 1 || true)"
  if [[ -z "${latest}" ]]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) no bundles" >> "${VERIFY_LOG}"
    exit 0
  fi

  latest="${latest%/}"
  wait_left="${IMPORT_LAYOUT_WAIT_SEC}"
  while (( wait_left > 0 )); do
    if bundle_is_complete "${latest}"; then
      bundle_dir="${latest}"
      break
    fi
    sleep "${IMPORT_LAYOUT_POLL_SEC}"
    wait_left=$(( wait_left - IMPORT_LAYOUT_POLL_SEC ))
  done
fi

if [[ -z "${bundle_dir:-}" ]]; then
  # All observed bundles are still incomplete. This is expected during upload race.
  latest="$(ls -1dt "${IMPORT_INBOX}"/*/ 2>/dev/null | head -n 1 || true)"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) invalid bundle layout: ${latest%/}" >> "${VERIFY_LOG}"
  exit 0
fi

manifest="${bundle_dir}/manifest.json"
signature="${bundle_dir}/manifest.sig"
bundle_file="$(ls "${bundle_dir}"/sanitized-bundle-*.tar.gz 2>/dev/null | head -n 1 || true)"

# Проверка подписи manifest.
ssh-keygen -Y verify -f "${ALLOWED_SIGNERS}" -I sanitizer-bundle -n file -s "${signature}" < "${manifest}" >/dev/null

# Проверка хеша tarball из manifest.
expected_bundle_sha="$(python3 - "${manifest}" <<'PY'
import json,sys
obj=json.load(open(sys.argv[1],encoding="utf-8"))
print(obj["bundle_sha256"])
PY
)"
actual_bundle_sha="$(sha256sum "${bundle_file}" | awk '{print $1}')"
if [[ "${expected_bundle_sha}" != "${actual_bundle_sha}" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) bundle checksum mismatch" >> "${VERIFY_LOG}"
  exit 1
fi

tmp_extract="${TMP_BASE}/extract-$(date -u +%Y%m%dT%H%M%SZ)"
tmp_mirror="${TMP_BASE}/mirror-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${tmp_extract}" "${tmp_mirror}"
tar -C "${tmp_extract}" -xzf "${bundle_file}"

# Проверка каждого файла из manifest.
python3 - "${manifest}" "${tmp_extract}" <<'PY'
import hashlib
import json
import pathlib
import sys

manifest = json.load(open(sys.argv[1], encoding="utf-8"))
root = pathlib.Path(sys.argv[2])

for item in manifest["files"]:
    p = root / item["path"]
    if not p.exists() or not p.is_file():
        raise SystemExit(f"missing file from manifest: {item['path']}")
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    if digest != item["sha256"]:
        raise SystemExit(f"sha mismatch for {item['path']}")
PY

cp -R "${tmp_extract}/." "${tmp_mirror}/"

# Атомарная замена mirror.
mkdir -p "$(dirname "${MIRROR_DIR}")"
if [[ -d "${MIRROR_DIR}" ]]; then
  mv "${MIRROR_DIR}" "${MIRROR_DIR}.prev"
fi
mv "${tmp_mirror}" "${MIRROR_DIR}"
rm -rf "${tmp_extract}"

bundle_id="$(python3 - "${manifest}" <<'PY'
import json,sys
obj=json.load(open(sys.argv[1],encoding="utf-8"))
print(obj["bundle_id"])
PY
)"

imported_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for consumer in claudeclaw openclaw; do
  python3 - "${STATE_DIR}/${consumer}.json" "${consumer}" "${bundle_id}" "${actual_bundle_sha}" "${imported_at}" <<'PY'
import json
import sys
from pathlib import Path

state_path = Path(sys.argv[1])
consumer = sys.argv[2]
bundle_id = sys.argv[3]
bundle_sha = sys.argv[4]
imported_at = sys.argv[5]

state = {
    "schema_version": "1.0",
    "consumer": consumer,
    "last_bundle_id": bundle_id,
    "last_bundle_sha256": bundle_sha,
    "imported_at": imported_at,
}
state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
PY
done

rm -rf "${bundle_dir}"
rm -rf "${MIRROR_DIR}.prev"
apply_readonly_permissions
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) imported ${bundle_id}" >> "${VERIFY_LOG}"
