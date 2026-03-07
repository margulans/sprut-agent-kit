#!/usr/bin/env bash
set -euo pipefail

BOT_HOST="${BOT_HOST:-136.244.83.50}"
BOT_USER="${BOT_USER:-root}"
BOT_AGENT_USER="${BOT_AGENT_USER:-claudeclaw}"
BOT_AGENT_GROUP="${BOT_AGENT_GROUP:-${BOT_AGENT_USER}}"
BOT_HOME="${BOT_HOME:-/home/${BOT_AGENT_USER}}"
REPO_DIR="${REPO_DIR:-${BOT_HOME}/sprut-agent-kit}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "[deploy] host=${BOT_USER}@${BOT_HOST}"

ssh "${BOT_USER}@${BOT_HOST}" "mkdir -p '${REPO_DIR}/ops/twin-sync/bot-vps/systemd' '${BOT_HOME}/twin-sync'"

scp \
  "ops/twin-sync/bot-vps/twin_orchestrator.py" \
  "ops/twin-sync/bot-vps/twin_runtime_bridge.py" \
  "ops/twin-sync/bot-vps/publish_twin_artifact.py" \
  "ops/twin-sync/bot-vps/apply_twin_proposal.py" \
  "ops/twin-sync/bot-vps/send_proposals_digest.py" \
  "${BOT_USER}@${BOT_HOST}:${REPO_DIR}/ops/twin-sync/bot-vps/"

scp \
  "ops/twin-sync/bot-vps/systemd/twin-orchestrator.service" \
  "ops/twin-sync/bot-vps/systemd/twin-orchestrator.timer" \
  "ops/twin-sync/bot-vps/systemd/twin-runtime-bridge.service" \
  "ops/twin-sync/bot-vps/systemd/twin-runtime-bridge.timer" \
  "ops/twin-sync/bot-vps/systemd/twin-proposals-digest.service" \
  "ops/twin-sync/bot-vps/systemd/twin-proposals-digest.timer" \
  "${BOT_USER}@${BOT_HOST}:${REPO_DIR}/ops/twin-sync/bot-vps/systemd/"

for service_file in \
  "twin-orchestrator.service" \
  "twin-runtime-bridge.service" \
  "twin-proposals-digest.service"; do
  sed \
    -e "s|__BOT_AGENT_USER__|${BOT_AGENT_USER}|g" \
    -e "s|__BOT_AGENT_GROUP__|${BOT_AGENT_GROUP}|g" \
    -e "s|__BOT_HOME__|${BOT_HOME}|g" \
    -e "s|__REPO_DIR__|${REPO_DIR}|g" \
    "ops/twin-sync/bot-vps/systemd/${service_file}" > "${TMP_DIR}/${service_file}"
  scp "${TMP_DIR}/${service_file}" "${BOT_USER}@${BOT_HOST}:/tmp/${service_file}"
done

ssh "${BOT_USER}@${BOT_HOST}" "
  id -u '${BOT_AGENT_USER}' >/dev/null 2>&1 || useradd -m -s /bin/bash '${BOT_AGENT_USER}' &&
  install -m 755 '${REPO_DIR}/ops/twin-sync/bot-vps/twin_orchestrator.py' '${REPO_DIR}/ops/twin-sync/bot-vps/twin_orchestrator.py' &&
  install -m 755 '${REPO_DIR}/ops/twin-sync/bot-vps/twin_runtime_bridge.py' '${REPO_DIR}/ops/twin-sync/bot-vps/twin_runtime_bridge.py' &&
  install -m 755 '${REPO_DIR}/ops/twin-sync/bot-vps/publish_twin_artifact.py' '${REPO_DIR}/ops/twin-sync/bot-vps/publish_twin_artifact.py' &&
  install -m 755 '${REPO_DIR}/ops/twin-sync/bot-vps/apply_twin_proposal.py' '${REPO_DIR}/ops/twin-sync/bot-vps/apply_twin_proposal.py' &&
  install -m 755 '${REPO_DIR}/ops/twin-sync/bot-vps/send_proposals_digest.py' '${REPO_DIR}/ops/twin-sync/bot-vps/send_proposals_digest.py' &&
  install -m 644 '/tmp/twin-orchestrator.service' /etc/systemd/system/twin-orchestrator.service &&
  install -m 644 '${REPO_DIR}/ops/twin-sync/bot-vps/systemd/twin-orchestrator.timer' /etc/systemd/system/twin-orchestrator.timer &&
  install -m 644 '/tmp/twin-runtime-bridge.service' /etc/systemd/system/twin-runtime-bridge.service &&
  install -m 644 '${REPO_DIR}/ops/twin-sync/bot-vps/systemd/twin-runtime-bridge.timer' /etc/systemd/system/twin-runtime-bridge.timer &&
  install -m 644 '/tmp/twin-proposals-digest.service' /etc/systemd/system/twin-proposals-digest.service &&
  install -m 644 '${REPO_DIR}/ops/twin-sync/bot-vps/systemd/twin-proposals-digest.timer' /etc/systemd/system/twin-proposals-digest.timer &&
  chown -R '${BOT_AGENT_USER}:${BOT_AGENT_GROUP}' '${BOT_HOME}/twin-sync' '${REPO_DIR}' &&
  systemctl daemon-reload &&
  systemctl enable --now twin-orchestrator.timer &&
  systemctl enable --now twin-runtime-bridge.timer &&
  systemctl enable --now twin-proposals-digest.timer &&
  systemctl start twin-runtime-bridge.service &&
  systemctl start twin-proposals-digest.service &&
  systemctl start twin-orchestrator.service
"

echo "[deploy] done"
