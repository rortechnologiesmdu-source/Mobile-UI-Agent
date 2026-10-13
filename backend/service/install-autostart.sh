#!/bin/sh
# Installs the MobileUse backend as an always-on macOS service (LaunchAgent).
#
# After running this once, the backend starts automatically whenever you log in,
# restarts itself if it crashes, and keeps the Mac awake so your phone can always
# reach it at http://<this-mac>:4000 and store SMS in MongoDB — no manual starting.
#
#   sh backend/service/install-autostart.sh
#
# Manage it later:
#   launchctl list | grep mobileuse           # is it running?
#   tail -f /tmp/mobileuse-backend.log         # live log
#   sh backend/service/uninstall-autostart.sh  # remove it
#
# Requires: only your own user (no sudo). The Mac must be on and on the same
# Wi-Fi as the phone. It does NOT start the MAI-UI model server (that's only
# needed for Agent 2 tasks, not for SMS collection).
set -eu

LABEL="com.mobileuse.backend"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # .../backend
NODE="$(command -v node || true)"
CAFFEINATE="/usr/bin/caffeinate"
LOG="/tmp/mobileuse-backend.log"

if [ -z "$NODE" ]; then
  echo "node not found on PATH. Install Node, then re-run."
  exit 1
fi
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "warning: $BACKEND_DIR/.env not found — the backend needs it (MONGODB_URI, etc.)."
fi

mkdir -p "$HOME/Library/LaunchAgents"

# caffeinate -i keeps the Mac awake while the backend runs (so SMS never stop
# arriving). KeepAlive restarts it on crash; RunAtLoad starts it at login.
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$CAFFEINATE</string>
        <string>-i</string>
        <string>$NODE</string>
        <string>src/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$BACKEND_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
</dict>
</plist>
PLISTEOF

plutil -lint "$PLIST" >/dev/null

# Reload cleanly if it was already installed.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed and started: $LABEL"
echo "  backend dir : $BACKEND_DIR"
echo "  log         : $LOG"
echo
echo "Check it:  curl http://localhost:4000/api/health   (expect {\"ok\":true})"
echo "It will now start automatically every time you log in."
