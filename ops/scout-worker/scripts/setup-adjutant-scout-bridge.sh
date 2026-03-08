#!/usr/bin/env bash
# =============================================================================
# Setup Adjutant → Scout VPS bridge on Bot VPS.
#
# What this does:
#   1. Creates /home/adjutant/inbox/{requests,sent,failed} directories
#   2. Creates /home/adjutant/checked/canonical as symlink → /home/claudeclaw/checked/canonical
#      (so Adjutant backend reads the same Sanitizer-verified results as ClaudeClaw)
#   3. Generates adjutant SSH key for Scout VPS push
#   4. Copies SSH pubkey to Scout VPS authorized_keys
#   5. Installs push script + systemd units
#   6. Writes /etc/adjutant-scout-request-bridge.env
#   7. Enables and starts the timer
#
# Environment:
#   BOT_HOST      — Bot VPS IP/host (default: 89.167.81.12)
#   BOT_USER      — root user on Bot VPS
#   SCOUT_HOST    — Scout VPS IP (required)
#   SCOUT_USER    — scout user on Scout VPS (default: scout)
#   REPO_DIR      — sprut-agent-kit path on Bot VPS
# =============================================================================
set -euo pipefail

BOT_HOST="${BOT_HOST:-89.167.81.12}"
BOT_USER="${BOT_USER:-root}"
SCOUT_HOST="${SCOUT_HOST:?ERROR: set SCOUT_HOST=<scout-vps-ip>}"
SCOUT_USER="${SCOUT_USER:-scout}"
REPO_DIR="${REPO_DIR:-/home/adjutant/sprut-agent-kit}"

echo "[setup-adjutant-scout-bridge] bot=${BOT_USER}@${BOT_HOST} scout=${SCOUT_USER}@${SCOUT_HOST}"

# ─── 1. Create directories and symlink on Bot VPS ────────────────────────────
ssh "${BOT_USER}@${BOT_HOST}" "
  set -euo pipefail

  # Inbox dirs for Adjutant Scout requests
  mkdir -p /home/adjutant/inbox/requests \
           /home/adjutant/inbox/sent \
           /home/adjutant/inbox/failed
  chown -R adjutant:adjutant /home/adjutant/inbox
  chmod 750 /home/adjutant/inbox /home/adjutant/inbox/requests \
            /home/adjutant/inbox/sent /home/adjutant/inbox/failed

  # checked/canonical: symlink to ClaudeClaw's verified dir (same Sanitizer delivery)
  mkdir -p /home/adjutant/checked
  if [ ! -e /home/adjutant/checked/canonical ]; then
    ln -s /home/claudeclaw/checked/canonical /home/adjutant/checked/canonical
    echo 'created symlink /home/adjutant/checked/canonical -> /home/claudeclaw/checked/canonical'
  else
    echo 'checked/canonical already exists, skipping symlink'
  fi
  chown -h adjutant:adjutant /home/adjutant/checked/canonical || true
  chmod 750 /home/adjutant/checked

  echo 'dirs ok'
"

# ─── 2. Generate SSH key on Bot VPS for Adjutant → Scout ─────────────────────
echo "[setup-adjutant-scout-bridge] generating SSH key..."
ssh "${BOT_USER}@${BOT_HOST}" "
  set -euo pipefail
  KEY=/home/adjutant/.ssh/id_ed25519_scout_requests
  if [ ! -f \"\${KEY}\" ]; then
    mkdir -p /home/adjutant/.ssh
    chmod 700 /home/adjutant/.ssh
    ssh-keygen -t ed25519 -f \"\${KEY}\" -N '' -C 'adjutant-scout-requests'
    chown -R adjutant:adjutant /home/adjutant/.ssh
    echo 'SSH key generated'
  else
    echo 'SSH key already exists'
  fi
  cat \"\${KEY}.pub\"
" | tee /tmp/adjutant_scout_pubkey.txt

PUBKEY="$(grep 'ssh-ed25519' /tmp/adjutant_scout_pubkey.txt)"
echo "[setup-adjutant-scout-bridge] pubkey: ${PUBKEY}"

# ─── 3. Add pubkey to Scout VPS authorized_keys ───────────────────────────────
echo "[setup-adjutant-scout-bridge] adding pubkey to Scout VPS..."
ssh "${BOT_USER}@${BOT_HOST}" "
  ssh -o StrictHostKeyChecking=accept-new -o BatchMode=no ${SCOUT_USER}@${SCOUT_HOST} \
    \"mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${PUBKEY}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'pubkey added'\"
" || {
  echo "[setup-adjutant-scout-bridge] could not auto-add pubkey. Add manually:"
  echo "  echo '${PUBKEY}' >> ~scout/.ssh/authorized_keys  (on Scout VPS)"
}

# ─── 4. Install push script on Bot VPS ───────────────────────────────────────
echo "[setup-adjutant-scout-bridge] installing push script..."
scp "ops/scout-worker/bot-vps/push-adjutant-requests-to-scout.sh" \
    "${BOT_USER}@${BOT_HOST}:/tmp/push-adjutant-requests-to-scout.sh"

ssh "${BOT_USER}@${BOT_HOST}" "
  install -m 755 /tmp/push-adjutant-requests-to-scout.sh /usr/local/bin/push-adjutant-requests-to-scout.sh
  echo 'push script installed'
"

# ─── 5. Install systemd units ────────────────────────────────────────────────
echo "[setup-adjutant-scout-bridge] installing systemd units..."
scp \
  "ops/scout-worker/bot-vps/systemd/adjutant-scout-request-push.service" \
  "ops/scout-worker/bot-vps/systemd/adjutant-scout-request-push.timer" \
  "${BOT_USER}@${BOT_HOST}:/tmp/"

ssh "${BOT_USER}@${BOT_HOST}" "
  install -m 644 /tmp/adjutant-scout-request-push.service /etc/systemd/system/adjutant-scout-request-push.service
  install -m 644 /tmp/adjutant-scout-request-push.timer   /etc/systemd/system/adjutant-scout-request-push.timer
  echo 'systemd units installed'
"

# ─── 6. Write env file ───────────────────────────────────────────────────────
echo "[setup-adjutant-scout-bridge] writing env file..."
ssh "${BOT_USER}@${BOT_HOST}" "
  cat > /etc/adjutant-scout-request-bridge.env <<'ENVEOF'
SCOUT_HOST=${SCOUT_HOST}
SCOUT_USER=${SCOUT_USER}
SCOUT_INBOX_DIR=/srv/scout/inbox/requests
BOT_SCOUT_PUSH_KEY=/home/adjutant/.ssh/id_ed25519_scout_requests
BOT_SCOUT_REQUEST_DIR=/home/adjutant/inbox/requests
BOT_SCOUT_SENT_DIR=/home/adjutant/inbox/sent
BOT_SCOUT_FAILED_DIR=/home/adjutant/inbox/failed
ENVEOF
  chmod 640 /etc/adjutant-scout-request-bridge.env
  echo 'env file written'
"

# ─── 7. Enable and start timer ───────────────────────────────────────────────
echo "[setup-adjutant-scout-bridge] enabling timer..."
ssh "${BOT_USER}@${BOT_HOST}" "
  systemctl daemon-reload
  systemctl enable --now adjutant-scout-request-push.timer
  echo 'timer enabled'
  systemctl status adjutant-scout-request-push.timer --no-pager
"

echo ""
echo "[setup-adjutant-scout-bridge] ✓ done"
echo ""
echo "Next steps:"
echo "  1. cd /home/adjutant/adjutant && docker compose up -d --build adjutant-backend"
echo "     (picks up new Scout volumes + SCOUT_REQUEST_DIR env)"
echo "  2. Test: curl -X POST http://localhost:8000/scout/request -H 'X-API-Key: <key>' \\"
echo "           -d '{\"task_type\":\"weather_lookup\",\"query\":\"погода Алматы\"}'"
echo "  3. Run e2e: SCOUT_HOST=${SCOUT_HOST} ops/scout-worker/scripts/e2e-weather.sh"
