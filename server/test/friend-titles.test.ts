// 통합 시험 (이슈 #110 2차): 친구별 일정 제목 공유. 허용 안 한 친구에게 제목이 안 나가고, 만 14~17세는 켤 수 없고,
// 끄면 바로 빠지고, 아무도 안 켜면 제목이 저장되지 않고, 차단, 끊기, 나이 변경, 합치기 뒤에도 지워지는지 본다.
// 시험용 Postgres 컨테이너를 무작위 이름으로 띄우고 끝나면 지운다.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Features } from '../src/features';
import { mergeFriends } from '../src/friend-links';
import { clipTitled, parseTitled } from '../src/friends';
import { client, type Harness, ip, startHarness } from './helpers';

let h: Harness;
const { api, newDevice, session } = client(() => h);

interface User {
  id: string;
  code: string;
  token: string;
}

async function user(age: '14+' | '18+' = '18+'): Promise<User> {
  const d = await newDevice(age, `친구${Math.floor(Math.random() * 900 + 100)}`);
  return { id: d.id, code: d.code, token: await session(d.id) };
}

const call = (u: User, method: string, path: string, body?: unknown) =>
  api(method, path, { token: u.token, ip: ip(), ...(body === undefined ? {} : { body }) });

async function befriend(a: User, b: User): Promise<void> {
  const r = await call(a, 'POST', '/v1/friends/requests', { code: b.code });
  assert.equal(r.status, 201, r.text);
  const ok = await call(b, 'POST', `/v1/friends/requests/${r.body.request.id}/accept`);
  assert.equal(ok.status, 200, ok.text);
}

const H = 3_600_000;
const items = () => {
  const t = Date.now();
  return [
    { start: t + H, end: t + 2 * H, title: '치과 진료' },
    { start: t + 5 * H, end: t + 6 * H, title: '면접' },
  ];
};
const blocksOf = (xs: { start: number; end: number }[]) => xs.map((x) => ({ start: x.start, end: x.end }));
const upload = (u: User, xs = items()) =>
  call(u, 'PUT', '/v1/friends/calendar/busy', { blocks: blocksOf(xs), items: xs });
const shareBusy = (a: User, b: User, share = true) =>
  call(a, 'PUT', `/v1/friends/${b.code}/calendar`, { share });
const shareTitle = (a: User, b: User, share = true) =>
  call(a, 'PUT', `/v1/friends/${b.code}/calendar/titles`, { share });
const seen = (viewer: User, owner: User) => call(viewer, 'GET', `/v1/friends/${owner.code}/busy`);
const titleRows = async (u: User) =>
  (await h.pool.query('SELECT count(*)::int AS n FROM busy_title WHERE account_id = $1', [u.id])).rows[0].n;
const friendOf = async (u: User, other: User) =>
  (await call(u, 'GET', '/v1/friends')).body.friends.find((f: { code: string }) => f.code === other.code);

before(async () => {
  h = await startHarness({ features: { friends: 'everyone', friend_calendar: 'everyone' } });
});

after(async () => {
  await h?.stop();
});

describe('일정 제목 공유 (친구별)', () => {
  test('기본 꺼짐: 바쁨만 켜면 제목은 안 간다. 제목을 켠 친구에게만 제목이 간다', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    await befriend(a, b);
    await befriend(a, c);
    await shareBusy(a, b);
    await shareBusy(a, c);
    assert.equal((await friendOf(a, b)).iTitle, false);
    assert.equal((await friendOf(a, b)).canTitle, true);
    // 제목을 켜지 않았으면 올려도 저장하지 않는다
    const first = await upload(a);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.titles, 0);
    assert.equal(await titleRows(a), 0);

    const on = await shareTitle(a, b);
    assert.equal(on.status, 200, on.text);
    assert.equal(on.body.titles, 1);
    const up = await upload(a);
    assert.equal(up.body.titles, 2);
    const forB = await seen(b, a);
    assert.equal(forB.status, 200);
    assert.deepEqual(
      forB.body.titles.map((x: { title: string }) => x.title),
      ['치과 진료', '면접'],
    );
    assert.equal(forB.body.blocks.length, 2);
    // 제목을 켜지 않은 친구 c 의 응답에는 제목 글자가 어디에도 없다
    const forC = await seen(c, a);
    assert.equal(forC.status, 200);
    assert.deepEqual(forC.body.titles, []);
    assert.ok(!forC.text.includes('치과'));
    assert.ok(!forC.text.includes('면접'));
    assert.equal((await friendOf(b, a)).theyTitle, true);
    assert.equal((await friendOf(c, a)).theyTitle, false);
  });

  test('방향이 있다: a 가 b 에게 켜도 b 의 일정 제목이 a 에게 가지 않는다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await shareBusy(a, b);
    await shareBusy(b, a);
    await shareTitle(a, b);
    await upload(b);
    assert.equal(await titleRows(b), 0, 'b 는 제목을 켠 친구가 없다');
    assert.deepEqual((await seen(a, b)).body.titles, []);
  });

  test('만 14~17세는 켤 수 없다 (409 title_age), 바쁨 공유가 꺼져 있어도 켤 수 없다 (409 busy_off)', async () => {
    const t1 = await user('14+');
    const t2 = await user('14+');
    await befriend(t1, t2);
    await shareBusy(t1, t2);
    const no = await shareTitle(t1, t2);
    assert.equal(no.status, 409);
    assert.equal(no.body.error, 'title_age');
    assert.equal((await friendOf(t1, t2)).canTitle, false);
    // 직접 올려도 저장하지 않는다
    assert.equal((await upload(t1)).body.titles, 0);
    assert.equal(await titleRows(t1), 0);
    assert.deepEqual((await seen(t2, t1)).body.titles, []);

    const a = await user();
    const b = await user();
    await befriend(a, b);
    const off = await shareTitle(a, b);
    assert.equal(off.status, 409);
    assert.equal(off.body.error, 'busy_off');
    // 친구가 아니면 404, 본문이 틀리면 400
    const s = await user();
    assert.equal((await shareTitle(s, a)).status, 404);
    assert.equal(
      (await call(a, 'PUT', `/v1/friends/${b.code}/calendar/titles`, { share: 'yes' })).status,
      400,
    );
  });

  test('끄면 바로 빠진다. 아무도 안 보게 되면 저장된 제목도 지운다 (바쁨은 그대로)', async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    await befriend(a, b);
    await befriend(a, c);
    for (const x of [b, c]) {
      await shareBusy(a, x);
      await shareTitle(a, x);
    }
    await upload(a);
    assert.equal(await titleRows(a), 2);
    // b 만 끄면 c 가 보므로 제목은 남고, b 의 응답에서는 바로 빠진다
    const offB = await shareTitle(a, b, false);
    assert.equal(offB.body.titles, 1);
    assert.equal(await titleRows(a), 2);
    assert.deepEqual((await seen(b, a)).body.titles, []);
    assert.equal((await seen(c, a)).body.titles.length, 2);
    // c 도 끄면 서버에 저장된 제목이 지워진다
    await shareTitle(a, c, false);
    assert.equal(await titleRows(a), 0);
    assert.equal((await seen(c, a)).body.blocks.length, 2, '바쁜 시간은 그대로');
    assert.deepEqual((await seen(c, a)).body.titles, []);
    // 다시 올리면 제목 없이 저장된다
    assert.equal((await upload(a)).body.titles, 0);
  });

  test('바쁨 공유를 끄면 제목 공유도 같이 꺼진다. 다시 켜도 제목은 꺼진 채', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await shareBusy(a, b);
    await shareTitle(a, b);
    await upload(a);
    await shareBusy(a, b, false);
    assert.equal(await titleRows(a), 0);
    await shareBusy(a, b);
    assert.equal((await friendOf(a, b)).iTitle, false);
    assert.equal((await upload(a)).body.titles, 0);
  });

  test('모두 끄기(DELETE calendar)와 끊기와 차단은 제목도 지운다', async () => {
    const a = await user();
    const b = await user();
    const arm = async () => {
      await shareBusy(a, b);
      await shareTitle(a, b);
      await upload(a);
      assert.equal(await titleRows(a), 2);
    };
    await befriend(a, b);
    await arm();
    assert.equal((await call(a, 'DELETE', '/v1/friends/calendar')).status, 204);
    assert.equal(await titleRows(a), 0);
    assert.equal((await friendOf(a, b)).iTitle, false);

    await arm();
    await call(a, 'DELETE', `/v1/friends/${b.code}`);
    assert.equal(await titleRows(a), 0);

    await befriend(a, b);
    await arm();
    await call(b, 'POST', '/v1/friends/blocks', { code: a.code });
    assert.equal(await titleRows(a), 0);
    const row = await h.pool.query(
      'SELECT count(*)::int AS n FROM friend WHERE share_title AND account_id = ANY($1::bigint[])',
      [[a.id, b.id]],
    );
    assert.equal(row.rows[0].n, 0, '제목 공유가 남은 친구 줄이 없다');
  });

  test('나이 구분이 바뀌어 둘 다 만 14~17세가 되면 제목 공유가 꺼지고 제목이 지워진다. 읽을 때도 한 번 더 막는다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await shareBusy(a, b);
    await shareTitle(a, b);
    await upload(a);
    assert.equal((await seen(b, a)).body.titles.length, 2);
    // 한 명만 바뀌면 친구가 걷힌다 (나이 구분이 달라서). 둘 다 바뀌면 친구는 남지만 제목은 아니다
    await call(a, 'PATCH', '/v1/account', { age: '14+' });
    await call(b, 'PATCH', '/v1/account', { age: '14+' });
    assert.equal(await titleRows(a), 0);

    // 읽을 때 한 번 더: 줄이 남아 있어도 둘 다 성인이 아니면 제목을 주지 않는다 (직접 되돌려 본다)
    const c = await user();
    const d = await user();
    await befriend(c, d);
    await shareBusy(c, d);
    await shareTitle(c, d);
    await upload(c);
    await h.pool.query(`UPDATE account SET age = '14+' WHERE id = ANY($1::bigint[])`, [[c.id, d.id]]);
    const r = await seen(d, c);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.titles, []);
    assert.ok(!r.text.includes('치과'));
    assert.equal((await friendOf(c, d)).iTitle, false);
  });

  test('합치면 제목 공유가 남는 쪽으로 옮겨지고 합쳐진 계정이 올린 제목은 지워진다', async () => {
    const a = await user();
    const b = await user();
    const other = await user();
    await befriend(a, b);
    await shareBusy(a, b);
    await shareTitle(a, b);
    await upload(a);
    assert.equal(await titleRows(a), 2);
    const into = other.id;
    const conn = await h.pool.connect();
    try {
      await conn.query('BEGIN');
      await mergeFriends(conn, a.id, into);
      await conn.query('COMMIT');
    } finally {
      conn.release();
    }
    assert.equal(await titleRows(a), 0);
    const kept = await h.pool.query(
      'SELECT share_busy, share_title FROM friend WHERE account_id = $1 AND friend_id = $2',
      [into, b.id],
    );
    assert.deepEqual(kept.rows[0], { share_busy: true, share_title: true });
  });

  test('올린 제목 검사: 모양이 틀리면 400 items, 긴 제목은 80자, 줄바꿈은 빈칸, 14일 밖과 빈 제목은 버린다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await shareBusy(a, b);
    await shareTitle(a, b);
    const t = Date.now();
    const bad = await call(a, 'PUT', '/v1/friends/calendar/busy', {
      blocks: [{ start: t + H, end: t + 2 * H }],
      items: [{ start: t + H, end: t + 2 * H, title: 5 }],
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'items');
    const notArray = await call(a, 'PUT', '/v1/friends/calendar/busy', { blocks: [], items: 'x' });
    assert.equal(notArray.status, 400);
    const ok = await call(a, 'PUT', '/v1/friends/calendar/busy', {
      blocks: [{ start: t + H, end: t + 4 * H }],
      items: [
        { start: t + H, end: t + 2 * H, title: `${'가'.repeat(100)}` },
        { start: t + 2 * H, end: t + 3 * H, title: '줄\n바꿈\t탭' },
        { start: t + 3 * H, end: t + 4 * H, title: '   ' },
        { start: t + 30 * 24 * H, end: t + 30 * 24 * H + H, title: '먼 일정' },
      ],
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.titles, 2);
    const titles = (await seen(b, a)).body.titles.map((x: { title: string }) => x.title);
    assert.equal(titles[0].length, 80);
    assert.equal(titles[1], '줄 바꿈 탭');
    // items 를 안 보내는 옛 앱도 그대로 된다 (제목은 비워진다)
    const old = await call(a, 'PUT', '/v1/friends/calendar/busy', {
      blocks: [{ start: t + H, end: t + 2 * H }],
    });
    assert.equal(old.status, 200);
    assert.equal(await titleRows(a), 0);
  });

  test('기능 키 friend_calendar 를 끄면 제목을 켜지 못하고 읽지도 못한다. 끄는 길은 열려 있다', async () => {
    const a = await user();
    const b = await user();
    await befriend(a, b);
    await shareBusy(a, b);
    await shareTitle(a, b);
    await upload(a);
    const features = h.app.get(Features);
    await features.setFeatureMode('friend_calendar', 'off');
    try {
      assert.equal((await shareTitle(a, b, false)).status, 200, '끄는 길은 열려 있다');
      await shareTitle(a, b, true).then((r) => assert.equal(r.status, 403));
      assert.equal((await seen(b, a)).status, 403);
    } finally {
      await features.setFeatureMode('friend_calendar', 'everyone');
    }
  });

  test('순수 함수: clipTitled, parseTitled', () => {
    assert.deepEqual(clipTitled([{ start: 1, end: 2, title: ' \u0000 ' }], 0, 10), []);
    assert.deepEqual(clipTitled([{ start: 1, end: 5, title: ' 회의 ' }], 2, 4), [
      { start: 2, end: 4, title: '회의' },
    ]);
    assert.deepEqual(parseTitled({}), []);
    assert.throws(() => parseTitled({ items: [{ start: 2, end: 1, title: 'x' }] }));
    assert.throws(() => parseTitled({ items: new Array(401).fill({ start: 1, end: 2, title: 'x' }) }));
  });
});
