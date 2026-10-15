#!/bin/sh
# 서버 백업 파일(볼륨 fairy_backups, AES-256-GCM 암호문)을 매일 외장 디스크로 맞춘다 (#102).
# 모일까 DB 백업 04:30, 페어리 DB 백업 05:30 UTC 와 겹치지 않게 06:00 UTC (= 15:00 KST).
# 암호문을 그대로 복사하고, 서버에서 지운 것(탈퇴, 최근 2개 밖, 1년 미사용)은 여기서도 지운다(--delete).
# 쓰다 만 파일(*.part)은 옮기지 않는다. 키(BACKUP_ENC_KEY)는 여기 없으니 이 사본만으로는 풀 수 없다.
set -eu
SRC=/src/
DST=/dst/files/
AT=${SYNC_AT_UTC_SEC:-21600}
mkdir -p "$DST"
sync_now() {
  if rsync -a --delete --exclude '*.part' "$SRC" "$DST"; then
    echo "$(date -u +%FT%TZ) 서버 백업 파일 맞춤: $(find "$DST" -type f | wc -l)개"
  else
    echo "$(date -u +%FT%TZ) 서버 백업 파일 맞추기 실패" >&2
  fi
}
[ "${SYNC_ON_START:-0}" = 1 ] && sync_now
while true; do
  t=$(($(date -u +%s) % 86400))
  wait=$(((AT - t + 86400) % 86400))
  [ "$wait" -eq 0 ] && wait=86400
  sleep "$wait"
  sync_now
done
