import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminJs } from '../src/admin-page';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const adminJsSource = () => adminJs;

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
let h: Harness;
const { api, newDevice } = client(() => h);
let admin: AdminBrowser;

const browser = () =>
  new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );

before(async () => {
  h = await startHarness({ adminToken: ADMIN_TOKEN });
  admin = browser();
  assert.equal((await admin.login()).status, 303);
  await admin.page();
});

after(async () => {
  await h?.stop();
});

const LEGACY: Array<[string, string]> = [
  ['', '#home'],
  ['/users', '#users/list'],
  ['/grants', '#users/grants'],
  ['/notices', '#announce/notices'],
  ['/events', '#announce/events'],
  ['/features', '#settings/features'],
  ['/ai', '#settings/ai'],
  ['/log', '#settings/log'],
];

describe('운영자 다섯 칸과 이용자 표', () => {
  test('로그인 뒤 한 장에 다섯 칸과 하위가 모두 있고 옛 여덟 탭 주소는 새 자리로 간다', async () => {
    const signed = await admin.page();
    assert.equal(signed.status, 200);
    assert.doesNotMatch(signed.text, /<script(?![^>]*src="\/admin\/admin\.js")/i);
    assert.doesNotMatch(signed.text, /<script[^>]*>[^<]/i);
    for (const cell of ['home', 'users', 'reports', 'announce', 'settings'])
      assert.match(signed.text, new RegExp(`id="cell-${cell}"`), cell);
    assert.equal(
      (signed.text.match(/<nav class="cells"[^>]*>(.*?)<\/nav>/s)?.[1] ?? '').match(/<a /g)?.length,
      5,
    );
    for (const sub of [
      'users-list',
      'users-grants',
      'announce-notices',
      'announce-events',
      'announce-coupons',
      'settings-features',
      'settings-ai',
      'settings-log',
    ])
      assert.match(signed.text, new RegExp(`id="sub-${sub}"`), sub);
    // 옛 탭에 있던 기능이 한 군데도 빠지지 않았다 (폼 주소로 센다)
    for (const action of [
      '/admin/grants/preview',
      '/admin/notices/preview',
      '/admin/versions',
      '/admin/events',
      '/admin/coupons',
      '/admin/rewards/policy',
      '/admin/features/mode',
      '/admin/features/allow',
      '/admin/ai/mode',
      '/admin/ai/limits',
      '/admin/ai/policy',
    ])
      assert.match(signed.text, new RegExp(`action="${action}"`), action);
    assert.match(signed.text, /action="\/admin#users\/list"/);
    assert.match(signed.text, /action="\/admin#settings\/log"/);
    assert.match(signed.text, /<h2>사용량<\/h2>/);

    for (const [path, hash] of LEGACY) {
      const old = await admin.page(path, true);
      if (path === '') {
        assert.equal(old.status, 200);
        continue;
      }
      assert.equal(old.status, 302, path);
      assert.equal(old.headers.get('location'), `/admin${hash}`, path);
    }
    // 찾기 조건은 새 이름으로 이어진다
    const log = await admin.page('/log?user=7&action=login&text=a&page=2', true);
    assert.equal(log.headers.get('location'), '/admin?lu=7&la=login&lt=a&lp=2#settings/log');
    const users = await admin.page('/users?q=F-1&sort=coins', true);
    assert.equal(users.headers.get('location'), '/admin?q=F-1&sort=coins#users/list');
  });

  test('로그인 없이는 어느 주소든 운영 내용을 보여 주지 않는다', async () => {
    for (const path of ['', '/users', '/grants', '/notices', '/events', '/features', '/ai', '/log']) {
      const anon = await api('GET', `/admin${path}`);
      assert.equal(anon.status, 200, path);
      assert.match(anon.text, /운영자 토큰/);
      assert.doesNotMatch(anon.text, /name="csrf"/);
      assert.doesNotMatch(anon.text, /id="cell-/);
    }
    for (const path of ['/grants/preview', '/notices/preview', '/flow/cancel']) {
      const r = await api('POST', `/admin${path}`, {
        body: 'csrf=x',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      assert.equal(r.status, 401, path);
    }
  });

  test('검색, 쪽 넘기기, 정렬과 개인정보 제외, 닉네임 이스케이프', async () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const codes: string[] = [];
    for (let i = 0; i < 55; i++) {
      let n = i;
      let suffix = '';
      for (let j = 0; j < 4; j++) {
        suffix = alphabet[n % alphabet.length] + suffix;
        n = Math.floor(n / alphabet.length);
      }
      const code = `F-TAB${alphabet[i % alphabet.length]}-${suffix}`;
      codes.push(code);
      await h.pool.query(
        `INSERT INTO account (age, nickname, code, balance, last_active_at, app_version)
         VALUES ('18+', $1, $2, $3, now() - make_interval(mins => $4), '1.2.3')`,
        [i === 0 ? '<b>고양이</b>' : `표시험${i}`, code, 1000 - i, i],
      );
    }
    const secretSub = `private-${randomUUID()}`;
    const first = await h.pool.query<{ id: string }>('SELECT id FROM account WHERE code = $1', [codes[0]]);
    await h.pool.query(`INSERT INTO login (service, sub, account_id) VALUES ('google', $1, $2)`, [
      secretSub,
      first.rows[0]?.id,
    ]);
    await h.pool.query('INSERT INTO device (account_id, token_hash) VALUES ($1, $2)', [
      first.rows[0]?.id,
      randomBytes(32),
    ]);

    const page1 = await admin.page('/users?sort=coins&direction=desc');
    assert.equal(page1.status, 200);
    assert.match(page1.text, /1 \/ 2/);
    assert.doesNotMatch(page1.text, new RegExp(secretSub));
    assert.doesNotMatch(page1.text, /token_hash|이메일|name="email"/i);
    assert.doesNotMatch(page1.text, /<b>고양이<\/b>/);
    assert.match(page1.text, /&lt;b&gt;고양이&lt;\/b&gt;/);

    const page2 = await admin.page('/users?page=2&sort=coins&direction=desc');
    assert.equal(page2.status, 200);
    assert.match(page2.text, /2 \/ 2/);

    const searched = await admin.page(`/users?q=${encodeURIComponent(codes[0] ?? '')}`);
    assert.equal(searched.status, 200);
    assert.match(searched.text, new RegExp(codes[0] ?? '없음'));
    assert.match(searched.text, /구글/);

    const legacy = await admin.page(`?q=${encodeURIComponent(codes[1] ?? '')}`);
    assert.equal(legacy.status, 200);
    assert.match(legacy.text, /id="user-detail"/);
    // 옛 주소 /admin?q= 는 주소 해시가 없어도 이용자 칸으로 열린다 (스크립트가 주소의 찾기 조건으로 정한다)
    assert.match(adminJsSource(), /'q', 'page', 'sort', 'direction', 'user'/);
  });
});

describe('운영자 지급 탭', () => {
  test('여러 계정 지급은 쪽지와 운영 기록을 남긴다', async () => {
    const a = await newDevice('18+', '지급하나');
    const b = await newDevice('18+', '지급둘');
    const result = await admin.act('/admin/grants/batch', {
      accounts: `${a.code}\n${b.code}`,
      coins: '12',
      chat_passes: '3',
      days: '30',
      reason: '시험 지급',
      confirm: 'yes',
    });
    assert.ok(result.ok, result.text);
    const notes = await h.pool.query(
      `SELECT account_id::text, coins, chat_passes, message FROM inbox
       WHERE account_id = ANY($1::bigint[]) ORDER BY account_id`,
      [[a.id, b.id]],
    );
    assert.equal(notes.rowCount, 2);
    assert.ok(notes.rows.every((x) => x.coins === 12 && x.chat_passes === 3 && x.message === '시험 지급'));
    const logs = await h.pool.query(
      `SELECT action, count(*)::int AS n FROM admin_log
       WHERE action IN ('note.send', 'grant.batch') GROUP BY action`,
    );
    assert.equal(logs.rows.find((x) => x.action === 'note.send')?.n, 2);
    assert.equal(logs.rows.find((x) => x.action === 'grant.batch')?.n, 1);
  });

  test('확인과 CSRF가 없거나 인원과 양 한도를 넘으면 거절한다', async () => {
    const d = await newDevice('18+', '한도시험');
    const base = { accounts: d.code, coins: '1', chat_passes: '0', reason: '한도 시험' };
    assert.equal((await admin.act('/admin/grants/batch', base)).ok, false);
    const tooManyCoins = await admin.confirmPost('/admin/grants/batch', {
      ...base,
      coins: '10001',
      confirm: 'yes',
    });
    assert.equal(tooManyCoins.status, 303);
    assert.equal(tooManyCoins.headers.get('location'), '/admin#users/grants');
    const many = Array.from({ length: 21 }, () => d.code).join('\n');
    assert.equal(
      (await admin.act('/admin/grants/batch', { ...base, accounts: many, confirm: 'yes' })).ok,
      false,
    );
    assert.equal(
      (await admin.confirmPost('/admin/grants/batch', { ...base, confirm: 'yes' }, false)).status,
      403,
    );
  });
});

/** 한 문서에서 칸 하나의 본문 (다른 칸의 같은 글과 섞이지 않게) */
const cellOf = (text: string, cell: string) => {
  const start = text.indexOf(`id="cell-${cell}"`);
  const next = text.indexOf('<div class="panel"', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
};

describe('발행과 지급의 공통 흐름 (작성, 대상 확인, 미리보기, 확정, 결과 확인)', () => {
  // 운영자 세션의 분당 요청 상한(120)에 앞 시험이 걸리지 않게 새 세션으로 시작한다
  before(async () => {
    admin = browser();
    assert.equal((await admin.login()).status, 303);
    await admin.page();
  });

  const grantFields = (accounts: string, extra: Record<string, string> = {}) => ({
    accounts,
    coins: '7',
    chat_passes: '1',
    days: '10',
    reason: '흐름 시험',
    ...extra,
  });
  const noteCount = async (id: string) =>
    Number((await h.pool.query('SELECT count(*) AS n FROM inbox WHERE account_id = $1', [id])).rows[0].n);

  test('대상 확인까지는 아무것도 쓰지 않고, 새로 고쳐도 남고, 확정해야 보낸다', async () => {
    const a = await newDevice('18+', '흐름하나');
    const b = await newDevice('18+', '흐름둘');
    const logsBefore = Number((await h.pool.query('SELECT count(*) AS n FROM admin_log')).rows[0].n);
    const r = await admin.post('/admin/grants/preview', grantFields(`${a.code}\n${b.id}\n${a.code}`));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/admin#users/grants');
    assert.equal(await noteCount(a.id), 0);
    assert.equal(await noteCount(b.id), 0);
    for (let i = 0; i < 2; i++) {
      const page = await admin.page();
      const grants = cellOf(page.text, 'users');
      assert.match(grants, /<li class="now" aria-current="step">3\. 미리보기<\/li>/);
      assert.match(grants, /action="\/admin\/grants\/batch"/);
      assert.doesNotMatch(grants, /action="\/admin\/grants\/preview"/);
      assert.match(grants, /<dt>받는 사람<\/dt><dd>2명<\/dd>/);
      assert.match(grants, /흐름하나/);
      assert.match(grants, /흐름둘/);
      assert.match(grants, /<span class="tag">중복<\/span>/);
      assert.match(grants, /<dt>모두 합쳐<\/dt><dd>코인 14, 채팅 이용권 2장<\/dd>/);
      assert.doesNotMatch(grants, /type="submit" disabled/);
      assert.match(grants, /name="confirm" value="yes" required/);
      assert.match(page.text, /data-flash="ok"/);
    }
    assert.equal(Number((await h.pool.query('SELECT count(*) AS n FROM admin_log')).rows[0].n), logsBefore);

    const fields = grantFields(`${a.code}\n${b.id}\n${a.code}`);
    const noConfirm = await admin.act('/admin/grants/batch', fields);
    assert.equal(noConfirm.ok, false);
    assert.equal(await noteCount(a.id), 0);
    // 실패하면 미리보기는 닫히고 쓴 값은 작성 화면에 돌아온다
    const back = cellOf((await admin.page()).text, 'users');
    assert.match(back, /<li class="now" aria-current="step">1\. 작성<\/li>/);

    await admin.post('/admin/grants/preview', fields);
    const done = await admin.act('/admin/grants/batch', { ...fields, confirm: 'yes' });
    assert.ok(done.ok, done.text);
    assert.equal(await noteCount(a.id), 1);
    assert.equal(await noteCount(b.id), 1);
    const after = cellOf((await admin.page()).text, 'users');
    assert.doesNotMatch(after, /class="now" aria-current="step">3\. 미리보기/);
  });

  test('결과 확인 단계는 성공 글을 폼 자리에 보이고 운영 기록으로 이어 준다', async () => {
    const d = await newDevice('18+', '결과확인');
    const fields = grantFields(d.code);
    const r = await admin.confirmPost('/admin/grants/batch', { ...fields, confirm: 'yes' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/admin#users/grants');
    const page = await admin.page();
    const users = cellOf(page.text, 'users');
    assert.match(
      users,
      /<div class="flow-result"><ol class="steps"[^>]*>.*?<li class="now" aria-current="step">5\. 결과 확인<\/li>/s,
    );
    assert.match(users, /<p class="flash" role="status" id="form-ok">1명에게 지급 쪽지를 보냈어요/);
    assert.match(users, /href="\/admin\?la=grant\.batch#settings\/log"/);
    // 맨 위가 아니라 폼 자리에만 한 번 (같은 글이 두 번 나오지 않는다)
    assert.equal(page.text.split('id="form-ok"').length, 2);
    // 한 번 보이고 사라진다
    assert.doesNotMatch((await admin.page()).text, /id="form-ok"/);
  });

  test('찾지 못한 계정, 18세 미만 채팅 이용권은 대상 확인에서 막히고 고치기로 쓴 값이 돌아온다', async () => {
    const minor = await newDevice('14+', '열넷');
    await admin.post('/admin/grants/preview', grantFields(`${minor.code}\nF-NOPE-0000`));
    const blocked = cellOf((await admin.page()).text, 'users');
    assert.match(blocked, /찾지 못함/);
    assert.match(blocked, /찾지 못한 계정이 1개 있어요/);
    assert.match(blocked, /<button type="submit" disabled>확정하고 지급 쪽지 보내기/);

    await admin.post('/admin/flow/cancel', { action: 'grants/batch' });
    const edit = cellOf((await admin.page()).text, 'users');
    assert.match(edit, /<li class="now" aria-current="step">1\. 작성<\/li>/);
    assert.match(edit, new RegExp(`>${minor.code}\\nF-NOPE-0000</textarea>`));
    assert.match(edit, /name="coins"[^>]*value="7"/);
    assert.doesNotMatch(edit, /role="alert"/);
    // 한 번만 되살린다
    assert.doesNotMatch(cellOf((await admin.page()).text, 'users'), /F-NOPE-0000/);

    await admin.post('/admin/grants/preview', grantFields(minor.code));
    assert.match(
      cellOf((await admin.page()).text, 'users'),
      /만 18세 미만 계정에는 채팅 이용권을 줄 수 없어요/,
    );
    await admin.post('/admin/flow/cancel', { action: 'grants/batch' });
    await admin.page();
    // 코인만이면 14세도 대상이다
    await admin.post('/admin/grants/preview', grantFields(minor.code, { chat_passes: '0' }));
    assert.doesNotMatch(cellOf((await admin.page()).text, 'users'), /type="submit" disabled/);
    await admin.post('/admin/flow/cancel', { action: 'grants/batch' });
    await admin.page();
  });

  test('작성이 맞지 않으면 미리보기로 가지 않고 그 폼에 오류가 뜬다. 출처와 CSRF 는 그대로', async () => {
    const d = await newDevice('18+', '검사');
    const bad = await admin.post('/admin/grants/preview', grantFields(d.code, { coins: '10001' }));
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get('location'), '/admin#users/grants');
    const page = await admin.page();
    const users = cellOf(page.text, 'users');
    assert.match(users, /<p class="flash error wide" role="alert" id="form-error">코인: 0~10000/);
    assert.match(users, /<li class="now" aria-current="step">1\. 작성<\/li>/);
    assert.match(users, /name="coins"[^>]*value="10001"/);
    assert.equal((await admin.post('/admin/grants/preview', grantFields(d.code), false)).status, 403);
    assert.equal(
      (await admin.post('/admin/grants/preview', grantFields(d.code), true, 'https://evil.example.com'))
        .status,
      403,
    );
    assert.equal((await admin.post('/admin/flow/cancel', { action: 'notices' }, false)).status, 403);
    await admin.page();
  });

  test('공지는 미리보기에서 공지 창 모양과 바뀌는 것을 보고 확정한다. 강제 글은 확정에서 체크해야 한다', async () => {
    const form = {
      id: 'flow-notice',
      kind: 'info',
      title_ko: '흐름 공지',
      title_en: 'Flow notice',
      body_ko: '본문',
      body_en: 'Body',
    };
    const r = await admin.post('/admin/notices/preview', form);
    assert.equal(r.headers.get('location'), '/admin#announce/notices');
    const before = await h.pool.query(`SELECT 1 FROM site_doc WHERE name = 'notices'`);
    const page = await admin.page();
    const announce = cellOf(page.text, 'announce');
    assert.match(announce, /<li class="now" aria-current="step">3\. 미리보기<\/li>/);
    assert.match(announce, /<div class="preview info" lang="ko">/);
    assert.match(announce, /없음 \(새로 넣어요\)/);
    assert.match(announce, /action="\/admin\/notices" class="grid"/);
    assert.doesNotMatch(announce, /강제 업데이트 글이에요/);
    assert.equal(
      (await h.pool.query(`SELECT 1 FROM site_doc WHERE name = 'notices'`)).rowCount,
      before.rowCount,
    );
    const saved = await admin.act('/admin/notices', form);
    assert.ok(saved.ok, saved.text);
    assert.match(cellOf((await admin.page()).text, 'announce'), /flow-notice/);

    // 같은 id 로 다시 올리면 바꾼다고 알려 준다. 강제 글은 체크 칸이 있다
    const force = { ...form, kind: 'force', title_ko: '바뀐 제목' };
    await admin.post('/admin/notices/preview', force);
    const again = cellOf((await admin.page()).text, 'announce');
    assert.match(again, /있음, 바꿔요 \(지금 제목 흐름 공지\)/);
    assert.match(again, /name="confirm" value="yes" required/);
    assert.equal((await admin.act('/admin/notices', force)).ok, false);
    await admin.post('/admin/notices/preview', force);
    assert.ok((await admin.act('/admin/notices', { ...force, confirm: 'yes' })).ok);
    assert.ok((await admin.act('/admin/notices/delete', { id: 'flow-notice', confirm: 'flow-notice' })).ok);
  });
});

describe('홈의 할 일과 신고 칸, 앱 개요 API', () => {
  // 운영자 세션의 분당 요청 상한(120)에 앞 시험이 걸리지 않게 새 세션으로 시작한다
  before(async () => {
    admin = browser();
    assert.equal((await admin.login()).status, 303);
    await admin.page();
  });

  const overview = async (query = '') =>
    api('GET', `/v1/admin/overview${query}`, { headers: { cookie: admin.cookie }, ip: admin.from });

  test('신고가 없으면 빈 상태, 있으면 건수가 홈 카드와 신고 칸에 보인다', async () => {
    let page = await admin.page();
    assert.match(cellOf(page.text, 'reports'), /접수된 신고가 없어요/);
    assert.doesNotMatch(cellOf(page.text, 'home'), /처리하지 않은 신고가/);
    assert.equal((await overview()).body.reports.total, 0);

    const d = await newDevice('18+', '신고자');
    await h.pool.query(
      `INSERT INTO ai_report (account_id, question, answer) VALUES ($1, '비밀질문본문', '비밀답변본문')`,
      [d.id],
    );
    page = await admin.page();
    assert.match(cellOf(page.text, 'reports'), /href="\/admin\?report=\d+#reports"/);
    assert.match(cellOf(page.text, 'home'), /<a href="#reports">처리하지 않은 신고가 1건 있어요<\/a>/);
    // 대화 본문은 열어 보기 전에는 어느 화면에도 나오지 않는다 (신고 처리: admin-reports.test.ts)
    assert.doesNotMatch(page.text, /비밀질문본문|비밀답변본문/);
    const ov = await overview();
    assert.equal(ov.status, 200);
    assert.equal(ov.body.reports.total, 1);
    assert.ok(ov.body.todo.some((t: { kind: string; n: number }) => t.kind === 'reports' && t.n === 1));
    await h.pool.query('DELETE FROM ai_report');
  });

  test('앱 개요 API 는 옛 앱이 읽던 칸을 그대로 두고 새 칸만 더한다', async () => {
    // 앞 시험에 기대지 않는다: 이 시험 안에서 공지와 지급 기록을 만든다
    const d = await newDevice('18+', '개요시험');
    assert.ok(
      (
        await admin.act('/admin/notices', {
          id: 'ov-notice',
          kind: 'info',
          title_ko: '개요 공지',
          title_en: 'Overview',
          body_ko: '본문',
          body_en: 'Body',
        })
      ).ok,
    );
    assert.ok(
      (
        await admin.act('/admin/grants/batch', {
          accounts: d.code,
          coins: '1',
          chat_passes: '0',
          days: '30',
          reason: '개요 시험',
          confirm: 'yes',
        })
      ).ok,
    );
    const ov = await overview();
    assert.equal(ov.status, 200);
    for (const key of [
      'summary',
      'accounts',
      'users',
      'ai',
      'events',
      'coupons',
      'notices',
      'latest',
      'features',
      'versions',
      'log',
      'logPage',
      'rewardsLoginOnly',
    ])
      assert.ok(key in ov.body, key);
    for (const key of ['accounts', 'coins', 'tickets', 'aiCostMicros'])
      assert.equal(typeof ov.body.summary[key], 'number', key);
    assert.ok(Array.isArray(ov.body.recent) && ov.body.recent.length <= 5);
    assert.ok(Array.isArray(ov.body.todo));
    // 옛 앱의 운영 기록 찾기 이름(user, action, text, page)은 그대로 듣는다
    const some = await overview('?action=grant.batch');
    assert.ok(some.body.log.length >= 1, 'grant.batch 기록이 있어야 every 가 빈 배열로 통과하지 않는다');
    assert.ok(ov.body.notices.notices.some((n: { id: string }) => n.id === 'ov-notice'));
    assert.ok(some.body.log.every((l: { action: string }) => l.action === 'grant.batch'));
  });
});

/** 미리보기 화면의 확정 폼이 보내는 값 그대로 (숨은 칸 전부, 확인 칸은 체크) */
function confirmFormOf(html: string, action: 'grants/batch' | 'notices'): Record<string, string> {
  const m = new RegExp(`<form method="post" action="/admin/${action}"[^>]*>([\\s\\S]*?)</form>`).exec(
    cellOf(html, action === 'notices' ? 'announce' : 'users'),
  );
  assert.ok(m, 'confirm form');
  const out: Record<string, string> = {};
  for (const x of (m[1] ?? '').matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g))
    if (x[1] !== 'csrf') out[x[1] as string] = (x[2] as string).replaceAll('&#10;', '\n');
  out.confirm = 'yes';
  const people = /name="people"[^>]*pattern="(\d+)"/.exec(m[1] ?? '')?.[1];
  if (people) out.people = people;
  return out;
}

describe('미리보기는 한 번만 확정된다 (두 탭, 뒤로 가기)', () => {
  // 운영자 세션의 분당 요청 상한(120)에 앞 시험이 걸리지 않게 새 세션으로 시작한다
  before(async () => {
    admin = browser();
    assert.equal((await admin.login()).status, 303);
    await admin.page();
  });

  const g = (accounts: string, reason = '한 번만') => ({
    accounts,
    coins: '500',
    chat_passes: '0',
    days: '30',
    reason,
  });
  const notes = async (id: string) =>
    Number((await h.pool.query('SELECT count(*) AS n FROM inbox WHERE account_id = $1', [id])).rows[0].n);

  test('같은 미리보기를 두 탭에서 확정하면 한 번만 지급하고 두 번째는 폼 근처에 안내한다', async () => {
    const d = await newDevice('18+', '두탭');
    await admin.post('/admin/grants/preview', g(d.code));
    const tabA = confirmFormOf((await admin.page()).text, 'grants/batch');
    const tabB = confirmFormOf((await admin.page()).text, 'grants/batch');
    assert.ok(tabA.flow && tabA.flow === tabB.flow);
    assert.equal((await admin.post('/admin/grants/batch', tabA)).status, 303);
    assert.equal(await notes(d.id), 1);
    const r2 = await admin.post('/admin/grants/batch', tabB);
    assert.equal(r2.status, 303);
    assert.equal(await notes(d.id), 1, '두 번째 확정은 지급하지 않는다');
    const page = await admin.page();
    assert.match(
      cellOf(page.text, 'users'),
      /<p class="flash error wide" role="alert" id="form-error">이미 확정했거나 닫힌 미리보기예요/,
    );
  });

  test('성공 뒤 뒤로 가기로 같은 확정을 다시 보내도, 고치기로 닫은 옛 미리보기도 지급하지 않는다', async () => {
    const d = await newDevice('18+', '뒤로');
    await admin.post('/admin/grants/preview', g(d.code));
    const first = confirmFormOf((await admin.page()).text, 'grants/batch');
    await admin.post('/admin/grants/batch', first);
    await admin.post('/admin/grants/batch', first);
    assert.equal(await notes(d.id), 1);
    // 옛 미리보기의 번호는 새 미리보기가 생겨도 쓸 수 없다
    await admin.post('/admin/grants/preview', g(d.code, '둘째'));
    const second = confirmFormOf((await admin.page()).text, 'grants/batch');
    assert.notEqual(second.flow, first.flow);
    await admin.post('/admin/grants/batch', first);
    assert.equal(await notes(d.id), 1);
    // 그 시도가 둘째 미리보기까지 닫으므로 둘째도 다시 만들어야 한다
    await admin.post('/admin/grants/preview', g(d.code, '셋째'));
    const third = confirmFormOf((await admin.page()).text, 'grants/batch');
    await admin.post('/admin/flow/cancel', { action: 'grants/batch' });
    await admin.post('/admin/grants/batch', third);
    assert.equal(await notes(d.id), 1, '고치기로 닫은 미리보기는 확정할 수 없다');
    // 미리보기를 거친 확정은 받는다
    assert.ok((await admin.act('/admin/grants/batch', { ...g(d.code, '거친'), confirm: 'yes' })).ok);
    assert.equal(await notes(d.id), 2);
  });

  test('웹 확정은 번호가 없거나, 비었거나, 둘이거나, 작성 단계에 끼워 넣은 번호면 지급하지 않는다', async () => {
    const d = await newDevice('18+', '번호검사');
    const base = { ...g(d.code, '번호'), confirm: 'yes' };
    // 번호 없이 직접
    await admin.post('/admin/grants/batch', base);
    // 미리보기는 있어도 번호를 빼거나 비운다
    await admin.post('/admin/grants/preview', g(d.code));
    const f1 = confirmFormOf((await admin.page()).text, 'grants/batch');
    const { flow: _drop, ...noFlow } = f1;
    await admin.post('/admin/grants/batch', noFlow);
    await admin.post('/admin/grants/batch', { ...noFlow, flow: '' });
    await admin.post('/admin/grants/preview', g(d.code));
    const f2 = confirmFormOf((await admin.page()).text, 'grants/batch');
    // 같은 이름을 둘 보내면 (배열) 거절
    await admin.post('/admin/grants/batch', { ...f2, flow: [f2.flow ?? '', f2.flow ?? ''] });
    await admin.post('/admin/grants/batch', f2);
    assert.equal(await notes(d.id), 0, '번호가 잘못된 확정은 지급하지 않는다');
    // 작성 단계에 flow 를 끼워 넣어도 확정 폼에는 서버 번호 하나뿐
    await admin.post('/admin/grants/preview', { ...g(d.code), flow: 'x' });
    const f3 = confirmFormOf((await admin.page()).text, 'grants/batch');
    const html = (await admin.page()).text;
    assert.equal((html.match(/name="flow"/g) ?? []).length, 1);
    assert.notEqual(f3.flow, 'x');
    await admin.post('/admin/grants/batch', { ...f3, flow: 'x' });
    assert.equal(await notes(d.id), 0);
    await admin.post('/admin/grants/preview', g(d.code));
    const f4 = confirmFormOf((await admin.page()).text, 'grants/batch');
    await admin.post('/admin/grants/batch', f4);
    await admin.post('/admin/grants/batch', f4);
    assert.equal(await notes(d.id), 1);
    // 거절은 작성 폼 근처에 안내
    await admin.post('/admin/grants/batch', base);
    assert.match(cellOf((await admin.page()).text, 'users'), /id="form-error">이미 확정했거나 닫힌/);
  });

  test('공지도 같은 미리보기를 두 번 확정할 수 없다', async () => {
    const form = {
      id: 'once-notice',
      kind: 'info',
      title_ko: '한 번',
      title_en: 'Once',
      body_ko: '본문',
      body_en: 'Body',
    };
    await admin.post('/admin/notices/preview', form);
    const tab = confirmFormOf((await admin.page()).text, 'notices');
    assert.ok(tab.flow);
    await admin.post('/admin/notices', tab);
    await admin.post('/admin/notices', tab);
    await admin.post('/admin/notices', { ...form, confirm: 'yes' });
    await admin.post('/admin/notices', { ...tab, flow: '' });
    const logs = await h.pool.query(
      `SELECT action FROM admin_log WHERE target = 'once-notice' AND action IN ('notice.create', 'notice.update')`,
    );
    assert.deepEqual(
      logs.rows.map((x) => x.action),
      ['notice.create'],
    );
    assert.match(cellOf((await admin.page()).text, 'announce'), /이미 확정했거나 닫힌 미리보기예요/);
    assert.ok((await admin.act('/admin/notices/delete', { id: 'once-notice', confirm: 'once-notice' })).ok);
  });

  test('미리보기가 떠 있는데 다른 이용자의 지급 링크로 오면 이어서, 버리고 새로 중에 고르게 한다', async () => {
    const a = await newDevice('18+', '쓰던대상');
    const b = await newDevice('18+', '새로운대상');
    await admin.post('/admin/grants/preview', g(a.code));
    const page = await admin.page(`?account=${encodeURIComponent(b.code)}`);
    const users = cellOf(page.text, 'users');
    assert.match(users, /쓰던 지급이 있어요/);
    assert.match(users, new RegExp(`버리고 ${b.code} 로`));
    assert.match(users, /쓰던대상/);
    assert.match(users, /href="\/admin#users\/grants">이어서/);
    // 같은 대상의 링크이면 안내 없이 그대로
    const same = cellOf((await admin.page(`?account=${encodeURIComponent(a.code)}`)).text, 'users');
    assert.doesNotMatch(same, /쓰던 지급이 있어요/);
    // 버리고 새로: 미리보기는 닫히고 새 대상이 작성 칸에 들어온다
    const r = await api('POST', '/admin/flow/cancel', {
      body: new URLSearchParams({ csrf: admin.csrf, action: 'grants/batch', discard: '1' }).toString(),
      ip: admin.from,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: admin.cookie,
        origin: h.base,
        referer: `${h.base}/admin?account=${encodeURIComponent(b.code)}`,
      },
    });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/admin?account=${encodeURIComponent(b.code)}#users/grants`);
    const after = cellOf((await admin.page(`?account=${encodeURIComponent(b.code)}`)).text, 'users');
    assert.match(after, new RegExp(`>${b.code}</textarea>`));
    assert.doesNotMatch(after, /쓰던 지급이 있어요|쓰던대상/);
  });

  test('좁은 폭에서 대상 확인 표는 가로 스크롤 없이 줄을 카드로 접는다', async () => {
    const d = await newDevice('18+', '카드');
    await admin.post('/admin/grants/preview', g(d.code));
    const users = cellOf((await admin.page()).text, 'users');
    assert.match(users, /<table class="targets">/);
    assert.doesNotMatch(users, /table-scroll"><table class="targets"/);
    await admin.post('/admin/flow/cancel', { action: 'grants/batch', discard: '1' });
    await admin.page();
    const css = (await api('GET', '/admin/admin.css')).text;
    assert.match(css, /table\.targets td \{ display: block;/);
  });
});
