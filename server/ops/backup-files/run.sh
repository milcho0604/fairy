#!/bin/sh
# 밖에서 도는 백업 둘의 결과를 서버가 읽을 상태 파일로 남기고, 서버 백업 파일을 매일 외장 디스크로 맞춘다 (#102, #152).
#
# 1) 서버 백업 파일(볼륨 fairy_backups, AES-256-GCM 암호문)을 매일 외장 디스크로 맞춘다.
#    모일까 DB 백업 04:30, 페어리 DB 백업 05:30 UTC 와 겹치지 않게 06:00 UTC (= 15:00 KST).
#    암호문을 그대로 복사하고, 서버에서 지운 것(탈퇴, 최근 2개 밖, 1년 미사용)은 여기서도 지운다(--delete).
#    쓰다 만 파일(*.part)은 옮기지 않는다. 키(BACKUP_ENC_KEY)는 여기 없으니 이 사본만으로는 풀 수 없다.
# 2) 데이터베이스 덤프(fairy-backup 컨테이너가 05:30 UTC 에 외장 디스크 daily/ 에 쓴다)가 제때 온전하게 생겼는지
#    10분마다 본다: 가장 새 파일의 시각이 26시간 안이고 gzip 이 온전한지.
#
# 결과는 STATUS 폴더(compose 볼륨 fairy_backup_status, 서버는 읽기 전용으로 붙인다)에 작업마다 세 파일로 남긴다:
#   <작업>.ok       마지막 성공: "<초 단위 시각><탭><한 줄 설명>"
#   <작업>.fail     마지막 실패: "<초 단위 시각><탭><까닭>"
#   <작업>.checked  이 스크립트가 마지막으로 본 때: "<초 단위 시각>"
# 작업은 db(덤프)와 files(사본). 파일은 임시 파일에 쓴 뒤 옮겨 읽는 쪽이 반쯤 쓴 글을 보지 않게 한다.
# 서버가 읽어 홈 카드로 보인다 (server/src/admin-home.ts backupJobOf). 성공 시각은 일이 끝난 시각이다
# (덤프는 파일의 수정 시각, 사본은 맞추기가 끝난 시각).
#
# 시험용 바꿈: SRC, DST, DUMP_DIR, STATUS, POLL_SEC, STALE_SEC, SYNC_ON_START, ONCE (1 이면 한 번만 보고 끝)
set -eu
SRC=${SRC:-/src/}
DST=${DST:-/dst/files/}
DUMP_DIR=${DUMP_DIR:-/dst/daily}
STATUS=${STATUS:-/status}
AT=${SYNC_AT_UTC_SEC:-21600}
POLL=${POLL_SEC:-600}
STALE=${STALE_SEC:-93600}
GZ_TIMEOUT=${GZ_TIMEOUT:-120}
# 이만큼(초)보다 새로 바뀐 덤프는 쓰는 중일 수 있어 건너뛴다
FRESH=${FRESH_SEC:-120}
mkdir -p "$DST"
# 상태 파일은 곁가지다: 못 만들거나 못 써도 사본 맞추기는 계속한다 (경고만 stderr)
mkdir -p "$STATUS" 2>/dev/null || echo "$(date -u +%FT%TZ) 상태 폴더를 못 만들어요: $STATUS" >&2

# 한 줄 파일을 통째로 바꿔 쓴다 (읽는 쪽이 중간 상태를 보지 않게)
put() {
  tmp="$STATUS/.$1.$$"
  if ! { printf '%s\n' "$2" > "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$STATUS/$1"; } 2>/dev/null; then
    rm -f "$tmp" 2>/dev/null || true
    echo "$(date -u +%FT%TZ) 상태 파일을 못 써요: $STATUS/$1" >&2
  fi
  return 0
}
# 시간 제한이 있으면 건다 (멎은 디스크에서 gzip 이 루프를 막지 않게. timeout 이 없는 곳은 그냥 돌린다)
tmo() {
  if command -v timeout >/dev/null 2>&1; then timeout "$GZ_TIMEOUT" "$@"; else "$@"; fi
}
now() { date -u +%s; }
# 설명 글은 한 줄, 200자까지 (탭과 줄바꿈은 공백으로)
oneline() { printf '%s' "$1" | tr '\t\r\n' '   ' | cut -c1-200; }
ok() { put "$1.ok" "$2	$(oneline "$3")"; }
fail() {
  put "$1.fail" "$(now)	$(oneline "$2")"
  echo "$(date -u +%FT%TZ) $1 실패: $2" >&2
}

sync_now() {
  err=$(rsync -a --delete --exclude '*.part' "$SRC" "$DST" 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    n=$(find "$DST" -type f | wc -l | tr -d ' ')
    ok files "$(now)" "서버 백업 파일 ${n}개 맞춤"
    echo "$(date -u +%FT%TZ) 서버 백업 파일 맞춤: ${n}개"
  else
    # rsync 의 마지막 줄을 까닭으로 (없으면 종료 코드)
    last=$(printf '%s\n' "$err" | tail -n 1)
    fail files "rsync 종료 코드 $rc ${last}"
  fi
  put files.checked "$(now)"
}

# 가장 새 덤프가 제때 있고 온전한지 본다
check_dump() {
  put db.checked "$(now)"
  if [ ! -d "$DUMP_DIR" ]; then
    fail db "덤프 폴더가 없어요 ($DUMP_DIR)"
    return
  fi
  # 가장 새 파일부터 보되 FRESH 초 안에 바뀐 것(쓰는 중일 수 있음)은 건너뛰고 그다음 새 파일을 본다
  newest=""
  seen=0
  for f in $(ls -t "$DUMP_DIR"/*.sql.gz 2>/dev/null || true); do
    m=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
    [ $(($(now) - m)) -ge "$FRESH" ] && { newest=$f; break; }
    seen=1
  done
  if [ -z "$newest" ]; then
    # 쓰는 중인 파일뿐이면 이번엔 판단하지 않는다 (다음 점검에서 본다)
    [ "$seen" = 1 ] || fail db "덤프 파일이 하나도 없어요"
    return 0
  fi
  # 수정 시각 (초). BSD 와 busybox 모두 되게 stat 두 형식을 시도한다
  mt=$(stat -c %Y "$newest" 2>/dev/null || stat -f %m "$newest" 2>/dev/null || echo 0)
  size=$(wc -c < "$newest" 2>/dev/null | tr -d ' ')
  size=${size:-0}
  age=$(($(now) - mt))
  base=$(basename "$newest")
  gzrc=0
  [ "$size" -lt 20 ] || tmo gzip -t "$newest" 2>/dev/null || gzrc=$?
  if [ "$size" -lt 20 ]; then
    fail db "가장 새 덤프가 비었어요 ($base, ${size}바이트)"
  elif [ "$gzrc" -eq 124 ]; then
    fail db "점검 시간 초과 ($base, ${GZ_TIMEOUT}초 안에 압축 검사가 끝나지 않았어요)"
  elif [ "$gzrc" -ne 0 ]; then
    fail db "가장 새 덤프가 깨졌어요 ($base, 압축 검사 실패)"
  elif [ "$age" -gt "$STALE" ]; then
    fail db "가장 새 덤프가 $((age / 3600))시간 전 것이에요 ($base)"
  else
    ok db "$mt" "$base ${size}바이트"
  fi
}

# 켤 때: 오늘 몫을 이미 했거나 맞추는 시각 전이면 기다린다. 사본의 마지막 성공이 25시간보다 오래됐으면(처음 켬, 오래 꺼져 있었음)
# 바로 한 번 맞춘다. 그래야 켠 직후부터 상태 파일이 생긴다 (SYNC_ON_START=1 이면 늘 한 번)
synced=""
[ "$(($(now) % 86400))" -ge "$AT" ] && synced=$(date -u +%F)
last=$(cut -f1 "$STATUS/files.ok" 2>/dev/null | head -n 1 || true)
case "$last" in ''|*[!0-9]*) last=0 ;; esac
if [ "${SYNC_ON_START:-0}" = 1 ] || [ $(($(now) - last)) -gt 90000 ]; then
  sync_now
  synced=$(date -u +%F)
fi
while true; do
  check_dump || echo "$(date -u +%FT%TZ) 덤프 점검 중 오류 (건너뜀)" >&2
  t=$(date -u +%F)
  s=$(($(now) % 86400))
  if [ "$s" -ge "$AT" ] && [ "$synced" != "$t" ]; then
    sync_now
    synced=$t
  fi
  [ "${ONCE:-0}" = 1 ] && exit 0
  sleep "$POLL"
done
