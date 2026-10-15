#!/bin/bash
# 페어리 서버 다운 감시 (맥미니 launchd, com.milcho.fairy-monitor). 모일까 감시(moilga-monitor.sh)와 같은 방식.
# 30초마다 홈서버 127.0.0.1:3002 와 밖(fairy-api.moilga.com)의 /health 를 본다.
# 두 번 연속 실패하면 private 레포 milcho0604/fairy-alerts 에 이슈를 열고(메일 알림), 되살아나면 복구 댓글과 함께 닫는다.
# 밖 주소가 아직 DNS 에 없으면(터널 연결 전) 밖 검사는 건너뛴다.
LOG="$HOME/fairy-monitor.log"
STATE="$HOME/.fairy-monitor.open-issue"
REPO="${FAIRY_ALERTS_REPO:-milcho0604/fairy-alerts}"
LOCAL_URL="http://127.0.0.1:3002/health"
EXT_URL="${FAIRY_EXT_URL:-https://fairy-api.moilga.com/health}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "=== 감시 시작 $(date '+%Y-%m-%d %H:%M:%S') (알림=GitHub 이슈 $REPO) ===" >> "$LOG"

# 로그는 1MB 를 넘으면 한 벌만 남기고 돌린다
rotate_log() {
  [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ] && mv -f "$LOG" "$LOG.1"
}

check_local() {
  curl -s -m5 "$LOCAL_URL" 2>/dev/null | grep -q '"db":"ok"' && echo OK || echo DOWN
}

check_ext() {
  local body code
  body=$(curl -s -m8 "$EXT_URL" 2>/dev/null); code=$?
  # 6 = 주소를 못 찾음 (터널에 아직 fairy-api 가 없다)
  [ "$code" -eq 6 ] && { echo SKIP; return; }
  echo "$body" | grep -q '"db":"ok"' && echo OK || echo DOWN
}

check_inner() {
  docker exec fairy-api node -e "fetch('http://127.0.0.1:3002/health').then(r=>r.text()).then(t=>console.log(t),()=>console.log('ERR'))" 2>/dev/null \
    | grep -q '"db":"ok"' && echo OK || echo DOWN
}

open_issue() {
  [ -f "$STATE" ] && return
  local num
  num=$(gh issue create --repo "$REPO" --title "[자동] 페어리 서버 다운 감지 — $(date '+%m-%d %H:%M')" --body "$1" 2>/dev/null | grep -oE '[0-9]+$')
  [ -n "$num" ] && echo "$num" > "$STATE" && echo "        → 이슈 #$num 등록" >> "$LOG"
}

close_issue() {
  [ -f "$STATE" ] || return
  local num; num=$(cat "$STATE")
  gh issue comment "$num" --repo "$REPO" --body "✅ 복구 확인 — $(date '+%Y-%m-%d %H:%M:%S') 홈서버와 밖 모두 정상." >/dev/null 2>&1
  gh issue close "$num" --repo "$REPO" >/dev/null 2>&1
  echo "        → 이슈 #$num 복구 댓글과 닫기" >> "$LOG"
  rm -f "$STATE"
}

fails=0
tick=0
while true; do
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  ls_=$(check_local)
  es=$(check_ext)
  if [ "$ls_" = OK ] && [ "$es" != DOWN ]; then
    fails=0
    close_issue
    tick=$((tick + 1))
    [ $((tick % 120)) -eq 1 ] && { rotate_log; echo "$ts  local=OK ext=$es (정상)" >> "$LOG"; }
  else
    fails=$((fails + 1))
    inner=$(check_inner)
    daemon=$(docker info >/dev/null 2>&1 && echo UP || echo DOWN)
    containers=$(docker ps -a --filter name=fairy- --format '{{.Names}}={{.Status}}' 2>/dev/null | tr '\n' ' ')
    sleep_evt=$(pmset -g log 2>/dev/null | grep -E " Sleep | Wake " | tail -1 | awk '{print $1" "$2" "$4}')
    if [ "$inner" = OK ]; then
      interp='컨테이너 안은 정상 → 포트, 터널(cloudflared), 절전 문제'
    else
      interp='컨테이너 안도 DOWN → API 프로세스, DB, 컨테이너 문제'
    fi
    echo "$ts  [이상 $fails] local=$ls_ ext=$es inner=$inner daemon=$daemon  $interp" >> "$LOG"
    if [ "$fails" -ge 2 ]; then
      open_issue "자동 감시가 페어리 서버 다운을 감지했습니다.

- 시각: $ts
- 홈서버(127.0.0.1:3002): $ls_
- 밖($EXT_URL): $es
- 컨테이너 안: $inner
- Docker: $daemon
- 컨테이너: ${containers:-(없음)}
- 해석: $interp
- 최근 절전 이벤트: ${sleep_evt:-없음}

확인: \`docker ps -a --filter name=fairy-\`, \`docker logs --tail 50 fairy-api\`, \`pgrep -lf cloudflared\`, \`pmset -g\`
되살아나면 이 이슈는 저절로 닫힙니다."
    fi
  fi
  sleep 30
done
