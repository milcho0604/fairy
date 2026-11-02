// 통합 시험: 쪽지 글 칸 암호화 (INBOX_ENC_KEY). 왕복, 열쇠 없음(평문, 서버 뜸), 열쇠가 생긴 뒤 옛 평문 읽기와 시작 시 일괄 잠금,
// 줄 바꿔치기(AAD), 앱 응답과 운영자 화면은 평문, DB 에는 평문이 없다. 탈퇴와 철회는 그대로.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app';
import { NOTE_UNREADABLE } from '../src/inbox';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = 'a'.repeat(20) + randomUUID().replaceAll('-', '');
const KEY = 'cd'.repeat(32);
let h: Harness;
const { api, newDevice } = client(() => h);
let admin: AdminBrowser;

const rawMessages = async (account: string) =>
  (
    await h.pool.query<{ id: string; message: string | null }>(
      'SELECT id, message FROM inbox WHERE account_id = $1 ORDER BY id',
      [account],
    )
  ).rows;

async function login(): Promise<void> {
  admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
}

describe('열쇠가 있을 때', () => {
  before(async () => {
    h = await startHarness({ adminToken: ADMIN_TOKEN, inboxKey: Buffer.from(KEY, 'hex') });
    await login();
  });
  after(async () => {
    await h?.stop();
  });

  test('운영자 쪽지: DB 에는 암호문, 앱 응답과 운영자 화면에는 평문, 열기와 철회는 그대로', async () => {
    const a = await newDevice('18+', '잠금고양이');
    assert.ok(
      (
        await admin.act('/admin/notes', {
          account: a.code,
          coins: '3',
          message: '비밀 안내 가나다',
          days: '5',
        })
      ).ok,
    );
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: '두 번째 공지 abc' })).ok);
    const rows = await rawMessages(a.id);
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.match(r.message ?? '', /^s1:/);
      assert.ok(!(r.message ?? '').includes('비밀'));
      assert.ok(!(r.message ?? '').includes('abc'));
    }
    const list = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(list.body.items.map((x: { message: string }) => x.message).sort(), [
      '두 번째 공지 abc',
      '비밀 안내 가나다',
    ]);
    assert.ok(!list.text.includes('s1:'));
    const page = await admin.page(`?user=${a.id}`);
    assert.ok(page.text.includes('비밀 안내 가나다'));
    assert.ok(!page.text.includes('s1:'));
    // 열기: 응답의 쪽지도 평문, 코인 지급
    const coin = list.body.items.find((x: { coins: number }) => x.coins === 3);
    const open = await api('POST', `/v1/inbox/${coin.id}/open`, { token: a.token });
    assert.equal(open.status, 200, open.text);
    assert.equal(open.body.item.message, '비밀 안내 가나다');
    // 철회
    const other = list.body.items.find((x: { coins: number }) => x.coins === 0);
    assert.ok(
      (await admin.act('/admin/notes/withdraw', { id: other.id, account: a.code, confirm: other.id })).ok,
    );
    const after1 = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(after1.body.items.length, 1);
  });

  test('배치 지급 사유도 잠긴다', async () => {
    const a = await newDevice('18+', '배치고양이');
    const r = await admin.act('/admin/grants/batch', {
      accounts: a.code,
      coins: '2',
      chat_passes: '0',
      days: '3',
      reason: '배치 사유 라마바',
      confirm: 'yes',
    });
    assert.ok(r.ok, r.text);
    const rows = await rawMessages(a.id);
    assert.match(rows[0]?.message ?? '', /^s1:/);
    const list = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(list.body.items[0].message, '배치 사유 라마바');
  });

  test('줄 바꿔치기: 다른 쪽지의 암호문을 붙이면 풀리지 않고 알림 글이 보인다', async () => {
    const a = await newDevice('18+', '바꿔치기');
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: '첫째 글' })).ok);
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: '둘째 글' })).ok);
    const [x, y] = await rawMessages(a.id);
    await h.pool.query('UPDATE inbox SET message = $2 WHERE id = $1', [x?.id, y?.message]);
    const list = await api('GET', '/v1/inbox', { token: a.token });
    const byId = new Map<string, string>(
      list.body.items.map((i: { id: number; message: string }) => [String(i.id), i.message]),
    );
    assert.equal(byId.get(x?.id as string), NOTE_UNREADABLE);
    assert.equal(byId.get(y?.id as string), '둘째 글');
  });

  test('글자 수 상한: 200자는 되고 201자는 운영자 화면이 거절한다', async () => {
    const a = await newDevice('18+', '길이고양이');
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: '가'.repeat(200) })).ok);
    assert.equal((await admin.act('/admin/notes', { account: a.code, message: '가'.repeat(201) })).ok, false);
    const list = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(list.body.items[0].message, '가'.repeat(200));
  });

  test('평문이 s1: 로 시작해도 그대로 왕복한다', async () => {
    const a = await newDevice('18+', '접두어고양이');
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: 's1:AAAA' })).ok);
    const list = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(list.body.items[0].message, 's1:AAAA');
  });

  test('운영자 홈에 쪽지 암호화 경고가 없다', async () => {
    const page = await admin.page();
    assert.ok(!page.text.includes('쪽지 암호화가 꺼져'));
  });

  test('탈퇴하면 쪽지도 함께 지워진다', async () => {
    const a = await newDevice('18+', '탈퇴고양이');
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: '탈퇴 전 글' })).ok);
    const del = await api('DELETE', '/v1/account', { token: a.token });
    assert.ok(del.status === 200 || del.status === 204, del.text);
    assert.equal((await rawMessages(a.id)).length, 0);
  });
});

describe('열쇠가 없다가 생길 때', () => {
  before(async () => {
    h = await startHarness({ adminToken: ADMIN_TOKEN });
    await login();
  });
  after(async () => {
    await h?.stop();
  });

  test('열쇠 없이도 서버는 뜨고 평문으로 쓰며 홈에 경고가 뜬다. 열쇠를 넣고 다시 뜨면 옛 평문을 잠그고 평문 그대로 읽힌다', async () => {
    const a = await newDevice('18+', '옛고양이');
    const b = await newDevice('18+', '두번째');
    assert.ok((await admin.act('/admin/notes', { account: a.code, message: '열쇠 전 글 하나' })).ok);
    assert.ok((await admin.act('/admin/notes', { account: b.code, message: 's1:열쇠 전 접두어 글' })).ok);
    assert.deepEqual(
      (await rawMessages(a.id)).map((r) => r.message),
      ['열쇠 전 글 하나'],
    );
    assert.match((await rawMessages(b.id))[0]?.message ?? '', /^s0:s1:/);
    assert.ok((await admin.page()).text.includes('쪽지 암호화가 꺼져'));
    const before1 = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(before1.body.items[0].message, '열쇠 전 글 하나');

    // 서버를 내리고 같은 DB 에 열쇠를 넣어 다시 띄운다 (시작 때 일괄 잠금)
    await h.app.close();
    const config = { ...h.config, inboxKey: Buffer.from(KEY, 'hex') };
    const app2 = await createApp(config);
    await app2.listen(0, '127.0.0.1');
    const addr = app2.getHttpServer().address();
    const h2: Harness = {
      ...h,
      app: app2,
      config,
      base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    };
    config.publicUrl = h2.base;
    const prev = h;
    h = h2;
    try {
      for (const acc of [a, b])
        for (const r of await rawMessages(acc.id)) assert.match(r.message ?? '', /^s1:/);
      assert.ok(!(await rawMessages(a.id))[0]?.message?.includes('열쇠 전'));
      const la = await api('GET', '/v1/inbox', { token: a.token });
      assert.equal(la.body.items[0].message, '열쇠 전 글 하나');
      const lb = await api('GET', '/v1/inbox', { token: b.token });
      assert.equal(lb.body.items[0].message, 's1:열쇠 전 접두어 글');
      // 한 번 더 해도 같다 (멱등)
      const before2 = (await rawMessages(a.id))[0]?.message;
      const { Inbox } = await import('../src/inbox');
      assert.equal(await app2.get(Inbox).sealPending(), 0);
      assert.equal((await rawMessages(a.id))[0]?.message, before2);
      // 새 글도 잠긴다
      await login();
      const c = await newDevice('18+', '세번째');
      assert.ok((await admin.act('/admin/notes', { account: c.code, message: '열쇠 뒤 글' })).ok);
      assert.match((await rawMessages(c.id))[0]?.message ?? '', /^s1:/);
      assert.ok(!(await admin.page()).text.includes('쪽지 암호화가 꺼져'));
    } finally {
      await app2.close().catch(() => {});
      h = prev;
    }
  });
});
