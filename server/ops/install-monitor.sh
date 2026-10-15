#!/bin/bash
# 맥미니에 페어리 감시를 깔거나 새 판으로 바꾼다. 여러 번 돌려도 된다.
#   bash server/ops/install-monitor.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.milcho.fairy-monitor.plist"
install -m 755 "$HERE/fairy-monitor.sh" "$HOME/fairy-monitor.sh"
sed "s#__HOME__#$HOME#g" "$HERE/com.milcho.fairy-monitor.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "감시를 켰다. 기록: ~/fairy-monitor.log"
