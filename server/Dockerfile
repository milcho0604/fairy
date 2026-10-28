# 페어리 서버 이미지. 빌드 맥락은 레포 루트다: 서버(server/)와 앱과 함께 쓰는 순수 규칙 파일 하나
# (src/shared/coin-rules.ts, site-events.ts, account-profile.ts)만 들어온다. 나머지 앱 코드는 server/Dockerfile.dockerignore 가 막는다.
#   docker build -f server/Dockerfile .
# 기동 때 마이그레이션을 돌리고 서버를 띄운다. node 사용자(uid 1000)로 돈다.
FROM node:26.12.1-slim AS builder
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/scripts ./scripts
COPY server/src ./src
# 공유 규칙은 원본 그대로 서버 src/shared/ 자리에 둔다 (scripts/sync-shared.mjs 가 레포에서 하는 일과 같다)
COPY src/shared/coin-rules.ts ./src/shared/coin-rules.ts
COPY src/shared/site-events.ts ./src/shared/site-events.ts
COPY src/shared/account-profile.ts ./src/shared/account-profile.ts
COPY src/shared/update-levels.ts ./src/shared/update-levels.ts
RUN npm run build && npm prune --omit=dev

FROM node:26.12.1-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node server/package.json ./
COPY --chown=node:node server/scripts ./scripts
COPY --chown=node:node server/db ./db
# 서버 백업 볼륨 자리. 빈 named volume 은 처음 붙을 때 이 폴더의 주인(node)을 물려받는다
RUN mkdir -p /data/backups && chown node:node /data/backups && chmod 700 /data/backups
# 밖에서 도는 백업의 결과를 읽는 자리 (compose 가 fairy_backup_status 볼륨을 읽기 전용으로 붙인다)
RUN mkdir -p /data/backup-status
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node dist/main.js"]
