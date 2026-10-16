// 통합 시험: 서버 백업(5단계)과 카카오 로그인(6단계), 기능 키 (#102).
// 시험용 Postgres 컨테이너, 임시 백업 폴더, 가짜 카카오(scripts/fake-kakao.mjs, HTTP)를 띄운다. 진짜 구글과 카카오는 부르지 않는다.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, type JsonWebKey, randomBytes, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import { BACKUP_MAX_BYTES, Backups } from '../src/backup';
import type { Config } from '../src/config';
import { Features } from '../src/features';
import type { GoogleApi } from '../src/google';
import { runMigrations, startPg } from './pg';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const KAKAO_KEY = 'kakao-rest-key';
const KAKAO_SECRET = 'kakao-secret';
const DAY = 86_400_000;
let stopPg = () => {};
let pool: Pool;
let app: NestExpressApplication;
let base = '';
let config: Config;
let dir = '';
let clockOffset = 0;
type FakeKakao = {
  url: string;
  state: { nextSub: string; scopes: string[]; errors: string[] };
  close: () => Promise<void>;
};
let kakao: FakeKakao;
const extraApps: NestExpressApplication[] = [];

// 가짜 구글 (accounts.test.ts 와 같은 꼴)
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(key.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'g1', alg: 'RS256' };
let nextGoogle: (nonce: string) => string = () => '';
let lastNonce = '';
const fakeGoogle: GoogleApi = {
  async exchangeCode() {
    return nextGoogle(lastNonce);
  },
  async fetchJwks() {
    return [jwk];
  },
};
function googleToken(sub: string, nonce: string): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${enc({ alg: 'RS256', kid: 'g1' })}.${enc({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, nonce, iat: now, exp: now + 3600 })}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), key.privateKey).toString('base64url')}`;
}

const ip = () => `10.${rnd()}.${rnd()}.${rnd()}`;
const rnd = () => Math.floor(Math.random() * 250);
// biome-ignore lint/suspicious/noExplicitAny: 시험은 응답 JSON 을 바로 읽는다
type Res = { status: number; body: any; headers: Headers; raw: Buffer };

async function api(
  method: string,
  path: string,
  o: {
    token?: string;
    body?: unknown;
    raw?: Buffer | ReadableStream;
    type?: string;
    ip?: string;
    at?: string;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.raw !== undefined) headers['content-type'] = o.type ?? 'application/octet-stream';
  headers['cf-connecting-ip'] = o.ip ?? ip();
  const init: RequestInit & { duplex?: string } = {
    method,
    headers,
    body: o.raw !== undefined ? o.raw : o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: 'manual',
  };
  if (o.raw instanceof ReadableStream) init.duplex = 'half';
  const res = await fetch(`${o.at ?? base}${path}`, init);
  const raw = Buffer.from(await res.arrayBuffer());
  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, body, headers: res.headers, raw };
}

async function newDevice(): Promise<string> {
  const r = await api('POST', '/v1/device', { body: { age: '14+' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}

const newVerifier = () => randomBytes(32).toString('base64url');
const challengeOf = (v: string) => createHash('sha256').update(v).digest('base64url');

/** 구글 로그인 한 바퀴 → 세션 */
async function googleLogin(token: string, sub: string): Promise<Res> {
  const v = newVerifier();
  const from = ip();
  const st = randomUUID().replaceAll('-', '');
  const start = await api('GET', `/auth/google/start?port=53682&state=${st}&challenge=${challengeOf(v)}`, {
    ip: from,
  });
  assert.equal(start.status, 302);
  const g = new URL(start.headers.get('location') ?? '');
  lastNonce = g.searchParams.get('nonce') ?? '';
  nextGoogle = (n) => googleToken(sub, n);
  const cb = await api('GET', `/auth/google/callback?state=${g.searchParams.get('state')}&code=x`, {
    ip: from,
  });
  const code = new URL(cb.headers.get('location') ?? '').searchParams.get('code');
  return api('POST', '/v1/session', { token, body: { code, verifier: v } });
}

async function session(sub = `g-${randomUUID()}`): Promise<{ device: string; session: string; id: string }> {
  const device = await newDevice();
  const r = await googleLogin(device, sub);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { device, session: r.body.session, id: String(r.body.account.id) };
}

/**
 * 카카오 로그인 한 바퀴. begin 이 주어지면 POST /v1/auth/kakao/begin(그 토큰)으로, 아니면 GET /auth/kakao/start 로 연다.
 * 가짜 카카오가 바로 콜백으로 돌려보낸다 → 서버 콜백 → 루프백 주소의 code
 */
async function kakaoCode(
  sub: string,
  o: { begin?: string } = {},
): Promise<{ code?: string; verifier: string; status: number; body?: unknown; error?: string | null }> {
  const v = newVerifier();
  const from = ip();
  const st = randomUUID().replaceAll('-', '');
  let url: string;
  if (o.begin) {
    const b = await api('POST', '/v1/auth/kakao/begin', {
      token: o.begin,
      body: { port: '53682', state: st, challenge: challengeOf(v) },
      ip: from,
    });
    if (b.status !== 200) return { verifier: v, status: b.status, body: b.body };
    url = b.body.url;
  } else {
    const s = await api('GET', `/auth/kakao/start?port=53682&state=${st}&challenge=${challengeOf(v)}`, {
      ip: from,
    });
    if (s.status !== 302) return { verifier: v, status: s.status, body: s.body };
    url = s.headers.get('location') ?? '';
  }
  const authorize = new URL(url);
  assert.equal(authorize.origin, kakao.url);
  assert.equal(authorize.searchParams.get('scope'), 'openid');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${config.publicUrl}/auth/kakao/callback`);
  kakao.state.nextSub = sub;
  const k = await fetch(url, { redirect: 'manual' });
  const cbUrl = new URL(k.headers.get('location') ?? '');
  const cb = await api('GET', `${cbUrl.pathname}${cbUrl.search}`, { ip: from });
  assert.equal(cb.status, 302);
  const done = new URL(cb.headers.get('location') ?? '');
  assert.equal(done.origin, 'http://127.0.0.1:53682');
  assert.equal(done.searchParams.get('state'), st);
  return {
    code: done.searchParams.get('code') ?? undefined,
    error: done.searchParams.get('error'),
    verifier: v,
    status: 302,
  };
}

async function kakaoSession(token: string, sub: string, o: { begin?: string; merge?: boolean } = {}) {
  const c = await kakaoCode(sub, o);
  if (!c.code) return { status: c.status, body: c.body, verifier: c.verifier };
  const r = await api('POST', '/v1/session', { token, body: { code: c.code, verifier: c.verifier } });
  return { ...r, verifier: c.verifier };
}

/** 그럴듯한 .fairybackup (zip 머리 + 알아볼 수 있는 글) */
function backupBytes(marker: string, size = 4096): Buffer {
  const b = Buffer.alloc(size, 0x20);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(b, 0);
  Buffer.from(marker).copy(b, 30);
  return b;
}

const put = (token: string, raw: Buffer | ReadableStream, consent = true, type?: string, at?: string) =>
  api('PUT', `/v1/backup${consent ? '?consent=yes' : ''}`, {
    token,
    raw,
    ...(type ? { type } : {}),
    ...(at ? { at } : {}),
  });

const files = () => readdirSync(dir).filter((f) => f.endsWith('.fbk'));
const features = () => app.get(Features);

before(async () => {
  const pg = await startPg();
  stopPg = pg.stop;
  await runMigrations(pg.databaseUrl);
  pool = new Pool({ connectionString: pg.databaseUrl, max: 2 });
  dir = mkdtempSync(join(tmpdir(), 'fairy-backup-test-'));
  // @ts-expect-error: .mjs 스크립트를 그대로 가져온다
  const { startFakeKakao } = (await import('../../scripts/fake-kakao.mjs')) as {
    startFakeKakao: (o: { clientId: string; clientSecret: string }) => Promise<FakeKakao>;
  };
  kakao = await startFakeKakao({ clientId: KAKAO_KEY, clientSecret: KAKAO_SECRET });
  config = {
    port: 0,
    databaseUrl: pg.databaseUrl,
    publicUrl: 'http://127.0.0.1:1',
    googleClientId: CLIENT_ID,
    googleClientSecret: 'test-secret',
    kakaoRestApiKey: KAKAO_KEY,
    kakaoClientSecret: KAKAO_SECRET,
    kakaoAuthUrl: kakao.url,
    backup: { key: randomBytes(32), dir },
    features: { kakao_login: 'off' },
  };
  app = await createApp(config, { google: fakeGoogle, now: () => Date.now() + clockOffset });
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  for (const a of extraApps) await a.close().catch(() => {});
  await app?.close().catch(() => {});
  await pool?.end().catch(() => {});
  await kakao?.close().catch(() => {});
  stopPg();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function otherApp(c: Config): Promise<string> {
  const a = await createApp(c, { google: fakeGoogle });
  await a.listen(0, '127.0.0.1');
  extraApps.push(a);
  const addr = a.getHttpServer().address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

describe('서버 백업', () => {
  test('세션만, 따로 동의한 요청만, 형식은 octet-stream 의 zip', async () => {
    const s = await session();
    assert.equal((await api('GET', '/v1/backup', { token: s.device })).status, 403);
    assert.deepEqual((await put(s.device, backupBytes('x'))).body, { error: 'login' });
    assert.deepEqual((await put(s.session, backupBytes('x'), false)).body, { error: 'consent' });
    assert.equal((await put(s.session, backupBytes('x'), true, 'application/zip')).status, 415);
    assert.deepEqual((await put(s.session, Buffer.from('not a zip at all'))).body, { error: 'format' });
    assert.deepEqual((await put(s.session, Buffer.alloc(0))).body, { error: 'empty' });
    assert.equal(files().length, 0);
    assert.equal(readdirSync(dir).length, 0, '쓰다 만 파일도 남기지 않는다');
  });

  test('올리기와 받기: 같은 바이트, sha256, 디스크 파일은 암호문 (평문이 보이지 않는다)', async () => {
    const s = await session();
    const marker = `secret-todo-${randomUUID()}`;
    const bytes = backupBytes(marker, 300_000);
    const up = await put(s.session, bytes);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const sha = createHash('sha256').update(bytes).digest('hex');
    assert.equal(up.body.backup.size, bytes.length);
    assert.equal(up.body.backup.sha256, sha);
    assert.equal(up.body.backup.soon, false);
    const row = (await pool.query('SELECT file FROM backup WHERE id = $1', [up.body.backup.id])).rows[0];
    const disk = readFileSync(join(dir, `${row.file}.fbk`));
    assert.equal(disk.subarray(0, 4).toString(), 'FBK1');
    assert.equal(disk.length, bytes.length + 4 + 12 + 16);
    assert.equal(disk.includes(Buffer.from(marker)), false, '암호화하지 않은 글이 디스크에 있다');
    assert.equal(disk.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04])), false);
    // DB 에는 메타만 (본문은 없다)
    const cols = (
      await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'backup'")
    ).rows.map((r) => r.column_name);
    assert.deepEqual(cols.sort(), [
      'account_id',
      'created_at',
      'file',
      'id',
      'last_access_at',
      'sha256',
      'size',
    ]);

    const list = await api('GET', '/v1/backup', { token: s.session });
    assert.equal(list.status, 200);
    assert.equal(list.body.keep, 2);
    assert.equal(list.body.maxBytes, BACKUP_MAX_BYTES);
    assert.equal(list.body.backups.length, 1);
    const got = await api('GET', `/v1/backup/${up.body.backup.id}`, { token: s.session });
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('x-backup-sha256'), sha);
    assert.ok(got.raw.equals(bytes));
    // 다른 계정은 못 받는다
    const t = await session();
    assert.equal((await api('GET', `/v1/backup/${up.body.backup.id}`, { token: t.session })).status, 404);
    assert.equal((await api('DELETE', `/v1/backup/${up.body.backup.id}`, { token: t.session })).status, 404);
    assert.equal((await api('GET', '/v1/backup/abc', { token: s.session })).status, 404);
  });

  test('계정마다 최근 2개: 세 번째를 올리면 가장 오래된 것과 그 파일이 지워진다', async () => {
    const s = await session();
    const ids: number[] = [];
    for (const m of ['one', 'two', 'three']) {
      const r = await put(s.session, backupBytes(m));
      assert.equal(r.status, 201);
      ids.push(r.body.backup.id);
    }
    const list = await api('GET', '/v1/backup', { token: s.session });
    assert.deepEqual(
      list.body.backups.map((b: { id: number }) => b.id),
      [ids[2], ids[1]],
    );
    const rows = (await pool.query('SELECT file FROM backup WHERE account_id = $1', [s.id])).rows;
    assert.equal(rows.length, 2);
    for (const r of rows) assert.ok(existsSync(join(dir, `${r.file}.fbk`)));
    assert.equal((await api('GET', `/v1/backup/${ids[0]}`, { token: s.session })).status, 404);
    // 지우기
    assert.equal((await api('DELETE', `/v1/backup/${ids[1]}`, { token: s.session })).status, 204);
    assert.equal((await api('GET', '/v1/backup', { token: s.session })).body.backups.length, 1);
    const all = new Set((await pool.query('SELECT file FROM backup')).rows.map((r) => `${r.file}.fbk`));
    assert.deepEqual(
      files().filter((f) => !all.has(f)),
      [],
      '줄 없는 파일이 남았다',
    );
  });

  test('20MB 를 넘으면 413 (길이를 알릴 때도, 흘려 보낼 때도), 남는 파일 없음', async () => {
    const s = await session();
    const before = readdirSync(dir).length;
    const big = backupBytes('big', BACKUP_MAX_BYTES + 1);
    const r = await put(s.session, big);
    assert.equal(r.status, 413);
    assert.deepEqual(r.body, { error: 'too_big' });
    // content-length 없이 흘려 보낸다
    let sent = 0;
    const chunk = backupBytes('c', 1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent > BACKUP_MAX_BYTES + 2 * 1024 * 1024) return ctl.close();
        sent += chunk.length;
        ctl.enqueue(chunk);
      },
    });
    const r2 = await put(s.session, stream);
    assert.equal(r2.status, 413);
    // 딱 20MB 는 된다
    const ok = await put(s.session, backupBytes('edge', BACKUP_MAX_BYTES));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(readdirSync(dir).length, before + 1);
  });

  test('디스크 파일을 바꾸면 받기가 끝까지 가지 않는다 (GCM tag)', async () => {
    const s = await session();
    const up = await put(s.session, backupBytes('tamper', 100_000));
    const row = (await pool.query('SELECT file FROM backup WHERE id = $1', [up.body.backup.id])).rows[0];
    const p = join(dir, `${row.file}.fbk`);
    const disk = readFileSync(p);
    disk[100] = (disk[100] ?? 0) ^ 0xff;
    writeFileSync(p, disk);
    let broken = false;
    try {
      const got = await api('GET', `/v1/backup/${up.body.backup.id}`, { token: s.session });
      broken =
        got.raw.length !== 100_000 ||
        createHash('sha256').update(got.raw).digest('hex') !== up.body.backup.sha256;
    } catch {
      broken = true;
    }
    assert.ok(broken);
  });

  test('탈퇴하면 백업 줄과 파일이 바로 지워진다', async () => {
    const s = await session();
    await put(s.session, backupBytes('bye1'));
    await put(s.session, backupBytes('bye2'));
    const mine = (await pool.query('SELECT file FROM backup WHERE account_id = $1', [s.id])).rows.map(
      (r) => r.file,
    );
    assert.equal(mine.length, 2);
    assert.equal((await api('DELETE', '/v1/account', { token: s.session })).status, 204);
    for (const f of mine) assert.equal(existsSync(join(dir, `${f}.fbk`)), false);
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM backup WHERE account_id = $1', [s.id])).rows[0].n,
      0,
    );
  });

  test('합치기: 남는 쪽으로 옮기고 두 계정 것 중 최근 2개만, 빠진 파일은 정리로 지운다', async () => {
    const a = await session();
    const b = await session();
    const order: number[] = [];
    for (const [who, m] of [
      [a, 'a1'],
      [b, 'b1'],
      [a, 'a2'],
      [b, 'b2'],
    ] as const) {
      const r = await put(who.session, backupBytes(m));
      order.push(r.body.backup.id);
    }
    // a 에 다른 서비스(카카오)를 잇는 대신, 구글 sub 로 합친다: a 세션으로 b 의 로그인을 쓰면 묻고, 확인하면 합친다
    const bSub = (await pool.query('SELECT sub FROM login WHERE account_id = $1', [b.id])).rows[0].sub;
    const v = newVerifier();
    const st = randomUUID().replaceAll('-', '');
    const from = ip();
    const start = await api('GET', `/auth/google/start?port=53682&state=${st}&challenge=${challengeOf(v)}`, {
      ip: from,
    });
    const g = new URL(start.headers.get('location') ?? '');
    lastNonce = g.searchParams.get('nonce') ?? '';
    nextGoogle = (n) => googleToken(bSub, n);
    const cb = await api('GET', `/auth/google/callback?state=${g.searchParams.get('state')}&code=x`, {
      ip: from,
    });
    const code = new URL(cb.headers.get('location') ?? '').searchParams.get('code');
    const ask = await api('POST', '/v1/session', { token: a.session, body: { code, verifier: v } });
    assert.equal(ask.status, 409);
    const yes = await api('POST', '/v1/session', {
      token: a.session,
      body: { code: ask.body.code, verifier: v, merge: true },
    });
    assert.equal(yes.status, 200);
    assert.equal(yes.body.merged, true);
    const list = await api('GET', '/v1/backup', { token: a.session });
    assert.deepEqual(
      list.body.backups.map((x: { id: number }) => x.id),
      [order[3], order[2]],
    );
    // 정리 (방금 올린 파일은 10분 기다린다: 시계를 당긴다)
    await app.get(Backups).sweepOrphans(Date.now() + 11 * 60_000);
    const all = new Set((await pool.query('SELECT file FROM backup')).rows.map((r) => `${r.file}.fbk`));
    assert.deepEqual(
      files().filter((f) => !all.has(f)),
      [],
    );
  });

  test('계정 활동이 1년 없으면 지운다, 30일 전부터 soon (시계 주입), 요청이 오면 활동이 다시 시작', async () => {
    const s = await session();
    const up = await put(s.session, backupBytes('old'));
    const id = up.body.backup.id;
    const file = (await pool.query('SELECT file FROM backup WHERE id = $1', [id])).rows[0].file;
    clockOffset = 330 * DAY;
    try {
      let list = await api('GET', '/v1/backup', { token: s.session });
      assert.equal(list.body.backups[0].soon, false);
      clockOffset = 340 * DAY;
      list = await api('GET', '/v1/backup', { token: s.session });
      assert.equal(list.body.backups[0].soon, true, '30일 안이면 곧 지워짐');
      await app.get(Backups).sweep(Date.now() + 366 * DAY);
      assert.equal((await api('GET', '/v1/backup', { token: s.session })).body.backups.length, 0);
      assert.equal(existsSync(join(dir, `${file}.fbk`)), false);
      clockOffset = 0;
      // 활동 기준: 400일 쉰 계정 둘. 하나는 요청(맞추기)이 와서 활동이 고쳐지고, 하나는 그대로라 지워진다
      const back = await session();
      const idle = await session();
      await put(back.session, backupBytes('back'));
      await put(idle.session, backupBytes('idle'));
      await pool.query(
        "UPDATE account SET last_active_at = now() - interval '400 days' WHERE id = ANY($1::bigint[])",
        [[back.id, idle.id]],
      );
      assert.equal(
        (await api('POST', '/v1/sync', { token: back.device, body: { entries: [] } })).status,
        200,
      );
      await app.get(Backups).sweep(Date.now());
      const left = await pool.query('SELECT account_id FROM backup WHERE account_id = ANY($1::bigint[])', [
        [back.id, idle.id],
      ]);
      assert.deepEqual(
        left.rows.map((r) => String(r.account_id)),
        [back.id],
      );
    } finally {
      clockOffset = 0;
    }
  });

  test('키(BACKUP_ENC_KEY)가 없으면 백업 경로만 503 backup_off', async () => {
    const at = await otherApp({ ...config, backup: { key: undefined, dir } });
    const s = await session();
    for (const [m, p] of [
      ['GET', '/v1/backup'],
      ['GET', '/v1/backup/1'],
      ['DELETE', '/v1/backup/1'],
    ] as const) {
      const r = await api(m, p, { token: s.session, at });
      assert.equal(r.status, 503, `${m} ${p}`);
      assert.deepEqual(r.body, { error: 'backup_off' });
    }
    const r = await api('PUT', '/v1/backup?consent=yes', { token: s.session, raw: backupBytes('x'), at });
    assert.equal(r.status, 503);
    assert.equal((await api('GET', '/health', { at })).status, 200);
  });
});

describe('카카오 로그인과 기능 키', () => {
  test('기능 키 off(기본): 키가 있어도 503 feature_off, providers 에 카카오 없음', async () => {
    await features().setFeatureMode('kakao_login', null);
    const r = await api('GET', `/auth/kakao/start?port=53682&state=abcdefgh12&challenge=${'A'.repeat(43)}`);
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'feature_off' });
    const s = await session();
    const b = await api('POST', '/v1/auth/kakao/begin', { token: s.session, body: {} });
    assert.deepEqual([b.status, b.body], [503, { error: 'feature_off' }]);
    assert.deepEqual((await api('GET', '/v1/auth/providers')).body, { login: ['google'], link: [] });
    assert.deepEqual((await api('GET', '/v1/auth/providers', { token: s.session })).body, {
      login: ['google'],
      link: ['google'],
    });
    assert.equal((await api('GET', '/v1/auth/google/begin')).status, 404);
  });

  test('everyone: 기기 계정이 카카오로 가입, openid 만, 같은 카카오로 다시 오면 같은 계정', async () => {
    await features().setFeatureMode('kakao_login', 'everyone');
    try {
      assert.deepEqual((await api('GET', '/v1/auth/providers')).body, {
        login: ['google', 'kakao'],
        link: [],
      });
      const d = await newDevice();
      const sub = `k-${randomUUID()}`;
      const r = await kakaoSession(d, sub);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.linked, true);
      assert.deepEqual(r.body.logins, ['kakao']);
      assert.ok(kakao.state.scopes.every((x) => x === 'openid'));
      const row = (
        await pool.query("SELECT account_id FROM login WHERE service = 'kakao' AND sub = $1", [sub])
      ).rows[0];
      assert.equal(String(r.body.account.id), row.account_id);
      // 다른 기기에서 같은 카카오로: 묻지 않고 합친다
      const d2 = await newDevice();
      const r2 = await kakaoSession(d2, sub);
      assert.equal(r2.status, 200);
      assert.equal(r2.body.merged, true);
      assert.equal(String(r2.body.account.id), row.account_id);
      // 키가 없으면 기능 키가 켜져도 503 login_off
      const at = await otherApp({ ...config, kakaoRestApiKey: '', features: { kakao_login: 'everyone' } });
      const off = await api(
        'GET',
        `/auth/kakao/start?port=53682&state=abcdefgh12&challenge=${'A'.repeat(43)}`,
        { at },
      );
      assert.deepEqual([off.status, off.body], [503, { error: 'login_off' }]);
      assert.deepEqual((await api('GET', '/v1/auth/providers', { at })).body, {
        login: ['google'],
        link: [],
      });
    } finally {
      await features().setFeatureMode('kakao_login', null);
    }
  });

  test('한 계정에 구글과 카카오: 로그인한 계정이 카카오를 연결, 다른 계정의 카카오면 묻고 합친다', async () => {
    await features().setFeatureMode('kakao_login', 'everyone');
    try {
      const a = await session();
      const ksub = `k-${randomUUID()}`;
      const link = await kakaoSession(a.session, ksub, { begin: a.session });
      assert.equal(link.status, 200, JSON.stringify(link.body));
      assert.equal(link.body.linked, true);
      assert.equal(String(link.body.account.id), a.id);
      assert.deepEqual(link.body.logins, ['google', 'kakao']);
      // 다른 사람: 카카오로만 가입한 계정 c 를 구글 계정 b 가 연결하려 함 → 409, 확인하면 b 에 합친다
      const c = await newDevice();
      const csub = `k-${randomUUID()}`;
      const cs = await kakaoSession(c, csub);
      await pool.query('UPDATE account SET balance = 70 WHERE id = $1', [cs.body.account.id]);
      const b = await session();
      const code = await kakaoCode(csub, { begin: b.session });
      const ask = await api('POST', '/v1/session', {
        token: b.session,
        body: { code: code.code, verifier: code.verifier },
      });
      assert.equal(ask.status, 409);
      assert.equal(ask.body.other.balance, 70);
      const yes = await api('POST', '/v1/session', {
        token: b.session,
        body: { code: ask.body.code, verifier: code.verifier, merge: true },
      });
      assert.equal(yes.status, 200);
      assert.equal(yes.body.merged, true);
      assert.equal(String(yes.body.account.id), b.id);
      assert.deepEqual(yes.body.logins, ['google', 'kakao']);
      const owner = (
        await pool.query("SELECT account_id FROM login WHERE service = 'kakao' AND sub = $1", [csub])
      ).rows[0];
      assert.equal(owner.account_id, b.id);
      // 카카오로 들어온 옛 기기도 합친 계정의 잔액을 본다
      const sync = await api('POST', '/v1/sync', { token: c, body: { entries: [] } });
      assert.equal(sync.body.balance, 70);
    } finally {
      await features().setFeatureMode('kakao_login', null);
    }
  });

  test('allowlist: 허용한 계정의 세션만 카카오를 연결, 브라우저 시작과 기기 토큰과 다른 계정은 403', async () => {
    await features().setFeatureMode('kakao_login', 'allowlist');
    try {
      const me = await session();
      const other = await session();
      await features().allowAccount('kakao_login', me.id);
      const st = await api(
        'GET',
        `/auth/kakao/start?port=53682&state=abcdefgh12&challenge=${'A'.repeat(43)}`,
      );
      assert.deepEqual([st.status, st.body], [403, { error: 'login' }]);
      assert.deepEqual((await kakaoCode('k-x', { begin: me.device })).body, { error: 'login' });
      assert.deepEqual((await kakaoCode('k-x', { begin: other.session })).body, { error: 'feature_off' });
      assert.deepEqual((await api('GET', '/v1/auth/providers')).body, { login: ['google'], link: [] });
      assert.deepEqual((await api('GET', '/v1/auth/providers', { token: other.session })).body.link, [
        'google',
      ]);
      assert.deepEqual((await api('GET', '/v1/auth/providers', { token: me.session })).body.link, [
        'google',
        'kakao',
      ]);
      // 내 세션으로 연 로그인의 코드를 다른 계정 세션이 바꾸려 하면 403
      const c = await kakaoCode(`k-${randomUUID()}`, { begin: me.session });
      const steal = await api('POST', '/v1/session', {
        token: other.session,
        body: { code: c.code, verifier: c.verifier },
      });
      assert.equal(steal.status, 403);
      const r = await kakaoSession(me.session, `k-${randomUUID()}`, { begin: me.session });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.logins, ['google', 'kakao']);
      // 허용을 빼면 다시 못 한다
      await features().disallowAccount('kakao_login', me.id);
      assert.equal((await kakaoCode('k-y', { begin: me.session })).status, 403);
      const listed = await features().listFeatures();
      assert.deepEqual(listed[0]?.key, 'kakao_login');
      assert.equal(listed[0]?.mode, 'allowlist');
      assert.equal(listed[0]?.from, 'db');
    } finally {
      await features().setFeatureMode('kakao_login', null);
    }
  });

  test('DB 값이 env 보다 먼저: env everyone 이어도 DB off 면 꺼진다, DB 줄을 지우면 env 로', async () => {
    const at = await otherApp({ ...config, features: { kakao_login: 'everyone' } });
    const start = `/auth/kakao/start?port=53682&state=abcdefgh12&challenge=${'A'.repeat(43)}`;
    assert.equal((await api('GET', start, { at })).status, 302);
    await pool.query("INSERT INTO feature_flag (key, mode) VALUES ('kakao_login', 'off')");
    // 다른 서버 인스턴스라 담아 둔 값이 5초 안에 풀린다
    await new Promise((r) => setTimeout(r, 5_200));
    assert.equal((await api('GET', start, { at })).status, 503);
    await pool.query("DELETE FROM feature_flag WHERE key = 'kakao_login'");
    await new Promise((r) => setTimeout(r, 5_200));
    assert.equal((await api('GET', start, { at })).status, 302);
  });

  test('카카오 교환이 실패하면 앱에 error=login, 다른 서비스의 state 는 모른다', async () => {
    await features().setFeatureMode('kakao_login', 'everyone');
    try {
      const at = await otherApp({ ...config, kakaoAuthUrl: 'http://127.0.0.1:9' });
      const st = await api(
        'GET',
        `/auth/kakao/start?port=53682&state=abcdefgh12&challenge=${'A'.repeat(43)}`,
        { at },
      );
      // 가짜 카카오가 아닌 주소(닿지 않음)로 보내므로 콜백은 교환에 실패한다
      const state = new URL(st.headers.get('location') ?? '').searchParams.get('state');
      const cb = await api('GET', `/auth/kakao/callback?state=${state}&code=zzz`, { at });
      assert.equal(new URL(cb.headers.get('location') ?? '').searchParams.get('error'), 'login');
      // 구글 콜백으로 카카오 state 를 보내면 모른다
      const st2 = await api(
        'GET',
        `/auth/kakao/start?port=53682&state=abcdefgh12&challenge=${'A'.repeat(43)}`,
      );
      const s2 = new URL(st2.headers.get('location') ?? '').searchParams.get('state');
      assert.equal((await api('GET', `/auth/google/callback?state=${s2}&code=x`)).status, 400);
    } finally {
      await features().setFeatureMode('kakao_login', null);
    }
  });
});

describe('코인 초기화 기능 키와 서버 백업 전체 상한', () => {
  const resetEntries = () => {
    const day = new Date().toISOString().slice(0, 10);
    return [
      { id: randomUUID(), reason: 'meet', amount: 10, day },
      { id: randomUUID(), reason: 'reset', amount: -10, day },
      { id: randomUUID(), reason: 'reset-items', amount: 0, day },
    ];
  };

  test('coin_reset off(기본): 초기화 기록만 feature_off 로 거절, 묶음은 200, GET /v1/features 도 false', async () => {
    await features().setFeatureMode('coin_reset', null);
    const d = await newDevice();
    const r = await api('POST', '/v1/sync', { token: d, body: { entries: resetEntries() } });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.results.map((x: { status: string; error?: string }) => [x.status, x.error ?? null]),
      [
        ['ok', null],
        ['rejected', 'feature_off'],
        ['rejected', 'feature_off'],
      ],
    );
    assert.equal(r.body.balance, 10);
    // 친구 기능 (#110) 넷도 같은 목록에 있다 (기본 allowlist 와 off: 이 계정은 목록에 없다)
    assert.deepEqual((await api('GET', '/v1/features', { token: d })).body.features, {
      kakao_login: false,
      coin_reset: false,
      calendar_link_hint: false,
      friends: false,
      friend_gifts: false,
      friend_calendar: false,
      friend_gift_passes: false,
    });
  });

  test('coin_reset allowlist 는 그 계정만, everyone 은 모두 지금처럼 초기화', async () => {
    await features().setFeatureMode('coin_reset', 'allowlist');
    try {
      const me = await session();
      const other = await session();
      await features().allowAccount('coin_reset', me.id);
      assert.equal((await api('GET', '/v1/features', { token: me.device })).body.features.coin_reset, true);
      assert.equal(
        (await api('GET', '/v1/features', { token: other.device })).body.features.coin_reset,
        false,
      );
      assert.equal((await api('GET', '/v1/features')).body.features.coin_reset, false);
      const mine = await api('POST', '/v1/sync', { token: me.device, body: { entries: resetEntries() } });
      assert.deepEqual(
        mine.body.results.map((x: { status: string }) => x.status),
        ['ok', 'ok', 'ok'],
      );
      assert.equal(mine.body.balance, 0);
      const theirs = await api('POST', '/v1/sync', {
        token: other.device,
        body: { entries: resetEntries() },
      });
      assert.equal(theirs.body.results[1].error, 'feature_off');
      await features().setFeatureMode('coin_reset', 'everyone');
      const all = await api('POST', '/v1/sync', { token: other.device, body: { entries: resetEntries() } });
      assert.equal(all.body.results[1].status, 'ok');
      assert.equal((await api('GET', '/v1/features')).body.features.coin_reset, true);
    } finally {
      await features().setFeatureMode('coin_reset', null);
    }
  });

  test('서버 백업 전체 상한(BACKUP_TOTAL_MAX_GB)을 넘으면 새 올리기는 507 storage_full, 파일은 남지 않는다', async () => {
    const used = Number((await pool.query('SELECT COALESCE(sum(size), 0) AS n FROM backup')).rows[0].n);
    const at = await otherApp({
      ...config,
      backup: { key: randomBytes(32), dir, totalMaxBytes: used + 6000 },
    });
    const s = await session();
    const before = files().length;
    const ok = await api('PUT', '/v1/backup?consent=yes', {
      token: s.session,
      raw: backupBytes('fits', 4096),
      at,
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const full = await api('PUT', '/v1/backup?consent=yes', {
      token: s.session,
      raw: backupBytes('over', 4096),
      at,
    });
    assert.equal(full.status, 507);
    assert.deepEqual(full.body, { error: 'storage_full' });
    assert.equal(files().length, before + 1);
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.part')).length, 0);
  });
});

describe('버그잡이 #112 고침', () => {
  test('1. 합치며 빠진 백업 파일은 합치자마자 디스크에서 지운다 (정리 작업을 기다리지 않는다)', async () => {
    const a = await session();
    const b = await session();
    for (const [who, m] of [
      [a, 'ma1'],
      [b, 'mb1'],
      [a, 'ma2'],
      [b, 'mb2'],
    ] as const)
      assert.equal((await put(who.session, backupBytes(m))).status, 201);
    const bSub = (await pool.query('SELECT sub FROM login WHERE account_id = $1', [b.id])).rows[0].sub;
    const v = newVerifier();
    const st = randomUUID().replaceAll('-', '');
    const from = ip();
    const start = await api('GET', `/auth/google/start?port=53682&state=${st}&challenge=${challengeOf(v)}`, {
      ip: from,
    });
    const g = new URL(start.headers.get('location') ?? '');
    lastNonce = g.searchParams.get('nonce') ?? '';
    nextGoogle = (n) => googleToken(bSub, n);
    const cb = await api('GET', `/auth/google/callback?state=${g.searchParams.get('state')}&code=x`, {
      ip: from,
    });
    const code = new URL(cb.headers.get('location') ?? '').searchParams.get('code');
    const ask = await api('POST', '/v1/session', { token: a.session, body: { code, verifier: v } });
    const yes = await api('POST', '/v1/session', {
      token: a.session,
      body: { code: ask.body.code, verifier: v, merge: true },
    });
    assert.equal(yes.body.merged, true);
    const known = new Set((await pool.query('SELECT file FROM backup')).rows.map((r) => `${r.file}.fbk`));
    assert.deepEqual(
      files().filter((f) => !known.has(f)),
      [],
      '합치며 빠진 파일이 남았다',
    );
    // 바로 탈퇴해도 남는 파일이 없다
    assert.equal((await api('DELETE', '/v1/account', { token: a.session })).status, 204);
    const after = new Set((await pool.query('SELECT file FROM backup')).rows.map((r) => `${r.file}.fbk`));
    assert.deepEqual(
      files().filter((f) => !after.has(f)),
      [],
    );
  });

  test('2. HEAD /v1/backup/:id 는 405 (받기로 치지 않는다: 마지막 접근, 횟수 그대로)', async () => {
    const s = await session();
    const up = await put(s.session, backupBytes('head'));
    const id = up.body.backup.id;
    const before = (await pool.query('SELECT last_access_at FROM backup WHERE id = $1', [id])).rows[0]
      .last_access_at;
    await new Promise((r) => setTimeout(r, 20));
    const r = await api('HEAD', `/v1/backup/${id}`, { token: s.session });
    assert.equal(r.status, 405);
    const now = (await pool.query('SELECT last_access_at FROM backup WHERE id = $1', [id])).rows[0]
      .last_access_at;
    assert.equal(now.getTime(), before.getTime());
  });

  test('3. 올리기는 느려도 끊지 않고(요청 시간 30분), 바이트가 멈추면 끊는다. 남는 파일 없음', async () => {
    assert.ok(app.getHttpServer().requestTimeout >= 30 * 60_000, '업로드 요청 시간이 짧다');
    const at = await otherApp({ ...config, backup: { key: randomBytes(32), dir, stallMs: 300 } });
    const s = await session();
    const before = readdirSync(dir).length;
    let n = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        if (n++ === 0) ctl.enqueue(backupBytes('slow', 1024));
        else {
          await new Promise((r) => setTimeout(r, 1500));
          ctl.close();
        }
      },
    });
    let status = 0;
    try {
      status = (await put(s.session, stream, true, undefined, at)).status;
    } catch {
      status = -1;
    }
    assert.notEqual(status, 201);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(readdirSync(dir).length, before, '쓰다 만 파일이 남았다');
  });
});
