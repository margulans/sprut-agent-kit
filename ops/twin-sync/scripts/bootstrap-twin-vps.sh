#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BOT_HOST="${BOT_HOST:?BOT_HOST is required}"
BOT_USER="${BOT_USER:-root}"
BOT_AGENT_USER="${BOT_AGENT_USER:-adjutant}"
BOT_AGENT_GROUP="${BOT_AGENT_GROUP:-${BOT_AGENT_USER}}"
BOT_HOME="${BOT_HOME:-/home/${BOT_AGENT_USER}}"
REPO_DIR="${REPO_DIR:-${BOT_HOME}/sprut-agent-kit}"
SYNC_REPO="${SYNC_REPO:-1}"
SSH_TARGET="${BOT_USER}@${BOT_HOST}"

echo "[bootstrap] target=${SSH_TARGET}"
echo "[bootstrap] agent_user=${BOT_AGENT_USER} home=${BOT_HOME}"
echo "[bootstrap] repo_dir=${REPO_DIR}"

ssh "${SSH_TARGET}" "bash -s" <<REMOTE
set -euo pipefail
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y python3 python3-venv python3-pip git ca-certificates rsync
fi

if ! id -u "${BOT_AGENT_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${BOT_AGENT_USER}"
fi

mkdir -p "${BOT_HOME}" "${BOT_HOME}/twin-sync" "${REPO_DIR}"
chown -R "${BOT_AGENT_USER}:${BOT_AGENT_GROUP}" "${BOT_HOME}" || true
REMOTE

if [[ "${SYNC_REPO}" == "1" ]]; then
  echo "[bootstrap] syncing local repo to remote ${REPO_DIR}"
  tar \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude ".cursor" \
    --exclude ".venv" \
    -czf - -C "${ROOT_DIR}" . \
    | ssh "${SSH_TARGET}" "mkdir -p '${REPO_DIR}' && tar -xzf - -C '${REPO_DIR}'"
fi

ssh "${SSH_TARGET}" "chown -R '${BOT_AGENT_USER}:${BOT_AGENT_GROUP}' '${BOT_HOME}' '${REPO_DIR}' || true"

echo "[bootstrap] deploying twin units"
BOT_HOST="${BOT_HOST}" \
BOT_USER="${BOT_USER}" \
BOT_AGENT_USER="${BOT_AGENT_USER}" \
BOT_AGENT_GROUP="${BOT_AGENT_GROUP}" \
BOT_HOME="${BOT_HOME}" \
REPO_DIR="${REPO_DIR}" \
bash "${ROOT_DIR}/ops/twin-sync/scripts/deploy-twin-orchestrator.sh"

echo "[bootstrap] done"
echo "[bootstrap] verify:"
echo "ssh ${SSH_TARGET} 'systemctl status twin-orchestrator.timer twin-runtime-bridge.timer twin-proposals-digest.timer --no-pager'"
