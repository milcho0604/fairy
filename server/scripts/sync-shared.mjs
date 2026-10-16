// 앱과 서버가 함께 쓰는 순수 규칙(레포 루트 src/shared/coin-rules.ts, site-events.ts, account-profile.ts)을 server/src/shared/ 로 복사한다 (기획서 16절).
// 원본은 한 곳뿐이고 복사본은 레포에 올리지 않는다(server/.gitignore). 빌드, 타입 검사, 시험 전에 돈다.
// Docker 빌드는 Dockerfile 이 원본을 그 자리에 바로 넣으므로, 원본이 없고 복사본만 있으면 그대로 둔다.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILES = ['coin-rules.ts', 'site-events.ts', 'account-profile.ts', 'update-levels.ts'];
const root = join(import.meta.dirname, '..');

for (const name of FILES) {
  const from = join(root, '..', 'src', 'shared', name);
  const to = join(root, 'src', 'shared', name);
  if (existsSync(from)) {
    if (existsSync(to) && readFileSync(from, 'utf8') === readFileSync(to, 'utf8')) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  } else if (!existsSync(to)) {
    console.error(`[sync-shared] ${from} 이 없다 (레포 루트의 src/shared/${name})`);
    process.exit(1);
  }
}
