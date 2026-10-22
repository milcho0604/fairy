import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

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

describe('운영자 탭과 이용자 표', () => {
  test('모든 탭은 로그인 뒤 200이고 로그인 없이는 운영 내용을 보여 주지 않는다', async () => {
    for (const path of ['', '/users', '/grants', '/notices', '/events', '/features', '/ai', '/log']) {
      const signed = await admin.page(path);
      assert.equal(signed.status, 200, path);
      assert.match(signed.text, /aria-current="page"/);
      assert.doesNotMatch(signed.text, /<script(?![^>]*src="\/admin\/admin\.js")/i);
      assert.doesNotMatch(signed.text, /<script[^>]*>[^<]/i);

      const anon = await api('GET', `/admin${path}`);
      assert.equal(anon.status, 200, path);
      assert.match(anon.text, /운영자 토큰/);
      assert.doesNotMatch(anon.text, /name="csrf"/);
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
    assert.match(legacy.text, /이용자 찾기와 자세히 보기/);
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
    const tooManyCoins = await admin.post('/admin/grants/batch', {
      ...base,
      coins: '10001',
      confirm: 'yes',
    });
    assert.equal(tooManyCoins.status, 303);
    assert.equal(tooManyCoins.headers.get('location'), '/admin/grants#form-error');
    const many = Array.from({ length: 21 }, () => d.code).join('\n');
    assert.equal(
      (await admin.act('/admin/grants/batch', { ...base, accounts: many, confirm: 'yes' })).ok,
      false,
    );
    assert.equal((await admin.post('/admin/grants/batch', { ...base, confirm: 'yes' }, false)).status, 403);
  });
});
