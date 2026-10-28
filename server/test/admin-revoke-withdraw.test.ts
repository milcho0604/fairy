// 코인 회수, 안 연 쪽지 철회, 밖 백업 상태 (#153, #152 뒤 빠진 기능):
// 회수는 미리보기 뒤 확정, 확인 칸, 사유, 잔액 넘김 거절(음수 금지), 장부 합 = 잔액, 합쳐진 계정은 남은 계정에서, 같은 요청 한 번만,
// 동시 요청 직렬화, 앱 맞추기가 서버 잔액으로 내려가는 것. 철회는 안 연 쪽지만, 열기와 동시에 오면 둘 중 하나만, 쪽지함에서 빠짐.
// 백업은 상태 파일을 읽어 마지막 성공, 실패와 까닭, 오래 성공 못 함이 홈 카드와 확인할 것으로 나오는 것.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
const STATUS_DIR = mkdtempSync(join(tmpdir(), 'fairy-status-'));
let h: Harness;
const { api, newDevice, session, balanceOf, ledgerSum, lastLog } = client(() => h);
let admin: AdminBrowser;
let adminSession = '';

const adminApi = (path: string, body: Record<string, unknown>) =>
  api('POST', `/v1/admin/${path}`, { token: adminSession, body });
const cellOf = (html: string, cell: string) => {
  const from = html.indexOf(`id="cell-${cell}"`);
  const next = html.indexOf('class="panel"', from + 10);
  return html.slice(from, next < 0 ? undefined : next);
};
let seq = 0;
const addCoins = async (id: string, amount: number, reason = 'todo') => {
  await h.pool.query(
    `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day) VALUES ($1, $2, $3, $4, $4, 'ok', current_date)`,
    [`t-rw-${++seq}`, id, reason, amount],
  );
  await h.pool.query('UPDATE account SET balance = balance + $2 WHERE id = $1', [id, amount]);
};
const revokeFields = (account: string, coins: string, extra: Record<string, string> = {}) => ({
  account,
  coins,
  reason: '잘못 준 코인',
  ...extra,
});
const logCount = async (action: string) =>
  Number((await h.pool.query('SELECT count(*) AS n FROM admin_log WHERE action = $1', [action])).rows[0].n);

before(async () => {
  h = await startHarness({
    adminToken: ADMIN_TOKEN,
    adminSubs: [ADMIN_SUB],
    backup: { key: undefined, dir: join(STATUS_DIR, 'none'), statusDir: STATUS_DIR },
  });
  admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
  const op = await newDevice('18+', '운영자');
  adminSession = await session(op.id, ADMIN_SUB);
});

after(async () => {
  await h?.stop();
  rmSync(STATUS_DIR, { recursive: true, force: true });
});

describe('코인 회수', () => {
  test('상세에 회수 칸이 있고, 미리보기에서 잔액과 회수 뒤 잔액을 본 뒤 확인 칸으로 확정한다', async () => {
    const a = await newDevice('18+', '회수대상');
    await addCoins(a.id, 50);
    const page = await admin.page(`?user=${a.id}`);
    assert.match(cellOf(page.text, 'users'), /action="\/admin\/coins\/revoke\/preview"/);
    // 미리보기: 아직 아무것도 빼지 않는다
    const pre = await admin.post('/admin/coins/revoke/preview', revokeFields(a.code, '20'));
    assert.equal(pre.status, 303);
    const shown = cellOf((await admin.page(`?user=${a.id}`)).text, 'users');
    assert.match(shown, /id="revoke-preview"/);
    assert.match(shown, /지금 잔액<\/dt><dd>50</);
    assert.match(shown, /회수 뒤 잔액<\/dt><dd>30</);
    assert.equal(await balanceOf(a.id), 50);
    // 확인 칸 없이는 거절, 잔액은 그대로
    const hidden = Object.fromEntries(
      [...shown.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)]
        .filter((x) => x[1] !== 'csrf')
        .map((x) => [x[1], x[2]]),
    ) as Record<string, string>;
    assert.ok(hidden.flow, '확정 폼에 미리보기 번호가 있다');
    assert.equal((await admin.post('/admin/coins/revoke', hidden)).status, 303);
    assert.equal(await balanceOf(a.id), 50, '확인 칸 없음');
    // 미리보기는 거절 때 닫혔으니 다시 만들어 확정
    const r = await admin.act('/admin/coins/revoke', revokeFields(a.code, '20', { confirm: 'yes' }));
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /코인 20개를 회수했어요 \(잔액 50, 회수 뒤 30\)/);
    assert.equal(await balanceOf(a.id), 30);
    // 장부: 음수 한 줄, 합 = 잔액
    const e = await h.pool.query(
      `SELECT reason, amount, asked, status FROM coin_entry WHERE account_id = $1 AND reason = 'admin-revoke'`,
      [a.id],
    );
    assert.deepEqual(e.rows, [{ reason: 'admin-revoke', amount: -20, asked: -20, status: 'ok' }]);
    assert.equal(await ledgerSum(a.id), await balanceOf(a.id));
    // 운영 기록: 누가, 대상, 전후 잔액, 사유
    const log = await lastLog('coins.revoke');
    assert.equal(log.target, `account:${a.id}`);
    assert.deepEqual(log.detail, { coins: 20, before: 50, after: 30, reason: '잘못 준 코인' });
    // 상세의 코인 내역에 회수 줄
    assert.match(cellOf((await admin.page(`?user=${a.id}`)).text, 'users'), /<code>admin-revoke<\/code>/);
  });

  test('미리보기 없이 확정 경로를 바로 부르면 거절한다 (웹은 미리보기를 거친 것만)', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 10);
    const had = await balanceOf(a.id);
    const logs = await logCount('coins.revoke');
    await admin.page();
    const r = await admin.post('/admin/coins/revoke', revokeFields(a.code, '5', { confirm: 'yes' }));
    assert.equal(r.status, 303);
    assert.equal(await balanceOf(a.id), had);
    assert.equal(await logCount('coins.revoke'), logs);
  });

  test('잔액보다 많이는 못 뺀다: 미리보기는 막히고 확정도 거절, 잔액은 음수가 되지 않는다', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 7);
    assert.equal((await admin.post('/admin/coins/revoke/preview', revokeFields(a.code, '8'))).status, 303);
    const shown = cellOf((await admin.page(`?user=${a.id}`)).text, 'users');
    assert.match(shown, /잔액 7보다 많이 회수할 수 없어요/);
    assert.match(shown, /<button type="submit" class="danger" disabled>확정하고 코인 회수/);
    const r = await admin.act('/admin/coins/revoke', revokeFields(a.code, '8', { confirm: 'yes' }));
    assert.equal(r.ok, false);
    assert.match(r.text, /잔액 7보다 많이 회수할 수 없어요/);
    assert.equal(await balanceOf(a.id), 7);
    // 딱 잔액만큼은 된다
    const ok = await admin.act('/admin/coins/revoke', revokeFields(a.code, '7', { confirm: 'yes' }));
    assert.equal(ok.ok, true, ok.text);
    assert.equal(await balanceOf(a.id), 0);
    assert.equal(await ledgerSum(a.id), 0);
  });

  test('사유는 필수, 양은 1 이상 정수, 없는 계정은 거절한다', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 5);
    for (const [fields, want] of [
      [{ account: a.code, coins: '1', reason: '  ' }, /회수 사유를 넣어 주세요/],
      [{ account: a.code, coins: '0', reason: 'x' }, /회수할 코인 수를 넣어 주세요/],
      [{ account: a.code, coins: '-3', reason: 'x' }, /숫자만/],
      [{ account: a.code, coins: '1.5', reason: 'x' }, /숫자만/],
      [{ account: a.code, coins: '1', reason: 'x'.repeat(201) }, /200자까지/],
      [{ account: '', coins: '1', reason: 'x' }, /계정 번호나 기기 코드/],
    ] as const) {
      const r = await admin.act('/admin/coins/revoke', { ...fields, confirm: 'yes' });
      assert.equal(r.ok, false);
      assert.match(r.text, want);
    }
    const none = await admin.act('/admin/coins/revoke', revokeFields('F-ZZZZ-ZZZZ', '1', { confirm: 'yes' }));
    assert.equal(none.ok, false);
    assert.equal(await balanceOf(a.id), 5);
  });

  test('합쳐진 계정을 적으면 남은 계정에서 빼고, 합쳐진 계정 장부는 건드리지 않는다', async () => {
    const live = await newDevice('18+');
    const old = await newDevice('18+');
    await addCoins(live.id, 40);
    await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [
      old.id,
      live.id,
    ]);
    const pre = await admin.post('/admin/coins/revoke/preview', revokeFields(old.code, '15'));
    assert.equal(pre.status, 303);
    const shown = cellOf((await admin.page(`?user=${live.id}`)).text, 'users');
    assert.match(shown, /합쳐진 계정 #\d+, 남은 계정에서 빼요/);
    const r = await admin.act('/admin/coins/revoke', revokeFields(old.code, '15', { confirm: 'yes' }));
    assert.equal(r.ok, true, r.text);
    assert.equal(await balanceOf(live.id), 25);
    const e = await h.pool.query(
      `SELECT account_id FROM coin_entry WHERE reason = 'admin-revoke' AND asked = -15`,
    );
    assert.deepEqual(
      e.rows.map((x) => String(x.account_id)),
      [live.id],
    );
  });

  test('앱 API: 확인 칸 없으면 거절, 같은 요청 번호는 한 번만, 다른 내용을 같은 번호로 보내면 거절', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 100);
    const body = {
      account: a.code,
      coins: 30,
      reason: '앱에서 회수',
      confirm: 'yes',
      request_id: 'rv-app-0001',
    };
    assert.equal((await adminApi('coins/revoke', { ...body, confirm: undefined })).status, 400);
    assert.equal(await balanceOf(a.id), 100);
    const first = await adminApi('coins/revoke', body);
    assert.equal(first.status, 200, first.text);
    const again = await adminApi('coins/revoke', body);
    assert.equal(again.status, 200, again.text);
    assert.equal(await balanceOf(a.id), 70, '두 번 보내도 한 번만');
    assert.equal(await ledgerSum(a.id), 70);
    const other = await adminApi('coins/revoke', { ...body, coins: 31 });
    assert.equal(other.status, 409);
    assert.match(other.text, /request_conflict/);
    assert.equal(await balanceOf(a.id), 70);
  });

  test('동시 요청: 잔액 10에 6을 동시에 둘 보내면 하나만 되고 잔액은 음수가 되지 않는다', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 10);
    const rs = await Promise.all(
      [1, 2].map((i) =>
        adminApi('coins/revoke', { account: a.code, coins: 6, reason: `동시 ${i}`, confirm: 'yes' }),
      ),
    );
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
    assert.equal(await balanceOf(a.id), 4);
    assert.equal(await ledgerSum(a.id), 4);
  });

  test('같은 요청 번호 동시 두 번: 한 번만 빼고 운영 기록도 한 줄', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 100);
    const body = {
      account: a.code,
      coins: 10,
      reason: '더블클릭',
      confirm: 'yes',
      request_id: 'rv-dbl-0001',
    };
    const rs = await Promise.all([adminApi('coins/revoke', body), adminApi('coins/revoke', body)]);
    assert.deepEqual(
      rs.map((r) => r.status),
      [200, 200],
    );
    assert.equal(await balanceOf(a.id), 90);
    const n = await h.pool.query(
      `SELECT count(*) AS n FROM admin_log WHERE action = 'coins.revoke' AND target = $1`,
      [`account:${a.id}`],
    );
    assert.equal(Number(n.rows[0].n), 1);
  });

  test('앱은 다음 /v1/sync 응답의 서버 잔액으로 맞춘다 (회수 뒤 잔액이 내려간다)', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 60);
    const before = await api('POST', '/v1/sync', { token: a.token, body: { entries: [] } });
    assert.equal(before.body.balance, 60);
    const r = await adminApi('coins/revoke', {
      account: a.code,
      coins: 25,
      reason: '맞추기',
      confirm: 'yes',
    });
    assert.equal(r.status, 200, r.text);
    const after = await api('POST', '/v1/sync', { token: a.token, body: { entries: [] } });
    assert.equal(after.body.balance, 35);
    // 앱이 그 사이 번 코인은 서버 잔액에 더해진다
    const earn = await api('POST', '/v1/sync', {
      token: a.token,
      body: {
        entries: [
          {
            id: randomUUID(),
            reason: 'todo',
            amount: 1,
            day: new Date().toISOString().slice(0, 10),
            ref: 'r1',
          },
        ],
      },
    });
    assert.equal(earn.body.balance, 36);
  });

  test('오늘 쓴 코인 합에는 회수가 들지 않는다 (회수는 쓰기가 아니다)', async () => {
    const a = await newDevice('18+');
    await addCoins(a.id, 20);
    const ov = async () =>
      (await api('GET', '/v1/admin/overview', { token: adminSession })).body.summary.spentDay;
    const had = await ov();
    await adminApi('coins/revoke', { account: a.code, coins: 5, reason: '쓴 코인 합', confirm: 'yes' });
    assert.equal(await ov(), had);
  });
});

describe('안 연 쪽지 철회', () => {
  const sendGrant = async (code: string, coins: number) => {
    const r = await adminApi('notes', { account: code, coins, message: '철회 시험', days: 10 });
    assert.equal(r.status, 200, r.text);
    return String((await h.pool.query('SELECT max(id) AS id FROM inbox')).rows[0].id);
  };
  const withdraw = (id: string, account: string, extra: Record<string, string> = {}) =>
    admin.act('/admin/notes/withdraw', { id, account, confirm: id, ...extra });

  test('안 연 쪽지는 철회되고 쪽지함 목록과 안 연 개수에서 빠지며 열 수 없다. 운영 기록이 남는다', async () => {
    const a = await newDevice('18+', '철회대상');
    const id = await sendGrant(a.code, 12);
    assert.equal((await api('GET', '/v1/inbox', { token: a.token })).body.items.length, 1);
    assert.equal((await api('POST', '/v1/sync', { token: a.token, body: { entries: [] } })).body.inbox, 1);
    const page = await admin.page(`?user=${a.id}`);
    assert.match(cellOf(page.text, 'users'), /action="\/admin\/notes\/withdraw"/);
    const r = await withdraw(id, a.code);
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /철회했어요/);
    const box = await api('GET', '/v1/inbox', { token: a.token });
    assert.equal(box.body.items.length, 0);
    assert.equal(box.body.unopened, 0);
    assert.equal((await api('POST', '/v1/sync', { token: a.token, body: { entries: [] } })).body.inbox, 0);
    const open = await api('POST', `/v1/inbox/${id}/open`, { token: a.token });
    assert.equal(open.status, 404);
    assert.equal(open.body.reason, 'withdrawn');
    assert.equal(await balanceOf(a.id), 0, '코인은 들어가지 않았다');
    const log = await lastLog('note.withdraw');
    assert.equal(log.target, `account:${a.id}`);
    assert.deepEqual(log.detail, { note: Number(id), coins: 12, chatPasses: 0 });
    // 운영 화면에는 철회됨
    assert.match(cellOf((await admin.page(`?user=${a.id}`)).text, 'users'), /철회됨/);
  });

  test('연 쪽지는 철회할 수 없다 (받은 코인은 코인 회수로)', async () => {
    const a = await newDevice('18+');
    const id = await sendGrant(a.code, 9);
    assert.equal((await api('POST', `/v1/inbox/${id}/open`, { token: a.token })).status, 200);
    const r = await withdraw(id, a.code);
    assert.equal(r.ok, false);
    assert.match(r.text, /이미 연 쪽지는 철회할 수 없어요.*코인 회수/);
    assert.equal(await balanceOf(a.id), 9);
    // 화면에는 단추 대신 안내
    const users = cellOf((await admin.page(`?user=${a.id}`)).text, 'users');
    assert.doesNotMatch(users, /action="\/admin\/notes\/withdraw"/);
    assert.match(users, /연 쪽지는 철회할 수 없어요/);
    // 그 코인은 코인 회수로
    const rv = await adminApi('coins/revoke', {
      account: a.code,
      coins: 9,
      reason: '연 쪽지 회수',
      confirm: 'yes',
    });
    assert.equal(rv.status, 200);
    assert.equal(await balanceOf(a.id), 0);
  });

  test('이미 철회한 쪽지, 기한이 지난 쪽지, 없는 쪽지, 확인 칸 없음은 거절한다', async () => {
    const a = await newDevice('18+');
    const id = await sendGrant(a.code, 3);
    assert.equal((await withdraw(id, a.code, { confirm: '' })).ok, false);
    // 앱 API 도 확인(쪽지 번호) 없이는 거절, 다른 번호를 확인해도 거절
    assert.equal((await adminApi('notes/withdraw', { id, account: a.code })).status, 400);
    assert.equal(
      (await adminApi('notes/withdraw', { id, account: a.code, confirm: String(Number(id) + 1) })).status,
      400,
    );
    assert.equal(
      (await h.pool.query('SELECT withdrawn_at FROM inbox WHERE id = $1', [id])).rows[0].withdrawn_at,
      null,
    );
    assert.equal((await withdraw(id, a.code)).ok, true);
    const again = await withdraw(id, a.code);
    assert.equal(again.ok, false);
    assert.match(again.text, /이미 철회한 쪽지/);
    const old = await sendGrant(a.code, 3);
    await h.pool.query(`UPDATE inbox SET expires_at = now() - interval '1 hour' WHERE id = $1`, [old]);
    assert.match((await withdraw(old, a.code)).text, /기한이 지나/);
    assert.match((await withdraw('999999999', a.code, { confirm: '999999999' })).text, /없는 쪽지/);
    assert.match((await withdraw('abc', a.code, { confirm: 'abc' })).text, /쪽지 번호가 이상해요/);
  });

  test('친구 선물 같은 운영자 쪽지가 아닌 것은 철회할 수 없다', async () => {
    const a = await newDevice('18+');
    const b = await newDevice('18+');
    await h.pool.query(
      `INSERT INTO inbox (account_id, kind, coins, from_account) VALUES ($1, 'gift', 5, $2)`,
      [a.id, b.id],
    );
    const id = String((await h.pool.query('SELECT max(id) AS id FROM inbox')).rows[0].id);
    const r = await withdraw(id, a.code);
    assert.equal(r.ok, false);
    assert.match(r.text, /운영자가 보낸 지급, 알림 쪽지만/);
  });

  test('철회와 열기가 동시에 오면 둘 중 하나만 이긴다 (코인이 들어갔으면 철회 안 됨, 철회됐으면 코인 없음)', async () => {
    let withdrawnWins = 0;
    let openWins = 0;
    for (let i = 0; i < 12; i++) {
      const a = await newDevice('18+');
      const id = await sendGrant(a.code, 5);
      const [w, o] = await Promise.all([
        adminApi('notes/withdraw', { id, account: a.code, confirm: id }),
        api('POST', `/v1/inbox/${id}/open`, { token: a.token }),
      ]);
      const row = (await h.pool.query('SELECT opened_at, withdrawn_at FROM inbox WHERE id = $1', [id]))
        .rows[0];
      assert.equal(!!row.opened_at && !!row.withdrawn_at, false, '둘 다 이길 수 없다');
      if (w.status === 200) {
        withdrawnWins++;
        assert.equal(o.status, 404);
        assert.equal(await balanceOf(a.id), 0);
        assert.ok(row.withdrawn_at);
      } else {
        openWins++;
        assert.equal(o.status, 200);
        assert.equal(w.status, 400);
        assert.equal(await balanceOf(a.id), 5);
        assert.ok(row.opened_at);
      }
      assert.equal(await ledgerSum(a.id), await balanceOf(a.id));
    }
    assert.equal(withdrawnWins + openWins, 12);
  });

  test('DB 제약: 연 쪽지에 철회 표시를 직접 넣을 수 없다', async () => {
    const a = await newDevice('18+');
    const id = await sendGrant(a.code, 1);
    await api('POST', `/v1/inbox/${id}/open`, { token: a.token });
    await assert.rejects(
      h.pool.query('UPDATE inbox SET withdrawn_at = now() WHERE id = $1', [id]),
      /inbox_withdrawn_check/,
    );
  });
});

describe('밖 백업 상태', () => {
  const sec = (ms: number) => Math.floor(ms / 1000);
  const put = (name: string, text: string) => writeFileSync(join(STATUS_DIR, name), text);
  const clear = () => {
    rmSync(STATUS_DIR, { recursive: true, force: true });
    mkdirSync(STATUS_DIR, { recursive: true });
  };
  const overview = async () => (await api('GET', '/v1/admin/overview', { token: adminSession })).body;
  const HOUR = 3_600_000;
  const backupCards = (b: { todo: Array<{ kind: string }> }) =>
    b.todo.filter((t) => t.kind.startsWith('backup_'));

  test('상태 파일이 없으면 unknown 이고 확인할 것 카드도 없다', async () => {
    clear();
    const b = await overview();
    assert.equal(b.backup.external.db.state, 'unknown');
    assert.equal(b.backup.external.files.state, 'unknown');
    assert.equal(backupCards(b).length, 0);
    assert.match(cellOf((await admin.page()).text, 'home'), /결과는 아직 못 읽었어요/);
  });

  test('둘 다 최근에 성공이면 ok, 홈에 마지막 성공 시각이 나오고 카드는 없다', async () => {
    clear();
    const now = Date.now();
    put('db.ok', `${sec(now - 2 * HOUR)}\tfairy-20261028-053000.sql.gz 4096바이트\n`);
    put('db.checked', `${sec(now - 60_000)}\n`);
    put('files.ok', `${sec(now - 3 * HOUR)}\t서버 백업 파일 12개 맞춤\n`);
    put('files.checked', `${sec(now - 60_000)}\n`);
    const b = await overview();
    assert.equal(b.backup.external.db.state, 'ok');
    assert.equal(b.backup.external.db.lastOkAt, sec(now - 2 * HOUR) * 1000);
    assert.equal(b.backup.external.db.lastOkNote, 'fairy-20261028-053000.sql.gz 4096바이트');
    assert.equal(b.backup.external.files.state, 'ok');
    assert.equal(backupCards(b).length, 0);
    const html = (await admin.page()).text;
    assert.match(cellOf(html, 'home'), /데이터베이스 덤프: 마지막 성공 20\d\d-\d\d-\d\d \d\d:\d\d/);
    assert.match(cellOf(html, 'home'), /백업 파일 외장 디스크 사본: 마지막 성공/);
    assert.match(cellOf(html, 'settings'), /fairy-20261028-053000\.sql\.gz 4096바이트/);
  });

  test('마지막이 실패면 failed(bad 카드), 까닭이 홈과 설정에 나온다. 그 뒤 성공하면 ok 로 돌아온다', async () => {
    clear();
    const now = Date.now();
    put('files.ok', `${sec(now - 30 * HOUR)}\t서버 백업 파일 12개 맞춤\n`);
    put('files.fail', `${sec(now - HOUR)}\trsync 종료 코드 23 <b>x</b>\n`);
    put('db.ok', `${sec(now - HOUR)}\t덤프\n`);
    const b = await overview();
    assert.equal(b.backup.external.files.state, 'failed');
    assert.equal(b.backup.external.files.lastFailReason, 'rsync 종료 코드 23 <b>x</b>');
    const card = b.todo.find((t: { kind: string }) => t.kind === 'backup_files');
    assert.deepEqual({ level: card.level, n: card.n }, { level: 'bad', n: -1 });
    const html = (await admin.page()).text;
    assert.match(cellOf(html, 'home'), /마지막 실패 20\d\d.*까닭 rsync 종료 코드 23 &lt;b&gt;x&lt;\/b&gt;/);
    assert.match(cellOf(html, 'home'), /백업 파일 외장 디스크 사본 백업이 마지막에 실패했어요/);
    assert.doesNotMatch(cellOf(html, 'home'), /<b>x<\/b>/);
    put('files.ok', `${sec(Date.now())}\t서버 백업 파일 13개 맞춤\n`);
    assert.equal((await overview()).backup.external.files.state, 'ok');
  });

  test('26시간을 넘게 성공하지 못하면 stale 경고(몇 시간째), 25시간이면 아직 ok', async () => {
    clear();
    const now = Date.now();
    put('db.ok', `${sec(now - 25 * HOUR)}\t덤프\n`);
    put('files.ok', `${sec(now - 30 * HOUR)}\t사본\n`);
    const b = await overview();
    assert.equal(b.backup.external.db.state, 'ok');
    assert.equal(b.backup.external.files.state, 'stale');
    const card = b.todo.find((t: { kind: string }) => t.kind === 'backup_files');
    assert.deepEqual({ level: card.level, n: card.n }, { level: 'warn', n: 30 });
    assert.match(cellOf((await admin.page()).text, 'home'), /30시간째 성공하지 못했어요/);
  });

  test('모양이 틀린 상태 파일은 없는 것으로 본다 (읽다 만 파일, 엉뚱한 글)', async () => {
    clear();
    put('db.ok', 'garbage');
    put('db.fail', '12\tx');
    put('files.checked', '');
    const b = await overview();
    assert.equal(b.backup.external.db.state, 'unknown');
    assert.equal(b.backup.external.files.state, 'unknown');
  });
});
