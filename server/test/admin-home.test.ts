// 운영자 홈 (#152): 일별 추이(한국 날짜), 서버 백업 현황, 잠기는 인원, 확인할 것의 백업 줄, 웹 그림(CSP 안),
// 옛 앱이 읽는 /v1/admin/overview 의 옛 칸이 그대로인 것
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
const DAY = 86_400_000;
const BACKUP_DIR = mkdtempSync(join(tmpdir(), 'fairy-152-'));
let h: Harness;
const { api, newDevice, session } = client(() => h);
let admin: AdminBrowser;
let appToken = '';
let opId = '';

/** 한국 날짜 (YYYY-MM-DD), 오늘에서 n 일 전 */
const kstDay = (back: number) => new Date(Date.now() + 9 * 3_600_000 - back * DAY).toISOString().slice(0, 10);
/** 한국 날짜 정오 (UTC 03:00) 를 시각으로. 날짜 경계에서 벗어난 값 */
const noon = (back: number) => `${kstDay(back)}T12:00:00+09:00`;
const overview = async () => {
  const r = await api('GET', '/v1/admin/overview', { token: appToken });
  assert.equal(r.status, 200, r.text);
  return r.body;
};
const dayOf = (body: { trend: { days: Array<{ day: string }> } }, back: number) =>
  body.trend.days.find((d) => d.day === kstDay(back)) as {
    day: string;
    signups: number;
    active: number;
    asks: number;
    costMicros: number;
  };
const UNKNOWN = {
  state: 'unknown',
  lastOkAt: null,
  lastOkNote: null,
  lastFailAt: null,
  lastFailReason: null,
  checkedAt: null,
};
const homeCell = (html: string) =>
  html.slice(html.indexOf('id="cell-home"'), html.indexOf('id="cell-users"'));
const settingsCell = (html: string) => html.slice(html.indexOf('id="cell-settings"'));

async function addAccount(createdAt: string, extra = ''): Promise<string> {
  const code = `F-${randomBytes(2).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
  const r = await h.pool.query<{ id: string }>(
    `INSERT INTO account (age, created_at, code${extra ? ', closed_at' : ''}) VALUES ('14+', $1, $2${extra ? ', now()' : ''}) RETURNING id`,
    [createdAt, code],
  );
  return String(r.rows[0]?.id);
}
async function addCoin(account: string, at: string) {
  await h.pool.query(
    `INSERT INTO coin_entry (entry_id, account_id, reason, asked, amount, status, day, created_at)
     VALUES ($1, $2, 'todo', 1, 1, 'ok', current_date, $3)`,
    [randomUUID(), account, at],
  );
}
async function addAsk(account: string | null, at: string, cost: number) {
  await h.pool.query(
    `INSERT INTO ai_usage (account_id, day, model, status, cost_micros, created_at)
     VALUES ($1, current_date, 'm', 'ok', $2, $3)`,
    [account, cost, at],
  );
}
async function addBackup(account: string, size: number, at: string) {
  await h.pool.query(
    'INSERT INTO backup (account_id, file, size, sha256, created_at) VALUES ($1, $2, $3, $4, $5)',
    [
      account,
      randomBytes(16).toString('hex'),
      size,
      createHash('sha256').update(randomBytes(8)).digest(),
      at,
    ],
  );
}

before(async () => {
  h = await startHarness({
    adminToken: ADMIN_TOKEN,
    adminSubs: [ADMIN_SUB],
    backup: { key: randomBytes(32), dir: BACKUP_DIR, totalMaxBytes: 1000 },
  });
  admin = new AdminBrowser(
    () => h,
    api,
    () => ADMIN_TOKEN,
  );
  assert.equal((await admin.login()).status, 303);
  await admin.page();
  const op = await newDevice('18+', '운영고양이');
  opId = op.id;
  appToken = await session(op.id, ADMIN_SUB);
});

after(async () => {
  await h?.stop();
  rmSync(BACKUP_DIR, { recursive: true, force: true });
});

describe('일별 추이', () => {
  const a: string[] = [];
  before(async () => {
    // 3일 전: 가입 2 (하나는 합쳐져 닫힌 계정이라 빠짐), 이틀 전: 가입 1
    a.push(await addAccount(noon(3)));
    a.push(await addAccount(noon(3)));
    await addAccount(noon(3), 'closed');
    a.push(await addAccount(noon(2)));
    // 한국 날짜 경계: 한국 시간 1일 전 00:30 (UTC 로는 그 전날 15:30) 은 1일 전으로 센다
    const edge = new Date(`${kstDay(1)}T00:30:00+09:00`).toISOString();
    a.push(await addAccount(edge));
    // 15일 전은 창 밖
    await addAccount(noon(15));
    // 활동: a0 은 3일 전에 코인 두 번 + 질문 한 번이라 한 명, a1 은 질문만, 이틀 전 a2 코인
    await addCoin(a[0] as string, noon(3));
    await addCoin(a[0] as string, noon(3));
    await addAsk(a[0] as string, noon(3), 1_500_000);
    await addAsk(a[1] as string, noon(3), 500_000);
    await addAsk(null, noon(3), 250_000);
    await addCoin(a[2] as string, noon(2));
    // 창 밖 기록은 세지 않는다
    await addCoin(a[0] as string, noon(20));
    await addAsk(a[0] as string, noon(20), 9_000_000);
  });

  test('열네 날이 오래된 날부터 오늘까지 한국 날짜로 오고, 빈 날은 0', async () => {
    const b = await overview();
    assert.equal(b.trend.zone, 'Asia/Seoul');
    assert.equal(b.trend.days.length, 14);
    assert.equal(b.trend.days[13].day, kstDay(0));
    assert.equal(b.trend.days[0].day, kstDay(13));
    const empty = dayOf(b, 6);
    assert.deepEqual([empty.signups, empty.active, empty.asks, empty.costMicros], [0, 0, 0, 0]);
  });

  test('가입은 합쳐져 닫힌 계정과 창 밖을 빼고, 한국 날짜 경계를 따른다', async () => {
    const b = await overview();
    assert.equal(dayOf(b, 3).signups, 2);
    assert.equal(dayOf(b, 2).signups, 1);
    assert.equal(dayOf(b, 1).signups, 1, '한국 00:30 가입은 그 한국 날짜');
    const total = b.trend.days.reduce((s: number, d: { signups: number }) => s + d.signups, 0);
    // 운영자 계정(오늘 가입) 하나가 더 있다
    assert.equal(total, 2 + 1 + 1 + (dayOf(b, 0).signups as number));
  });

  test('활동은 코인 기록이나 질문을 보낸 계정을 하루에 한 번만 센다', async () => {
    const b = await overview();
    assert.equal(
      dayOf(b, 3).active,
      2,
      'a0 은 코인 두 번 + 질문이어도 한 명, a1 은 질문만, 계정 없는 질문은 제외',
    );
    assert.equal(dayOf(b, 2).active, 1);
    assert.equal(dayOf(b, 4).active, 0);
  });

  test('질문과 비용은 그날 합 (계정 없는 질문 포함), 창 밖은 빠진다', async () => {
    const b = await overview();
    const d = dayOf(b, 3);
    assert.equal(d.asks, 3);
    assert.equal(d.costMicros, 2_250_000);
    const asks = b.trend.days.reduce((s: number, x: { asks: number }) => s + x.asks, 0);
    assert.equal(asks, 3);
  });

  test('옛 앱이 읽는 칸은 그대로다 (필드는 더하기만)', async () => {
    const b = await overview();
    for (const k of [
      'summary',
      'ai',
      'todo',
      'reports',
      'recent',
      'versions',
      'latest',
      'features',
      'events',
    ])
      assert.ok(k in b, `${k} 가 있어야 한다`);
    for (const k of ['accounts', 'coins', 'tickets', 'aiCostMicros']) assert.ok(k in b.summary);
    assert.equal(typeof b.ai.monthlyBudgetMicros, 'number');
    for (const k of ['active', 'unknown', 'rows']) assert.ok(k in b.versions);
    assert.ok(Array.isArray(b.todo));
  });
});

describe('서버 백업 현황', () => {
  test('백업이 없으면 0과 없음, 상한은 설정값, 확인할 것에 백업 줄이 없다', async () => {
    const b = await overview();
    assert.deepEqual(
      { ...b.backup },
      {
        enabled: true,
        files: 0,
        accounts: 0,
        bytes: 0,
        maxBytes: 1000,
        lastUploadAt: null,
        external: { db: UNKNOWN, files: UNKNOWN },
      },
    );
    assert.equal(
      b.todo.some((t: { kind: string }) => t.kind === 'backup'),
      false,
    );
  });

  test('올린 파일 수, 계정 수, 크기, 가장 최근 때를 센다', async () => {
    const x = await addAccount(noon(5));
    const y = await addAccount(noon(5));
    await addBackup(x, 300, noon(4));
    await addBackup(x, 200, noon(1));
    await addBackup(y, 100, noon(2));
    const b = await overview();
    assert.equal(b.backup.files, 3);
    assert.equal(b.backup.accounts, 2);
    assert.equal(b.backup.bytes, 600);
    assert.equal(b.backup.lastUploadAt, new Date(noon(1)).getTime());
    assert.equal(
      b.todo.some((t: { kind: string }) => t.kind === 'backup'),
      false,
      '60% 는 확인할 것이 아니다',
    );
  });

  test('상한의 80% 부터 경고, 95% 부터 나쁨으로 확인할 것에 올리고 설정/백업으로 보낸다', async () => {
    const z = await addAccount(noon(5));
    await addBackup(z, 200, noon(0)); // 800 / 1000
    let b = await overview();
    let t = b.todo.find((x: { kind: string }) => x.kind === 'backup');
    assert.deepEqual(t, { kind: 'backup', level: 'warn', n: 80, place: 'settings/backup' });
    await addBackup(z, 160, noon(0)); // 960 / 1000
    b = await overview();
    t = b.todo.find((x: { kind: string }) => x.kind === 'backup');
    assert.deepEqual(t, { kind: 'backup', level: 'bad', n: 96, place: 'settings/backup' });
    await h.pool.query('DELETE FROM backup WHERE size = 160 OR size = 200 AND account_id = $1', [z]);
  });
});

describe('잠기는 인원', () => {
  before(async () => {
    // 앞 시험이 만든 계정은 30일 활동 밖으로 밀고, 운영자 계정은 기준 위의 판으로 둔다
    await h.pool.query(`UPDATE account SET last_active_at = now() - interval '90 days'`);
    await h.pool.query(`UPDATE account SET app_version = '0.6.0', last_active_at = now() WHERE id = $1`, [
      opId,
    ]);
    const ver = async (v: string | null, n: number) => {
      for (let i = 0; i < n; i++) {
        const id = await addAccount(noon(5));
        await h.pool.query('UPDATE account SET app_version = $1, last_active_at = now() WHERE id = $2', [
          v,
          id,
        ]);
      }
    };
    await ver('0.4.0', 3);
    await ver('0.5.0', 2);
    await ver('0.5.5', 4);
    await ver(null, 1);
  });

  test('기준이 없으면 아무도 잠기지 않고 기준 값도 null', async () => {
    const b = await overview();
    assert.deepEqual(b.versions.locked, { min: null, restrict: null, locked: 0, restricted: 0, unknown: 0 });
  });

  test('최소 0.5.0, 기능 제한 0.5.5: 0.4.0 셋과 판 모름 하나가 잠기고 0.5.0 둘은 기능 제한만', async () => {
    await h.pool.query(
      `INSERT INTO site_doc (name, body) VALUES ('notices', $1::jsonb)
       ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`,
      [JSON.stringify({ minVersion: '0.5.0', restrictVersion: '0.5.5' })],
    );
    const b = await overview();
    assert.deepEqual(b.versions.locked, {
      min: '0.5.0',
      restrict: '0.5.5',
      locked: 4,
      restricted: 2,
      unknown: 1,
    });
  });

  test('웹 홈 표에 잠기는 계정 수가 보인다', async () => {
    const html = (await admin.page()).text;
    assert.match(homeCell(html), /앱이 잠기는 계정 <strong>4명<\/strong>/);
    assert.match(homeCell(html), /서버 기능이 거절되는 계정 <strong>2명<\/strong>/);
  });
});

describe('웹 화면', () => {
  test('홈에 막대 그림 넷과 숫자 표, 백업 줄, 설정의 백업 현황 링크가 있다', async () => {
    const html = (await admin.page()).text;
    const home = homeCell(html);
    assert.equal((home.match(/<svg class="trend-svg"/g) ?? []).length, 4);
    assert.match(home, /오늘과 최근 14일/);
    assert.match(home, /<details><summary>숫자로 보기<\/summary>/);
    assert.equal((home.match(/<tr><td>20\d\d-\d\d-\d\d<\/td>/g) ?? []).length, 14);
    assert.match(home, /href="#settings\/backup"/);
    assert.match(home, /한국 시간 기준/);
  });

  test('설정의 예산, 정책, 백업 칸에 서버가 아는 값과 모르는 값이 따로 나온다', async () => {
    const html = (await admin.page()).text;
    const s = settingsCell(html);
    assert.match(s, /data-sub="settings\/ai"/);
    assert.doesNotMatch(s, /data-sub="settings\/backup"/);
    assert.match(s, /<h2>백업 현황<\/h2>/);
    assert.match(s, /이용자 서버 백업/);
    assert.match(s, /올리기 실패<\/dt><dd>기록 없음/);
    assert.match(s, /상태<\/dt><dd>알 수 없어요 \(상태 파일이 없어요\)/);
    assert.match(s, /맥미니 외장 디스크/);
  });

  test('그림은 인라인 스크립트도 style 속성도 쓰지 않는다 (CSP)', async () => {
    const r = await admin.page();
    assert.doesNotMatch(r.text, /\sstyle=/);
    assert.doesNotMatch(r.text, /\son[a-z]+=/);
    assert.equal((r.text.match(/<script/g) ?? []).length, 1, '바깥 admin.js 하나뿐');
    assert.match(r.headers.get('content-security-policy') ?? '', /style-src 'self'/);
    assert.doesNotMatch(r.headers.get('content-security-policy') ?? '', /unsafe-inline/);
  });

  test('로그인 없이는 추이도 백업도 볼 수 없다', async () => {
    const r = await api('GET', '/v1/admin/overview');
    assert.equal(r.status, 401);
    const w = await api('GET', '/admin');
    assert.doesNotMatch(w.text, /trend-svg/);
  });
});
