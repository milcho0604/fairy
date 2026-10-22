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
  const people = /name="people"[^>]*pattern="(\d+)"/.exec(m[1] ?? '')?.[1];
  assert.ok(people, '인원 수 칸이 있어야 한다');
  return { hidden: hiddenFields, people };
}
const confirm = (hiddenFields: Record<string, string>, extra: Record<string, string> = {}) =>
  admin.post('/admin/grants/batch', { ...hiddenFields, confirm: 'yes', ...extra });
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
      '<h3>받은 쪽지와 받았는지</h3>',
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
  test('인원 수를 안 적거나 틀리게 적으면 한 통도 안 가고, 맞게 적으면 한 번만 간다', async () => {
    const d = await newDevice('18+', '인원고양이');
    const p = await previewForm(fields(d.code));
    assert.equal(p.people, '1');
    assert.equal((await confirm(p.hidden)).status, 303);
    assert.match(await resultText(), /받는 사람 수를 숫자로/);
    assert.equal(await noteCount(d.id), 0);
    const q = await previewForm(fields(d.code));
    await confirm(q.hidden, { people: '2' });
    assert.match(await resultText(), /받는 사람 수가 달라요|받는 사람 수를 숫자로/);
    assert.equal(await noteCount(d.id), 0);
    const ok = await previewForm(fields(d.code));
    await confirm(ok.hidden, { people: ok.people });
    assert.match(await resultText(), /1명에게 지급 쪽지를 보냈어요/);
    // 같은 확정을 또 보내도 (뒤로 가기, 두 탭) 한 번뿐
    await confirm(ok.hidden, { people: ok.people });
    assert.match(await resultText(), /이미 확정했거나 닫힌 미리보기/);
    assert.equal(await noteCount(d.id), 1);
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
    assert.equal(p.people, '1');
    await confirm(p.hidden, { people: p.people });
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
