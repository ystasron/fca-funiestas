#!/usr/bin/env bash
#
# start-chrome.sh — launch the headless Chromium the DM bridge drives.
#
# Tries --headless=new first (no display needed, ~300-500MB RAM). If
# Messenger misbehaves in headless on your VPS, run with xvfb instead:
#   xvfb-run -a bash dmhelper/start-chrome.sh
#
# The login session persists in dmhelper/bot-profile/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE_DIR="${SCRIPT_DIR}/bot-profile"
PORT="${CDP_PORT:-9222}"

mkdir -p "$PROFILE_DIR"

# Find a chromium binary (name differs per distro)
CHROME_BIN="${CHROME_BIN:-}"
if [ -z "$CHROME_BIN" ]; then
  for c in chromium chromium-browser google-chrome google-chrome-stable chrome; do
    if command -v "$c" >/dev/null 2>&1; then CHROME_BIN="$c"; break; fi
  done
fi
if [ -z "$CHROME_BIN" ]; then
  echo "No chromium found. Install it first:" >&2
  echo "  sudo apt install -y chromium" >&2
  exit 1
fi

# Chrome's sandbox needs extra kernel flags inside most VPS containers;
# --no-sandbox is the standard workaround for automation profiles.
FLAGS=(
  --remote-debugging-port="$PORT"
  --remote-debugging-address=127.0.0.1
  --user-data-dir="$PROFILE_DIR"
  --no-sandbox
  --disable-gpu
  --disable-software-rasterizer
  --disable-dev-shm-usage
  --window-size=1280,900
  --no-first-run
  --no-default-browser-check
  --disable-features=Translate
  --hide-scrollbars
)

echo "[start-chrome] $CHROME_BIN ${FLAGS[*]} about:blank"

# --headless=new supports Input.* trusted events and full AX tree, which the
# bridge needs. Old --headless does not; keep "new".
exec "$CHROME_BIN" --headless=new "${FLAGS[@]}" about:blank
