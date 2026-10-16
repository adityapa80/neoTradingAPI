# Deploying Neo Terminal to the VPS (Ubuntu 24.04)

Neo Terminal can run on the same VPS as Kite Terminal. It uses its own folder (`/opt/neo-terminal`),
service (`neo-terminal`), service user (`neo`) and port (**5001**), so the two never touch each other.
Below, replace `YOUR_SERVER_IP` with the server's address.

**How it fits together:**
- **On the server:** the app runs as a background service, listening only on `127.0.0.1:5001`. Nothing is exposed to the internet, and the firewall allows SSH only.
- **From your PC:** an SSH tunnel makes it appear at `http://127.0.0.1:5001`.
- **Automatic upkeep:** the service restarts itself if it stops, and the server installs security updates automatically.

---

## 1. One-time: add the tunnel to your SSH shortcut

In PowerShell, run `notepad $env:USERPROFILE\.ssh\config`. If you already have a `Host kite` entry, add a
second `LocalForward` line to it, so one tunnel serves both apps:

```
Host kite
  HostName YOUR_SERVER_IP
  User root
  LocalForward 5000 127.0.0.1:5000
  LocalForward 5001 127.0.0.1:5001
  ServerAliveInterval 30
  ExitOnForwardFailure yes
```

## 2. Upload the app (PowerShell, on your PC)

```powershell
tar -czf $env:TEMP\neo-terminal.tgz --exclude=data --exclude=.env --exclude=__pycache__ --exclude=.claude --exclude=.venv -C C:\path\to\neoapi .
scp $env:TEMP\neo-terminal.tgz kite:/root/
```

## 3. Install (on the server)

```bash
ssh kite
rm -rf /root/neo-src && mkdir -p /root/neo-src && tar -xzf /root/neo-terminal.tgz -C /root/neo-src
bash /root/neo-src/deploy/setup.sh
```

The script installs Python, the firewall (SSH only), fail2ban and automatic security updates (all already
there if Kite Terminal is installed), creates a locked-down `neo` service user, installs the app to
`/opt/neo-terminal`, and schedules a nightly backup.

## 4. Add your Kotak credentials (on the server)

```bash
nano /opt/neo-terminal/.env
```

Set `NEO_ACCESS_TOKEN` (Neo app → More → Trade API → your application), `NEO_MOBILE` and `NEO_UCC`, and keep
`NEO_MOCK=0` and `PORT=5001`. Optionally set `NEO_MPIN` so the daily login needs only the TOTP code. Save with
**Ctrl+O, Enter, Ctrl+X**, then run:

```bash
systemctl restart neo-terminal
journalctl -u neo-terminal -n 20 --no-pager
```

You should see `Neo Terminal running at http://127.0.0.1:5001 (LIVE mode)`.

## 5. Register the server's IP with Kotak

Kotak requires a registered static IP for Trade API orders. In the Neo app's Trade API dashboard, register
`YOUR_SERVER_IP` (check it on the server with `curl -4 https://api.ipify.org`). The app forces IPv4 for every
connection so orders always come from that address.

## 6. Use it (every trading day)

1. On your PC, start the tunnel and leave the window open: `ssh -N kite`
2. Open **http://127.0.0.1:5001** and log in with the 6-digit code from your authenticator app (and MPIN).
3. Check that the **LIVE** badge is on.

The session is stored on the server, so closing the tunnel or restarting the app doesn't log you out for the
rest of the day. The server keeps managing TP/SL with your browser closed or the tunnel off.

## Backups

Every night at 23:30 the server writes `/root/backups/neo-DATE.tgz` (`.env` and the TP/SL records) and
keeps 14 days. To copy them to your PC (`%USERPROFILE%\neo-terminal-backups`):

```powershell
powershell -NoProfile -File C:\path\to\neoapi\deploy\backup-to-pc.ps1 -Server YOUR_SERVER_IP
```

## Updating the app later

Repeat steps 2 and 3. `setup.sh` is safe to re-run: it never touches `.env` or `data/`, and it restarts the
service at the end.

## Troubleshooting

| Symptom | Check |
|---|---|
| Page doesn't load | Is the `ssh -N kite` window open, with the 5001 forward? On the server: `systemctl status neo-terminal` |
| App crashes or restarts | `journalctl -u neo-terminal -n 50 --no-pager` |
| Login fails | TOTP codes change every 30 s; check the PC/phone clock. Check `NEO_MOBILE` (with +91) and `NEO_UCC` |
| Badge shows POLLING | The live feed is down: usually the session expired, so log in again. Logs show `market feed:` lines |
| Orders rejected for IP | The server IP isn't registered with Kotak (step 5) |
