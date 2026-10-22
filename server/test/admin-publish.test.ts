// 통합 시험 (이슈 #154): 알리기 발행 도구. 게시물 목록(상태 필터, 검색), 이벤트, 쿠폰, 버전의 미리보기 흐름과 통째 비교,
// 옛 앱(0.5.0)의 공지 수정이 웹에서 정한 대상 조건을 지우지 않는 것, 영향 인원, 초안, 쿠폰 원본 코드 한 번만 보이기,
// 저장과 앱 반영 안내. 진짜 GitHub 도 홈페이지도 부르지 않는다 (최신 릴리스는 이 시험이 띄운 가짜 주소가 준다).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, HOUR, kstInput, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
const LATEST = '0.5.0';
let h: Harness;
let release: Server;
let appSession = '';
let admin: AdminBrowser;
const { api, newDevice, session, lastLog } = client(() => h);

const browser = () =>
  new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );

const noticeBody = {
  id: 'web-notice',
  kind: 'important',
  title_ko: '웹 공지',
  title_en: 'Web notice',
  body_ko: '본문',
  body_en: 'Body',
};
const doc = async () =>
  (
    await h.pool.query<{ body: { notices: Array<Record<string, unknown>> } & Record<string, unknown> }>(
      `SELECT body FROM site_doc WHERE name = 'notices'`,
    )
  ).rows[0]?.body;
const noticeOf = async (id: string) => (await doc())?.notices.find((n) => n.id === id);

before(async () => {
  release = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tag_name: `v${LATEST}` }));
  });
  await new Promise<void>((r) => release.listen(0, '127.0.0.1', r));
  const port = (release.address() as AddressInfo).port;
  h = await startHarness({
    adminToken: ADMIN_TOKEN,
    adminSubs: [ADMIN_SUB],
    releasesApi: `http://127.0.0.1:${port}/latest`,
  });
  const op = await newDevice('18+', '운영자');
  appSession = await session(op.id, ADMIN_SUB);
  admin = browser();
  assert.equal((await admin.login()).status, 303);
  await admin.page();
});

after(async () => {
  await h?.stop();
  await new Promise<void>((r) => release?.close(() => r()));
});

/** 쓰기 하나에 요청이 넷이라 한 분 상한(120)을 새 세션으로 비운다 */
async function fresh() {
  admin = browser();
  assert.equal((await admin.login()).status, 303);
  await admin.page();
}

describe('옛 앱의 공지 수정은 웹에서 정한 대상 조건을 지우지 않는다', () => {
  const legacy = (body: Record<string, string>) =>
    api('POST', '/v1/admin/notices', { token: appSession, body });

  test('기간, 대상 버전, 운영체제, 링크가 있는 공지를 앱이 id, 종류, 제목, 본문만 보내 고쳐도 남는다', async () => {
    const from = kstInput(Date.now() - HOUR);
    const until = kstInput(Date.now() + 48 * HOUR);
    const made = await admin.act('/admin/notices', {
      ...noticeBody,
      id: 'targeted',
      link: 'https://fairy.moilga.com/news/1',
      from,
      until,
      versions: '<0.9.0',
      platforms: 'darwin,win32',
    });
    assert.ok(made.ok, made.text);
    const before = await noticeOf('targeted');
    assert.equal(before?.versions, '<0.9.0');
    assert.deepEqual(before?.platforms, ['darwin', 'win32']);

    // 0.5.0 앱의 공지 폼이 보내는 칸: 기간, 대상 버전, 운영체제 칸이 아예 없다
    const r = await legacy({
      id: 'targeted',
      kind: 'important',
      title_ko: '앱에서 고친 제목',
      title_en: 'Edited in app',
      body_ko: '앱 본문',
      body_en: 'App body',
      link: 'https://fairy.moilga.com/news/1',
    });
    assert.equal(r.status, 200, r.text);
    const after = await noticeOf('targeted');
    assert.equal((after?.title as { ko: string } | undefined)?.ko, '앱에서 고친 제목');
    assert.equal(after?.versions, '<0.9.0');
    assert.deepEqual(after?.platforms, ['darwin', 'win32']);
    assert.equal(after?.from, before?.from);
    assert.equal(after?.until, before?.until);
    assert.equal(after?.link, 'https://fairy.moilga.com/news/1');
  });

  test('웹 폼이 칸을 비워서 보내면 지운다 (비운 칸과 빠뜨린 칸은 다르다)', async () => {
    await fresh();
    const r = await admin.act('/admin/notices', {
      ...noticeBody,
      id: 'targeted',
      title_ko: '웹에서 비움',
      title_en: 'Cleared on web',
      link: '',
      from: '',
      until: '',
      versions: '',
      platforms: '',
    });
    assert.ok(r.ok, r.text);
    const n = await noticeOf('targeted');
    for (const k of ['versions', 'platforms', 'from', 'until', 'link']) assert.equal(n?.[k], undefined, k);
  });

  test('없던 id 를 앱이 새로 넣으면 보낸 칸만으로 만든다', async () => {
    const r = await legacy({
      id: 'app-new',
      kind: 'info',
      title_ko: '앱 새 공지',
      title_en: 'App new',
      body_ko: 'a',
      body_en: 'b',
    });
    assert.equal(r.status, 200, r.text);
    const n = await noticeOf('app-new');
    assert.equal(n?.versions, undefined);
    assert.equal(n?.from, undefined);
  });
});

describe('게시물 목록: 상태 필터와 검색', () => {
  const insertEvent = (id: string, title: string, startsH: number, endsH: number) =>
    h.pool.query(
      `INSERT INTO event (id, kind, title_ko, title_en, body_ko, body_en, starts_at, ends_at, coins)
       VALUES ($1, 'gift', $2, $3, '본문', 'body', now() + make_interval(hours => $4), now() + make_interval(hours => $5), 10)`,
      [id, title, `${title} en`, startsH, endsH],
    );
  const ids = (html: string, kind: string): string[] =>
    [
      ...html.matchAll(
        new RegExp(`<tr[^>]*><td data-l="종류">${kind}</td>\\s*<td class="name" data-l="제목">([^<]*)`, 'g'),
      ),
    ].map((m) => m[1] as string);

  before(async () => {
    await fresh();
    await insertEvent('ev-live', '진행 중 이벤트', -2, 48);
    await insertEvent('ev-soon', '예정 이벤트', 24, 96);
    await insertEvent('ev-ended', '끝난 이벤트', -96, -48);
    // 오래된 것 70개: 예전 표는 최근 50개만 보여 줘서 이 중 대부분을 찾을 수 없었다
    for (let i = 0; i < 70; i++)
      await insertEvent(`old-${String(i).padStart(2, '0')}`, `오래된 ${i}`, -9000 - i, -8000 - i);
    await h.pool.query(
      `INSERT INTO coupon (code_hash, hint, label, coins, tickets, starts_at, ends_at, max_uses)
       VALUES ('\\x${'11'.repeat(32)}', 'AAAA', '진행 쿠폰', 10, 0, now() - interval '1 hour', now() + interval '5 days', 5),
              ('\\x${'22'.repeat(32)}', 'BBBB', '끈 쿠폰', 10, 0, now() - interval '1 hour', now() + interval '5 days', 5)`,
    );
    await h.pool.query(`UPDATE coupon SET disabled_at = now() WHERE hint = 'BBBB'`);
  });

  test('모든 종류가 한 목록에 진행 중, 예정, 끝남 순으로 온다', async () => {
    const p = await admin.page('?pq=&pk=event');
    const live = p.text.indexOf('진행 중 이벤트');
    const soon = p.text.indexOf('예정 이벤트');
    const ended = p.text.indexOf('끝난 이벤트');
    assert.ok(live > 0 && live < soon && soon < ended, [live, soon, ended].join());
    const all = await admin.page();
    for (const k of ['공지', '이벤트', '쿠폰', '버전 기준'])
      assert.match(all.text, new RegExp(`<td data-l="종류">${k}</td>`), k);
  });

  test('상태 필터: 끝남만, 예정만, 진행 중만', async () => {
    const ended = ids((await admin.page('?pk=event&ps=ended')).text, '이벤트');
    assert.ok(ended.includes('끝난 이벤트'));
    assert.ok(!ended.includes('진행 중 이벤트') && !ended.includes('예정 이벤트'));
    const soon = ids((await admin.page('?pk=event&ps=soon')).text, '이벤트');
    assert.deepEqual(soon, ['예정 이벤트']);
    const live = ids((await admin.page('?pk=event&ps=live')).text, '이벤트');
    assert.deepEqual(live, ['진행 중 이벤트']);
  });

  test('쿠폰은 끈 것과 다 쓴 것이 끝남이다', async () => {
    const ended = ids((await admin.page('?pk=coupon&ps=ended')).text, '쿠폰');
    assert.deepEqual(ended, ['끈 쿠폰']);
    assert.deepEqual(ids((await admin.page('?pk=coupon&ps=live')).text, '쿠폰'), ['진행 쿠폰']);
    await h.pool.query(`UPDATE coupon SET used = max_uses WHERE hint = 'AAAA'`);
    assert.deepEqual(ids((await admin.page('?pk=coupon&ps=live')).text, '쿠폰'), []);
    const spent = (await admin.page('?pk=coupon&ps=ended')).text;
    assert.match(spent, /다 씀/);
    assert.match(spent, /진행 쿠폰<br>[\s\S]*?<span class="tag ended">끝남<\/span> <small>다 씀/);
  });

  test('검색은 오래된 항목도 찾는다 (최근 50개 밖)', async () => {
    const p = await admin.page('?pk=event&pq=old-07');
    assert.deepEqual(ids(p.text, '이벤트'), ['오래된 7']);
    const none = await admin.page('?pq=zzzz-nothing');
    assert.match(none.text, /조건에 맞는 게시물이 없어요/);
    // 목록은 종류마다 100건까지, 넘치면 알린다
    const manyOld = await admin.page('?pk=event&ps=ended');
    assert.equal(ids(manyOld.text, '이벤트').length, 71);
    // 검색어의 % 와 _ 는 그대로 찾는다 (모든 글에 맞지 않는다)
    assert.deepEqual(ids((await admin.page('?pk=event&pq=%25')).text, '이벤트'), []);
  });

  test('불러와 고치기와 복사 링크가 행마다 있다', async () => {
    const p = await admin.page('?pk=event&pq=live');
    assert.match(p.text, /href="\/admin\?load=event%3Aev-live#announce\/new"/);
    assert.match(p.text, /복사해서 새로 만들기/);
  });
});

describe('이벤트, 쿠폰, 버전도 미리보기를 거쳐야 쓴다 (통째 비교)', () => {
  const ev = () => ({
    id: `ev-${randomUUID().slice(0, 8)}`,
    kind: 'gift',
    title_ko: '선물',
    title_en: 'Gift',
    body_ko: '코인을 받아요',
    body_en: 'Get coins',
    from: kstInput(Date.now() + HOUR),
    until: kstInput(Date.now() + 24 * HOUR),
    coins: '40',
  });
  const hiddenOf = async (path: string) => {
    const page = await admin.page();
    const m = new RegExp(`<form method="post" action="${path}"[^>]*>([\\s\\S]*?)</form>`).exec(page.text);
    assert.ok(m, `${path} 확정 폼`);
    const hidden: Record<string, string> = {};
    for (const x of (m[1] ?? '').matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g))
      if (x[1] !== 'csrf') hidden[x[1] as string] = (x[2] as string).replaceAll('&#10;', '\n');
    return hidden;
  };

  test('미리보기 없이 바로 확정하면 거절하고 아무것도 쓰지 않는다', async () => {
    await fresh();
    const f = ev();
    for (const [path, body] of [
      ['/admin/events', f],
      [
        '/admin/coupons',
        { label: '바로', coins: '5', tickets: '0', max_uses: '3', until: kstInput(Date.now() + 24 * HOUR) },
      ],
      ['/admin/versions', { minVersion: '', restrictVersion: '', recommendVersion: '0.4.3' }],
    ] as const) {
      assert.equal((await admin.post(path, body)).status, 303);
      const p = await admin.page();
      assert.match(p.text, /이미 확정했거나 닫힌 미리보기예요/, path);
    }
    assert.equal((await h.pool.query('SELECT 1 FROM event WHERE id = $1', [f.id])).rowCount, 0);
    assert.equal((await h.pool.query(`SELECT 1 FROM coupon WHERE label = '바로'`)).rowCount, 0);
  });

  test('이벤트: 미리보기에서 본 값과 다른 값으로 확정하면 거절하고, 같으면 만든다', async () => {
    await fresh();
    const f = ev();
    assert.equal((await admin.post('/admin/events/preview', f)).status, 303);
    const page = await admin.page();
    assert.match(page.text, /class="preview event" lang="ko"/);
    assert.match(page.text, /class="preview event" lang="en"/);
    assert.match(page.text, /선물 40 코인/);
    assert.match(page.text, /저장과 앱 반영은 달라요/);
    assert.match(page.text, /events\.json/);
    const hidden = await hiddenOf('/admin/events');
    // 확정 폼의 숨은 칸을 바꿔 보낸다 (코인 40 을 1000 으로)
    const tampered = await admin.post('/admin/events', { ...hidden, coins: '1000' });
    assert.equal(tampered.status, 303);
    assert.match((await admin.page()).text, /미리보기와 다른 값이에요/);
    assert.equal((await h.pool.query('SELECT 1 FROM event WHERE id = $1', [f.id])).rowCount, 0);
    // 미리보기는 한 번 쓰면 닫힌다: 다시 처음부터
    await admin.post('/admin/events/preview', f);
    const ok = await admin.post('/admin/events', await hiddenOf('/admin/events'));
    assert.equal(ok.status, 303);
    const result = await admin.page();
    assert.match(result.text, /이벤트 .* 를 만들었어요/);
    assert.match(result.text, /5\. 결과 확인/);
    assert.equal((await h.pool.query('SELECT coins FROM event WHERE id = $1', [f.id])).rows[0]?.coins, 40);
    assert.equal((await lastLog('event.create'))?.target, f.id);
  });

  test('이벤트: 같은 id 가 있으면 미리보기에서 막고, 끝이 지난 값은 작성에서 오류로 돌려보낸다', async () => {
    await fresh();
    const f = ev();
    await admin.act('/admin/events', f);
    await fresh();
    await admin.post('/admin/events/preview', f);
    const p = await admin.page();
    assert.match(p.text, /같은 id 의 이벤트가 있어요/);
    assert.doesNotMatch(p.text, /확정하고 이벤트 만들기/);
    await fresh();
    const r = await admin.post('/admin/events/preview', { ...ev(), until: kstInput(Date.now() - HOUR) });
    assert.equal(r.status, 303);
    const back = await admin.page();
    assert.match(back.text, /끝이 지금보다 뒤여야 해요/);
    assert.match(back.text, /class="grid mk-f mk-events"/);
  });

  test('쿠폰: 코드는 만든 직후 한 번만 보이고 복사 단추가 있다. 서버에는 해시만 있다', async () => {
    await fresh();
    const f = {
      label: '복사 쿠폰',
      coins: '25',
      tickets: '0',
      max_uses: '4',
      until: kstInput(Date.now() + 24 * HOUR),
    };
    await admin.post('/admin/coupons/preview', f);
    const pv = await admin.page();
    assert.match(pv.text, /코드는 확정하는 순간 한 번만 보여요/);
    assert.match(pv.text, /Coupon redeemed/);
    await admin.post('/admin/coupons', await hiddenOf('/admin/coupons'));
    const done = await admin.page();
    const code = /<code class="coupon-code" id="coupon-code">([A-Z0-9-]+)<\/code>/.exec(done.text)?.[1];
    assert.ok(code, '결과 화면에 코드');
    assert.match(done.text, new RegExp(`<button type="button" data-copy="${code}">복사</button>`));
    assert.match(done.text, /다시 볼 수 없어요/);
    // 다시 열면 없다
    const again = await admin.page();
    assert.doesNotMatch(again.text, new RegExp(code as string));
    assert.doesNotMatch(again.text, /data-copy=/);
    // 서버는 해시만: 원본 코드가 표에도 운영 기록에도 없다
    const raw = (code as string).replaceAll('-', '');
    const cols = (
      await h.pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'coupon'`,
      )
    ).rows.map((x) => x.column_name);
    assert.ok(!cols.includes('code'));
    const dump =
      JSON.stringify((await h.pool.query('SELECT * FROM coupon')).rows) +
      JSON.stringify((await h.pool.query('SELECT * FROM admin_log')).rows);
    assert.ok(!dump.includes(raw) && !dump.includes(code as string));
    // 목록에는 코드 앞 4자만
    assert.match((await admin.page('?pk=coupon&pq=복사')).text, new RegExp(`코드 ${raw.slice(0, 4)}…`));
  });

  test('쿠폰: 시작을 비우면 만드는 순간부터라 미리보기와 확정 사이에 시간이 지나도 같다', async () => {
    await fresh();
    const f = {
      label: '시작 비움',
      coins: '5',
      tickets: '0',
      max_uses: '2',
      until: kstInput(Date.now() + 24 * HOUR),
    };
    const r = await admin.act('/admin/coupons', f);
    assert.ok(r.ok, r.text);
  });
});

describe('버전: 강제와 권장과 안내문을 한 화면에서', () => {
  const levels = (o: Record<string, string> = {}) => ({
    minVersion: '',
    restrictVersion: '',
    recommendVersion: '',
    ...o,
  });
  const seed = async () => {
    await h.pool.query(`DELETE FROM site_doc`);
    for (const [v, n] of [
      ['0.3.0', 3],
      ['0.4.0', 2],
      ['0.4.3', 4],
      ['0.5.0', 5],
      [null, 1],
    ] as const)
      for (let i = 0; i < n; i++) {
        const d = await newDevice('18+', `버전${randomUUID().slice(0, 6)}`);
        await h.pool.query(`UPDATE account SET app_version = $2, last_active_at = now() WHERE id = $1`, [
          d.id,
          v,
        ]);
      }
  };

  test('미리보기는 지금과 저장한 뒤의 인원을 나란히 보인다', async () => {
    await fresh();
    await seed();
    await admin.post('/admin/versions/preview', levels({ minVersion: '0.4.0', recommendVersion: '0.4.3' }));
    const p = await admin.page();
    // 최소 0.4.0 보다 낮은 판: 0.3.0 의 3명 + 판 모름 1명 = 4명 (운영자 계정은 이 시험에서 판이 없어 1명 더)
    const locked = Number(/앱이 잠기는 계정<\/dt><dd>0명 &rarr; <strong>(\d+)명<\/strong>/.exec(p.text)?.[1]);
    const unknown = (
      await h.pool.query(
        `SELECT count(*) AS n FROM account WHERE app_version IS NULL AND last_active_at > now() - interval '30 days'`,
      )
    ).rows[0]?.n;
    assert.equal(locked, 3 + Number(unknown));
    // 권장 0.4.3 보다 낮은 판: 0.3.0, 0.4.0 과 판 모름
    const rec = Number(
      /권장 알림을 받는 계정<\/dt><dd>0명 &rarr; <strong>(\d+)명<\/strong>/.exec(p.text)?.[1],
    );
    assert.equal(rec, 3 + 2 + Number(unknown));
    assert.match(p.text, /올림/);
    assert.match(p.text, /최소 버전을 올려요/);
    assert.match(p.text, /name="confirm" value="yes" required/);
  });

  test('순서가 어긋나면 작성 화면으로 돌려보내고, 최신 릴리스보다 높으면 미리보기에서 막는다', async () => {
    await fresh();
    await admin.post('/admin/versions/preview', levels({ minVersion: '0.4.3', recommendVersion: '0.4.0' }));
    const bad = await admin.page();
    assert.match(bad.text, /class="flash error wide" role="alert" id="form-error"/);
    assert.match(bad.text, /class="grid mk-f mk-versions"/);
    await fresh();
    await admin.post('/admin/versions/preview', levels({ recommendVersion: '0.9.9', minVersion: '' }));
    const high = await admin.page();
    assert.match(high.text, /최신 릴리스 0\.5\.0 보다 높아요/);
    assert.doesNotMatch(high.text, /확정하고 버전 기준 저장/);
  });

  test('강제 기준을 올리고 강제 안내문까지 한 번에 저장하며, 안내문 대상은 그 판보다 낮은 앱이다', async () => {
    await fresh();
    const r = await admin.act('/admin/versions', {
      ...levels({ minVersion: '0.4.0', recommendVersion: '0.4.3' }),
      confirm: 'yes',
      msg_kind: 'force',
      msg_title_ko: '꼭 업데이트해 주세요',
      msg_title_en: 'Please update',
      msg_body_ko: '새 판이 나왔어요',
      msg_body_en: 'A new version is out',
    });
    assert.ok(r.ok, r.text);
    const d = await doc();
    assert.equal(d?.minVersion, '0.4.0');
    assert.equal(d?.recommendVersion, '0.4.3');
    const n = await noticeOf('force-0.4.0');
    assert.equal(n?.kind, 'force');
    assert.equal(n?.versions, '<0.4.0');
    assert.equal((await lastLog('versions'))?.detail?.notice, 'force-0.4.0');
  });

  test('강제 기준을 올리면서 확인 칸을 체크하지 않으면 거절한다', async () => {
    await fresh();
    const r = await admin.act('/admin/versions', levels({ minVersion: '0.4.3', recommendVersion: '0.4.3' }));
    assert.equal(r.ok, false);
    assert.match(r.text, /확인 칸/);
    assert.equal((await doc())?.minVersion, '0.4.0');
  });

  test('안내문 종류를 정했는데 그 기준이 없으면 작성 화면 오류다', async () => {
    await fresh();
    await admin.post('/admin/versions/preview', {
      ...levels({ recommendVersion: '0.4.3' }),
      msg_kind: 'force',
      msg_title_ko: 'a',
      msg_title_en: 'a',
      msg_body_ko: 'b',
      msg_body_en: 'b',
    });
    assert.match((await admin.page()).text, /강제 안내문은 최소 버전을 정해야 해요/);
  });

  test('옛 앱의 버전 저장(기능 제한 칸 없음)은 안내문 칸 없이도 그대로 된다', async () => {
    const r = await api('POST', '/v1/admin/versions', {
      token: appSession,
      body: { minVersion: '0.4.0', recommendVersion: '0.4.3', confirm: 'yes' },
    });
    assert.equal(r.status, 200, r.text);
  });
});

describe('초안', () => {
  const f = {
    id: 'draft-notice',
    kind: 'info',
    title_ko: '쓰던 제목',
    title_en: 'Draft title',
    body_ko: '쓰던 본문',
    body_en: 'Draft body',
  };

  test('저장하면 쓰던 값이 그대로 남고, 다시 열어 불러오고, 지운다. 확인 칸과 csrf 는 담지 않는다', async () => {
    await fresh();
    const saved = await admin.post('/admin/drafts/save', { ...f, draft: 'notices', confirm: 'yes' });
    assert.equal(saved.status, 303);
    const page = await admin.page();
    assert.match(page.text, /초안을 저장했어요/);
    assert.match(page.text, /value="쓰던 제목"/);
    const row = (
      await h.pool.query<{ body: Record<string, unknown>; saved_by: string }>(
        `SELECT body, saved_by FROM admin_draft WHERE kind = 'notices'`,
      )
    ).rows[0];
    assert.equal(row?.body.title_ko, '쓰던 제목');
    for (const k of ['csrf', 'confirm', 'flow', 'draft']) assert.equal(row?.body[k], undefined, k);
    assert.match((await admin.page()).text, /저장한 초안이 있어요/);
    // 빈 폼에서 불러오기
    await admin.post('/admin/drafts/load', { draft: 'notices' });
    const loaded = await admin.page();
    assert.match(loaded.text, /초안을 불러왔어요/);
    assert.match(loaded.text, /value="draft-notice"/);
    await admin.post('/admin/drafts/delete', { draft: 'notices' });
    assert.equal((await h.pool.query(`SELECT 1 FROM admin_draft`)).rowCount, 0);
    assert.equal((await lastLog('draft.delete'))?.target, 'notices');
  });

  test('다른 종류나 칸 이름은 받지 않는다', async () => {
    await admin.post('/admin/drafts/save', { ...f, draft: 'grants' });
    assert.match((await admin.page()).text, /초안 종류가 이상해요/);
    await admin.post('/admin/drafts/save', { draft: 'events', secret_note: '값' });
    assert.match((await admin.page()).text, /저장할 내용이 없어요/);
    assert.equal((await h.pool.query(`SELECT 1 FROM admin_draft`)).rowCount, 0);
  });

  test('초안 저장은 CSRF 와 출처를 본다', async () => {
    assert.equal((await admin.post('/admin/drafts/save', { ...f, draft: 'notices' }, false)).status, 403);
    assert.equal(
      (await admin.post('/admin/drafts/save', { ...f, draft: 'notices' }, true, 'https://evil.example.com'))
        .status,
      403,
    );
    const nobody = browser();
    assert.equal((await nobody.post('/admin/drafts/save', { ...f, draft: 'notices' }, false)).status, 401);
    for (const p of ['/admin/events/preview', '/admin/coupons/preview', '/admin/versions/preview'])
      assert.equal((await admin.post(p, {}, false)).status, 403, p);
  });
});

describe('불러와 고치기', () => {
  test('공지를 불러오면 같은 id 로 고치게 채우고, 이벤트와 쿠폰은 복사본을 채운다', async () => {
    await fresh();
    await admin.act('/admin/notices', {
      ...noticeBody,
      id: 'load-me',
      versions: '<0.8.0',
      platforms: 'darwin',
    });
    const n = await admin.page('?load=notice%3Aload-me');
    assert.match(n.text, /공지 load-me 를 불러왔어요/);
    assert.match(n.text, /name="id" required[^>]*value="load-me"/);
    assert.match(n.text, /name="versions" maxlength="60" value="&lt;0\.8\.0"/);
    assert.match(n.text, /<details class="wide" open>/);
    const e = await admin.page('?load=event%3Aev-live');
    assert.match(e.text, /이벤트 ev-live 를 복사했어요/);
    assert.match(e.text, /value="ev-live-2"/);
    const c = await admin.page('?load=coupon%3A1');
    assert.match(c.text, /쿠폰 #1 를 복사했어요/);
    const v = await admin.page('?load=version');
    assert.match(v.text, /지금 저장된 기준을 불러왔어요/);
    const none = await admin.page('?load=notice%3Anope');
    assert.match(none.text, /불러올 글을 찾지 못했어요/);
  });
});

describe('저장과 앱 반영', () => {
  test('공지는 서버 저장, 홈페이지 파일, 앱 세 단계를 나눠 알린다. 쿠폰은 서버에만 있다고 말한다', async () => {
    await fresh();
    const r = await admin.confirmPost('/admin/notices', { ...noticeBody, id: 'reach-1' });
    assert.equal(r.status, 303);
    const done = await admin.page();
    assert.match(done.text, /<strong>서버에 저장<\/strong>/);
    assert.match(done.text, /<strong>홈페이지 파일<\/strong>/);
    assert.match(done.text, /<strong>앱에 닿음<\/strong>/);
    assert.match(done.text, /4시간마다/);
    assert.match(done.text, /늦어도 \d{4}-\d{2}-\d{2} \d{2}:\d{2} 쯤/);
    const posts = await admin.page();
    assert.match(posts.text, /홈페이지에는 늦어도/);
    // 서버의 공개 파일에는 바로 들어 있다 (저장 성공 = 서버 파일 반영, 홈페이지는 따로)
    const feed = await api('GET', '/v1/notices.json');
    assert.ok(feed.body.notices.some((x: { id: string }) => x.id === 'reach-1'));
    await fresh();
    await admin.post('/admin/coupons/preview', {
      label: '반영',
      coins: '5',
      tickets: '0',
      max_uses: '1',
      until: kstInput(Date.now() + 24 * HOUR),
    });
    assert.match((await admin.page()).text, /홈페이지 파일을 거치지 않아요/);
  });
});
