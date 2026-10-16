// 통합 시험 (이슈 #115): 같은 계정의 기기끼리 구글 일정 연결 이어 주기. 서버에는 기기마다 "연결했다" 표시만 둔다.
// 표시 켜기와 끄기, 두 기기 세기(마지막 기기가 끊으면 거짓), 합치기와 탈퇴, 기능 키 calendar_link_hint(기본 allowlist + 운영자).
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Accounts } from '../src/accounts';
import { Db } from '../src/db';
import { Features } from '../src/features';
import { client, type Harness, startHarness } from './helpers';

const ADMIN_SUB = `admin-${randomUUID()}`;
let h: Harness;
const { api, newDevice, session, secondDevice } = client(() => h);
const features = () => h.app.get(Features);

before(async () => {
  h = await startHarness({ adminSubs: [ADMIN_SUB] });
});
after(async () => {
  await h?.stop();
});

/** 기기 토큰으로 이 기기의 연결 표시를 보낸다 */
const report = (token: string, linked: unknown) =>
  api('PATCH', '/v1/account', { token, body: { calendarLinked: linked } });
const me = async (token: string) => {
  const r = await api('GET', '/v1/me', { token });
  assert.equal(r.status, 200, r.text);
  return r.body.calendar as { linked: boolean; devices: number } | null;
};

/** 기능 키를 켠 계정 하나: 기기 A(로그인한 첫 기기), 같은 계정의 기기 B, 세션 */
async function family() {
  const a = await newDevice();
  await features().allowAccount('calendar_link_hint', a.id);
  const b = await secondDevice(a.id);
  const s = await session(a.id);
  return { id: a.id, a: a.token, b, s };
}

describe('연결 표시 (#115)', () => {
  test('기본은 거짓, 기기 A 가 켜면 세션과 기기 B 모두 참, 같은 값을 다시 보내도 하나로 센다', async () => {
    const f = await family();
    assert.deepEqual(await me(f.s), { linked: false, devices: 0 });
    const on = await report(f.a, true);
    assert.equal(on.status, 200, on.text);
    assert.deepEqual(on.body.calendar, { linked: true, devices: 1 });
    assert.ok(on.body.account.code, '대답에 계정 정보도 그대로');
    assert.equal((await report(f.a, true)).body.calendar.devices, 1);
    assert.deepEqual(await me(f.s), { linked: true, devices: 1 });
    assert.deepEqual(await me(f.b), { linked: true, devices: 1 });
  });

  test('두 기기를 센다: 하나가 끊어도 참, 마지막 기기가 끊으면 거짓', async () => {
    const f = await family();
    await report(f.a, true);
    await report(f.b, true);
    assert.deepEqual(await me(f.s), { linked: true, devices: 2 });
    assert.deepEqual((await report(f.a, false)).body.calendar, { linked: true, devices: 1 });
    assert.deepEqual((await report(f.b, false)).body.calendar, { linked: false, devices: 0 });
    // 이미 끊은 기기가 다시 끊어도 그대로
    assert.equal((await report(f.b, false)).status, 200);
    assert.deepEqual(await me(f.s), { linked: false, devices: 0 });
  });

  test('모양 검사: 참거짓만, 세션 토큰은 400 device_token, 토큰 없으면 401, 빈 몸은 예전처럼 400 age', async () => {
    const f = await family();
    for (const bad of ['yes', 1, null]) {
      const r = await report(f.a, bad);
      assert.deepEqual([r.status, r.body.error], [400, 'calendar'], String(bad));
    }
    const viaSession = await report(f.s, true);
    assert.deepEqual([viaSession.status, viaSession.body.error], [400, 'device_token']);
    assert.equal((await api('PATCH', '/v1/account', { body: { calendarLinked: true } })).status, 401);
    assert.deepEqual((await api('PATCH', '/v1/account', { token: f.a, body: {} })).body, { error: 'age' });
    // 다른 값과 같이 보내도 된다
    const both = await api('PATCH', '/v1/account', {
      token: f.a,
      body: { age: '18+', calendarLinked: true },
    });
    assert.deepEqual([both.status, both.body.account.age, both.body.calendar.linked], [200, '18+', true]);
    assert.deepEqual(await me(f.s), { linked: true, devices: 1 });
  });

  test('다른 계정의 표시는 섞이지 않는다', async () => {
    const f = await family();
    const g = await family();
    await report(f.a, true);
    assert.deepEqual(await me(g.s), { linked: false, devices: 0 });
  });
});

describe('합치기와 탈퇴 (#115)', () => {
  test('합치면 기기 표시가 남는 쪽으로 따라온다 (두 계정 것을 더해 센다)', async () => {
    const x = await family();
    const y = await family();
    await report(x.a, true);
    await report(y.a, true);
    await report(y.b, true);
    const accounts = h.app.get(Accounts);
    await h.app.get(Db).tx(async (c) => {
      const [from, into] = await accounts.lockPair(c, y.id, x.id);
      await accounts.merge(c, from, into);
    });
    assert.deepEqual(await me(x.s), { linked: true, devices: 3 });
    // 옛 계정의 기기 토큰도 남는 쪽을 본다
    assert.deepEqual(await me(y.b), { linked: true, devices: 3 });
    assert.deepEqual((await report(y.b, false)).body.calendar, { linked: true, devices: 2 });
  });

  test('탈퇴하면 표시도 함께 지워진다', async () => {
    const f = await family();
    await report(f.a, true);
    await report(f.b, true);
    const before = await h.pool.query('SELECT count(*)::int AS n FROM calendar_link');
    assert.equal((await api('DELETE', '/v1/account', { token: f.s })).status, 204);
    const left = await h.pool.query(
      'SELECT count(*)::int AS n FROM calendar_link l JOIN device d ON d.id = l.device_id WHERE d.account_id = $1',
      [f.id],
    );
    assert.equal(left.rows[0].n, 0);
    const now = await h.pool.query('SELECT count(*)::int AS n FROM calendar_link');
    assert.equal(now.rows[0].n, before.rows[0].n - 2);
  });
});

describe('기능 키 calendar_link_hint (#115)', () => {
  test('기본 allowlist: 허용 목록에 없는 계정은 켜기 403 feature_off, /v1/me 의 calendar 는 null, 끄기는 받는다', async () => {
    await features().setFeatureMode('calendar_link_hint', null);
    const d = await newDevice();
    const s = await session(d.id);
    const f = await api('GET', '/v1/features', { token: s });
    assert.equal(f.body.features.calendar_link_hint, false);
    const on = await report(d.token, true);
    assert.deepEqual([on.status, on.body.error], [403, 'feature_off']);
    assert.equal(await me(s), null);
    const off = await report(d.token, false);
    assert.deepEqual([off.status, off.body.calendar], [200, null]);
    // 토큰 없이는 꺼짐
    assert.equal((await api('GET', '/v1/features')).body.features.calendar_link_hint, false);
  });

  test('운영자 계정은 허용 목록에 넣지 않아도 켜진다 (allowlist), off 면 운영자도 꺼진다', async () => {
    await features().setFeatureMode('calendar_link_hint', null);
    const d = await newDevice();
    const s = await session(d.id, ADMIN_SUB);
    assert.equal((await api('GET', '/v1/features', { token: s })).body.features.calendar_link_hint, true);
    assert.equal(
      (await api('GET', '/v1/features', { token: d.token })).body.features.calendar_link_hint,
      true,
    );
    assert.equal((await report(d.token, true)).status, 200);
    assert.deepEqual(await me(s), { linked: true, devices: 1 });
    try {
      await features().setFeatureMode('calendar_link_hint', 'off');
      assert.equal((await api('GET', '/v1/features', { token: s })).body.features.calendar_link_hint, false);
      assert.equal(await me(s), null);
      assert.equal((await report(d.token, true)).status, 403);
      // 꺼져 있어도 끊은 것은 받는다: 다시 켰을 때 남은 표시가 없게
      assert.equal((await report(d.token, false)).status, 200);
    } finally {
      await features().setFeatureMode('calendar_link_hint', null);
    }
    assert.deepEqual(await me(s), { linked: false, devices: 0 });
  });

  test('everyone 이면 모두, 허용 목록에서 빼면 다시 꺼진다', async () => {
    const d = await newDevice();
    const s = await session(d.id);
    try {
      await features().setFeatureMode('calendar_link_hint', 'everyone');
      assert.equal((await report(d.token, true)).status, 200);
      assert.deepEqual(await me(s), { linked: true, devices: 1 });
      await features().setFeatureMode('calendar_link_hint', 'allowlist');
      await features().allowAccount('calendar_link_hint', d.id);
      assert.deepEqual(await me(s), { linked: true, devices: 1 });
      await features().disallowAccount('calendar_link_hint', d.id);
      assert.equal(await me(s), null);
    } finally {
      await features().setFeatureMode('calendar_link_hint', null);
    }
  });

  test('운영자 화면 기능 스위치 칸에 나온다 (기본 allowlist, 서버 설정 기본값)', async () => {
    const listed = await features().listFeatures();
    const row = listed.find((x) => x.key === 'calendar_link_hint');
    assert.ok(row);
    assert.equal(row.mode, 'allowlist');
    assert.equal(row.from, 'env');
  });
});
