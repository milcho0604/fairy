// 통합 시험: 무작위 이름의 시험용 Postgres 컨테이너를 띄워 마이그레이션, /health 200, DB 를 멈추면 503 까지 본다.
// Docker 가 필요하다. 끝나면 컨테이너를 지운다 (홈서버의 다른 컨테이너는 이름으로만 건드리지 않는다).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../src/app';

const name = `fairy-test-pg-${randomBytes(4).toString('hex')}`;
const password = randomBytes(12).toString('hex');
let databaseUrl = '';
let app: NestExpressApplication | undefined;
let base = '';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

async function waitFor(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('시간 안에 준비되지 않았다');
}

// 시험이 중간에 죽어도 컨테이너를 남기지 않는다
process.on('exit', () => {
  try {
    execFileSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' });
  } catch {}
});

before(async () => {
  docker(
    'run',
    '-d',
    '--rm',
    '--tmpfs',
    '/var/lib/postgresql/data',
    '--name',
    name,
    '--log-opt',
    'max-size=1m',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_USER=fairy',
    '-e',
    'POSTGRES_DB=fairy',
    '-p',
    '127.0.0.1::5432',
    'postgres:16-alpine',
  );
  const port = docker('port', name, '5432/tcp').split('\n')[0]?.split(':').pop();
  databaseUrl = `postgres://fairy:${password}@127.0.0.1:${port}/fairy`;
  await waitFor(async () => {
    try {
      docker('exec', name, 'pg_isready', '-U', 'fairy', '-d', 'fairy', '-h', '127.0.0.1');
      return true;
    } catch {
      return false;
    }
  }, 60_000);
});

after(async () => {
  await app?.close().catch(() => {});
  try {
    docker('rm', '-f', '-v', name);
  } catch {}
});

test('마이그레이션은 한 번만 적용되고 다시 돌려도 그대로', async () => {
  // @ts-expect-error: .mjs 스크립트를 그대로 가져온다
  const { migrate } = (await import('../../scripts/migrate.mjs')) as {
    migrate: (url: string, log?: (s: string) => void) => Promise<void>;
  };
  const logs: string[] = [];
  await migrate(databaseUrl, (s) => logs.push(s));
  assert.ok(logs.some((s) => s.includes('0001_init.sql')));
  const again: string[] = [];
  await migrate(databaseUrl, (s) => again.push(s));
  assert.deepEqual(again, []);
});

test('/health: DB 가 살아 있으면 200, 멈추면 503, 다시 켜면 200', async () => {
  app = await createApp({
    port: 0,
    databaseUrl,
    publicUrl: 'http://127.0.0.1:1',
    googleClientId: '',
    googleClientSecret: '',
  });
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const ok = await fetch(`${base}/health`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { status: 'ok', db: 'ok' });
  assert.equal(ok.headers.get('x-powered-by'), null);

  docker('pause', name);
  try {
    const down = await fetch(`${base}/health`);
    assert.equal(down.status, 503);
  } finally {
    docker('unpause', name);
  }
  await waitFor(async () => (await fetch(`${base}/health`)).status === 200, 15_000);
});
