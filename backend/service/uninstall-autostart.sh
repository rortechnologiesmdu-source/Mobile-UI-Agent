#!/bin/sh
# Removes the always-on MobileUse backend service installed by install-autostart.sh.
#
#   sh backend/service/uninstall-autostart.sh
#
# After this, the backend no longer starts automatically; run it by hand with
# `npm start` when you need it.
set -eu

LABEL="com.mobileuse.backend"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL (stopped and will no longer auto-start)."
