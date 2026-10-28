// 신고 처리 화면 (#151): 목록에 본문이 없는 것, 본문을 열면 운영 기록에 남는 것, 처리 상태 바꾸기(두 번 확정 막기),
// 신고에서 이용자로, 이용자에서 신고로, 막기 연결, 홈의 미처리 신고, 옛 INSERT 호환
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Ai } from '../src/ai';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
let h: Harness;
const { api, newDevice, session } = client(() => h);
let admin: AdminBrowser;
let appToken = '';

const SECRET_Q = `비밀질문-${randomUUID()}`;
const SECRET_A = `비밀답-${randomUUID()}`;
const ids: string[] = [];
let accA: { id: string; code: string };
let accB: { id: string; code: string };

/** 옛 서버 코드가 쓰던 INSERT 그대로 (처리 상태 열을 모르는 코드) */
async function oldInsert(account: string, question: string, answer: string): Promise<string> {
  const r = await h.pool.query<{ id: string }>(
    'INSERT INTO ai_report (account_id, question, answer) VALUES ($1, $2, $3) RETURNING id',
    [account, question, answer],
  );
  return String(r.rows[0]?.id);
}
const logs = async (action: string) =>
  (
    await h.pool.query(
      'SELECT actor, actor_name, target, detail FROM admin_log WHERE action = $1 ORDER BY id',
      [action],
    )
  ).rows;
const statusOf = async (id: string) =>
  (
    await h.pool.query('SELECT status, handled_by, handled_name, handled_at FROM ai_report WHERE id = $1', [
      id,
    ])
  ).rows[0];
const reportsCell = (html: string) =>
  html.slice(html.indexOf('id="cell-reports"'), html.indexOf('id="cell-announce"'));
const homeCell = (html: string) =>
  html.slice(html.indexOf('id="cell-home"'), html.indexOf('id="cell-users"'));
const move = (id: string, from: string, to: string) => admin.post('/admin/reports/status', { id, from, to });
const id0 = () => ids[0] as string;
const id1 = () => ids[1] as string;
const id2 = () => ids[2] as string;

before(async () => {
  h = await startHarness({ adminToken: ADMIN_TOKEN, adminSubs: [ADMIN_SUB] });
  admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
  accA = await newDevice('18+', '신고당한고양이');
  accB = await newDevice('18+', '다른고양이');
  const op = await newDevice('18+', '운영고양이');
  appToken = await session(op.id, ADMIN_SUB);
  ids.push(await oldInsert(accA.id, SECRET_Q, `${SECRET_A} <script>alert(1)</script>`));
  ids.push(await oldInsert(accA.id, '두번째 질문', '두번째 답'));
  ids.push(await oldInsert(accB.id, '', '질문 없는 신고의 답'));
});

after(async () => {
  await h?.stop();
});

describe('신고 목록', () => {
  test('옛 INSERT 로 들어온 신고는 미처리이고 처리 열은 비어 있다', async () => {
    for (const id of ids) {
      const r = await statusOf(id);
      assert.equal(r?.status, 'pending');
      assert.equal(r?.handled_by, null);
      assert.equal(r?.handled_at, null);
    }
  });

  test('목록에는 번호, 이용자, 상태만 있고 질문과 답 글은 없다. 열람 기록도 아직 없다', async () => {
    const p = await admin.page();
    assert.equal(p.status, 200);
    const cell = reportsCell(p.text);
    for (const id of ids) assert.match(cell, new RegExp(`href="/admin\\?report=${id}#reports"`));
    assert.match(cell, /신고당한고양이/);
    assert.match(cell, /신고 2건/);
    assert.doesNotMatch(p.text, new RegExp(SECRET_Q));
    assert.doesNotMatch(p.text, new RegExp(SECRET_A));
    assert.doesNotMatch(cell, /<pre/);
    assert.equal((await logs('report.view')).length, 0);
  });

  test('미처리가 먼저, 새것이 먼저. 상태별 보기와 건수', async () => {
    await move(id0(), 'pending', 'seen');
    const p = await admin.page();
    const cell = reportsCell(p.text);
    const at = (id: string) => cell.indexOf(`href="/admin?report=${id}#reports"`);
    // 미처리(id2, id1 새것 먼저)가 확인(id0)보다 앞
    assert.ok(at(id2()) < at(id1()));
    assert.ok(at(id1()) < at(id0()));
    const only = reportsCell((await admin.page('?rs=seen')).text);
    assert.match(only, new RegExp(`report=${id0()}#`));
    assert.doesNotMatch(only, new RegExp(`report=${id1()}#`));
    assert.match(cell, /미처리 2/);
    assert.match(cell, /확인 1/);
    await move(id0(), 'seen', 'pending');
  });

  test('로그인 없이는 목록도 본문도 열람 기록도 없다', async () => {
    const r = await api('GET', `/admin?report=${id0()}`, { ip: '10.9.9.9' });
    assert.equal(r.status, 200);
    assert.match(r.text, /운영자 토큰/);
    assert.doesNotMatch(r.text, new RegExp(SECRET_Q));
    assert.equal((await logs('report.view')).length, 0);
  });
});

describe('본문 열기와 열람 기록', () => {
  test('열면 질문과 답이 보이고(이스케이프됨) 운영 기록에 한 줄이 남는다. 기록에는 글이 없다', async () => {
    // 앞 시험의 쓰기가 남긴 결과 글(redirect 뒤 첫 화면이 받아 가는 것)을 먼저 비운다
    await admin.page();
    const p = await admin.page(`?report=${id0()}`);
    assert.equal(p.status, 200);
    assert.match(p.text, new RegExp(SECRET_Q));
    assert.match(p.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(p.text, /<script>alert/);
    const rows = await logs('report.view');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target, `account:${accA.id}`);
    assert.deepEqual(rows[0].detail, { report: Number(id0()) });
    assert.match(rows[0].actor, /^admin:/);
    assert.equal(rows[0].actor_name, '웹 운영자');
    const dump = JSON.stringify((await h.pool.query('SELECT * FROM admin_log')).rows);
    assert.ok(!dump.includes(SECRET_Q) && !dump.includes(SECRET_A));
    // 운영 기록 칸에서 동작과 이용자로 찾는다
    const found = await admin.page(`?la=report.view&lu=${accA.id}`);
    const log = found.text.slice(found.text.indexOf('id="sub-settings-log"'));
    assert.match(log, /신고 대화 열어 봄/);
  });

  test('연 횟수만큼 남는다 (다시 열면 또 한 줄)', async () => {
    await admin.page(`?report=${id0()}`);
    assert.equal((await logs('report.view')).length, 2);
  });

  test('없는 번호, 이상한 번호는 오류 글이고 기록이 늘지 않는다', async () => {
    const n = (await logs('report.view')).length;
    for (const bad of ['999999', 'abc', '1;DROP', '-1', '99999999999999999999']) {
      const p = await admin.page(`?report=${encodeURIComponent(bad)}`);
      assert.equal(p.status, 200);
      assert.match(reportsCell(p.text), /없는 신고예요/);
    }
    assert.equal((await logs('report.view')).length, n);
  });

  test('열린 신고에서 이용자 상세로 가는 링크와 같은 이용자의 다른 신고 링크가 있다', async () => {
    const cell = reportsCell((await admin.page(`?report=${id0()}`)).text);
    assert.match(cell, new RegExp(`href="/admin\\?q=${accA.code}#users/list"`));
    assert.match(cell, new RegExp(`다른 신고:.*report=${id1()}`));
  });
});

describe('처리 상태 바꾸기', () => {
  test('미처리에서 확인, 조치로: 처리자와 시각이 남고 운영 기록이 한 줄씩 쌓인다', async () => {
    const r = await move(id1(), 'pending', 'seen');
    assert.equal(r.status, 303);
    // 처리한 신고를 열어 둔 채 돌아온다
    assert.equal(r.headers.get('location'), `/admin?report=${id1()}#reports`);
    let row = await statusOf(id1());
    assert.equal(row?.status, 'seen');
    assert.match(row?.handled_by, /^admin:/);
    assert.equal(row?.handled_name, '웹 운영자');
    assert.ok(row?.handled_at);
    assert.match(reportsCell((await admin.page()).text), /신고 #\d+ 를 확인으로 표시했어요/);
    await move(id1(), 'seen', 'done');
    row = await statusOf(id1());
    assert.equal(row?.status, 'done');
    const seen = (await logs('report.seen')).filter((x) => x.detail.report === Number(id1()));
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].detail, { report: Number(id1()), from: 'pending', to: 'seen' });
    assert.equal(seen[0].target, `account:${accA.id}`);
    assert.equal((await logs('report.done')).filter((x) => x.detail.report === Number(id1())).length, 1);
  });

  test('같은 단추를 두 번 눌러도(옛 화면) 두 번 쓰지 않는다: 거절 글과 한 줄 기록', async () => {
    const id = id2();
    assert.equal((await move(id, 'pending', 'done')).status, 303);
    const first = await statusOf(id);
    const again = await move(id, 'pending', 'done');
    assert.equal(again.status, 303);
    assert.match(reportsCell((await admin.page()).text), /다른 곳에서 먼저 바꿨어요 \(지금 조치\)/);
    const second = await statusOf(id);
    assert.equal(String(second?.handled_at), String(first?.handled_at));
    assert.equal((await logs('report.done')).filter((x) => x.detail.report === Number(id)).length, 1);
    // 낡은 화면에서 다른 상태로 덮어쓰기도 거절
    await move(id, 'pending', 'seen');
    assert.equal((await statusOf(id))?.status, 'done');
  });

  test('미처리로 되돌리면 처리자와 시각이 비고 reopen 이 남는다', async () => {
    const id = id2();
    await move(id, 'done', 'pending');
    const row = await statusOf(id);
    assert.equal(row?.status, 'pending');
    assert.equal(row?.handled_by, null);
    assert.equal(row?.handled_name, null);
    assert.equal(row?.handled_at, null);
    assert.equal((await logs('report.reopen')).filter((x) => x.detail.report === Number(id)).length, 1);
  });

  test('이상한 입력은 거절하고 아무것도 바꾸지 않는다', async () => {
    const id = id2();
    const count = async () => (await h.pool.query('SELECT count(*)::int AS n FROM admin_log')).rows[0].n;
    const n = await count();
    for (const f of [
      { id, from: 'pending', to: 'pending' },
      { id, from: 'pending', to: 'weird' },
      { id, from: 'x', to: 'done' },
      { id: 'abc', from: 'pending', to: 'done' },
      { id: '', from: 'pending', to: 'done' },
    ])
      assert.equal((await admin.post('/admin/reports/status', f)).status, 303);
    assert.equal((await statusOf(id))?.status, 'pending');
    assert.equal(await count(), n);
    // 없는 번호는 거절 글이 다르다
    await admin.post('/admin/reports/status', { id: '999999', from: 'pending', to: 'done' });
    assert.match(reportsCell((await admin.page()).text), /없는 신고예요/);
    assert.equal(await count(), n);
  });

  test('CSRF 가 없거나 다른 출처이거나 로그인이 없으면 바뀌지 않는다', async () => {
    const id = id2();
    const noCsrf = await admin.post('/admin/reports/status', { id, from: 'pending', to: 'done' }, false);
    assert.equal(noCsrf.status, 403);
    const evil = await admin.post(
      '/admin/reports/status',
      { id, from: 'pending', to: 'done' },
      true,
      'https://evil.example.com',
    );
    assert.equal(evil.status, 403);
    const anon = await api('POST', '/admin/reports/status', {
      body: new URLSearchParams({ id, from: 'pending', to: 'done' }).toString(),
      ip: '10.8.8.8',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: h.base },
    });
    assert.equal(anon.status, 401);
    assert.equal((await statusOf(id))?.status, 'pending');
  });

  test('열람 중 화면에서 쓰기를 하면 같은 신고로 돌아오고, 그 화면은 열람을 또 남기지 않는다', async () => {
    await admin.page();
    const n = (await logs('report.view')).length;
    const r = await api('POST', '/admin/reports/status', {
      body: new URLSearchParams({ csrf: admin.csrf, id: id2(), from: 'pending', to: 'seen' }).toString(),
      ip: admin.from,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: admin.cookie,
        origin: h.base,
        referer: `${h.base}/admin?report=${id2()}&rs=pending`,
      },
    });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/admin?report=${id2()}#reports`);
    assert.equal((await logs('report.view')).length, n);
    // 돌아온 첫 화면: 대화가 보이면 열람 기록이 남고(빠지는 경우 없음), 결과 글은 한 번만 보인다
    const back = await admin.page(`?report=${id2()}`);
    assert.match(back.text, /질문 없는 신고의 답/);
    assert.equal((await logs('report.view')).length, n + 1);
    assert.equal(reportsCell(back.text).split('id="form-ok"').length, 2);
    assert.match(reportsCell(back.text), /신고 #\d+ 를 확인으로 표시했어요/);
    // 바로 이어서 다른 탭에서 여는 것도 기록에 남는다
    await admin.page(`?report=${id2()}`);
    assert.equal((await logs('report.view')).length, n + 2);
    await move(id2(), 'seen', 'pending');
    await admin.page();
  });
});

describe('이용자와 막기', () => {
  test('이용자 상세에 신고 목록과 신고 링크가 있다', async () => {
    const p = await admin.page(`?q=${accA.code}`);
    assert.match(p.text, /<dt>신고<\/dt><dd>2건:/);
    for (const id of [id0(), id1()]) assert.match(p.text, new RegExp(`href="/admin\\?report=${id}#reports"`));
    assert.doesNotMatch(p.text, new RegExp(SECRET_Q));
    const none = await admin.page(`?q=${(await newDevice('18+')).code}`);
    assert.match(none.text, /<dt>신고<\/dt><dd>없음<\/dd>/);
  });

  test('신고 화면에서 채팅 이용권 막기: 확인 칸이 이용자 코드와 맞아야 하고, 끝나면 신고 칸으로 돌아온다', async () => {
    const cell = reportsCell((await admin.page(`?report=${id0()}`)).text);
    assert.match(cell, /action="\/admin\/ai\/block"/);
    assert.match(cell, /name="ret" value="reports"/);
    const noConfirm = await admin.post('/admin/ai/block', {
      account: accA.code,
      blocked: '1',
      ret: 'reports',
    });
    assert.equal(noConfirm.status, 303);
    assert.equal((await h.pool.query('SELECT 1 FROM ai_block WHERE account_id = $1', [accA.id])).rowCount, 0);
    const ok = await admin.post('/admin/ai/block', {
      account: accA.code,
      blocked: '1',
      ret: 'reports',
      confirm: accA.code,
    });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get('location') ?? '', /#reports$/);
    assert.equal((await h.pool.query('SELECT 1 FROM ai_block WHERE account_id = $1', [accA.id])).rowCount, 1);
    assert.equal((await logs('ai.block')).length, 1);
    const after = reportsCell((await admin.page(`?report=${id0()}`)).text);
    assert.match(after, /채팅 이용권 막힘/);
    assert.match(after, /막기 풀기/);
    assert.match(reportsCell((await admin.page()).text), /<span class="tag ended">막힘<\/span>/);
    await admin.post('/admin/ai/block', { account: accA.code, blocked: '0', ret: 'reports' });
    assert.equal((await h.pool.query('SELECT 1 FROM ai_block WHERE account_id = $1', [accA.id])).rowCount, 0);
  });

  test('ret 가 없는 옛 요청은 이용자 칸으로 돌아간다', async () => {
    const r = await admin.post('/admin/ai/block', { account: accB.code, blocked: '0' });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location') ?? '', /#users\/list$/);
  });
});

describe('홈과 앱 API', () => {
  before(async () => {
    await h.pool.query(
      "UPDATE ai_report SET status = 'pending', handled_by = NULL, handled_name = NULL, handled_at = NULL",
    );
  });

  test('홈의 "처리하지 않은 신고" 는 미처리 건수이고 신고 칸으로 간다. 모두 처리하면 사라진다', async () => {
    assert.match(
      homeCell((await admin.page()).text),
      /<a href="#reports">처리하지 않은 신고가 3건 있어요<\/a>/,
    );
    for (const id of ids) await move(id, 'pending', 'done');
    assert.doesNotMatch(homeCell((await admin.page()).text), /처리하지 않은 신고/);
    for (const id of ids) await move(id, 'done', 'pending');
  });

  test('앱이 받는 overview: reports.total 은 옛 뜻(전체)을 지키고 pending 이 더해졌다. 본문은 없다', async () => {
    const r = await api('GET', '/v1/admin/overview', { token: appToken });
    assert.equal(r.status, 200);
    assert.equal(r.body.reports.total, 3);
    assert.equal(r.body.reports.pending, 3);
    assert.deepEqual(r.body.reports.rows, []);
    assert.equal(r.body.reports.open, undefined);
    assert.ok(!r.text.includes(SECRET_Q) && !r.text.includes(SECRET_A));
    assert.deepEqual(
      r.body.todo.find((x: { kind: string }) => x.kind === 'reports'),
      { kind: 'reports', level: 'warn', n: 3, place: 'reports' },
    );
    await move(id0(), 'pending', 'done');
    const r2 = await api('GET', '/v1/admin/overview', { token: appToken });
    assert.equal(r2.body.reports.total, 3);
    assert.equal(r2.body.reports.pending, 2);
    assert.equal(r2.body.todo.find((x: { kind: string }) => x.kind === 'reports').n, 2);
    await move(id0(), 'done', 'pending');
  });

  test('앱이 받는 이용자 상세에도 신고 글은 없다', async () => {
    const r = await api('GET', `/v1/admin/overview?q=${accA.code}`, { token: appToken });
    assert.equal(r.body.account.reports.total, 2);
    assert.ok(!r.text.includes(SECRET_Q));
  });

  test('기기 토큰으로는 overview 도 신고 상태 쓰기도 403', async () => {
    const dev = await newDevice('18+');
    assert.equal((await api('GET', '/v1/admin/overview', { token: dev.token })).status, 403);
    const w = await api('POST', '/v1/admin/reports/status', {
      token: dev.token,
      body: { id: id0(), from: 'pending', to: 'done' },
    });
    assert.equal(w.status, 403);
    assert.equal((await statusOf(id0()))?.status, 'pending');
  });

  test('앱 운영자 계정의 상태 쓰기는 처리자가 닉네임과 번호로 남고, 낡은 요청은 stale', async () => {
    const r = await api('POST', '/v1/admin/reports/status', {
      token: appToken,
      body: { id: id0(), from: 'pending', to: 'seen' },
    });
    assert.equal(r.status, 200, r.text);
    const row = await statusOf(id0());
    assert.match(row?.handled_by, /^account:\d+$/);
    assert.match(row?.handled_name, /^운영고양이 #\d+$/);
    const stale = await api('POST', '/v1/admin/reports/status', {
      token: appToken,
      body: { id: id0(), from: 'pending', to: 'seen' },
    });
    assert.equal(stale.status, 400);
    assert.equal(stale.body.code, 'stale');
  });
});

describe('보관', () => {
  test('처리한 신고도 받은 날부터 30일 뒤에 정리 작업이 지운다 (상태가 보관을 늘리지 않는다)', async () => {
    const id = await oldInsert(accB.id, '오래된 질문', '오래된 답');
    await move(id, 'pending', 'done');
    await h.pool.query("UPDATE ai_report SET created_at = now() - interval '31 days' WHERE id = $1", [id]);
    await h.app.get(Ai).sweep();
    assert.equal((await h.pool.query('SELECT 1 FROM ai_report WHERE id = $1', [id])).rowCount, 0);
    assert.equal((await h.pool.query('SELECT 1 FROM ai_report WHERE id = $1', [id0()])).rowCount, 1);
  });
});

describe('합쳐진 계정과 열람 기록의 짝', () => {
  test('합쳐진 쪽 신고가 남는 쪽 이용자 상세, 목록 건수, 열람 기록 대상에 묶여 나온다', async () => {
    const old = await newDevice('18+', '옛기기');
    const live = await newDevice('18+', '새기기');
    const a = await oldInsert(old.id, '합침질문', '합침답');
    const b = await oldInsert(live.id, '남는쪽질문', '남는쪽답');
    // accounts.ts 합치기가 남기는 끝 상태 (신고는 옮기지 않는다)
    await h.pool.query('UPDATE account SET balance = 0, closed_at = now(), merged_into = $2 WHERE id = $1', [
      old.id,
      live.id,
    ]);
    for (const code of [live.code, old.code]) {
      const p = await admin.page(`?q=${code}`);
      const dd = /<dt>신고<\/dt><dd>(.*?)<\/dd>/s.exec(p.text)?.[1] ?? '';
      assert.match(dd, /^2건:/, code);
      for (const id of [a, b]) assert.match(dd, new RegExp(`report=${id}#reports`), code);
    }
    const list = reportsCell((await admin.page()).text);
    const row = (id: string) => list.slice(list.indexOf(`report=${id}#reports`)).split('</tr>')[0] ?? '';
    assert.match(row(a), /신고 2건/);
    assert.match(row(b), /신고 2건/);
    await admin.page(`?report=${a}`);
    const v = (await logs('report.view')).at(-1);
    assert.equal(v.target, `account:${live.id}`);
    assert.match(reportsCell((await admin.page(`?report=${a}`)).text), new RegExp(`다른 신고:.*report=${b}`));
    // 처리 상태 기록의 대상도 남는 쪽
    await move(a, 'pending', 'seen');
    assert.equal((await logs('report.seen')).at(-1).target, `account:${live.id}`);
  });

  test('열람 기록을 못 쓰면 본문도 나오지 않는다 (같은 트랜잭션)', async () => {
    const d = await newDevice('18+', '기록실패');
    const id = await oldInsert(d.id, `실패질문-${randomUUID()}`, `실패답-${randomUUID()}`);
    const q = (await h.pool.query('SELECT question, answer FROM ai_report WHERE id = $1', [id])).rows[0];
    await h.pool.query(`CREATE FUNCTION fail_view() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'report.view' THEN RAISE EXCEPTION 'log down'; END IF; RETURN NEW; END $$`);
    await h.pool.query(
      'CREATE TRIGGER fail_view BEFORE INSERT ON admin_log FOR EACH ROW EXECUTE FUNCTION fail_view()',
    );
    try {
      const before = (await logs('report.view')).length;
      const r = await admin.page(`?report=${id}`);
      assert.ok(!r.text.includes(q.question) && !r.text.includes(q.answer));
      assert.notEqual(r.status, 200);
      assert.equal((await logs('report.view')).length, before);
    } finally {
      await h.pool.query('DROP TRIGGER fail_view ON admin_log');
      await h.pool.query('DROP FUNCTION fail_view()');
    }
  });

  test('신고 화면에서 막기가 실패하면 오류 글이 신고 칸에 보인다', async () => {
    const d = await newDevice('18+', '막기실패');
    await oldInsert(d.id, 'q', 'a');
    const r = await admin.post('/admin/ai/block', {
      account: 'F-ZZZZ-9999',
      blocked: '1',
      ret: 'reports',
      confirm: 'F-ZZZZ-9999',
    });
    assert.equal(r.status, 303);
    const p = await admin.page();
    assert.match(reportsCell(p.text), /id="form-error"/);
    const users = p.text.slice(p.text.indexOf('id="cell-users"'), p.text.indexOf('id="cell-reports"'));
    assert.doesNotMatch(users, /id="form-error"/);
  });

  test('overview 의 latest 는 못 읽어도 키가 있고 null 이다 (옛 앱 호환)', async () => {
    const r = await api('GET', '/v1/admin/overview', { token: appToken });
    assert.ok('latest' in r.body);
    assert.equal(r.body.latest, null);
  });
});

describe('합쳐진 계정과 나이 (사냥)', () => {
  test('합쳐진 계정의 신고는 남은 이용자의 코드와 닉네임을 보인다 (목록과 본문)', async () => {
    const stay = await newDevice('18+', '남는쪽고양이');
    const gone = await newDevice('18+', '닫힌쪽고양이');
    const id = await oldInsert(gone.id, '합친 질문', '합친 답');
    await h.pool.query('UPDATE account SET closed_at = now(), merged_into = $2 WHERE id = $1', [
      gone.id,
      stay.id,
    ]);
    const cell = reportsCell((await admin.page()).text);
    assert.match(cell, new RegExp(stay.code));
    assert.match(cell, /남는쪽고양이/);
    assert.doesNotMatch(cell, new RegExp(gone.code));
    assert.doesNotMatch(cell, /닫힌쪽고양이/);
    const open = reportsCell((await admin.page(`?report=${id}`)).text);
    assert.match(open, new RegExp(stay.code));
    assert.doesNotMatch(open, new RegExp(gone.code));
    assert.doesNotMatch(open, /닫힌쪽고양이/);
    assert.match(open, /합친 질문/);
  });

  test('나이가 18+ 아니게 바뀐 계정의 신고 본문은 열지 않는다. 목록과 처리는 그대로', async () => {
    const a = await newDevice('18+', '나이내린고양이');
    const id = await oldInsert(a.id, 'Q-나이내림', 'A-나이내림');
    assert.match((await admin.page(`?report=${id}`)).text, /Q-나이내림/);
    await h.pool.query('UPDATE account SET age = $2 WHERE id = $1', [a.id, '14+']);
    const p = await admin.page(`?report=${id}`);
    assert.doesNotMatch(p.text, /Q-나이내림/);
    assert.doesNotMatch(p.text, /A-나이내림/);
    assert.match(reportsCell(p.text), /만 18세 이상이 아니라서/);
    assert.match(reportsCell(p.text), /나이내린고양이/);
    await h.pool.query('UPDATE account SET age = $2 WHERE id = $1', [a.id, '18+']);
    assert.match((await admin.page(`?report=${id}`)).text, /Q-나이내림/);
  });
});

describe('신고 화면 사용성 (막기 결과 글, 열어 둔 채 처리, 다음 열기)', () => {
  let a: { id: string; code: string };
  let r1 = '';
  let r2 = '';
  let r3 = '';
  before(async () => {
    await h.pool.query("UPDATE ai_report SET status = 'done'");
    a = await newDevice('18+', '사용성고양이');
    r1 = await oldInsert(a.id, 'U1-질문', 'U1-답');
    r2 = await oldInsert(a.id, 'U2-질문', 'U2-답');
    r3 = await oldInsert(a.id, 'U3-질문', 'U3-답');
    await admin.page();
  });

  test('신고 칸에서 막으면 성공 글이 숨은 이용자 칸이 아니라 신고 칸에 한 번 보인다', async () => {
    const ok = await admin.post('/admin/ai/block', {
      account: a.code,
      blocked: '1',
      ret: 'reports',
      confirm: a.code,
    });
    assert.equal(ok.status, 303);
    const p = await admin.page();
    const users = p.text.slice(p.text.indexOf('id="cell-users"'), p.text.indexOf('id="cell-reports"'));
    assert.doesNotMatch(users, /id="form-ok"/);
    assert.match(reportsCell(p.text), /id="form-ok"[^>]*>계정 #\d+ 의 채팅 이용권 사용을 막았어요/);
    assert.equal(p.text.split('id="form-ok"').length, 2);
    await admin.post('/admin/ai/block', { account: a.code, blocked: '0', ret: 'reports' });
    await admin.page();
  });

  test('열린 신고에 상태 뜻 설명, 다음 미처리 열기, 막고 조치로 표시 단추가 있다', async () => {
    const cell = reportsCell((await admin.page(`?report=${r1}`)).text);
    assert.match(cell, /<strong>미처리<\/strong>는 아직 안 본 신고/);
    assert.match(cell, /<strong>확인<\/strong>은 읽었지만 아직 처리 중/);
    assert.match(cell, /<strong>조치<\/strong>는 막기 같은 처리를 마친 신고/);
    assert.match(cell, /href="\/admin\?report=\d+#reports">다음 미처리 열기/);
    assert.match(cell, /막고 조치로 표시/);
    assert.match(cell, /name="mark_report" value="/);
    assert.match(cell, /조치하고 다음 미처리 열기/);
  });

  test('막고 조치로 표시: 한 번에 막고 그 신고가 조치가 되며 기록이 둘 남는다. 남의 신고 번호는 거절', async () => {
    const other = await newDevice('18+', '남의신고');
    const otherReport = await oldInsert(other.id, 'x', 'y');
    const bad = await admin.post('/admin/ai/block', {
      account: a.code,
      blocked: '1',
      ret: 'reports',
      mark_report: otherReport,
      confirm: a.code,
    });
    assert.equal(bad.status, 303);
    assert.equal((await h.pool.query('SELECT 1 FROM ai_block WHERE account_id = $1', [a.id])).rowCount, 0);
    assert.equal((await statusOf(otherReport))?.status, 'pending');
    await admin.page();
    const doneBefore = (await logs('report.done')).length;
    const r = await admin.post('/admin/ai/block', {
      account: a.code,
      blocked: '1',
      ret: 'reports',
      mark_report: r1,
      confirm: a.code,
    });
    assert.equal(r.headers.get('location'), `/admin?report=${r1}#reports`);
    assert.equal((await h.pool.query('SELECT 1 FROM ai_block WHERE account_id = $1', [a.id])).rowCount, 1);
    assert.equal((await statusOf(r1))?.status, 'done');
    assert.equal((await logs('report.done')).length, doneBefore + 1);
    assert.ok((await logs('ai.block')).length >= 1);
    const viewsBefore = (await logs('report.view')).length;
    const p = await admin.page(`?report=${r1}`);
    assert.equal((await logs('report.view')).length, viewsBefore + 1);
    assert.match(reportsCell(p.text), /신고 #\d+ 도 조치로 표시했어요/);
    await admin.post('/admin/ai/block', { account: a.code, blocked: '0', ret: 'reports' });
    await admin.page();
  });

  test('조치하고 다음 미처리 열기: 다음 미처리 신고로 가고 그 신고는 열람이 남는다. 없으면 그 자리', async () => {
    const r = await admin.post('/admin/reports/status', { id: r2, from: 'pending', to: 'done', next: '1' });
    assert.equal(r.status, 303);
    const loc = r.headers.get('location') ?? '';
    const m = /^\/admin\?report=(\d+)#reports$/.exec(loc);
    assert.ok(m, loc);
    const nextId = m?.[1] as string;
    assert.notEqual(nextId, r2);
    assert.equal((await statusOf(nextId))?.status, 'pending');
    assert.equal((await statusOf(r2))?.status, 'done');
    const n = (await logs('report.view')).length;
    const p = await admin.page(`?report=${nextId}`);
    assert.equal((await logs('report.view')).length, n + 1);
    assert.match(reportsCell(p.text), /신고 #\d+ 를 조치로 표시했어요/);
    // 미처리가 더 없을 때
    await h.pool.query("UPDATE ai_report SET status = 'done' WHERE id <> $1", [r3]);
    await h.pool.query("UPDATE ai_report SET status = 'pending' WHERE id = $1", [r3]);
    const last = await admin.post('/admin/reports/status', {
      id: r3,
      from: 'pending',
      to: 'done',
      next: '1',
    });
    assert.equal(last.headers.get('location'), `/admin?report=${r3}#reports`);
    const q = reportsCell((await admin.page(`?report=${r3}`)).text);
    assert.match(q, /다음 미처리 신고는 없어요/);
    assert.match(q, /다른 미처리 신고는 없어요/);
  });
});
