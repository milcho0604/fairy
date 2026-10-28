// 통합 시험 (이슈 #156): 기능 스위치 한 표(채팅 이용권 포함), 바꾸기와 확인, 운영 기록, 이전 값과 되돌리기,
// 그 사이 다른 곳에서 바뀐 것은 거절, 예산, 정책, 백업이 한 칸. 진짜 외부 서비스는 부르지 않는다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { AdminBrowser, client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = `admin-${randomUUID()}-${randomUUID()}`;
let h: Harness;
const { api } = client(() => h);
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

/** 스위치 표의 한 줄 */
const rowOf = (html: string, key: string): string => {
  const t = html.slice(html.indexOf('<table class="switches cards">'));
  const m = new RegExp(`<tr class="sw" data-key="${key}">([\\s\\S]*?)</tr>`).exec(t);
  assert.ok(m, `${key} 줄이 없어요`);
  return m[1] as string;
};

const lastLog = async (action: string) =>
  (
    await h.pool.query<{ detail: unknown }>(
      'SELECT detail FROM admin_log WHERE action = $1 ORDER BY id DESC LIMIT 1',
      [action],
    )
  ).rows[0]?.detail;

const KEYS = [
  'ai_chat',
  'kakao_login',
  'coin_reset',
  'calendar_link_hint',
  'friends',
  'friend_gifts',
  'friend_calendar',
  'friend_gift_passes',
];

describe('기능 스위치 한 표', () => {
  test('채팅 이용권을 포함한 모든 스위치가 한 표에 있고 줄마다 바로 바꾸는 폼이 있다', async () => {
    const page = (await admin.page()).text;
    assert.equal((page.match(/<table class="switches cards">/g) ?? []).length, 1);
    const head = /<table class="switches cards"><thead>(.*?)<\/thead>/s.exec(page)?.[1] ?? '';
    for (const th of ['기능', '설명', '상태', '영향', '바꾸기'])
      assert.match(head, new RegExp(`<th>${th}</th>`));
    for (const key of KEYS) {
      const row = rowOf(page, key);
      assert.match(row, new RegExp(`<code>${key}</code>`));
      assert.match(row, /data-l="설명"/);
      assert.match(row, /data-l="영향"/);
      assert.match(
        row,
        key === 'ai_chat' ? /action="\/admin\/ai\/mode"/ : /action="\/admin\/features\/mode"/,
      );
      assert.match(row, /name="confirm" value="yes" required/);
      assert.match(row, /name="from"/);
    }
    // 채팅 이용권 접근 폼은 예산 칸에서 빠졌다
    const budget = page.slice(page.indexOf('id="sub-settings-ai"'), page.indexOf('id="sub-settings-log"'));
    assert.doesNotMatch(budget, /action="\/admin\/ai\/mode"/);
    assert.match(budget, /action="\/admin\/ai\/limits"/);
    assert.match(budget, /action="\/admin\/ai\/policy"/);
  });

  test('예산, 정책, 백업 현황이 같은 칸이고 백업 하위 칸은 따로 없다', async () => {
    const page = (await admin.page()).text;
    const cfg = page.slice(page.indexOf('id="sub-settings-ai"'), page.indexOf('id="sub-settings-log"'));
    assert.match(cfg, /<h2>예산과 정책<\/h2>/);
    assert.match(cfg, /<h2>백업 현황<\/h2>/);
    assert.doesNotMatch(page, /id="sub-settings-backup"/);
    const nav = /<nav class="subnav" aria-label="설정 안">(.*?)<\/nav>/s.exec(page)?.[1] ?? '';
    assert.equal((nav.match(/<a /g) ?? []).length, 3);
    // 옛 #settings/backup 주소는 이 칸으로 오는 길이 admin.js 에 있다
    assert.match((await api('GET', '/admin/admin.js')).text, /s === 'backup'\) s = 'ai'/);
  });

  test('확인 칸이 없으면 거절하고 모드는 그대로다', async () => {
    const r = await admin.act('/admin/features/mode', { key: 'coin_reset', mode: 'everyone', from: 'off' });
    assert.equal(r.ok, false);
    assert.match(r.text, /확인 칸/);
    assert.match(rowOf((await admin.page()).text, 'coin_reset'), /서버 설정 기본값/);
  });

  test('바꾸면 운영 기록에 남고, 줄에 이전 값과 되돌리기가 생긴다', async () => {
    let page = (await admin.page()).text;
    assert.doesNotMatch(rowOf(page, 'coin_reset'), /되돌리기/);
    const done = await admin.act('/admin/features/mode', {
      key: 'coin_reset',
      mode: 'everyone',
      from: 'off',
      confirm: 'yes',
    });
    assert.ok(done.ok, done.text);
    page = (await admin.page()).text;
    const row = rowOf(page, 'coin_reset');
    assert.match(row, /이전 값: 끔/);
    assert.match(row, /웹 운영자/);
    assert.match(row, /name="revert" value="1"/);
    assert.match(row, /name="mode" value="off"/);
    assert.match(row, /모두 써요/);
    assert.deepEqual(await lastLog('feature.mode'), { key: 'coin_reset', before: 'off', after: 'everyone' });
  });

  test('되돌리기는 이전 값으로 돌리고 운영 기록에 되돌림 표시를 남긴다', async () => {
    const back = await admin.act('/admin/features/mode', {
      key: 'coin_reset',
      mode: 'off',
      from: 'everyone',
      revert: '1',
      confirm: 'yes',
    });
    assert.ok(back.ok, back.text);
    assert.deepEqual(await lastLog('feature.mode'), {
      key: 'coin_reset',
      before: 'everyone',
      after: 'off',
      revert: true,
    });
    const page = (await admin.page()).text;
    assert.match(rowOf(page, 'coin_reset'), /이전 값: 모두/);
    assert.match(page.slice(page.indexOf('id="sub-settings-log"')), /\(되돌림\)/);
  });

  test('그 사이 다른 곳에서 바뀌었으면(from 이 다르면) 거절하고 덮어쓰지 않는다', async () => {
    const r = await admin.act('/admin/features/mode', {
      key: 'coin_reset',
      mode: 'everyone',
      from: 'allowlist',
      confirm: 'yes',
    });
    assert.equal(r.ok, false);
    assert.match(r.text, /다른 곳에서 먼저 바꿨어요 \(지금 off\)/);
    const row = await h.pool.query<{ mode: string }>(
      "SELECT mode FROM feature_flag WHERE key = 'coin_reset'",
    );
    assert.equal(row.rows[0]?.mode, 'off');
  });

  test('채팅 이용권도 같은 표에서 바꾸고 되돌린다 (이전 값, 운영 기록, 거절)', async () => {
    const first = rowOf((await admin.page()).text, 'ai_chat');
    const mode = /name="from" value="([a-z]+)"/.exec(first)?.[1] ?? '';
    assert.ok(['off', 'allowlist', 'everyone'].includes(mode), mode);
    const to = mode === 'everyone' ? 'off' : 'everyone';
    const done = await admin.act('/admin/ai/mode', { key: 'ai_chat', mode: to, from: mode, confirm: 'yes' });
    assert.ok(done.ok, done.text);
    const row = rowOf((await admin.page()).text, 'ai_chat');
    assert.match(row, /이전 값:/);
    assert.match(row, /name="revert" value="1"/);
    const stale = await admin.act('/admin/ai/mode', { key: 'ai_chat', mode, from: mode, confirm: 'yes' });
    assert.equal(stale.ok, false);
    assert.match(stale.text, /다른 곳에서 먼저 바꿨어요/);
    const back = await admin.act('/admin/ai/mode', {
      key: 'ai_chat',
      mode,
      from: to,
      revert: '1',
      confirm: 'yes',
    });
    assert.ok(back.ok, back.text);
    assert.deepEqual(await lastLog('ai.mode'), { before: to, after: mode, revert: true });
  });

  test('from 이 없는 요청(앱 API, 옛 폼)은 예전처럼 받는다', async () => {
    const r = await admin.act('/admin/features/mode', { key: 'friends', mode: 'everyone', confirm: 'yes' });
    assert.ok(r.ok, r.text);
  });

  test('되돌리기(revert=1)는 from 이 없으면 거절한다', async () => {
    const r = await admin.act('/admin/features/mode', {
      key: 'friend_gift_passes',
      mode: 'off',
      revert: '1',
      confirm: 'yes',
    });
    assert.equal(r.ok, false);
    assert.match(r.text, /from/);
    assert.equal(
      (await h.pool.query("SELECT 1 FROM feature_flag WHERE key = 'friend_gift_passes'")).rowCount,
      0,
    );
  });

  test('같은 from 으로 동시에 바꾸면 하나만 성공한다 (채팅 이용권)', async () => {
    const cur =
      (await h.pool.query<{ mode: string }>("SELECT mode FROM feature_flag WHERE key = 'ai_chat'")).rows[0]
        ?.mode ?? 'off';
    const targets = ['off', 'allowlist', 'everyone'].filter((m) => m !== cur);
    const before = (await h.pool.query("SELECT 1 FROM admin_log WHERE action = 'ai.mode'")).rowCount ?? 0;
    const rs = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        admin.act('/admin/ai/mode', {
          key: 'ai_chat',
          mode: targets[i % 2] ?? 'off',
          from: cur,
          confirm: 'yes',
        }),
      ),
    );
    assert.equal(rs.filter((r) => r.ok).length, 1);
    assert.equal(
      ((await h.pool.query("SELECT 1 FROM admin_log WHERE action = 'ai.mode'")).rowCount ?? 0) - before,
      1,
    );
  });

  test('같은 from 으로 동시에 바꾸면 하나만 성공한다 (줄이 없는 서버 설정 기본값, 줄이 있는 경우)', async () => {
    const key = 'friend_calendar';
    assert.equal((await h.pool.query('SELECT 1 FROM feature_flag WHERE key = $1', [key])).rowCount, 0);
    const run = (from: string, modes: string[]) =>
      Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          admin.act('/admin/features/mode', { key, mode: modes[i % 2] ?? 'off', from, confirm: 'yes' }),
        ),
      );
    const first = await run('allowlist', ['off', 'everyone']);
    assert.equal(first.filter((r) => r.ok).length, 1);
    const cur = (await h.pool.query<{ mode: string }>('SELECT mode FROM feature_flag WHERE key = $1', [key]))
      .rows[0]?.mode as string;
    const second = await run(cur, ['allowlist', cur === 'off' ? 'everyone' : 'off']);
    assert.equal(second.filter((r) => r.ok).length, 1);
  });

  test('줄이 없는 스위치는 거절되거나 읽기만 해서는 줄이 생기지 않는다 (서버 설정 기본값 표시 유지)', async () => {
    await admin.act('/admin/features/mode', {
      key: 'friend_gift_passes',
      mode: 'off',
      from: 'everyone',
      confirm: 'yes',
    });
    assert.equal(
      (await h.pool.query("SELECT 1 FROM feature_flag WHERE key = 'friend_gift_passes'")).rowCount,
      0,
    );
    assert.match(rowOf((await admin.page()).text, 'friend_gift_passes'), /서버 설정 기본값/);
  });

  test('휴대폰 폭에서 표가 카드로 접히는 규칙이 있다', async () => {
    const css = (await api('GET', '/admin/admin.css')).text;
    assert.match(css, /table\.cards thead \{ display: none; \}/);
    assert.match(css, /table\.switches tr \{ border:/);
    assert.match(css, /\.table-scroll table\.cards \{ min-width: 0; \}/);
  });
});
