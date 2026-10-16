// 통합 시험 (이슈 #120): 업데이트 세 단계의 서버 관문. 운영자가 저장한 기준이 바로 426 으로 나오는지,
// 머리 없음과 깨진 값, 예외 경로, 최신 릴리스보다 높은 값과 순서 거절, 앱 판 분포. 진짜 GitHub 은 부르지 않는다
// (최신 릴리스는 이 시험이 띄운 가짜 릴리스 주소가 준다).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = 'c'.repeat(20) + randomUUID().replaceAll('-', '');
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
const LATEST = '0.5.0';
let h: Harness;
let release: Server;
let adminSession = '';
/** 가벼운 기기 토큰 (내 계정 보기처럼 토큰이 필요한 예외 경로를 부를 때) */
let anyToken = '';
const { api, newDevice, session } = client(() => h);

const hdr = (v?: string): Record<string, string> => (v === undefined ? {} : { 'x-fairy-version': v });
/** 기능 하나 (GET /v1/features): 막히면 426, 통과하면 200 */
const feature = (v?: string) => api('GET', '/v1/features', { headers: hdr(v) });
/** 운영자가 세 기준을 저장한다 (빈 칸은 지운다). 짧은 이름을 운영자 폼 칸 이름으로 바꾼다 */
const save = (b: { min?: string; restrict?: string; recommend?: string; confirm?: string }) =>
  api('POST', '/v1/admin/versions', {
    token: adminSession,
    body: {
      minVersion: b.min,
      // 기능 제한 칸은 빈 글로 지운다 (칸이 아예 없으면 기존 값을 둔다, admin.ts saveVersions)
      restrictVersion: b.restrict ?? '',
      recommendVersion: b.recommend,
      confirm: b.confirm,
    },
  });

before(async () => {
  release = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        tag_name: `v${LATEST}`,
        html_url: 'https://github.com/milcho0604/fairy-releases/releases/latest',
      }),
    );
  });
  await new Promise<void>((r) => release.listen(0, '127.0.0.1', r));
  const port = (release.address() as AddressInfo).port;
  h = await startHarness({
    adminToken: ADMIN_TOKEN,
    adminSubs: [ADMIN_SUB],
    releasesApi: `http://127.0.0.1:${port}/latest`,
  });
  const admin = await newDevice('18+', '운영자');
  adminSession = await session(admin.id, ADMIN_SUB);
  anyToken = (await newDevice('18+', '공용계정')).token;
});

after(async () => {
  await h?.stop();
  release?.close();
});

describe('운영자 저장과 검사', () => {
  test('최신 릴리스보다 높은 기준은 거절한다 (앱이 풀 수 없다)', async () => {
    const r = await save({ restrict: '0.6.0', confirm: 'yes' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'too_high');
  });

  test('올릴 때는 확인 칸이 있어야 한다 (기능 제한, 강제)', async () => {
    const r = await save({ restrict: '0.4.4' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'confirm');
    assert.equal((await save({ min: '0.4.0' })).body.code, 'confirm');
  });

  test('순서가 어긋나면 거절한다 (강제 ≤ 기능 제한 ≤ 권장)', async () => {
    const r = await save({ min: '0.4.5', restrict: '0.4.4', confirm: 'yes' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'order');
    assert.equal((await save({ restrict: '0.4.4', recommend: '0.4.3', confirm: 'yes' })).body.code, 'order');
  });
});

describe('기능 제한 (restrict) 한 단계만', () => {
  test('저장하면 바로 적용된다: 머리 없음, 낮은 판은 426, 같은 판과 높은 판은 통과', async () => {
    assert.equal((await save({ restrict: '0.4.4', confirm: 'yes' })).status, 200);
    const none = await feature();
    assert.equal(none.status, 426);
    assert.deepEqual(none.body, { error: 'update_required', need: '0.4.4', level: 'restrict' });
    const old = await feature('0.4.3');
    assert.equal(old.status, 426);
    assert.equal(old.body.level, 'restrict');
    assert.equal((await feature('0.4.4')).status, 200);
    assert.equal((await feature('0.4.5')).status, 200);
    assert.equal((await feature('0.10.0')).status, 200);
  });

  test('머리가 깨졌으면 낮은 판으로 본다', async () => {
    assert.equal((await feature('abc')).status, 426);
    assert.equal((await feature('0.4')).status, 426);
  });

  test('예외 경로는 머리와 상관없이 막히지 않는다', async () => {
    assert.equal((await api('GET', '/health')).status, 200);
    const notices = await api('GET', '/v1/notices.json');
    assert.equal(notices.status, 200);
    assert.equal(notices.body.restrictVersion, '0.4.4');
    assert.equal((await api('GET', '/v1/events.json')).status, 200);
    const me = await api('GET', '/v1/me', { token: anyToken, headers: hdr('0.1.0') });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.update, { recommend: null, restrict: '0.4.4', min: null });
    assert.equal((await api('GET', '/v1/auth/providers', { headers: hdr() })).status, 200);
    assert.equal(
      (await api('GET', '/v1/admin/overview', { token: adminSession, headers: hdr() })).status,
      200,
    );
    // 로그인 완료는 막히지 않는다 (잘못된 본문이라 400 이면 된다)
    assert.notEqual((await api('POST', '/v1/session', { headers: hdr(), body: {} })).status, 426);
  });

  test('계정을 만드는 요청은 막힌다 (기기 계정을 옛 앱이 만들지 못한다)', async () => {
    const r = await api('POST', '/v1/device', { headers: hdr('0.4.3'), body: { age: '18+' } });
    assert.equal(r.status, 426);
    const ok = await api('POST', '/v1/device', { headers: hdr('0.4.4'), body: { age: '18+' } });
    assert.equal(ok.status, 201);
  });
});

describe('강제 (min) 와 기능 제한을 같이', () => {
  test('강제 기준보다 낮으면 force, 강제 기준과 같으면 기능 제한 기준으로 본다', async () => {
    assert.equal((await save({ min: '0.4.0', restrict: '0.4.4', confirm: 'yes' })).status, 200);
    const under = await feature('0.3.9');
    assert.equal(under.status, 426);
    assert.deepEqual(under.body, { error: 'update_required', need: '0.4.0', level: 'force' });
    assert.deepEqual((await feature('0.4.0')).body, {
      error: 'update_required',
      need: '0.4.4',
      level: 'restrict',
    });
    assert.deepEqual((await feature()).body, { error: 'update_required', need: '0.4.0', level: 'force' });
    assert.equal((await feature('0.4.4')).status, 200);
    assert.equal(
      (await api('GET', '/v1/me', { token: anyToken, headers: hdr('0.3.9') })).body.update.min,
      '0.4.0',
    );
  });

  test('기준을 모두 지우면 모두 통과한다', async () => {
    assert.equal((await save({ confirm: 'yes' })).status, 200);
    assert.equal((await feature()).status, 200);
    assert.equal((await feature('0.0.1')).status, 200);
    assert.deepEqual((await api('GET', '/v1/me', { token: anyToken })).body.update, {
      recommend: null,
      restrict: null,
      min: null,
    });
  });
});

describe('저장 칸의 뜻과 판 맞춤 (PR #127 버그잡이)', () => {
  test('기능 제한 칸이 아예 없으면 기존 값을 둔다, 빈 글이면 지운다', async () => {
    assert.equal((await save({ restrict: '0.4.4', confirm: 'yes' })).status, 200);
    // 칸 없이 강제 칸만 저장 (옛 폼): 기능 제한은 그대로
    const keep = await api('POST', '/v1/admin/versions', {
      token: adminSession,
      body: { minVersion: '0.4.0', recommendVersion: '', confirm: 'yes' },
    });
    assert.equal(keep.status, 200, JSON.stringify(keep.body));
    const kept = await h.pool.query(
      `SELECT body->>'restrictVersion' AS r FROM site_doc WHERE name = 'notices'`,
    );
    assert.equal(kept.rows[0].r, '0.4.4');
    assert.equal((await feature('0.4.3')).status, 426);
    // 빈 글이면 지운다
    assert.equal((await save({ restrict: '', min: '', confirm: 'yes' })).status, 200);
    assert.equal((await feature()).status, 200);
  });

  test('판은 숫자 모양으로 저장한다 (0000.0005.0000 → 0.5.0)', async () => {
    assert.equal((await save({ restrict: '0000.0004.0000', confirm: 'yes' })).status, 200);
    const row = await h.pool.query(
      `SELECT body->>'restrictVersion' AS r FROM site_doc WHERE name = 'notices'`,
    );
    assert.equal(row.rows[0].r, '0.4.0');
    assert.equal((await feature('0000.0004.0000')).status, 200);
    assert.equal((await save({ confirm: 'yes' })).status, 200);
  });

  test('앱 판은 하루에 한 번만 적는다 (판이 바뀌어도 하루 안에는 다시 쓰지 않는다)', async () => {
    const a = await newDevice('18+', '하루한번');
    assert.equal((await api('GET', '/v1/me', { token: a.token, headers: hdr('0.4.4') })).status, 200);
    const first = await h.pool.query(`SELECT app_version AS v FROM account WHERE code = $1`, [a.code]);
    assert.equal(first.rows[0].v, '0.4.4');
    assert.equal((await api('GET', '/v1/me', { token: a.token, headers: hdr('0.4.5') })).status, 200);
    const second = await h.pool.query(`SELECT app_version AS v FROM account WHERE code = $1`, [a.code]);
    assert.equal(second.rows[0].v, '0.4.4', '하루 안에는 바뀐 판을 다시 적지 않는다');
  });
});

describe('앱 판 분포 (운영자 화면)', () => {
  test('요청한 앱 판을 계정에 적고, 판을 모르는 계정은 따로 센다', async () => {
    const a = await newDevice('18+', '판테스트');
    assert.equal((await api('GET', '/v1/me', { token: a.token, headers: hdr('0.4.4') })).status, 200);
    await newDevice('18+', '판없음');
    const over = await api('GET', '/v1/admin/overview', { token: adminSession });
    assert.equal(over.status, 200);
    const v = over.body.versions;
    assert.ok(v.active >= 3, '활동 계정 수');
    assert.ok(v.unknown >= 1, '판을 모르는 계정');
    const row = v.rows.find((r: { version: string }) => r.version === '0.4.4');
    assert.ok(row && row.count >= 1, '0.4.4 계정');
    // 높은 판이 위
    const versions = v.rows.map((r: { version: string }) => r.version);
    assert.deepEqual(
      versions,
      [...versions].sort((x: string, y: string) => {
        const p = x.split('.').map(Number);
        const q = y.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return (q[i] ?? 0) - (p[i] ?? 0);
        return 0;
      }),
    );
  });
});
