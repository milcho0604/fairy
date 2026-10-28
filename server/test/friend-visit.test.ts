// 통합 시험 (이슈 #141 1부 서버): 친구 펫 놀러 가기. 서로 켠 친구의 카드만 나가고, 14~17세끼리와 성인끼리만,
// 끄기, 끊기, 차단, 나이 변경, 합치기, 탈퇴, 오래된 카드 정리, 카드 검사, 레이트리밋, 기능 키를 본다.
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Features } from '../src/features';
import { mergeFriends } from '../src/friend-links';
import { Friends } from '../src/friends';
import { exempt } from '../src/update-gate';
import { client, type Harness, ip, startHarness } from './helpers';

let h: Harness;
const { api, newDevice, session } = client(() => h);

interface User {
  id: string;
  code: string;
  token: string;
  nick: string;
}

async function user(age: '14+' | '18+' = '18+'): Promise<User> {
  const nick = `친구${Math.floor(Math.random() * 9000 + 1000)}`;
  const d = await newDevice(age, nick);
  return { id: d.id, code: d.code, token: await session(d.id), nick };
}

const call = (u: User, method: string, path: string, body?: unknown) =>
  api(method, path, { token: u.token, ip: ip(), ...(body === undefined ? {} : { body }) });

async function befriend(a: User, b: User): Promise<void> {
  const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
  assert.equal(r.status, 201, r.text);
  const ok = await call(b, 'POST', `/v1/friends/requests/${r.body.request.id}/accept`);
  assert.equal(ok.status, 200, ok.text);
}

const visit = (a: User, b: User, on = true) => call(a, 'PUT', `/v1/friends/${b.code}/visit`, { on });
const card = (u: User, body: unknown = { species: 'kind:cat', name: '나비', stand: false }) =>
  call(u, 'PUT', '/v1/friends/visit/card', body);
const visitors = (u: User) => call(u, 'GET', '/v1/friends/visits');
const cardRows = async (u: User) =>
  (await h.pool.query('SELECT count(*)::int AS n FROM pet_card WHERE account_id = $1', [u.id])).rows[0].n;
const friendOf = async (u: User, other: User) =>
  (await call(u, 'GET', '/v1/friends')).body.friends.find((f: { code: string }) => f.code === other.code);

/** 서로 친구, 서로 켬, 서로 카드 올림 */
async function pair(age: '14+' | '18+' = '18+'): Promise<[User, User]> {
  const a = await user(age);
  const b = await user(age);
  await befriend(a, b);
  assert.equal((await visit(a, b)).status, 200);
  assert.equal((await visit(b, a)).status, 200);
  assert.equal((await card(a, { species: 'kind:cat', name: '나비' })).status, 200);
  assert.equal((await card(b, { species: 'starter:milk', name: '밀크', stand: true })).status, 200);
  return [a, b];
}

before(async () => {
  h = await startHarness({ features: { friends: 'everyone', friend_visit: 'everyone' } });
});

after(async () => {
  await h?.stop();
});

describe('펫 놀러 가기 (서버)', () => {
  test('1 한쪽만 켜면 손님이 없다. 목록에는 iVisit, theyVisit 가 맞게 나온다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    assert.equal((await friendOf(a, b)).iVisit, false);
    assert.equal((await friendOf(a, b)).theyVisit, false);
    assert.equal((await visit(a, b)).body.visiting, 1);
    assert.equal((await card(a)).status, 200);
    assert.equal((await card(b)).status, 409, '켠 친구가 없는 b 는 카드를 못 올린다');
    assert.deepEqual((await visitors(b)).body, { visitors: [] });
    assert.deepEqual((await visitors(a)).body, { visitors: [] });
    assert.equal((await friendOf(a, b)).iVisit, true);
    assert.equal((await friendOf(b, a)).theyVisit, true);
    assert.equal((await friendOf(b, a)).iVisit, false);
  });

  test('2 양쪽 켬 + 카드: 서로의 카드를 받는다. 카드가 없으면 빈 목록. 서로 켠 친구의 카드만', async () => {
    const [a, b] = await pair();
    const c = await user();
    await befriend(a, c);
    await visit(c, a); // c 만 켬: a 는 c 에게 안 켬
    await card(c);
    const forA = await visitors(a);
    assert.equal(forA.status, 200, forA.text);
    assert.deepEqual(forA.body.visitors, [
      { code: b.code, nickname: b.nick, pet: { species: 'starter:milk', name: '밀크', stand: true } },
    ]);
    const forB = await visitors(b);
    assert.deepEqual(forB.body.visitors, [
      { code: a.code, nickname: a.nick, pet: { species: 'kind:cat', name: '나비', stand: false } },
    ]);
    // 카드 없는 짝
    const d = await user();
    const e = await user();
    await befriend(d, e);
    await visit(d, e);
    await visit(e, d);
    assert.deepEqual((await visitors(d)).body.visitors, []);
  });

  test('3 기능 키: 내 쪽이 꺼지면 403, 상대 쪽이 꺼지면 목록에서 빠진다. 끄는 길은 열려 있다', async () => {
    const [a, b] = await pair();
    const features = h.app.get(Features);
    await features.setFeatureMode('friend_visit', 'allowlist');
    try {
      await features.allowAccount('friend_visit', a.id);
      assert.equal((await visitors(b)).status, 403);
      assert.equal((await visit(b, a)).status, 403, '켜기는 막힌다');
      assert.equal((await card(b)).status, 403);
      assert.equal((await visitors(a)).status, 200);
      assert.deepEqual((await visitors(a)).body.visitors, [], '상대 b 가 허용 목록에 없다');
      await features.allowAccount('friend_visit', b.id);
      assert.equal((await visitors(a)).body.visitors.length, 1);
      assert.equal((await visit(b, a, false)).status, 200);
      await features.setFeatureMode('friend_visit', 'off');
      assert.equal((await visit(a, b, false)).status, 200, '끄기는 friends 키만 본다');
      assert.equal((await call(a, 'DELETE', '/v1/friends/visit')).status, 204);
    } finally {
      await features.setFeatureMode('friend_visit', 'everyone');
    }
  });

  test('4 기기 토큰(로그인 아님)은 403 login_required', async () => {
    const d = await newDevice('18+', '기기만');
    const r = await api('GET', '/v1/friends/visits', { token: d.token, ip: ip() });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'login_required');
    assert.equal(
      (
        await api('PUT', '/v1/friends/visit/card', {
          token: d.token,
          ip: ip(),
          body: { species: 'kind:cat' },
        })
      ).status,
      403,
    );
  });

  test('5 나이 구분: 14~17세끼리, 성인끼리만. 나이를 바꾸면 즉시 사라진다', async () => {
    const [a, b] = await pair('14+');
    assert.equal((await visitors(a)).body.visitors.length, 1);
    const adult = await user('18+');
    assert.equal((await call(a, 'POST', '/v1/friends/requests', { code: adult.code })).status, 409);
    assert.equal((await visit(a, adult)).status, 404, '친구가 아니면 켤 수 없다');
    // b 가 성인으로 바꾸면 친구 줄이 걷히고 둘의 카드가 지워진다
    assert.equal((await call(b, 'PATCH', '/v1/account', { age: '18+' })).status, 200);
    assert.deepEqual((await visitors(a)).body.visitors, []);
    assert.equal(await cardRows(a), 0);
    assert.equal(await cardRows(b), 0);
    // 같은 나이로 다시 맞는 사이는 줄이 이미 없다
    assert.equal(await friendOf(a, b), undefined);
  });

  test('6 차단과 끊기: 서버가 바로 주지 않고, 켠 친구가 없어진 카드는 지운다', async () => {
    const [a, b] = await pair();
    const [c, d] = await pair();
    assert.equal((await call(a, 'DELETE', `/v1/friends/${b.code}`)).status, 204);
    assert.deepEqual((await visitors(b)).body.visitors, []);
    assert.equal(await cardRows(a), 0);
    assert.equal(await cardRows(b), 0);
    assert.equal((await call(d, 'POST', '/v1/friends/blocks', { code: c.code })).status, 201);
    assert.deepEqual((await visitors(c)).body.visitors, []);
    assert.deepEqual((await visitors(d)).body.visitors, []);
    assert.equal(await cardRows(c), 0);
    assert.equal(await cardRows(d), 0);
  });

  test('7 내가 끄기: 켠 친구가 0이면 카드 삭제, 한 명 남으면 유지', async () => {
    const [a, b] = await pair();
    const c = await user();
    await befriend(a, c);
    await visit(a, c);
    await visit(c, a);
    assert.equal((await visit(a, b, false)).body.visiting, 1);
    assert.equal(await cardRows(a), 1);
    assert.deepEqual((await visitors(b)).body.visitors, []);
    const off = await visit(a, c, false);
    assert.equal(off.body.visiting, 0);
    assert.equal(await cardRows(a), 0);
    assert.equal((await call(a, 'PUT', `/v1/friends/${c.code}/visit`, { on: 'yes' })).status, 400);
  });

  test('8 켠 친구 없이 카드를 올리면 409 not_visiting. DELETE /visit 는 모두 끄고 카드를 지운다', async () => {
    const a = await user();
    const r = await card(a);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'not_visiting');
    const [b, c] = await pair();
    assert.equal((await call(b, 'DELETE', '/v1/friends/visit')).status, 204);
    assert.equal(await cardRows(b), 0);
    assert.equal((await friendOf(b, c)).iVisit, false);
    assert.equal((await friendOf(c, b)).theyVisit, false);
  });

  test('9 카드 검사: 모르는 종류, 사진, 그 밖의 칸, 긴 이름, @, 주소, 제어 문자, 배열은 400', async () => {
    const [a] = await pair();
    const bad: unknown[] = [
      { species: 'kind:dragon' },
      { species: 'starter:other' },
      { species: 'kind:cat; DROP TABLE pet_card' },
      { species: 'kind:cat', image: 'data:image/png;base64,AAAA' },
      { species: 'kind:cat', photo: 'x' },
      { species: 'kind:cat', stand: 'yes' },
      { species: 'kind:cat', name: '가' },
      { species: 'kind:cat', name: '가나다라마바사아자차카타파' },
      { species: 'kind:cat', name: 'a@b.cd' },
      { species: 'kind:cat', name: 'https://x.kr' },
      { species: 'kind:cat', name: '나\u0000비' },
      { species: ['kind:cat'] },
      { species: 'kind:cat', name: ['나비'] },
      ['kind:cat'],
      {},
    ];
    for (const body of bad) {
      const r = await card(a, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error, 'card');
    }
    const row = (await h.pool.query('SELECT species, name FROM pet_card WHERE account_id = $1', [a.id]))
      .rows[0];
    assert.deepEqual(row, { species: 'kind:cat', name: '나비' }, '거절된 요청은 기존 카드를 바꾸지 않는다');
    const ok = await card(a, { species: 'starter:choco' });
    assert.equal(ok.status, 200);
    assert.equal(
      (await h.pool.query('SELECT name FROM pet_card WHERE account_id = $1', [a.id])).rows[0].name,
      null,
    );
  });

  test('10 합치기: visit_on 이 OR 로 남는 쪽에 옮겨지고 합쳐진 계정의 카드는 지워진다', async () => {
    const a = await user();
    const b = await user();
    const into = await user();
    await befriend(a, b);
    await visit(a, b);
    await visit(b, a);
    await card(a);
    const conn = await h.pool.connect();
    try {
      await conn.query('BEGIN');
      await mergeFriends(conn, a.id, into.id);
      await conn.query('COMMIT');
    } finally {
      conn.release();
    }
    assert.equal(await cardRows(a), 0);
    const kept = await h.pool.query('SELECT visit_on FROM friend WHERE account_id = $1 AND friend_id = $2', [
      into.id,
      b.id,
    ]);
    assert.deepEqual(kept.rows[0], { visit_on: true });
    const back = await h.pool.query('SELECT visit_on FROM friend WHERE account_id = $1 AND friend_id = $2', [
      b.id,
      into.id,
    ]);
    assert.deepEqual(back.rows[0], { visit_on: true });
  });

  test('10b 합치기: 남는 쪽에도 같은 친구 줄이 있으면(충돌) 어느 쪽이든 켰으면 켬', async () => {
    const a = await user();
    const into = await user();
    const b = await user();
    await befriend(a, b);
    await befriend(into, b);
    await visit(a, b); // 합쳐질 a 만 켬, into 는 안 켬
    await visit(b, a);
    await visit(b, into);
    const conn = await h.pool.connect();
    try {
      await conn.query('BEGIN');
      await mergeFriends(conn, a.id, into.id);
      await conn.query('COMMIT');
    } finally {
      conn.release();
    }
    const q = (x: string, y: string) =>
      h.pool.query('SELECT visit_on FROM friend WHERE account_id = $1 AND friend_id = $2', [x, y]);
    assert.deepEqual((await q(into.id, b.id)).rows[0], { visit_on: true });
    assert.deepEqual((await q(b.id, into.id)).rows[0], { visit_on: true });
  });

  test('11 탈퇴: 카드와 줄이 지워지고 상대 목록에서 사라진다', async () => {
    const [a, b] = await pair();
    assert.equal((await call(a, 'DELETE', '/v1/account')).status, 204);
    assert.equal(await cardRows(a), 0);
    assert.deepEqual((await visitors(b)).body.visitors, []);
    assert.equal(await cardRows(b), 1, '남은 b 의 카드는 그대로');
    assert.equal(
      (await h.pool.query('SELECT 1 FROM friend WHERE account_id = $1 OR friend_id = $1', [a.id])).rowCount,
      0,
    );
  });

  test('12 14일 안 올린 카드는 정리되고, 13일 된 카드는 서빙된다 (14일 넘은 것은 정리 전에도 안 나간다)', async () => {
    const [a, b] = await pair();
    await h.pool.query("UPDATE pet_card SET updated_at = now() - interval '13 days' WHERE account_id = $1", [
      b.id,
    ]);
    assert.equal((await visitors(a)).body.visitors.length, 1);
    await h.pool.query("UPDATE pet_card SET updated_at = now() - interval '15 days' WHERE account_id = $1", [
      b.id,
    ]);
    assert.deepEqual((await visitors(a)).body.visitors, [], '정리 전에도 서빙하지 않는다');
    assert.equal(await cardRows(b), 1);
    await h.app.get(Friends).sweep();
    assert.equal(await cardRows(b), 0);
    assert.equal(await cardRows(a), 1);
  });

  test('13 레이트리밋: 목록 91번째, 카드 21번째, 스위치 61번째가 429', async () => {
    const [a, b] = await pair();
    let r = 0;
    for (let i = 0; i < 95 && r === 0; i++) if ((await visitors(a)).status === 429) r = i + 1;
    assert.equal(r, 91, '목록');
    // pair() 가 카드 1번, 스위치 1번을 이미 썼다
    let c = 0;
    for (let i = 0; i < 25 && c === 0; i++) if ((await card(b)).status === 429) c = i + 2;
    assert.equal(c, 21, '카드');
    let s = 0;
    for (let i = 0; i < 70 && s === 0; i++) if ((await visit(b, a)).status === 429) s = i + 2;
    assert.equal(s, 61, '스위치');
  });

  test('14 응답 몸에 올린 때, 계정 번호, 방문 기록이 없다', async () => {
    const [a, b] = await pair();
    const r = await visitors(a);
    assert.deepEqual(Object.keys(r.body), ['visitors']);
    assert.deepEqual(Object.keys(r.body.visitors[0]).sort(), ['code', 'nickname', 'pet']);
    assert.deepEqual(Object.keys(r.body.visitors[0].pet).sort(), ['name', 'species', 'stand']);
    assert.ok(!r.text.includes(`"${b.id}"`), '계정 번호가 없다');
    assert.ok(!/updated|updatedAt|visited|at"/i.test(r.text));
    const cols = (
      await h.pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'pet_card' ORDER BY 1",
      )
    ).rows.map((x) => x.column_name);
    assert.deepEqual(cols, ['account_id', 'name', 'species', 'stand', 'updated_at']);
  });

  test('15 업데이트 관문: 새 경로는 예외 목록에 없어 낡은 앱은 426 을 받는다', () => {
    for (const [m, p] of [
      ['GET', '/v1/friends/visits'],
      ['PUT', '/v1/friends/visit/card'],
      ['PUT', '/v1/friends/f-abcd-efgh/visit'],
      ['DELETE', '/v1/friends/visit'],
    ] as const)
      assert.equal(exempt(m, p), false, `${m} ${p}`);
  });

  test('16 관리자 기능 스위치 표에 friend_visit 행이 있다 (admin-switches 시험의 키 목록과 같은 기능 키)', async () => {
    const list = await h.app.get(Features).listFeatures();
    assert.ok(list.some((f) => f.key === 'friend_visit'));
    assert.equal(await h.app.get(Features).featureMode('friend_visit'), 'everyone');
  });
});

describe('경쟁: 카드 올리기 대 친구 쪽 변화 (15번씩, 남는 카드 0건)', () => {
  test('친구가 나이를 바꾸거나 끊는 순간 카드를 올려도 켠 친구가 없으면 카드가 남지 않는다', async () => {
    for (let i = 0; i < 15; i++) {
      const [a, b] = await pair(i % 2 === 0 ? '14+' : '18+');
      await visit(b, a, false);
      // a 는 b 만 켜 둔 상태: b 가 끊거나 나이를 바꾸는 순간 a 가 카드를 올린다
      await Promise.all([
        card(a),
        i % 2 === 0
          ? call(b, 'PATCH', '/v1/account', { age: '18+' })
          : call(b, 'DELETE', `/v1/friends/${a.code}`),
      ]);
      assert.equal(await cardRows(a), 0, `반복 ${i}`);
    }
  });
});
