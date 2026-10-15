#!/bin/bash
# 홈서버에서 페어리 서버를 올린다. 배포 워크플로(server-deploy.yml)가 ssh 로 이 파일을 넘겨 돌리고,
# 사람이 홈서버에서 직접 돌려도 된다:
#
#   FAIRY_REPO_DIR=~/bk/project/fairy bash server/ops/deploy.sh [ref]
#
# 운영 체크아웃의 커밋된 것만 쓴다 (git archive). 작업 중인 파일이 섞이지 않는다.
# .env.prod 는 운영 체크아웃의 server/.env.prod 를 복사해 쓴다. 모일까 컨테이너는 건드리지 않는다.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

REPO="${FAIRY_REPO_DIR:?FAIRY_REPO_DIR (홈서버의 fairy 레포 경로)가 필요하다}"
REPO="${REPO/#\~/$HOME}"
REF="${1:-origin/main}"
SRC="$HOME/.fairy-deploy-src"

cd "$REPO"
git fetch origin --prune --quiet
[ -f "$REPO/server/.env.prod" ] || { echo "[deploy] $REPO/server/.env.prod 가 없다"; exit 1; }

rm -rf "$SRC"; mkdir -p "$SRC"
# 서버와, 서버가 앱과 함께 쓰는 공용 파일만 꺼낸다. compose 빌드 맥락이 레포 루트(..)다.
# 공용 파일 목록은 server/Dockerfile 의 `COPY src/shared/...` 줄이 원본이다 (목록을 두 곳에 두지 않는다).
SHARED=$(git show "$REF:server/Dockerfile" | sed -n 's#^COPY \(src/shared/[^ ]*\) .*#\1#p')
[ -n "$SHARED" ] || { echo "[deploy] Dockerfile 에서 공용 파일 목록을 못 읽었다"; exit 1; }
# shellcheck disable=SC2086
git archive "$REF" server $SHARED | tar -x -C "$SRC"
cp "$REPO/server/.env.prod" "$SRC/server/.env.prod"
chmod 600 "$SRC/server/.env.prod"
echo "[deploy] $(git rev-parse --short "$REF") 빌드"

cd "$SRC/server"
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build --remove-orphans
cd "$HOME"; rm -rf "$SRC"

for _ in $(seq 1 30); do
  if curl -fsS -m 3 http://127.0.0.1:3002/health >/dev/null 2>&1; then
    echo "[deploy] /health 200"
    exit 0
  fi
  sleep 2
done
echo "[deploy] /health 가 60초 안에 200 이 아니다"
docker logs --tail 50 fairy-api || true
exit 1
