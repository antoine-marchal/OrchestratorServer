#!/usr/bin/env bash
# Fill the required secrets in the orchestrator-webpanel env file with random
# values. Idempotent: only replaces placeholder values (change_me_in_production,
# and ADMIN_PASSWORD=admin) unless --force is given.
#
#   sudo orchestrator-webpanel-gen-secrets [ENV_FILE] [--force]
#
# Default ENV_FILE: /etc/orchestrator-webpanel/orchestrator-webpanel.env
set -euo pipefail

ENV_FILE=/etc/orchestrator-webpanel/orchestrator-webpanel.env
FORCE=0
NO_ADMIN=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    # Skip ADMIN_PASSWORD (leave the placeholder for the operator to set). Used
    # by the RPM %post so an unattended install fills the machine secrets the
    # server fatally requires without randomizing the admin login.
    --no-admin) NO_ADMIN=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) ENV_FILE="$arg" ;;
  esac
done

command -v openssl >/dev/null || { echo "ERROR: openssl not found." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: env file not found: $ENV_FILE" >&2; exit 1; }

# var -> placeholder values that count as "unset". Secrets get 32-byte hex.
SECRETS="JWT_SECRET ORCHESTRATOR_MASTER_KEY WORKER_REGISTRATION_SECRET ADMIN_PASSWORD"
[ "$NO_ADMIN" -eq 1 ] && SECRETS="JWT_SECRET ORCHESTRATOR_MASTER_KEY WORKER_REGISTRATION_SECRET"
is_placeholder() {
  case "$1" in
    change_me_in_production|admin|'') return 0 ;;
    *) return 1 ;;
  esac
}

cp -p -- "$ENV_FILE" "${ENV_FILE}.bak"
changed=0
for key in $SECRETS; do
  cur="$(sed -n "s/^${key}=//p" "$ENV_FILE" | head -n1)"
  if [ "$FORCE" -ne 1 ] && ! is_placeholder "$cur"; then
    echo "  $key: already set, skipping"
    continue
  fi
  val="$(openssl rand -hex 32)"
  # Hex value has no sed-special chars, so a plain s/// is safe.
  sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  echo "  $key: generated"
  changed=1
done

# Keep secrets readable only by root + the service group.
chmod 0640 "$ENV_FILE" 2>/dev/null || true
chgrp orchestrator "$ENV_FILE" 2>/dev/null || true

if [ "$changed" -eq 1 ]; then
  echo "Updated $ENV_FILE (backup: ${ENV_FILE}.bak)"
  echo "Restart the service:  sudo systemctl restart orchestrator-webpanel"
else
  echo "No placeholders left; nothing changed. Use --force to regenerate all."
  rm -f -- "${ENV_FILE}.bak"
fi
