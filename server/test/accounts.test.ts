// 통합 시험: 기기 계정, 코인 맞추기, 기존 잔액 옮기기, 구글 로그인(가짜 구글), 합치기, 탈퇴, 레이트리밋.
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다. 진짜 구글은 부르지 않는다(키 쌍을 만들어 id_token 을 직접 서명).
import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  type JsonWebKey,
  type KeyObject,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import type { GoogleApi } from '../src/google';
import { runMigrations, startPg } from './pg';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
let stopPg = () => {};
let pool: Pool;
let app: NestExpressApplication;
let base = '';
let config: Config;

// 가짜 구글: 시험이 만든 키로 서명한 id_token 을 돌려준다
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...(key.publicKey.export({ format: 'jwk' }) as JsonWebKey),
  kid: 'k1',
  alg: 'RS256',
  use: 'sig',
};
let nextIdToken: (nonce: string) => string = () => '';
let lastNonce = '';
// 공개 키 목록. 키 바꾸기 시험은 처음 받을 때는 옛 목록, 다시 받으면 새 목록을 준다
let jwksNow: () => JsonWebKey[] = () => [jwk];
let jwksRefreshed: (() => JsonWebKey[]) | undefined;
let jwksCalls = 0;
const fakeGoogle: GoogleApi = {
  async exchangeCode() {
    return nextIdToken(lastNonce);
  },
  async fetchJwks(o) {
    jwksCalls++;
    if (o?.refresh && jwksRefreshed) jwksNow = jwksRefreshed;
    return jwksNow();
  },
};

function idToken(claims: Record<string, unknown>, signer: KeyObject = key.privateKey, kid = 'k1'): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' });
  const body = enc(claims);
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), signer).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const goodClaims = (sub: string, nonce: string) => {
  const now = Math.floor(Date.now() / 1000);
  return { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, nonce, iat: now, exp: now + 3600 };
};

const ip = () => `10.${rand()}.${rand()}.${rand()}`;
const rand = () => Math.floor(Math.random() * 250);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// biome-ignore lint/suspicious/noExplicitAny: 시험은 응답 JSON 을 바로 읽는다
type Res = { status: number; body: any; headers: Headers };

async function api(
  method: string,
  path: string,
  o: { token?: string; body?: unknown; ip?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.ip) headers['cf-connecting-ip'] = o.ip;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: 'manual',
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

async function newDevice(age = '14+'): Promise<string> {
  const r = await api('POST', '/v1/device', { body: { age }, ip: ip() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}

type Entry = { id: string; reason: string; amount: number; day: string; ref?: string };
/** 할 일 기록(todo, early, undo)은 할 일 번호 ref 가 필요하다. 주지 않으면 새 할 일 */
const entry = (reason: string, amount: number, day = today(), ref?: string): Entry => ({
  id: randomUUID(),
  reason,
  amount,
  day,
  ...(ref !== undefined ? { ref } : ['todo', 'early', 'undo'].includes(reason) ? { ref: randomUUID() } : {}),
});

async function sync(token: string, entries: Entry[]): Promise<Res> {
  const r = await api('POST', '/v1/sync', { token, body: { entries } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}

/** 앱의 로컬 PKCE: verifier 는 앱만 갖고 start 에는 그 sha256 만 보낸다 */
const newVerifier = () => randomBytes(32).toString('base64url');
const challengeOf = (v: string) => createHash('sha256').update(v).digest('base64url');

/** 구글 로그인 한 바퀴: start → (가짜 구글) → callback → 루프백 → 일회용 코드 */
async function googleCode(
  sub: string,
  claims?: (nonce: string) => Record<string, unknown>,
  verifier = newVerifier(),
  signWith: { key: KeyObject; kid: string } = { key: key.privateKey, kid: 'k1' },
): Promise<URL> {
  const from = ip();
  const appState = randomUUID().replaceAll('-', '');
  const start = await api(
    'GET',
    `/auth/google/start?port=53682&state=${appState}&challenge=${challengeOf(verifier)}`,
    { ip: from },
  );
  assert.equal(start.status, 302);
  const google = new URL(start.headers.get('location') ?? '');
  lastNonce = google.searchParams.get('nonce') ?? '';
  nextIdToken = (nonce) =>
    idToken(claims ? claims(nonce) : goodClaims(sub, nonce), signWith.key, signWith.kid);
  const cb = await api(
    'GET',
    `/auth/google/callback?state=${google.searchParams.get('state')}&code=google-code`,
    { ip: from },
  );
  assert.equal(cb.status, 302);
  const done = new URL(cb.headers.get('location') ?? '');
  assert.equal(done.origin, 'http://127.0.0.1:53682');
  assert.equal(done.pathname, '/done');
  assert.equal(done.searchParams.get('state'), appState);
  return done;
}

async function login(token: string, sub: string, merge?: boolean): Promise<Res & { verifier: string }> {
  const verifier = newVerifier();
  const done = await googleCode(sub, undefined, verifier);
  const code = done.searchParams.get('code');
  assert.ok(code, done.toString());
  const r = await api('POST', '/v1/session', {
    token,
    body: { code, verifier, ...(merge ? { merge } : {}) },
    ip: ip(),
  });
  return { ...r, verifier };
}

before(async () => {
  const pg = await startPg();
  stopPg = pg.stop;
  await runMigrations(pg.databaseUrl);
  pool = new Pool({ connectionString: pg.databaseUrl, max: 2 });
  config = {
    port: 0,
    databaseUrl: pg.databaseUrl,
    publicUrl: 'http://127.0.0.1:1',
    googleClientId: CLIENT_ID,
    googleClientSecret: 'test-secret',
  };
  app = await createApp(config, { google: fakeGoogle });
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  await app?.close().catch(() => {});
  await pool?.end().catch(() => {});
  stopPg();
});

describe('기기 계정', () => {
  test('나이 구분 필수, 14세 미만 값은 거절, 토큰은 한 번만 주고 해시만 둔다', async () => {
    for (const age of [undefined, 'under14', '<14', '13', 14, '']) {
      const r = await api('POST', '/v1/device', { body: age === undefined ? {} : { age }, ip: ip() });
      assert.equal(r.status, 400);
      assert.deepEqual(r.body, { error: 'age' });
    }
    const r = await api('POST', '/v1/device', { body: { age: '18+' }, ip: ip() });
    assert.equal(r.status, 201);
    assert.match(r.body.token, /^fd_[A-Za-z0-9_-]{43}$/);
    assert.equal(typeof r.body.account.id, 'number');
    const row = await pool.query(
      'SELECT a.age, d.token_hash FROM device d JOIN account a ON a.id = d.account_id WHERE a.id = $1',
      [r.body.account.id],
    );
    assert.equal(row.rows[0].age, '18+');
    assert.equal(row.rows[0].token_hash.length, 32);
    // 토큰 원문은 어느 표에도 없다
    const dump = await pool.query(
      "SELECT count(*)::int AS n FROM device WHERE encode(token_hash, 'escape') LIKE $1",
      [`%${r.body.token.slice(3, 20)}%`],
    );
    assert.equal(dump.rows[0].n, 0);
  });

  test('토큰이 틀리면 401', async () => {
    const token = await newDevice();
    for (const bad of [
      undefined,
      'nope',
      `fd_${'A'.repeat(43)}`,
      `fs_${'A'.repeat(43)}`,
      `${token}x`,
      token.replace('fd_', 'fs_'),
    ]) {
      const r = await api('POST', '/v1/sync', { token: bad, body: { entries: [] } });
      assert.equal(r.status, 401, String(bad));
      assert.deepEqual(r.body, { error: 'token' });
    }
    const ok = await sync(token, []);
    assert.deepEqual(ok.body, { balance: 0, items: {}, results: [] });
  });

  test('같은 곳에서 기기 계정을 너무 많이 만들면 429', async () => {
    const from = ip();
    const codes: number[] = [];
    for (let i = 0; i < 21; i++)
      codes.push((await api('POST', '/v1/device', { body: { age: '14+' }, ip: from })).status);
    assert.deepEqual(codes.slice(0, 20), Array(20).fill(201));
    assert.equal(codes[20], 429);
  });
});

describe('코인 맞추기', () => {
  test('같은 기록을 두 번 보내도 한 번만 반영된다 (묶음 안에서도, 다음 묶음에서도)', async () => {
    const token = await newDevice();
    const e = entry('todo', 15);
    const first = await sync(token, [e, e]);
    assert.equal(first.body.balance, 15);
    assert.deepEqual(first.body.results[0], { id: e.id, status: 'ok', applied: 15 });
    assert.deepEqual(first.body.results[1], { id: e.id, status: 'ok', applied: 15, duplicate: true });
    const again = await sync(token, [e]);
    assert.equal(again.body.balance, 15);
    assert.deepEqual(again.body.results[0], { id: e.id, status: 'ok', applied: 15, duplicate: true });
  });

  test('하루 상한을 넘으면 상한까지만 (집중 100, 놀이 6, 매주 선물은 한 주 50)', async () => {
    const token = await newDevice();
    const focus = [1, 2, 3, 4, 5].map(() => entry('focus', 25));
    const r = await sync(token, focus);
    assert.deepEqual(
      r.body.results.map((x: { status: string; applied: number }) => [x.status, x.applied]),
      [
        ['ok', 25],
        ['ok', 25],
        ['ok', 25],
        ['ok', 25],
        ['capped', 0],
      ],
    );
    assert.equal(r.body.balance, 100);
    // 다른 날은 따로 센다
    const yesterday = await sync(token, [entry('focus', 25, daysAgo(1))]);
    assert.equal(yesterday.body.results[0].status, 'ok');
    const play = await sync(token, [entry('play', 4), entry('play', 4)]);
    assert.deepEqual(play.body.results[1], {
      id: play.body.results[1].id,
      status: 'capped',
      applied: 2,
      error: 'cap',
    });
    const weekly = await sync(token, [entry('weekly', 50), entry('weekly', 50)]);
    assert.equal(weekly.body.results[0].applied, 50);
    assert.equal(weekly.body.results[1].applied, 0);
    assert.equal(weekly.body.balance, 100 + 25 + 6 + 50);
  });

  test('규칙에 없는 값, 모르는 까닭, 오래된 날짜는 그 기록만 거절', async () => {
    const token = await newDevice();
    const r = await sync(token, [
      entry('todo', 16),
      entry('todo', -15),
      entry('gift-from-nowhere', 100),
      entry('todo', 15, daysAgo(40)),
      entry('todo', 15, '2026-02-30'),
      entry('todo', 15),
    ]);
    assert.deepEqual(
      r.body.results.map((x: { status: string; error?: string }) => [x.status, x.error]),
      [
        ['rejected', 'amount'],
        ['rejected', 'amount'],
        ['rejected', 'reason'],
        ['rejected', 'day'],
        ['rejected', 'day'],
        ['ok', undefined],
      ],
    );
    assert.equal(r.body.balance, 15);
    // 모양이 틀린 묶음은 통째로 400
    const bad = await api('POST', '/v1/sync', {
      token,
      body: { entries: [{ id: 'x', reason: 'todo', amount: 1, day: today() }] },
    });
    assert.equal(bad.status, 400);
    const many = await api('POST', '/v1/sync', {
      token,
      body: { entries: Array(501).fill(entry('todo', 1)) },
    });
    assert.equal(many.status, 400);
  });

  test('잔액이 모자라면 그 구매만 거절, 값이 틀리거나 이미 가진 물건도 거절, 되돌리기는 잔액까지만', async () => {
    const token = await newDevice();
    await sync(token, [entry('todo', 15), entry('todo', 15)]);
    const yarn = entry('toy:yarn', -60);
    const ball = entry('toy:ball', -30);
    const r = await sync(token, [
      yarn,
      ball,
      entry('toy:ball', -30),
      entry('toy:cushion', -1),
      entry('house:2', -500),
    ]);
    assert.deepEqual(
      r.body.results.map((x: { status: string; error?: string }) => [x.status, x.error]),
      [
        ['rejected', 'insufficient'],
        ['ok', undefined],
        ['rejected', 'owned'],
        ['rejected', 'price'],
        ['rejected', 'owned'],
      ],
    );
    assert.equal(r.body.balance, 0);
    assert.deepEqual(r.body.items, { 'toy:ball': 1 });
    // 거절된 구매를 다시 보내도 처음 결과 그대로 (잔액이 생겨도 늦게 반영하지 않는다)
    await sync(token, [entry('todo', 15), entry('todo', 15), entry('todo', 15), entry('todo', 15)]);
    const again = await sync(token, [yarn]);
    assert.deepEqual(again.body.results[0], {
      id: yarn.id,
      status: 'rejected',
      applied: 0,
      error: 'insufficient',
      duplicate: true,
    });
    assert.equal(again.body.balance, 60);
    const undo = await sync(token, [entry('reset', -100), entry('food', -5)]);
    assert.deepEqual(undo.body.results[0].applied, -60);
    assert.equal(undo.body.results[0].status, 'capped');
    assert.deepEqual(undo.body.results[1].error, 'insufficient');
    assert.equal(undo.body.balance, 0);
  });
});

describe('기존 잔액 옮기기', () => {
  test('기기마다 한 번, 상한까지, 물건은 아는 것만', async () => {
    const token = await newDevice();
    const bad = await api('POST', '/v1/migrate', {
      token,
      body: { balance: 10, items: { 'toy:rocket': 1 } },
    });
    assert.equal(bad.status, 400);
    const neg = await api('POST', '/v1/migrate', { token, body: { balance: -1 } });
    assert.equal(neg.status, 400);
    const r = await api('POST', '/v1/migrate', {
      token,
      body: { balance: 345, items: { house: 2, 'toy:ball': 1, 'house-style:igloo': 1 } },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      balance: 345,
      items: { house: 2, 'house-style:igloo': 1, 'toy:ball': 1 },
      applied: 345,
      status: 'ok',
    });
    const twice = await api('POST', '/v1/migrate', { token, body: { balance: 345 } });
    assert.equal(twice.status, 409);
    assert.deepEqual(twice.body, { error: 'already_migrated' });
    // 다음 집 단계는 옮긴 단계 다음부터
    const house = await sync(token, [entry('house:3', -1000), entry('house:2', -500)]);
    assert.deepEqual(
      house.body.results.map((x: { error?: string }) => x.error),
      ['insufficient', 'owned'],
    );

    const big = await newDevice();
    const capped = await api('POST', '/v1/migrate', { token: big, body: { balance: 999_999 } });
    assert.equal(capped.body.applied, 10_000);
    assert.equal(capped.body.status, 'capped');
  });
});

describe('구글 로그인', () => {
  test('시작: 포트와 state 검사, 구글 주소는 openid 만, PKCE 와 nonce', async () => {
    for (const q of [
      'port=80&state=abcdefgh',
      'port=70000&state=abcdefgh',
      'port=x&state=abcdefgh',
      'port=5000&state=a',
      'port=5000',
    ]) {
      const r = await api('GET', `/auth/google/start?${q}&challenge=${challengeOf(newVerifier())}`, {
        ip: ip(),
      });
      assert.equal(r.status, 400, q);
    }
    // 앱의 challenge 가 없거나 모양이 틀리면 400
    for (const c of ['', '&challenge=short', `&challenge=${'A'.repeat(42)}!`]) {
      const r = await api('GET', `/auth/google/start?port=5000&state=abcdefgh${c}`, { ip: ip() });
      assert.equal(r.status, 400, c);
      assert.deepEqual(r.body, { error: 'challenge' });
    }
    const r = await api(
      'GET',
      `/auth/google/start?port=5000&state=abcdefgh&challenge=${challengeOf(newVerifier())}`,
      { ip: ip() },
    );
    assert.equal(r.status, 302);
    const u = new URL(r.headers.get('location') ?? '');
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('scope'), 'openid');
    assert.equal(u.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:1/auth/google/callback');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(u.searchParams.get('nonce'));
    assert.notEqual(u.searchParams.get('state'), 'abcdefgh');
  });

  test('돌아오기: 모르는 state 는 400, id_token 이 틀리면 앱에 error 로 알린다', async () => {
    const unknown = await api('GET', '/auth/google/callback?state=nope&code=x', { ip: ip() });
    assert.equal(unknown.status, 400);
    const cases: ((n: string) => Record<string, unknown>)[] = [
      (n) => ({ ...goodClaims('s', n), aud: 'someone-else' }),
      (n) => ({ ...goodClaims('s', n), iss: 'https://evil.example' }),
      (n) => ({ ...goodClaims('s', n), exp: Math.floor(Date.now() / 1000) - 3600 }),
      (n) => ({ ...goodClaims('s', n), nonce: `${n}x` }),
    ];
    for (const c of cases) {
      const done = await googleCode('s', c);
      assert.equal(done.searchParams.get('error'), 'login');
      assert.equal(done.searchParams.get('code'), null);
    }
    // 다른 키로 서명
    const from = ip();
    const start = await api(
      'GET',
      `/auth/google/start?port=5000&state=abcdefgh&challenge=${challengeOf(newVerifier())}`,
      { ip: from },
    );
    const g = new URL(start.headers.get('location') ?? '');
    lastNonce = g.searchParams.get('nonce') ?? '';
    nextIdToken = (n) => idToken(goodClaims('s', n), otherKey.privateKey);
    const cb = await api('GET', `/auth/google/callback?state=${g.searchParams.get('state')}&code=c`, {
      ip: from,
    });
    assert.equal(new URL(cb.headers.get('location') ?? '').searchParams.get('error'), 'login');
    // 같은 state 는 한 번만
    const reuse = await api('GET', `/auth/google/callback?state=${g.searchParams.get('state')}&code=c`, {
      ip: from,
    });
    assert.equal(reuse.status, 400);
  });

  test('처음 보는 로그인은 기기 계정에 붙고, 일회용 코드는 한 번만, 세션 토큰으로도 맞춘다', async () => {
    const token = await newDevice();
    await sync(token, [entry('todo', 15)]);
    const verifier = newVerifier();
    const done = await googleCode('sub-first', undefined, verifier);
    const code = done.searchParams.get('code');
    const r = await api('POST', '/v1/session', { token, body: { code, verifier }, ip: ip() });
    assert.equal(r.status, 200);
    assert.match(r.body.session, /^fs_/);
    assert.equal(r.body.merged, false);
    assert.equal(r.body.linked, true);
    const reuse = await api('POST', '/v1/session', { token, body: { code, verifier }, ip: ip() });
    assert.equal(reuse.status, 400);
    assert.deepEqual(reuse.body, { error: 'code' });
    const viaSession = await sync(r.body.session, []);
    assert.equal(viaSession.body.balance, 15);
    // 옮기기는 계정(과 그 로그인)마다 한 번: 세션으로 했으면 기기 토큰으로 다시 못 한다
    const m = await api('POST', '/v1/migrate', { token: r.body.session, body: { balance: 1 } });
    assert.equal(m.status, 200);
    assert.equal((await api('POST', '/v1/migrate', { token, body: { balance: 1 } })).status, 409);
    // 로그인 표에는 sub 만
    const row = await pool.query("SELECT * FROM login WHERE sub = 'sub-first'");
    assert.deepEqual(Object.keys(row.rows[0]).sort(), ['account_id', 'created_at', 'service', 'sub']);
  });

  test('합치기: 기기 계정으로 이미 있는 계정에 로그인하면 묻지 않고 합친다 (코인 더하기, 물건 큰 쪽)', async () => {
    const a = await newDevice();
    await sync(a, [entry('todo', 15), entry('todo', 15), entry('toy:ball', -30), entry('todo', 15)]);
    await api('POST', '/v1/migrate', { token: a, body: { balance: 0, items: { house: 1 } } });
    assert.equal((await login(a, 'sub-merge')).status, 200);

    const b = await newDevice();
    await api('POST', '/v1/migrate', {
      token: b,
      body: { balance: 250, items: { house: 2, 'house-style:castle': 1 } },
    });
    const shared = entry('focus', 25);
    await sync(b, [shared]);
    const r = await login(b, 'sub-merge');
    assert.equal(r.status, 200);
    assert.equal(r.body.merged, true);

    const after = await sync(b, []);
    assert.equal(after.body.balance, 15 + 275);
    assert.deepEqual(after.body.items, { house: 2, 'house-style:castle': 1, 'toy:ball': 1 });
    assert.deepEqual((await sync(a, [])).body, after.body);
    // 합쳐진 계정의 옛 기록을 다시 보내도 다시 반영하지 않는다
    const resend = await sync(a, [shared]);
    assert.equal(resend.body.results[0].duplicate, true);
    assert.equal(resend.body.balance, 290);
    // 같은 로그인으로 다시 해도 세션만 새로
    const again = await login(a, 'sub-merge');
    assert.equal(again.body.merged, false);
    assert.equal(again.body.linked, false);
  });

  test('두 기기가 같은 계정으로 동시에 맞춰도 잔액과 상한이 맞다', async () => {
    const c = await newDevice();
    const d = await newDevice();
    assert.equal((await login(c, 'sub-race')).status, 200);
    assert.equal((await login(d, 'sub-race')).body.merged, true);
    await sync(
      c,
      Array.from({ length: 20 }, () => entry('todo', 15)),
    );

    // 300 코인에서 200 짜리와 300 짜리를 동시에: 하나만 된다
    const [x, y] = await Promise.all([
      sync(c, [entry('house:1', -200)]),
      sync(d, [entry('house-style:mushroom', -300)]),
    ]);
    const statuses = [x.body.results[0].status, y.body.results[0].status].sort();
    assert.deepEqual(statuses, ['ok', 'rejected']);
    const balance = (await sync(c, [])).body.balance;
    assert.ok(balance === 100 || balance === 0, String(balance));

    // 집중 상한 100 을 두 기기가 나눠 동시에 넘겨도 합은 100
    const before = balance;
    await Promise.all([
      sync(c, [entry('focus', 25), entry('focus', 25), entry('focus', 25)]),
      sync(d, [entry('focus', 25), entry('focus', 25), entry('focus', 25)]),
    ]);
    // 같은 기록을 두 기기가 동시에 보내도 한 번
    const same = entry('meet', 10);
    await Promise.all([sync(c, [same]), sync(d, [same])]);
    const end = await sync(d, []);
    assert.equal(end.body.balance, before + 100 + 10);

    // 정본 잔액은 장부 합과 같다
    const check = await pool.query(
      `SELECT a.id, a.balance, COALESCE(SUM(e.amount), 0) AS s FROM account a
         LEFT JOIN coin_entry e ON e.account_id = a.id WHERE a.closed_at IS NULL GROUP BY a.id HAVING a.balance <> COALESCE(SUM(e.amount), 0)`,
    );
    assert.deepEqual(check.rows, []);
  });

  test('합치기: 로그인한 계정에서 다른 계정의 로그인을 쓰면 묻고, 확인하면 지금 계정에 합친다', async () => {
    const e = await newDevice();
    await sync(e, [entry('todo', 15)]);
    assert.equal((await login(e, 'sub-e')).status, 200);
    const f = await newDevice();
    await sync(f, [entry('todo', 15), entry('todo', 15)]);
    assert.equal((await login(f, 'sub-f')).status, 200);

    const ask = await login(f, 'sub-e');
    assert.equal(ask.status, 409);
    assert.equal(ask.body.error, 'merge_needed');
    assert.deepEqual(ask.body.current, { balance: 30, items: {} });
    assert.deepEqual(ask.body.other, { balance: 15, items: {} });
    assert.equal((await sync(e, [])).body.balance, 15);

    const yes = await api('POST', '/v1/session', {
      token: f,
      body: { code: ask.body.code, verifier: ask.verifier, merge: true },
      ip: ip(),
    });
    assert.equal(yes.status, 200);
    assert.equal(yes.body.merged, true);
    const fId = (await pool.query("SELECT account_id FROM login WHERE sub = 'sub-f'")).rows[0].account_id;
    assert.equal(String(yes.body.account.id), fId);
    assert.equal((await sync(e, [])).body.balance, 45);
    const logins = await pool.query('SELECT sub FROM login WHERE account_id = $1 ORDER BY sub', [fId]);
    assert.deepEqual(
      logins.rows.map((r) => r.sub),
      ['sub-e', 'sub-f'],
    );
  });
});

describe('탈퇴', () => {
  test('바로 지우고(코인 내역, 기기, 로그인, 세션, 합쳐진 계정까지) 토큰은 무효', async () => {
    const g = await newDevice();
    await sync(g, [entry('todo', 15)]);
    const s = (await login(g, 'sub-bye')).body.session;
    const h = await newDevice();
    await sync(h, [entry('todo', 15)]);
    await login(h, 'sub-bye');
    const id = (await pool.query("SELECT account_id FROM login WHERE sub = 'sub-bye'")).rows[0].account_id;

    const r = await api('DELETE', '/v1/account', { token: s });
    assert.equal(r.status, 204);
    for (const t of [g, h, s])
      assert.equal((await api('POST', '/v1/sync', { token: t, body: { entries: [] } })).status, 401);
    const left = await pool.query(
      `SELECT (SELECT count(*) FROM account WHERE id = $1 OR merged_into = $1)::int AS a,
              (SELECT count(*) FROM login WHERE sub = 'sub-bye')::int AS l,
              (SELECT count(*) FROM coin_entry e WHERE NOT EXISTS (SELECT 1 FROM account x WHERE x.id = e.account_id))::int AS orphans`,
      [id],
    );
    assert.deepEqual(left.rows[0], { a: 0, l: 0, orphans: 0 });
    // 같은 구글 계정으로 다시 오면 새로 붙는다
    const again = await newDevice();
    assert.equal((await login(again, 'sub-bye')).body.linked, true);
  });
});

describe('구글 설정이 비면', () => {
  test('로그인 경로는 503 으로 꺼진다', async () => {
    const off = await createApp(
      { ...config, googleClientId: '', googleClientSecret: '' },
      { google: fakeGoogle },
    );
    await off.listen(0, '127.0.0.1');
    try {
      const addr = off.getHttpServer().address();
      const b = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      const start = await fetch(
        `${b}/auth/google/start?port=5000&state=abcdefgh&challenge=${challengeOf(newVerifier())}`,
        {
          redirect: 'manual',
        },
      );
      assert.equal(start.status, 503);
      const cb = await fetch(`${b}/auth/google/callback?state=x&code=y`, { redirect: 'manual' });
      assert.equal(cb.status, 503);
      const dev = await fetch(`${b}/v1/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip() },
        body: JSON.stringify({ age: '14+' }),
      });
      const { token } = (await dev.json()) as { token: string };
      const session = await fetch(`${b}/v1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: 'x' }),
      });
      assert.equal(session.status, 503);
    } finally {
      await off.close();
    }
  });
});

describe('검토 고침 (#106)', () => {
  test('1. 잔액이 3,000 을 넘어도 초기화와 되돌리기는 잔액까지 뺀다', async () => {
    const t = await newDevice();
    const m = await api('POST', '/v1/migrate', { token: t, body: { balance: 5000 } });
    assert.equal(m.body.balance, 5000);
    const r = await sync(t, [entry('reset', -5000)]);
    assert.deepEqual([r.body.results[0].status, r.body.results[0].applied], ['ok', -5000]);
    assert.equal(r.body.balance, 0);
  });

  test('2. 할 일 상한은 그날 코인 받은 서로 다른 할 일 수(20)로 센다, 되돌리기는 실제로 받은 만큼만', async () => {
    const t = await newDevice();
    // 같은 할 일을 끝내고 되돌리기를 25번 되풀이해도 그날 새 할 일은 막히지 않는다
    for (let i = 0; i < 25; i++)
      await sync(t, [entry('todo', 15, today(), 'same'), entry('undo', -15, today(), 'same')]);
    const fresh = await sync(t, [entry('todo', 15)]);
    assert.deepEqual([fresh.body.results[0].status, fresh.body.results[0].applied], ['ok', 15]);
    // 서로 다른 할 일은 그날 20개까지 (same 과 fresh 로 둘을 이미 셌다)
    const many = await sync(
      t,
      Array.from({ length: 19 }, () => entry('todo', 15)),
    );
    const statuses = many.body.results.map((x: { status: string }) => x.status);
    assert.equal(statuses.filter((s: string) => s === 'capped').length, 1);
    const balance = many.body.balance;
    // 상한에 걸려 0 을 받은 할 일을 되돌리면 아무것도 빼지 않는다
    const capRef = randomUUID();
    const c2 = await sync(t, [entry('todo', 15, today(), capRef)]);
    assert.equal(c2.body.results[0].applied, 0);
    const u = await sync(t, [entry('undo', -15, today(), capRef)]);
    assert.equal(u.body.results[0].applied, 0);
    assert.equal(u.body.balance, balance);
    // 할 일 기록에는 ref 가 있어야 한다
    const noRef = await sync(t, [{ id: randomUUID(), reason: 'todo', amount: 15, day: today() }]);
    assert.deepEqual([noRef.body.results[0].status, noRef.body.results[0].error], ['rejected', 'ref']);
  });

  test('3. 범위를 넘는 양은 그 기록만 거절, 옮기기는 상한까지 (500 이 아니다)', async () => {
    const t = await newDevice();
    const r = await sync(t, [entry('focus', 1e15), entry('food', -1e15), entry('focus', 10)]);
    assert.deepEqual(
      r.body.results.map((x: { status: string; error?: string }) => [x.status, x.error]),
      [
        ['rejected', 'amount'],
        ['rejected', 'amount'],
        ['ok', undefined],
      ],
    );
    const m = await api('POST', '/v1/migrate', { token: t, body: { balance: 1e20 } });
    assert.equal(m.status, 200);
    assert.deepEqual([m.body.applied, m.body.status], [10_000, 'capped']);
  });

  test('4. 옮기기는 합쳐도 계정에 10,000 까지, 계정이 생기기 전 날짜는 받지 않는다', async () => {
    const a = await newDevice();
    assert.equal((await api('POST', '/v1/migrate', { token: a, body: { balance: 8000 } })).status, 200);
    assert.equal((await login(a, 'sub-mint')).status, 200);
    const b = await newDevice();
    assert.equal((await api('POST', '/v1/migrate', { token: b, body: { balance: 5000 } })).status, 200);
    const r = await login(b, 'sub-mint');
    assert.equal(r.body.merged, true);
    assert.equal((await sync(a, [])).body.balance, 10_000);
    // 합친 뒤에는 어느 기기로도 다시 옮기지 못한다
    assert.equal((await api('POST', '/v1/migrate', { token: b, body: { balance: 1 } })).status, 409);
    assert.equal(
      (await api('POST', '/v1/migrate', { token: r.body.session, body: { balance: 1 } })).status,
      409,
    );
    // 새 기기 계정은 만든 날(시간대 여유 하루) 전 날짜를 받지 않는다
    const n = await newDevice();
    const old = await sync(n, [entry('focus', 25, daysAgo(5)), entry('focus', 25, daysAgo(1))]);
    assert.deepEqual(
      old.body.results.map((x: { status: string; error?: string }) => [x.status, x.error]),
      [
        ['rejected', 'day'],
        ['ok', undefined],
      ],
    );
  });

  test('5. 서로의 로그인으로 동시에 합쳐도 교착 없이 끝난다', async () => {
    const x = await newDevice();
    const y = await newDevice();
    await sync(x, [entry('todo', 15)]);
    await sync(y, [entry('todo', 15), entry('todo', 15)]);
    assert.equal((await login(x, 'sub-x')).status, 200);
    assert.equal((await login(y, 'sub-y')).status, 200);
    const askX = await login(x, 'sub-y');
    const askY = await login(y, 'sub-x');
    assert.equal(askX.status, 409);
    assert.equal(askY.status, 409);
    const body = (a: typeof askX) => ({ code: a.body.code, verifier: a.verifier, merge: true });
    const [rx, ry] = await Promise.all([
      api('POST', '/v1/session', { token: x, body: body(askX), ip: ip() }),
      api('POST', '/v1/session', { token: y, body: body(askY), ip: ip() }),
    ]);
    assert.ok(rx.status < 500 && ry.status < 500, JSON.stringify([rx.status, rx.body, ry.status, ry.body]));
    assert.equal((await sync(x, [])).body.balance, 45);
    assert.equal((await sync(y, [])).body.balance, 45);
  });

  test('6. 처음 보는 sub 로 두 기기가 동시에 로그인해도 한쪽은 합쳐진다 (500 이 아니다)', async () => {
    const p = await newDevice();
    const q = await newDevice();
    await sync(p, [entry('todo', 15)]);
    await sync(q, [entry('todo', 15)]);
    const vp = newVerifier();
    const vq = newVerifier();
    const cp = (await googleCode('sub-same-time', undefined, vp)).searchParams.get('code');
    const cq = (await googleCode('sub-same-time', undefined, vq)).searchParams.get('code');
    const [rp, rq] = await Promise.all([
      api('POST', '/v1/session', { token: p, body: { code: cp, verifier: vp }, ip: ip() }),
      api('POST', '/v1/session', { token: q, body: { code: cq, verifier: vq }, ip: ip() }),
    ]);
    assert.deepEqual([rp.status, rq.status], [200, 200], JSON.stringify([rp.body, rq.body]));
    assert.deepEqual([rp.body.merged, rq.body.merged].sort(), [false, true]);
    assert.equal((await sync(p, [])).body.balance, 30);
  });

  test('7. 같은 곳에서 대기 로그인을 너무 많이 열면 429', async () => {
    const from = ip();
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) {
      const q = `port=5000&state=abcdefgh&challenge=${challengeOf(newVerifier())}`;
      codes.push((await api('GET', `/auth/google/start?${q}`, { ip: from })).status);
    }
    assert.deepEqual(codes.slice(0, 20), Array(20).fill(302));
    assert.equal(codes[20], 429);
  });

  test('8. 화해는 7일에 한 번, 만난 날은 7일 120, 여정은 계정 평생 21', async () => {
    const t = await newDevice();
    const mk = await sync(t, [entry('makeup', 28, daysAgo(1)), entry('makeup', 28)]);
    assert.deepEqual(
      mk.body.results.map((x: { applied: number }) => x.applied),
      [28, 0],
    );
    const meet = await sync(t, [entry('meet', 60, daysAgo(1)), entry('meet', 60)]);
    assert.deepEqual(
      meet.body.results.map((x: { applied: number }) => x.applied),
      [60, 60],
    );
    // 7일 안에 120 을 다 받았다 (내일 날짜로 보내도)
    const meet3 = await sync(t, [entry('meet', 10, daysAgo(-1))]);
    assert.equal(meet3.body.results[0].applied, 0);
    const j = await sync(t, [
      ...Array.from({ length: 4 }, () => entry('journey', 3, daysAgo(1))),
      ...Array.from({ length: 4 }, () => entry('journey', 3)),
    ]);
    assert.equal(
      j.body.results.reduce((n: number, x: { applied: number }) => n + x.applied, 0),
      21,
    );
  });

  test('9. 세션 바꾸기는 start 때 보낸 challenge 의 verifier 가 맞아야 한다 (틀리면 코드도 버린다)', async () => {
    const t = await newDevice();
    const code = (await googleCode('sub-pkce')).searchParams.get('code');
    const none = await api('POST', '/v1/session', { token: t, body: { code }, ip: ip() });
    assert.deepEqual([none.status, none.body], [400, { error: 'verifier' }]);
    const v2 = newVerifier();
    const code2 = (await googleCode('sub-pkce', undefined, v2)).searchParams.get('code');
    const wrong = await api('POST', '/v1/session', {
      token: t,
      body: { code: code2, verifier: newVerifier() },
      ip: ip(),
    });
    assert.deepEqual([wrong.status, wrong.body], [400, { error: 'verifier' }]);
    const late = await api('POST', '/v1/session', {
      token: t,
      body: { code: code2, verifier: v2 },
      ip: ip(),
    });
    assert.deepEqual([late.status, late.body], [400, { error: 'code' }]);
  });

  test('10. 구글이 키를 바꿨으면(kid 없음) 공개 키를 한 번 다시 받는다', async () => {
    const newKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk2 = { ...(newKey.publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k2', alg: 'RS256' };
    jwksRefreshed = () => [jwk, jwk2];
    jwksCalls = 0;
    try {
      const t = await newDevice();
      const v = newVerifier();
      const done = await googleCode('sub-rotate', undefined, v, { key: newKey.privateKey, kid: 'k2' });
      assert.equal(done.searchParams.get('error'), null, done.toString());
      assert.equal(jwksCalls, 2);
      const code = done.searchParams.get('code');
      const r = await api('POST', '/v1/session', { token: t, body: { code, verifier: v }, ip: ip() });
      assert.equal(r.status, 200);
    } finally {
      jwksNow = () => [jwk];
      jwksRefreshed = undefined;
    }
  });
});

describe('재검토 고침 (#106)', () => {
  test('1. 7일 상한은 그 날짜를 품은 모든 7일 창에서 본다 (날짜를 거꾸로 보내도)', async () => {
    const t = await newDevice();
    const meet = await sync(t, [
      entry('meet', 60, daysAgo(-1)),
      entry('meet', 60),
      entry('meet', 60, daysAgo(1)),
    ]);
    assert.deepEqual(
      meet.body.results.map((x: { applied: number }) => x.applied),
      [60, 60, 0],
    );
    const mk = await sync(t, [entry('makeup', 28, daysAgo(-1)), entry('makeup', 28, daysAgo(1))]);
    assert.deepEqual(
      mk.body.results.map((x: { applied: number }) => x.applied),
      [28, 0],
    );
  });

  test('2. 마감 전 보너스 하루 상한은 서로 다른 할 일 수로 센다', async () => {
    const t = await newDevice();
    for (let i = 0; i < 25; i++)
      await sync(t, [
        entry('todo', 15, today(), 'loop'),
        entry('early', 5, today(), 'loop'),
        entry('undo', -20, today(), 'loop'),
      ]);
    const b = randomUUID();
    const r = await sync(t, [entry('todo', 15, today(), b), entry('early', 5, today(), b)]);
    assert.deepEqual(
      r.body.results.map((x: { applied: number }) => x.applied),
      [15, 5],
    );
  });

  test('3. 합친 계정의 기록도 하루, 할 일, 평생 상한에 센다', async () => {
    const x = await newDevice();
    assert.equal((await login(x, 'sub-family')).status, 200);
    const y = await newDevice();
    await sync(y, [
      ...Array.from({ length: 20 }, () => entry('todo', 15)),
      ...Array.from({ length: 7 }, () => entry('journey', 3)),
      entry('focus', 25),
      entry('focus', 25),
      entry('focus', 25),
      entry('focus', 25),
    ]);
    assert.equal((await login(y, 'sub-family')).body.merged, true);
    const r = await sync(x, [entry('todo', 15), entry('journey', 3), entry('focus', 25)]);
    assert.deepEqual(
      r.body.results.map((v: { applied: number }) => v.applied),
      [0, 0, 0],
    );
  });
});
