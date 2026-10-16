#!/usr/bin/env bash
# Install or update Neo Terminal on Ubuntu 24.04 (run as root from the unpacked folder):
#   bash deploy/setup.sh               install / update the app
#   bash deploy/setup.sh --lock-ssh    also turn off SSH password login (do this only
#                                      after you have confirmed key login works)
# Safe to re-run: .env and data/ are never overwritten.
set -euo pipefail

APP=/opt/neo-terminal
SRC=$(cd "$(dirname "$0")/.." && pwd)
LOCK_SSH=0
[[ "${1:-}" == "--lock-ssh" ]] && LOCK_SSH=1

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
step() { echo -e "\n\033[1;34m==> $*\033[0m"; }

step "System packages and automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip ufw fail2ban unattended-upgrades rsync >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null

step "Service user"
id neo >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin neo

step "Copying app to $APP"
mkdir -p "$APP/data"
rsync -a --delete \
  --exclude ".env" --exclude "data/" --exclude ".venv/" --exclude "__pycache__/" \
  --exclude ".claude/" --exclude ".git/" --exclude ".cache/" "$SRC/" "$APP/"

if [[ ! -f "$APP/.env" ]]; then
  cp "$APP/.env.example" "$APP/.env"
  sed -i 's/^NEO_MOCK=.*/NEO_MOCK=0/' "$APP/.env"
  NEED_ENV=1
fi
chown -R neo:neo "$APP"
chmod 600 "$APP/.env"

step "Python environment"
[[ -d "$APP/.venv" ]] || runuser -u neo -- python3 -m venv "$APP/.venv"
runuser -u neo -- "$APP/.venv/bin/pip" install -q --upgrade pip
runuser -u neo -- "$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"

step "Firewall: allow SSH only"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

step "Nightly local backup of .env and TP/SL records (kept 14 days)"
cat > /etc/cron.d/neo-terminal-backup <<'EOF'
30 23 * * * root mkdir -p /root/backups && tar -czf /root/backups/neo-$(date +\%F).tgz -C /opt/neo-terminal .env data/protections.json data/session.json data/drawings.json 2>/dev/null; find /root/backups -name 'neo-*.tgz' -mtime +14 -delete
EOF

if [[ $LOCK_SSH -eq 1 ]]; then
  step "Turning off SSH password login"
  if [[ ! -s /root/.ssh/authorized_keys ]]; then
    echo "No SSH key in /root/.ssh/authorized_keys - refusing to lock you out."; exit 1
  fi
  cat > /etc/ssh/sshd_config.d/10-neo-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t && systemctl reload ssh
  echo "Password login disabled; key login only."
fi

step "Service"
cp "$APP/deploy/neo-terminal.service" /etc/systemd/system/neo-terminal.service
systemctl daemon-reload
systemctl enable neo-terminal >/dev/null 2>&1

if [[ "${NEED_ENV:-0}" == 1 ]] || grep -q "your_api_access_token" "$APP/.env"; then
  echo -e "\n\033[1;33mNext: put your Neo access token, mobile number and client code in $APP/.env, then run:\033[0m"
  echo "  nano $APP/.env"
  echo "  systemctl restart neo-terminal"
else
  systemctl restart neo-terminal
  sleep 3
  systemctl --no-pager --lines=5 status neo-terminal || true
fi
echo -e "\nDone. Logs: journalctl -u neo-terminal -f"
