// 이용자 상세 한 화면과 안전한 지급 (#153): 상세, 검색 하나, 합친 계정 묶음, 지급 확정의 서버 재검사(값, 받는 계정, 인원 수,
// 한 번만), 일괄 지급 대상 확인, 표에서 골라 지급, 받았는지 추적, 휴대폰 카드 모양, 옛 앱 API 호환
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
let h: Harness;
const { api, newDevice } = client(() => h);
let admin: AdminBrowser;

before(async () => {
  h = await startHarness({ adminToken: ADMIN_TOKEN });
  admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
});

after(async () => {
  await h?.stop();
});

const cellOf = (html: string, cell: string) => {
  const from = html.indexOf(`id="cell-${cell}"`);
  const next = html.indexOf('class="panel"', from + 10);
  return html.slice(from, next < 0 ? undefined : next);
};
const noteCount = async (id: string) =>
  Number((await h.pool.query('SELECT count(*) AS n FROM inbox WHERE account_id = $1', [id])).rows[0].n);
const fields = (accounts: string, extra: Record<string, string> = {}) => ({
  accounts,
  coins: '7',
  chat_passes: '0',
  days: '10',
  reason: '상세 시험',
  ...extra,
});
let entrySeq = 0;
const addCoins = (id: string, amount: number, reason = 'todo') =>
  h.pool.query(
    `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day) VALUES ($1, $2, $3, $4, $4, 'ok', current_date)`,
    [`t153-${++entrySeq}`, id, reason, amount],
  );

/** 미리보기를 만들고 확정 폼이 싣는 값 그대로 돌려준다 (숨은 칸 전부, 인원 수 칸의 정답) */
async function previewForm(
  f: Record<string, string>,
): Promise<{ hidden: Record<string, string>; people: string }> {
  const r = await admin.post('/admin/grants/preview', f);
  assert.equal(r.status, 303, r.text);
  const page = await admin.page();
  const m = /<form method="post" action="\/admin\/grants\/batch"[^>]*>([\s\S]*?)<\/form>/.exec(
    cellOf(page.text, 'users'),
  );
  assert.ok(m, '확정 폼이 있어야 한다');
  const hiddenFields: Record<string, string> = {};
  for (const x of (m[1] ?? '').matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g))
    if (x[1] !== 'csrf') hiddenFields[x[1] as string] = (x[2] as string).replaceAll('&#10;', '\n');
  // 2명 이상일 때만 인원 수 칸이 있다 (1명은 대상 확인 화면의 이름과 체크 칸이 대신한다)
  const people = /name="people"[^>]*pattern="(\d+)"/.exec(m[1] ?? '')?.[1] ?? '';
  return { hidden: hiddenFields, people };
}
const confirm = (hiddenFields: Record<string, string>, extra: Record<string, string> = {}) => {
  const body: Record<string, string> = { ...hiddenFields, confirm: 'yes', ...extra };
  if (body.people === '') delete body.people;
  return admin.post('/admin/grants/batch', body);
};
const resultText = async () => {
  const p = await admin.page();
  return (
    /<p class="flash( error)?( wide)?" role="(?:status|alert)"[^>]*>([^<]*)<\/p>/.exec(p.text)?.[3] ?? ''
  );
};

describe('이용자 상세 한 화면', () => {
  let a: { token: string; id: string; code: string };

  test('행을 누르면(user=번호) 지급, 막기, 정기 지급, 회수, 신고, 내역, 운영 기록이 한 화면에 있다', async () => {
    a = await newDevice('18+', '상세고양이');
    await addCoins(a.id, 30);
    await addCoins(a.id, -5, 'shop');
    await h.pool.query(`INSERT INTO ai_report (account_id, question, answer) VALUES ($1, '질문', '답')`, [
      a.id,
    ]);
    const page = await admin.page(`?user=${a.id}`);
    const users = cellOf(page.text, 'users');
    assert.match(users, /id="user-detail"/);
    assert.match(users, /<h2>상세고양이 <code>/);
    // 지급: 받는 사람 이름이 단추 옆에 있고 대상은 숨은 칸으로 고정, 확정 전 대상 확인 화면으로 간다
    assert.match(users, /<form method="post" action="\/admin\/grants\/preview" class="grid grant-one">/);
    assert.match(users, /받는 사람: <strong>상세고양이<\/strong>/);
    assert.match(users, new RegExp(`<input type="hidden" name="accounts" value="${a.code}">`));
    assert.match(users, /상세고양이 에게 지급, 대상 확인하기/);
    for (const part of [
      'action="/admin/ai/block"',
      'action="/admin/ai/subscribe"',
      'action="/admin/ai/revoke"',
      'action="/admin/ai/allow"',
      '<h3 id="user-notes">받은 쪽지와 받았는지</h3>',
      '<h3>코인 내역</h3>',
      '<h3>이 사람의 운영 기록</h3>',
    ])
      assert.ok(users.includes(part), part);
    assert.match(users, /<td data-l="코인">\+30<\/td>/);
    assert.match(users, /<td data-l="코인">-5<\/td>/);
    assert.match(users, /신고<\/dt><dd>1건/);
    // 검색 칸은 하나
    assert.equal((users.match(/name="q"/g) ?? []).length, 1);
    assert.doesNotMatch(users, /이용자 찾기와 자세히 보기/);
  });

  test('검색 하나로 번호, 닉네임, 기기 코드(표기가 달라도) 모두 같은 상세가 열린다', async () => {
    const loose = a.code.replaceAll('-', '').toLowerCase();
    for (const q of [a.id, '상세고양', a.code, loose]) {
      const page = await admin.page(`?q=${encodeURIComponent(q)}`);
      assert.match(cellOf(page.text, 'users'), /id="user-detail"/, q);
    }
    const none = await admin.page(`?q=${encodeURIComponent('없는사람zzz')}`);
    assert.match(cellOf(none.text, 'users'), /찾은 이용자가 없어요/);
  });

  test('지급을 보내면 받았는지가 아직 안 열음에서 받음(실제로 받은 양)으로 바뀐다', async () => {
    const f = fields(a.code, { coins: '12' });
    const p = await previewForm(f);
    const r = await confirm(p.hidden, { people: p.people });
    assert.equal(r.status, 303);
    assert.match(await resultText(), /1명에게 지급 쪽지를 보냈어요/);
    let page = await admin.page(`?user=${a.id}`);
    assert.match(cellOf(page.text, 'users'), /아직 안 열었어요/);
    assert.match(cellOf(page.text, 'users'), /최근 지급과 받았는지/);
    const box = await api('GET', '/v1/inbox', { token: a.token });
    const note = box.body.items.find((x: { kind: string }) => x.kind === 'grant');
    assert.ok(note);
    assert.equal((await api('POST', `/v1/inbox/${note.id}/open`, { token: a.token })).status, 200);
    page = await admin.page(`?user=${a.id}`);
    const users = cellOf(page.text, 'users');
    assert.match(
      users,
      /<span class="tag live">받음<\/span> \d{4}-\d\d-\d\d \d\d:\d\d \(받은 코인 12, 채팅 이용권 0장\)/,
    );
    // 지급 칸의 최근 지급 표에서도 같은 상태
    assert.match(users, /<td data-l="받는 사람"><a href="\/admin\?user=/);
    // 이 사람의 운영 기록에 쪽지 보냄이 있다
    assert.match(users, /<td data-l="무엇">쪽지 보내기<\/td>/);
  });
});

describe('합친 계정은 묶음으로', () => {
  test('합쳐져 닫힌 계정을 찾으면 남은 계정이 열리고 두 계정의 코인 내역이 한 묶음이다', async () => {
    const old = await newDevice('18+', '합친옛계정');
    const live = await newDevice('18+', '합친남은계정');
    await addCoins(old.id, 111, 'oldwallet');
    await addCoins(live.id, 222, 'newwallet');
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [
      old.id,
      live.id,
    ]);
    const page = await admin.page(`?q=${encodeURIComponent(old.code)}`);
    const users = cellOf(page.text, 'users');
    assert.match(users, /id="user-detail"/);
    assert.match(users, /<h2>합친남은계정 /);
    assert.match(users, new RegExp(`찾은 계정 #${old.id} 는 이 계정에 합쳐졌어요`));
    assert.match(users, /oldwallet/);
    assert.match(users, /newwallet/);
    // 지급 대상은 남은 계정
    assert.match(users, new RegExp(`name="accounts" value="${live.code}"`));
    const list = await admin.page();
    assert.doesNotMatch(cellOf(list.text, 'users'), new RegExp(`user=${old.id}#`));
  });
});

describe('지급 확정은 서버가 다시 본다', () => {
  test('1명이면 인원 수 칸 없이 체크 하나로 보내고, 대상 이름이 체크 칸 글에 있다. 틀린 인원 수를 보내면 거절', async () => {
    const d = await newDevice('18+', '인원고양이');
    const p = await previewForm(fields(d.code));
    assert.equal(p.people, '');
    const view = cellOf((await admin.page()).text, 'users');
    assert.doesNotMatch(view, /name="people"/);
    assert.match(view, /위 표의 인원고양이 F-[A-Z0-9-]+에게 코인 7, 채팅 이용권 0장 지급할게요/);
    // 서버도 같다: 틀린 인원 수를 같이 보내면 거절
    await confirm(p.hidden, { people: '2' });
    assert.match(await resultText(), /받는 사람 수가 달라요/);
    assert.equal(await noteCount(d.id), 0);
    const ok = await previewForm(fields(d.code));
    assert.equal((await confirm(ok.hidden)).status, 303);
    assert.match(await resultText(), /1명에게 지급 쪽지를 보냈어요/);
    // 같은 확정을 또 보내도 (뒤로 가기, 두 탭) 한 번뿐
    await confirm(ok.hidden);
    assert.match(await resultText(), /이미 확정했거나 닫힌 미리보기/);
    assert.equal(await noteCount(d.id), 1);
  });

  test('2명 이상이면 인원 수를 안 적거나 틀리게 적으면 한 통도 안 가고, 맞게 적으면 한 번씩만 간다', async () => {
    const d1 = await newDevice('18+', '둘이상A');
    const d2 = await newDevice('18+', '둘이상B');
    const both = `${d1.code}\n${d2.code}`;
    const p = await previewForm(fields(both));
    assert.equal(p.people, '2');
    assert.equal((await confirm(p.hidden)).status, 303);
    assert.match(await resultText(), /받는 사람 수를 숫자로/);
    const q = await previewForm(fields(both));
    await confirm(q.hidden, { people: '3' });
    assert.match(await resultText(), /받는 사람 수가 달라요/);
    assert.equal(await noteCount(d1.id), 0);
    assert.equal(await noteCount(d2.id), 0);
    const ok = await previewForm(fields(both));
    await confirm(ok.hidden, { people: ok.people });
    assert.match(await resultText(), /2명에게 지급 쪽지를 보냈어요/);
    assert.equal(await noteCount(d1.id), 1);
    assert.equal(await noteCount(d2.id), 1);
  });

  test('미리보기 뒤 숨은 칸의 대상, 양, 사유, 만료를 바꿔 보내면 거절한다', async () => {
    const d = await newDevice('18+', '바꿔치기A');
    const other = await newDevice('18+', '바꿔치기B');
    const swaps: Array<Record<string, string>> = [
      { accounts: other.code },
      { accounts: `${d.code}\n${other.code}` },
      { coins: '9999' },
      { chat_passes: '5' },
      { days: '365' },
      { reason: '다른 사유' },
    ];
    for (const swap of swaps) {
      const p = await previewForm(fields(d.code));
      await confirm({ ...p.hidden, ...swap }, { people: p.people });
      assert.match(await resultText(), /미리보기와 다른 값이에요/, JSON.stringify(swap));
    }
    assert.equal(await noteCount(d.id), 0);
    assert.equal(await noteCount(other.id), 0);
  });

  test('미리보기 뒤에 계정이 합쳐져 받는 사람이 달라지면 거절한다', async () => {
    const x = await newDevice('18+', '합침전');
    const y = await newDevice('18+', '합침후');
    const p = await previewForm(fields(x.code));
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [x.id, y.id]);
    await confirm(p.hidden, { people: p.people });
    assert.match(await resultText(), /받는 사람이 달라졌어요/);
    assert.equal(await noteCount(x.id), 0);
    assert.equal(await noteCount(y.id), 0);
  });

  test('음수, 거대한 값, 소수, 글자, 상한 넘는 인원과 사유는 대상 확인 단계에서 막는다', async () => {
    const d = await newDevice('18+', '상한고양이');
    const many = Array.from({ length: 21 }, (_, i) => `F-NOPE-${String(i).padStart(4, '0')}`).join('\n');
    const bad: Array<Record<string, string>> = [
      { coins: '-1' },
      { coins: '10001' },
      { coins: '99999999999999999999' },
      { coins: '1.5' },
      { coins: '1e3' },
      { coins: '0x10' },
      { coins: '+5' },
      { coins: 'abc' },
      { chat_passes: '-3' },
      { chat_passes: '1001' },
      { coins: '0', chat_passes: '0' },
      { days: '0' },
      { days: '366' },
      { reason: 'x'.repeat(201) },
      { reason: '   ' },
      { accounts: many },
      { accounts: '   ' },
    ];
    for (const b of bad) {
      const r = await admin.post('/admin/grants/preview', fields(d.code, b));
      assert.equal(r.status, 303);
      const page = await admin.page();
      assert.doesNotMatch(cellOf(page.text, 'users'), /action="\/admin\/grants\/batch"/, JSON.stringify(b));
    }
    assert.equal(await noteCount(d.id), 0);
  });
});

describe('일괄 지급 대상 확인', () => {
  test('못 찾은 계정, 중복, 합쳐진 계정을 표시하고 못 찾은 것이 있으면 확정할 수 없다', async () => {
    const a = await newDevice('18+', '일괄하나');
    const b = await newDevice('18+', '일괄둘');
    const c = await newDevice('18+', '일괄셋');
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [c.id, b.id]);
    const r = await admin.post('/admin/grants/preview', fields(`${a.code}, ${a.id}\n${c.code}\nF-NOPE-9999`));
    assert.equal(r.status, 303);
    const users = cellOf((await admin.page()).text, 'users');
    assert.match(users, /<dt>받는 사람<\/dt><dd>2명<\/dd>/);
    assert.match(users, /<span class="tag">중복<\/span>/);
    assert.match(users, new RegExp(`합쳐진 계정 #${c.id}, 남은 계정이 받아요`));
    assert.match(users, /<span class="tag bad">찾지 못함<\/span>/);
    assert.match(users, /적은 4줄: 찾지 못한 1, 중복 1, 합쳐진 계정 1/);
    assert.match(users, /<button type="submit" disabled>/);
    await admin.post('/admin/flow/cancel', { action: 'grants/batch', discard: '1' });
  });

  test('합친 계정을 적은 줄은 남은 계정이 한 번만 받는다', async () => {
    const b = await newDevice('18+', '묶음남');
    const c = await newDevice('18+', '묶음옛');
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [c.id, b.id]);
    const p = await previewForm(fields(`${b.code}\n${c.code}`));
    // 두 줄이어도 한 사람이면 인원 수 칸 없이 체크 하나
    assert.equal(p.people, '');
    await confirm(p.hidden);
    assert.match(await resultText(), /1명에게 지급 쪽지를 보냈어요/);
    assert.equal(await noteCount(b.id), 1);
    assert.equal(await noteCount(c.id), 0);
  });
});

describe('표에서 여러 명 골라 지급', () => {
  test('고른 사람이 지급 칸의 받는 사람으로 채워지고, 숫자가 아닌 값과 20명 넘는 값은 버린다', async () => {
    const p1 = await newDevice('18+', '고른하나');
    const p2 = await newDevice('18+', '고른둘');
    const url = `?pick=${p1.id}&pick=${p2.id}&pick=abc&pick=${p1.id}`;
    const page = await admin.page(url);
    const users = cellOf(page.text, 'users');
    assert.match(users, /고른 2명: 고른하나 <code>/);
    assert.match(
      users,
      /<textarea name="accounts"[^>]*>\d+&#10;\d+<\/textarea>|<textarea name="accounts"[^>]*>\d+\n\d+<\/textarea>/,
    );
    assert.doesNotMatch(users, /abc/);
    const lots = Array.from({ length: 30 }, () => `pick=${p1.id}`).join('&');
    assert.match(cellOf((await admin.page(`?${lots}`)).text, 'users'), /고른 1명/);
    // 고른 사람에게 보내는 것도 같은 대상 확인과 인원 수 확인을 거친다
    const f = fields(`${p1.id}\n${p2.id}`);
    const pv = await previewForm(f);
    assert.equal(pv.people, '2');
    await confirm(pv.hidden, { people: pv.people });
    assert.equal(await noteCount(p1.id), 1);
    assert.equal(await noteCount(p2.id), 1);
  });

  test('표는 휴대폰에서 카드가 되고 지급 단추에 이름이 붙고 고르는 칸이 표 밖 폼에 묶인다', async () => {
    const users = cellOf((await admin.page()).text, 'users');
    assert.match(users, /<table class="users cards">/);
    assert.match(users, /<td class="pick"><input type="checkbox" name="pick" value="\d+" form="pick-form"/);
    assert.match(users, /<form id="pick-form" method="get" action="\/admin#users\/grants"/);
    assert.match(users, /<a class="button-link" href="\/admin\?account=\d+#users\/grants">[^<]+ 지급<\/a>/);
    assert.match(users, /<td class="opt" data-l="만든 날">/);
  });
});

describe('옛 앱 API 호환', () => {
  test('/v1/admin/overview 는 같은 키에 상세 내역을 싣지 않고, /v1/admin/grants/batch 는 확인 칸만으로 한 번에 쓴다', async () => {
    const d = await newDevice('18+', '옛앱지급');
    const ov = await api('GET', `/v1/admin/overview?q=${d.id}`, {
      headers: { cookie: admin.cookie },
      ip: admin.from,
    });
    assert.equal(ov.status, 200);
    assert.equal(ov.body.account.id, d.id);
    assert.equal(ov.body.account.history, undefined);
    assert.equal(ov.body.recentGrants, undefined);
    const w = await api('POST', '/v1/admin/grants/batch', {
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, origin: h.base },
      ip: admin.from,
      body: { accounts: d.code, coins: '3', chat_passes: '0', days: '5', reason: '옛 앱', confirm: 'yes' },
    });
    assert.equal(w.status, 200, w.text);
    assert.equal(await noteCount(d.id), 1);
  });
});

describe('버그 사냥 고침 (#153)', () => {
  // 분당 요청 상한이 앞 시험에 걸리지 않게 새 세션으로 시작한다
  before(async () => {
    admin = new AdminBrowser(
      () => h,
      api,
      () => ADMIN_TOKEN,
    );
    assert.equal((await admin.login()).status, 303);
    await admin.page();
  });

  const v1 = (path: string, body: Record<string, unknown>) =>
    api('POST', `/v1/admin/${path}`, {
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, origin: h.base },
      ip: admin.from,
      body,
    });

  test('reason 과 message 를 같이 보내 확정 때 사유만 바꿔도 거절한다 (별칭까지 풀어 비교)', async () => {
    const d = await newDevice('18+', '사유바꿔치기');
    const base = {
      accounts: d.code,
      coins: '7',
      chat_passes: '0',
      days: '10',
      reason: '본사유',
      message: '본사유',
    };
    const swaps: Array<Record<string, string>> = [
      { reason: '바꾼사유' },
      { reason: '', message: '바꾼사유' },
    ];
    for (const swap of swaps) {
      const p = await previewForm(base);
      await confirm({ ...p.hidden, ...swap }, { people: p.people });
      assert.match(await resultText(), /미리보기와 다른 값이에요/, JSON.stringify(swap));
    }
    assert.equal(await noteCount(d.id), 0);
    // 별칭만 바꿔 쓴 같은 값은 통과 (message 로만 미리보기, reason 으로 확정)
    const q = await previewForm({
      accounts: d.code,
      coins: '7',
      chat_passes: '0',
      days: '10',
      message: '같은사유',
    });
    await confirm({ ...q.hidden, reason: '같은사유', message: '' }, { people: q.people });
    assert.match(await resultText(), /1명에게 지급 쪽지를 보냈어요/);
  });

  test('21명 넘게 고르면 20명만 넣고 몇 명이 빠졌는지 말한다', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push((await newDevice('18+', `다수${i}`)).id);
    const users = cellOf((await admin.page(`?${ids.map((x) => `pick=${x}`).join('&')}`)).text, 'users');
    assert.match(users, /고른 20명 \(한 번에 20명까지만 넣을 수 있어 2명은 빠졌어요\)/);
  });

  test('정책 숫자와 이벤트 선물 코인은 10진수만, 옛 앱 모양("5", 5, 5.0, 빈 칸)은 받는다', async () => {
    for (const bad of ['1e2', '0x10', '-1', '+5', '5.5', 'abc']) {
      const r = await v1('ai/policy', { auto_monthly: bad });
      assert.equal(r.status, 400, `auto_monthly ${bad}: ${r.text}`);
      assert.equal((await v1('ai/policy', { seat_limit: bad })).status, 400, `seat_limit ${bad}`);
    }
    for (const ok of ['5', 5, 5.0, ' 5 ', '']) {
      const r = await v1('ai/policy', { auto_monthly: ok, seat_limit: ok });
      assert.equal(r.status, 200, `${JSON.stringify(ok)}: ${r.text}`);
    }
    const ev = (coins: unknown, id: string) => ({
      id,
      kind: 'gift',
      title_ko: '제목',
      title_en: 'T',
      body_ko: '본문',
      body_en: 'B',
      from: '2099-01-01T00:00',
      until: '2099-01-02T00:00',
      coins,
    });
    for (const bad of ['1e2', '0x10', '1e1'])
      assert.equal((await v1('events', ev(bad, 'bad-1'))).status, 400, `coins ${bad}`);
    assert.equal((await v1('events', ev('50', 'ok-1'))).status, 200);
    assert.equal((await v1('events', ev(50, 'ok-2'))).status, 200);
  });

  test('숫자 칸에 배열이나 글이 아닌 값을 보내면 500 이 아니라 400', async () => {
    const d = await newDevice('18+', '배열고양이');
    for (const [path, body] of [
      ['grants/batch', { accounts: d.code, coins: ['1', '2'], reason: 'r', confirm: 'yes' }],
      ['notes', { account: d.code, coins: ['1'], message: 'r' }],
      ['ai/revoke', { account: d.code, count: ['1', '2'], confirm: 'yes' }],
      ['ai/policy', { auto_monthly: ['1'] }],
      ['ai/policy', { seat_limit: { a: 1 } }],
    ] as const) {
      const r = await v1(path, body as Record<string, unknown>);
      assert.equal(r.status, 400, `${path}: ${r.status} ${r.text}`);
    }
  });
});

describe('이용자 상세 길이와 목록 (사용성 2차)', () => {
  test('맨 위에 지급, 회수, 철회 바로가기 세 단추가 있고 가리키는 자리가 있다', async () => {
    const d = await newDevice('18+', '바로가기고양이');
    const users = cellOf((await admin.page(`?user=${d.id}`)).text, 'users');
    const nav = /<nav class="row jump"[^>]*>(.*?)<\/nav>/s.exec(users)?.[1] ?? '';
    assert.equal((nav.match(/<a /g) ?? []).length, 3);
    for (const [id, label] of [
      ['user-grant', '지급'],
      ['user-revoke', '회수'],
      ['user-notes', '철회'],
    ] as const) {
      assert.match(nav, new RegExp(`href="#${id}" data-jump="${id}">${label}</a>`));
      assert.match(users, new RegExp(`id="${id}"`));
    }
    // 바로가기는 상세 안의 첫 칸 (통계보다 위)
    assert.ok(users.indexOf('class="row jump"') < users.indexOf('<dl class="stats">'));
  });

  test('위험한 회수 칸 둘은 접어 두고, 지급 칸 바로 아래가 아니라 내역 뒤에 있다', async () => {
    const d = await newDevice('18+', '접힌회수');
    await addCoins(d.id, 40);
    const users = cellOf((await admin.page(`?user=${d.id}`)).text, 'users');
    const fold = /<details class="danger-fold" id="user-revoke">(.*?)<\/details>/s.exec(users);
    assert.ok(fold, '접는 칸이 있어야 한다 (기본은 닫힘)');
    assert.match(fold[1] ?? '', /action="\/admin\/ai\/revoke"/);
    assert.match(fold[1] ?? '', /action="\/admin\/coins\/revoke\/preview"/);
    // 접는 칸 밖에는 회수 폼이 없다
    const outside = users.replace(fold[0], '');
    assert.doesNotMatch(outside, /action="\/admin\/ai\/revoke"/);
    assert.doesNotMatch(outside, /action="\/admin\/coins\/revoke\/preview"/);
    // 순서: 지급 단추, 막기와 허용, 쪽지, 내역, 그 뒤에 접힌 회수
    const at = (s: string) => users.indexOf(s);
    assert.ok(at('에게 지급, 대상 확인하기') < at('<h3>막기와 허용</h3>'));
    assert.ok(at('<h3>코인 내역</h3>') < at('id="user-revoke"'));
    assert.ok(at('id="user-revoke"') < at('<h3>이 사람의 운영 기록</h3>'));
    // 지급 단추와 회수 단추 사이에는 다른 칸이 끼어 있다
    const between = users.slice(at('에게 지급, 대상 확인하기'), at('id="user-revoke"'));
    assert.ok((between.match(/<h3/g) ?? []).length >= 3);
  });

  test('회수 미리보기가 진행 중이거나 회수 결과가 있으면 접는 칸이 열려 있다', async () => {
    const d = await newDevice('18+', '열린회수');
    await addCoins(d.id, 40);
    await admin.post('/admin/coins/revoke/preview', { account: d.code, coins: '5', reason: '시험 회수' });
    const open = cellOf((await admin.page(`?user=${d.id}`)).text, 'users');
    assert.match(open, /<details class="danger-fold" id="user-revoke" open>/);
    assert.match(open, /id="revoke-preview"/);
    await admin.post('/admin/flow/cancel', { action: 'coins/revoke', discard: '1' });
  });

  test('이용자 목록: 검색이 맨 위, 정렬은 접혀 있고, 한 쪽은 20명', async () => {
    for (let i = 0; i < 22; i++) await newDevice('18+', `목록${String(i).padStart(2, '0')}`);
    const users = cellOf((await admin.page()).text, 'users');
    assert.match(users, /<details class="sort-fold"><summary>정렬 바꾸기<\/summary>/);
    assert.ok(users.indexOf('name="q"') < users.indexOf('<details class="sort-fold"'));
    assert.match(users, /한 쪽에 20명씩 보여요/);
    const rows = (users.match(/<td class="pick">/g) ?? []).length;
    assert.equal(rows, 20);
    // 정렬을 바꾼 검색이면 펼쳐서 보인다
    const sorted = cellOf((await admin.page('?sort=coins&direction=asc')).text, 'users');
    assert.match(sorted, /<details class="sort-fold" open>/);
  });
});
