#!/usr/bin/env bash
set -euo pipefail

# Передает последний подписанный бандл на Bot VPS.

EXPORT_DIR="/srv/sanitizer/export"
BOT_HOST="${BOT_HOST:?set BOT_HOST}"
BOT_USER="${BOT_USER:-sanitizerdeploy}"
BOT_INBOX="${BOT_INBOX:-/home/claudeclaw/import/inbox}"

latest="$(ls -1dt "${EXPORT_DIR}"/*/ 2>/dev/null | head -n 1 || true)"
if [[ -z "${latest}" ]]; then
  echo "no export bundle found in ${EXPORT_DIR}" >&2
  exit 1
fi

bundle_dir="${latest%/}"
bundle_name="$(basename "${bundle_dir}")"

ssh "${BOT_USER}@${BOT_HOST}" "mkdir -p '${BOT_INBOX}/${bundle_name}'"
scp "${bundle_dir}/manifest.json" "${BOT_USER}@${BOT_HOST}:${BOT_INBOX}/${bundle_name}/manifest.json"
scp "${bundle_dir}/manifest.sig" "${BOT_USER}@${BOT_HOST}:${BOT_INBOX}/${bundle_name}/manifest.sig"
scp "${bundle_dir}/"*.tar.gz "${BOT_USER}@${BOT_HOST}:${BOT_INBOX}/${bundle_name}/"

echo "pushed ${bundle_name} -> ${BOT_USER}@${BOT_HOST}:${BOT_INBOX}/${bundle_name}"
