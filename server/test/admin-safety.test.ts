// 운영자 실수 방지와 피드백 (#155): 실패한 제출의 입력 보존, 파괴적 동작의 확인, 운영 기록의 누가와 필터
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, kstInput, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
let h: Harness;
const { api, newDevice, session } = client(() => h);
let admin: AdminBrowser;
let appToken = '';
let appAccount: { id: string; code: string } = { id: '', code: '' };

const adminApi = (path: string, body?: Record<string, unknown>) =>
  body === undefined
    ? api('GET', `/v1/admin/${path}`, { token: appToken })
    : api('POST', `/v1/admin/${path}`, { token: appToken, body });

before(async () => {
  h = await startHarness({ adminToken: ADMIN_TOKEN, adminSubs: [ADMIN_SUB] });
  admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
  // 앱의 운영자 계정 (닉네임이 있는 구글 로그인 계정)
  const dev = await newDevice('18+', '운영고양이');
  appAccount = { id: dev.id, code: dev.code };
  appToken = await session(dev.id, ADMIN_SUB);
});

after(async () => {
  await h?.stop();
});

const noticeForm = {
  id: 'keep-me',
  kind: 'info',
  title_ko: '보존될 제목',
  title_en: 'Kept title',
  body_ko: '한국어 본문\n두 번째 줄',
  body_en: 'English body',
  link: 'https://evil.example.com/x',
};

describe('실패한 제출의 입력 보존', () => {
  test('허용 안 되는 링크로 공지를 내면 쓴 글이 그대로 남고 오류가 폼 가까이에 뜬다', async () => {
    const r = await admin.post('/admin/notices', noticeForm);
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location') ?? '', /#form-error$/);
    const page = await admin.page('/notices');
    assert.match(page.text, /value="keep-me"/);
    assert.match(page.text, /value="보존될 제목"/);
    assert.match(page.text, /value="Kept title"/);
    assert.match(page.text, />한국어 본문\n두 번째 줄<\/textarea>/);
    assert.match(page.text, /value="https:\/\/evil\.example\.com\/x"/);
    assert.match(page.text, /<p class="flash error wide" role="alert" id="form-error">/);
    // 오류는 공지 폼 안(폼 여는 태그 바로 뒤)에 있고 맨 위 알림 줄에는 없다
    const form = page.text.indexOf('action="/admin/notices" class="grid"');
    assert.ok(form > 0);
    assert.ok(page.text.indexOf('id="form-error"') > form);
    assert.ok(page.text.indexOf('id="form-error"') < form + 200);
    assert.equal(page.text.split('id="form-error"').length, 2);
    // 고른 종류도 그대로
    // 한 번 보이고 사라진다
    const again = await admin.page('/notices');
    assert.doesNotMatch(again.text, /value="보존될 제목"/);
    assert.doesNotMatch(again.text, /id="form-error"/);
  });

  test('쓴 글이 길어도 다른 폼은 채우지 않고, 확인 칸은 다시 체크해야 한다', async () => {
    const r = await admin.post('/admin/grants/batch', {
      accounts: 'F-NOPE-0000',
      coins: '12',
      chat_passes: '0',
      days: '7',
      reason: '보상 지급 사유',
      confirm: 'yes',
    });
    assert.equal(r.status, 303);
    const page = await admin.page('/grants');
    assert.match(page.text, />F-NOPE-0000<\/textarea>/);
    assert.match(page.text, /name="coins"[^>]*value="12"/);
    assert.match(page.text, /name="days"[^>]*value="7"/);
    assert.match(page.text, />보상 지급 사유<\/textarea>/);
    assert.match(page.text, /없는 계정이에요: F-NOPE-0000/);
    assert.doesNotMatch(page.text, /name="confirm" value="yes" required checked/);
    const other = await admin.page('/notices');
    assert.doesNotMatch(other.text, /F-NOPE-0000/);
  });

  test('이벤트 폼은 종류, 배수 까닭 체크, 날짜까지 되살린다', async () => {
    const from = kstInput(Date.now() + 3_600_000);
    const until = kstInput(Date.now() - 3_600_000); // 끝이 지금보다 앞이라 거절
    const r = await admin.post('/admin/events', {
      id: 'boost-keep',
      kind: 'boost',
      title_ko: '배수 제목',
      title_en: 'Boost',
      body_ko: '본문',
      body_en: 'Body',
      from,
      until,
      times: '3',
      reasons: ['focus'],
    });
    assert.equal(r.status, 303);
    const page = await admin.page('/events');
    assert.match(page.text, /value="boost-keep"/);
    assert.match(page.text, /<option value="boost" selected>/);
    assert.match(page.text, /<option value="3" selected>/);
    assert.match(page.text, /value="focus" checked>/);
    assert.doesNotMatch(page.text, /value="meet" checked>/);
    assert.match(page.text, new RegExp(`name="from" type="datetime-local" required value="${from}"`));
  });

  test('같은 모양의 폼이 여럿이면 실패한 대상의 폼만 채운다 (기능 스위치 허용 계정)', async () => {
    const r = await admin.post('/admin/features/allow', {
      key: 'friends',
      allowed: '1',
      account: 'F-NOPE-1111',
    });
    assert.equal(r.status, 303);
    const page = await admin.page('/features');
    const hits = page.text.split('value="F-NOPE-1111"').length - 1;
    assert.equal(hits, 1);
    assert.match(page.text, /없는 계정이에요/);
  });

  test('쿠폰 폼도 거절되면 쓴 값을 지키고 확인 칸은 다시 체크해야 한다', async () => {
    const r = await admin.post('/admin/coupons', {
      label: '메모 보존',
      coins: '5',
      tickets: '0',
      max_uses: '0',
      until: kstInput(Date.now() + 86_400_000),
    });
    assert.equal(r.status, 303);
    const page = await admin.page('/events');
    assert.match(page.text, /name="label" required maxlength="80" value="메모 보존"/);
    assert.equal(page.text.includes('value="yes" required checked'), false);
  });

  test('성공하면 채우지 않고 맨 위 알림 줄만 쓴다', async () => {
    const out = await admin.act('/admin/notices', { ...noticeForm, link: '' });
    assert.equal(out.ok, true);
    const page = await admin.page('/notices');
    assert.doesNotMatch(page.text, /id="form-error"/);
    assert.doesNotMatch(page.text, /name="id" required maxlength="80"[^>]*value="keep-me"/);
    await admin.act('/admin/notices/delete', { id: 'keep-me', confirm: 'keep-me' });
  });
});

describe('되돌릴 수 없는 동작의 확인', () => {
  const kinds = async () => {
    const day = 86_400_000;
    const mk = async (id: string, from: number, until: number) =>
      admin.act('/admin/events', {
        id,
        kind: 'gift',
        coins: '10',
        title_ko: `행사 ${id}`,
        title_en: id,
        body_ko: '본문',
        body_en: 'Body',
        from: kstInput(from),
        until: kstInput(until),
      });
    return { mk, day };
  };

  const markOf = async (action: string, target: string) =>
    (
      await h.pool.query<{ detail: { confirm?: string } | null }>(
        'SELECT detail FROM admin_log WHERE action = $1 AND target = $2 ORDER BY id DESC LIMIT 1',
        [action, target],
      )
    ).rows[0]?.detail?.confirm;

  test('확인한 대상이 틀리면 거절되고 아무것도 바뀌지 않는다 (웹)', async () => {
    const { mk, day } = await kinds();
    assert.ok((await mk('sure-live', Date.now() - 3_600_000, Date.now() + day)).ok);
    const r = await admin.act('/admin/events/end', { id: 'sure-live', confirm: 'other-event' });
    assert.equal(r.ok, false);
    assert.match(r.text, /확인한 대상이 달라요 \(이벤트 sure-live 끝내기\)/);
    const row = await h.pool.query('SELECT ends_at > now() AS live FROM event WHERE id = $1', ['sure-live']);
    assert.equal(row.rows[0]?.live, true);

    await admin.act('/admin/coupons', {
      label: '확인 쿠폰',
      coins: '5',
      tickets: '0',
      max_uses: '3',
      until: kstInput(Date.now() + day),
    });
    const cid = (await h.pool.query<{ id: string }>('SELECT id FROM coupon ORDER BY id DESC LIMIT 1')).rows[0]
      ?.id as string;
    const c = await admin.act('/admin/coupons/disable', { id: cid, confirm: '99999' });
    assert.equal(c.ok, false);
    assert.equal(
      (await h.pool.query('SELECT disabled_at FROM coupon WHERE id = $1', [cid])).rows[0]?.disabled_at,
      null,
    );
    await admin.act('/admin/notices', { ...noticeForm, id: 'sure-notice', link: '' });
    const n = await admin.act('/admin/notices/delete', { id: 'sure-notice', confirm: 'nope' });
    assert.equal(n.ok, false);
    const doc = await h.pool.query(`SELECT body FROM site_doc WHERE name = 'notices'`);
    assert.match(JSON.stringify(doc.rows[0]?.body), /sure-notice/);

    // 맞는 확인은 통과하고 기록에 "확인 없이" 표시가 없다
    assert.ok((await admin.act('/admin/events/end', { id: 'sure-live', confirm: 'sure-live' })).ok);
    assert.ok((await admin.act('/admin/coupons/disable', { id: cid, confirm: cid })).ok);
    assert.ok((await admin.act('/admin/notices/delete', { id: 'sure-notice', confirm: 'sure-notice' })).ok);
    assert.equal(await markOf('event.end', 'sure-live'), undefined);
  });

  test('옛 앱(0.5.0)처럼 확인 없이 와도 받고, 운영 기록에 "확인 없이(옛 앱)" 를 남긴다', async () => {
    const { mk, day } = await kinds();
    assert.ok((await mk('old-live', Date.now() - 3_600_000, Date.now() + day)).ok);
    assert.equal((await adminApi('events/end', { id: 'old-live' })).status, 200);
    assert.equal(await markOf('event.end', 'old-live'), '확인 없이(옛 앱)');
    const dev = await newDevice('18+', '옛앱 대상');
    assert.equal((await adminApi('ai/block', { account: dev.code, blocked: true })).status, 200);
    assert.equal(await markOf('ai.block', `account:${dev.id}`), '확인 없이(옛 앱)');
    // 푸는 쪽은 확인이 없어도 표시가 없다
    assert.equal((await adminApi('ai/block', { account: dev.code, blocked: false })).status, 200);
    assert.equal(await markOf('ai.unblock', `account:${dev.id}`), undefined);
    // 확인이 오면 이름이 맞아야 한다
    const bad = await adminApi('ai/cancel', { account: dev.code, confirm: 'F-ZZZZ-ZZZZ' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'confirm');
    assert.equal(
      (await adminApi('ai/block', { account: dev.code, blocked: true, confirm: dev.code })).status,
      200,
    );
    assert.equal(await markOf('ai.block', `account:${dev.id}`), undefined);
  });

  test('운영자 화면은 대상 이름이 적힌 확인 칸과 단추를 그린다', async () => {
    const { mk, day } = await kinds();
    assert.ok((await mk('sure-name', Date.now() - 3_600_000, Date.now() + day)).ok);
    const page = await admin.page('/events');
    assert.match(
      page.text,
      /class="sure"[^>]*>.*name="confirm" value="sure-name" required> 이벤트 &quot;행사 sure-name&quot; \(sure-name\) 지금 끝낼게요<\/label><button type="submit" class="danger">지금 끝내기/s,
    );
    // 이벤트 끝내기 단추는 확인 칸 없이 단독으로 있지 않다
    assert.doesNotMatch(
      page.text,
      /class="inline"><input type="hidden" name="csrf"[^>]*><input type="hidden" name="id" value="sure-name"/,
    );
    await admin.act('/admin/events/end', { id: 'sure-name', confirm: 'sure-name' });
  });
});

describe('운영 기록의 누가, 대상, 동작 종류', () => {
  test('웹은 "웹 운영자", 앱은 닉네임과 번호가 남고 옛 기록(이름 없음)도 깨지지 않는다', async () => {
    const target = await newDevice('18+', '받는이');
    assert.equal(
      (await adminApi('notes', { account: target.code, message: '안녕', coins: 1, chat_passes: 0 })).status,
      200,
    );
    await admin.act('/admin/notes', { account: target.code, message: '웹에서', coins: '2' });
    const rows = await h.pool.query<{ actor: string; actor_name: string | null; target: string | null }>(
      `SELECT actor, actor_name, target FROM admin_log WHERE action = 'note.send' ORDER BY id`,
    );
    assert.equal(rows.rows.at(-2)?.actor, `account:${appAccount.id}`);
    assert.equal(rows.rows.at(-2)?.actor_name, `운영고양이 #${appAccount.id}`);
    assert.equal(rows.rows.at(-1)?.actor_name, '웹 운영자');
    // 옛 기록: 이름 칸이 비어 있다
    await h.pool.query(
      `INSERT INTO admin_log (actor, action, target) VALUES ('admin:deadbeef', 'event.end', 'old-event')`,
    );
    const page = await admin.page('/log');
    assert.equal(page.status, 200);
    assert.match(page.text, /운영고양이 #\d+<br><small><code>account:\d+<\/code>/);
    assert.match(page.text, /웹 운영자<br><small><code>admin:/);
    assert.match(page.text, /<td><code>admin:deadbeef<\/code><\/td>/);
    assert.match(page.text, /이벤트 끝내기<br><small><code>event\.end<\/code>/);
    // 앱 개요에도 같은 자료
    const ov = await adminApi('overview');
    assert.equal(ov.status, 200);
    assert.ok(
      ov.body.log.some((l: { actorName: string | null }) => l.actorName === `운영고양이 #${appAccount.id}`),
    );
    assert.ok(
      ov.body.log.some(
        (l: { actor: string; actorName: string | null }) =>
          l.actor === 'admin:deadbeef' && l.actorName === null,
      ),
    );
    assert.equal(typeof ov.body.logPage.total, 'number');
  });

  test('대상 이용자(번호, 기기 코드, 닉네임), 동작 종류, 글 검색으로 걸러진다', async () => {
    const a = await newDevice('18+', '찾는사람');
    const b = await newDevice('18+', '다른사람');
    await admin.act('/admin/notes', { account: a.code, message: '가나다 보상', coins: '3' });
    await admin.act('/admin/notes', { account: b.code, message: '라마바', coins: '4' });
    await admin.act('/admin/grants/batch', {
      accounts: a.code,
      coins: '1',
      chat_passes: '0',
      days: '30',
      reason: '묶음 지급',
      confirm: 'yes',
    });

    const byCode = await admin.page(`/log?user=${encodeURIComponent(a.code)}`);
    assert.match(byCode.text, new RegExp(`찾는사람 #${a.id}`));
    assert.doesNotMatch(byCode.text, new RegExp(`다른사람 #${b.id}`));
    const byId = await admin.page(`/log?user=${a.id}`);
    assert.match(byId.text, new RegExp(`account:${a.id}`));
    const byName = await admin.page(`/log?user=${encodeURIComponent('찾는사')}`);
    assert.match(byName.text, new RegExp(`account:${a.id}`));
    assert.doesNotMatch(byName.text, new RegExp(`account:${b.id}<`));

    const byAction = await admin.page('/log?action=grant.batch');
    assert.match(byAction.text, /<code>grant\.batch<\/code>/);
    assert.doesNotMatch(byAction.text, /<code>note\.send<\/code>/);
    // 동작 종류 상자는 기록에 있는 종류만, 고른 것이 선택됨
    assert.match(byAction.text, /<option value="grant\.batch" selected>지급 묶음 \(grant\.batch\)<\/option>/);

    const byText = await admin.page(`/log?text=${encodeURIComponent('가나다')}`);
    assert.match(byText.text, new RegExp(`account:${a.id}`));
    assert.doesNotMatch(byText.text, new RegExp(`account:${b.id}<`));
    // 검색어의 % 와 _ 는 글자로 본다
    const wild = await admin.page(`/log?text=${encodeURIComponent('%')}`);
    assert.match(wild.text, /조건에 맞는 기록이 없어요/);

    const none = await admin.page('/log?user=F-ZZZZ-ZZZZ');
    assert.match(none.text, /그 이용자를 찾지 못했어요/);
    assert.match(none.text, /조건에 맞는 기록이 없어요/);

    // 앱 개요도 같은 걸러내기
    const ov = await adminApi(`overview?user=${a.id}`);
    assert.equal(ov.status, 200);
    assert.ok(ov.body.log.length > 0);
    assert.ok(ov.body.log.every((l: { target: string | null }) => l.target === `account:${a.id}`));
  });

  test('쪽 넘기기: 50건씩, 걸러낸 조건을 쪽 주소에 유지한다', async () => {
    const t = await newDevice('18+', '많은기록');
    const values = Array.from(
      { length: 120 },
      (_, i) => `('admin:00000000', '웹 운영자', 'note.send', 'account:${t.id}', '{"i":${i}}')`,
    );
    await h.pool.query(
      `INSERT INTO admin_log (actor, actor_name, action, target, detail) VALUES ${values.join(',')}`,
    );
    const p1 = await admin.page(`/log?user=${t.id}`);
    assert.match(p1.text, /1 \/ 3/);
    assert.match(p1.text, /운영 기록 120건/);
    assert.match(p1.text, new RegExp(`href="/admin/log\\?user=${t.id}&amp;page=2"`));
    const p3 = await admin.page(`/log?user=${t.id}&page=3`);
    assert.match(p3.text, /3 \/ 3/);
    assert.equal(p3.text.split('<td>').length - 1 > 0, true);
    const over = await admin.page(`/log?user=${t.id}&page=99`);
    assert.match(over.text, /3 \/ 3/);
  });
});

describe('처리 중 표시와 스크립트', () => {
  test('운영자 화면은 바깥 스크립트 하나만 쓰고 CSP 는 같은 곳 스크립트만 허용한다', async () => {
    const page = await admin.page('');
    assert.match(page.text, /<script src="\/admin\/admin\.js" defer><\/script>/);
    assert.doesNotMatch(page.text, /<script(?![^>]*src=)/i);
    assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    const js = await api('GET', '/admin/admin.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);
    assert.match(js.text, /처리 중/);
    const anon = await api('GET', '/admin');
    assert.doesNotMatch(anon.text, /<script/i);
  });
});
