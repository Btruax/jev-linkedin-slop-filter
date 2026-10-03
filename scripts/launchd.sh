#!/bin/bash
# Runs the proxy as a macOS launchd agent: starts at login, restarts on crash.
#
#   scripts/launchd.sh install     # copy server + .env to ~/.slop-filter, (re)start
#   scripts/launchd.sh uninstall   # stop and remove the agent (keeps ~/.slop-filter)
#   scripts/launchd.sh status
#
# The server is copied out of the repo because macOS privacy protection (TCC)
# often blocks background jobs from reading ~/Documents. Re-run `install`
# after pulling changes to server/ or editing .env.

set -euo pipefail

LABEL="com.jev-slop-filter-proxy"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.slop-filter"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
PORT=8787
# The name macOS shows in Activity Monitor, `ps` and Login Items. A bare
# `node` there looks like a stray process and invites being killed.
PROC_NAME="jev-slop-filter-proxy"

stop_agent() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
}

status() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl print "$DOMAIN/$LABEL" | grep -E '^\s*(state|pid|last exit code) =' || true
  else
    echo "agent not loaded"
  fi
  curl -s --max-time 2 "http://127.0.0.1:$PORT/stats" && echo || echo "proxy not answering on :$PORT"
}

install() {
  local node
  node="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
  [ -f "$REPO/.env" ] || { echo "missing $REPO/.env (copy .env.example and add your key)" >&2; exit 1; }
  grep -q '^TYPESAFE_API_KEY=your_key' "$REPO/.env" && { echo ".env still has the placeholder key" >&2; exit 1; }

  mkdir -p "$DEST/server" "$DEST/logs" "$DEST/bin" "$(dirname "$PLIST")"
  # macOS names a process after the executable it ran, and resolves symlinks
  # first, so the node binary is hard-linked (copied if that fails) under
  # the proxy's own name. Re-running install refreshes it after a node update.
  ln -f "$node" "$DEST/bin/$PROC_NAME" 2>/dev/null || cp -f "$node" "$DEST/bin/$PROC_NAME"
  cp "$REPO"/server/*.js "$REPO/server/package.json" "$DEST/server/"
  cp "$REPO/.env" "$DEST/.env"
  chmod 600 "$DEST/.env"

  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<!-- Jev Slop Filter: local proxy for the LinkedIn/X slop filter browser
     extension. Holds the TypeSafe API key and calls Jev. Safe to leave running.
     Remove with: $REPO/scripts/launchd.sh uninstall -->
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DEST/bin/$PROC_NAME</string>
    <string>$DEST/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DEST/server</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$DEST/logs/server.log</string>
  <key>StandardErrorPath</key><string>$DEST/logs/server-error.log</string>
</dict>
</plist>
EOF

  stop_agent
  launchctl bootstrap "$DOMAIN" "$PLIST"
  sleep 2
  status
}

case "${1:-}" in
  install) install ;;
  uninstall) stop_agent; rm -f "$PLIST"; echo "agent removed; $DEST left in place" ;;
  status) status ;;
  *) echo "usage: $0 install|uninstall|status" >&2; exit 2 ;;
esac
