# 페어리 서버 이미지. 빌드 맥락은 레포 루트다: 서버(server/)와 앱과 함께 쓰는 순수 규칙 파일 하나
# (src/shared/coin-rules.ts)만 들어온다. 나머지 앱 코드는 server/Dockerfile.dockerignore 가 막는다.
#   docker build -f server/Dockerfile .
# 기동 때 마이그레이션을 돌리고 서버를 띄운다. node 사용자(uid 1000)로 돈다.
FROM node:24-slim AS builder
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/scripts ./scripts
COPY server/src ./src
# 공유 규칙은 원본 그대로 서버 src/shared/ 자리에 둔다 (scripts/sync-shared.mjs 가 레포에서 하는 일과 같다)
COPY src/shared/coin-rules.ts ./src/shared/coin-rules.ts
RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node server/package.json ./
COPY --chown=node:node server/scripts ./scripts
COPY --chown=node:node server/db ./db
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node dist/main.js"]
