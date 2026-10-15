#!/bin/bash
# 맥미니에 페어리 감시를 깔거나 새 판으로 바꾼다. 여러 번 돌려도 된다.
#   bash server/ops/install-monitor.sh         홈서버 안만 본다 (터널 연결 전)
#   bash server/ops/install-monitor.sh --ext   밖(fairy-api.moilga.com)도 본다 (터널 연결 뒤)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT=0; [ "${1:-}" = --ext ] && EXT=1
PLIST="$HOME/Library/LaunchAgents/com.milcho.fairy-monitor.plist"
install -m 755 "$HERE/fairy-monitor.sh" "$HOME/fairy-monitor.sh"
sed -e "s#__HOME__#$HOME#g" -e "s#__EXT__#$EXT#g" "$HERE/com.milcho.fairy-monitor.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "감시를 켰다 (밖 검사 $([ $EXT = 1 ] && echo 켬 || echo 끔)). 기록: ~/fairy-monitor.log"
