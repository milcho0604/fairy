// 시험용 Postgres 컨테이너. 무작위 이름으로 띄우고 끝나면 지운다 (홈서버의 다른 컨테이너는 이름으로만 건드리지 않는다).
// 로그는 1MB 까지만. 시험이 중간에 죽어도 process exit 에서 지운다.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

export async function waitFor(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('시간 안에 준비되지 않았다');
}

export async function startPg(): Promise<{ databaseUrl: string; stop: () => void }> {
  const name = `fairy-test-pg-${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  const stop = () => {
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    } catch {}
  };
  process.on('exit', stop);
  docker(
    'run',
    '-d',
    '--rm',
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
  await waitFor(async () => {
    try {
      docker('exec', name, 'pg_isready', '-U', 'fairy', '-d', 'fairy', '-h', '127.0.0.1');
      return true;
    } catch {
      return false;
    }
  }, 60_000);
  return { databaseUrl: `postgres://fairy:${password}@127.0.0.1:${port}/fairy`, stop };
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  // @ts-expect-error: .mjs 스크립트를 그대로 가져온다
  const { migrate } = (await import('../../scripts/migrate.mjs')) as {
    migrate: (url: string, log?: (s: string) => void) => Promise<void>;
  };
  await migrate(databaseUrl, () => {});
}
