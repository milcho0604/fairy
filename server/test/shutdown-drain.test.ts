// 통합 시험: 진행 중인 AI 답이 있을 때 SIGTERM 을 받아도 답이 끝나고 사용량이 적힌 뒤에 풀이 닫힌다.
// 진짜 서버 프로세스(dist-test/src/main.js)를 띄우고 가짜 Anthropic 의 느린 스트림([[late]]) 도중에 보낸다.
// 진짜 Anthropic 은 부르지 않는다 (ANTHROPIC_BASE_URL 이 가짜 주소).
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { runMigrations, startPg } from './pg';

let stopPg = () => {};
let pool: Pool;
let fake: { url: string; calls: unknown[]; close: () => Promise<void> };
let child: ChildProcess | undefined;
let out = '';
const sha = (s: string) => createHash('sha256').update(s).digest();
const session = ['fs', randomBytes(32).toString('base64url')].join('_');
let port = 0;

before(async () => {
  // 비어 있는 포트 하나를 받아 둔다
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  port = (probe.address() as { port: number }).port;
  await new Promise((r) => probe.close(r));
  const pg = await startPg();
  stopPg = pg.stop;
  await runMigrations(pg.databaseUrl);
  pool = new Pool({ connectionString: pg.databaseUrl, max: 2 });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO account (age, code) VALUES ('18+', 'F-AAAA-BBBB') RETURNING id`,
  );
  const id = a.rows[0]?.id;
  await pool.query(`INSERT INTO login (service, sub, account_id) VALUES ('google', 'sub-drain', $1)`, [id]);
  await pool.query('INSERT INTO session (account_id, token_hash) VALUES ($1, $2)', [id, sha(session)]);
  await pool.query('INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, 5)', [id]);
  await pool.query(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);
  const fakePath = ['..', '..', 'scripts', 'fake-anthropic.mjs'].join('/');
  const mod = await import(fakePath);
  fake = await mod.startFakeAnthropic();
  child = spawn(process.execPath, [join(__dirname, '..', 'src', 'main.js')], {
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_URL: pg.databaseUrl,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: `zz-${randomBytes(4).toString('hex')}`,
      ANTHROPIC_BASE_URL: fake.url,
      GIFT_HMAC_KEY: randomBytes(32).toString('hex'),
    },
  });
  child.stdout?.on('data', (d) => {
    out += d;
  });
  child.stderr?.on('data', (d) => {
    out += d;
  });
  for (let i = 0; i < 100; i++) {
    if (/successfully started/.test(out)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(out, /successfully started/, out.slice(-500));
});
after(async () => {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  await fake?.close().catch(() => {});
  await pool?.end().catch(() => {});
  stopPg();
});

test('SIGTERM 이 진행 중인 답 도중에 와도 답이 끝나고 사용량이 적힌 뒤에 종료한다', async () => {
  const body = { messages: [{ role: 'user', content: '[[late]] 안녕' }], lang: 'ko' };
  const res = fetch(`http://127.0.0.1:${port}/v1/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` },
    body: JSON.stringify(body),
  });
  // 업스트림에 요청이 닿았을 때(답이 진행 중일 때) 종료 신호
  for (let i = 0; i < 100 && fake.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
  if (fake.calls.length !== 1) {
    const early = await Promise.race([
      res,
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 500)),
    ]);
    assert.fail(
      `가짜 Anthropic 에 요청이 닿아야 한다: ${early ? `${early.status} ${await early.text()}` : '응답 없음'}`,
    );
  }
  const exited = once(child as ChildProcess, 'exit');
  (child as ChildProcess).kill('SIGTERM');
  const r = await res;
  const text = await r.text();
  assert.equal(r.status, 200, text);
  assert.match(text, /event: done/, text);
  // Nest 는 정리를 마치면 같은 신호를 다시 보내 끝낸다 (코드 null, 신호 SIGTERM). 컨테이너에는 143 으로 보인다
  const [code, signal] = await exited;
  assert.ok(code === 0 || signal === 'SIGTERM', `code ${code} signal ${signal}: ${out.slice(-800)}`);
  const u = await pool.query<{ status: string }>('SELECT status FROM ai_usage');
  assert.deepEqual(
    u.rows.map((x) => x.status),
    ['ok'],
  );
  assert.doesNotMatch(out, /Cannot use a pool after calling end/);
});
