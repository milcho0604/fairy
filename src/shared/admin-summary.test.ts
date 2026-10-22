import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionName, adminSummaryOf, todoLabel, whoName } from './admin-summary.ts';
import { setLang } from './i18n/index.ts';

const base = {
  summary: { accounts: 12, coins: '340', tickets: 5, aiCostMicros: 1_500_000 },
  ai: { monthlyBudgetMicros: 10_000_000 },
};

test('요약은 서버 자료의 숫자만 읽고, 새 칸이 없는 낡은 서버도 받는다', () => {
  const s = adminSummaryOf(base);
  assert.deepEqual(s, {
    accounts: 12,
    coins: 340,
    passes: 5,
    costMicros: 1_500_000,
    budgetMicros: 10_000_000,
    reports: 0,
    todo: [],
    recent: [],
    today: null,
    backup: null,
    locked: null,
  });
});

test('모양이 틀리면 요약이 아니라 실패로 본다', () => {
  assert.equal(adminSummaryOf(undefined), undefined);
  assert.equal(adminSummaryOf('x'), undefined);
  assert.equal(adminSummaryOf({}), undefined);
  assert.equal(adminSummaryOf({ ...base, summary: { ...base.summary, accounts: 'abc' } }), undefined);
  assert.equal(adminSummaryOf({ ...base, summary: { ...base.summary, coins: null } }), undefined);
  assert.equal(adminSummaryOf({ ...base, ai: {} }), undefined);
});

test('확인할 것과 최근 기록은 모양이 맞는 줄만, 최대 5줄', () => {
  const s = adminSummaryOf({
    ...base,
    reports: { total: 4 },
    todo: [
      { kind: 'reports', level: 'warn', n: 4, place: 'reports' },
      { kind: 'budget', level: 'bad', n: -1, place: 'settings/ai' },
      { kind: 'ending_events', level: 'warn', n: 2, place: '../x' },
      { kind: 'unknown', level: 'warn', n: 1, place: 'home' },
      { kind: 'reports', level: 'warn', n: 'many', place: 'home' },
    ],
    recent: Array.from({ length: 9 }, (_, i) => ({
      at: String(1_700_000_000_000 + i),
      actor: 'admin:abc',
      actorName: null,
      action: 'event.end',
      target: 'x',
      targetName: null,
    })).concat([{ at: 'bad' } as never]),
  });
  assert.equal(s?.reports, 4);
  assert.deepEqual(
    s?.todo.map((x) => [x.kind, x.n, x.place, x.level]),
    [
      ['reports', 4, 'reports', 'warn'],
      ['budget', -1, 'settings/ai', 'bad'],
      ['ending_events', 2, 'home', 'warn'],
    ],
  );
  assert.equal(s?.recent.length, 5);
  assert.equal(s?.recent[0]?.at, 1_700_000_000_000);
});

test('신고 건수는 reports 칸이 없으면 확인할 것의 신고 줄에서 읽는다', () => {
  const s = adminSummaryOf({ ...base, todo: [{ kind: 'reports', level: 'warn', n: 3, place: 'reports' }] });
  assert.equal(s?.reports, 3);
});

test('확인할 것과 운영 기록 글은 ko, en 둘 다 나온다', () => {
  const item = { kind: 'budget', level: 'warn', n: 63, place: 'settings/ai' } as const;
  setLang('ko');
  assert.equal(todoLabel(item), '이번 달 비용이 예산의 63%');
  assert.equal(todoLabel({ ...item, n: -1 }), '월 예산이 0이라 채팅 이용권 질문이 모두 막혀');
  assert.equal(whoName({ actor: 'admin:abc' }), '웹 운영자');
  assert.equal(actionName('event.end'), '이벤트 끝내기');
  assert.equal(actionName('something.new'), 'something.new');
  setLang('en');
  assert.equal(todoLabel(item), "This month's cost is 63% of the budget");
  assert.equal(
    todoLabel({ kind: 'ending_coupons', level: 'warn', n: 2, place: 'announce/coupons' }),
    'Coupons ending within 3 days: 2',
  );
  assert.equal(whoName({ actor: 'admin:abc' }), 'Web operator');
  assert.equal(whoName({ actor: 'account:7', actorName: '고양이 #7' }), '고양이 #7');
  setLang('ko');
});

test('신고 대기는 pending 을 먼저, 없으면 옛 서버의 total 로 읽는다 (#151)', () => {
  assert.equal(adminSummaryOf({ ...base, reports: { total: 9, pending: 2, seen: 3, done: 4 } })?.reports, 2);
  assert.equal(adminSummaryOf({ ...base, reports: { total: 9, pending: 0 } })?.reports, 0);
  assert.equal(adminSummaryOf({ ...base, reports: { total: 9 } })?.reports, 9);
  assert.equal(adminSummaryOf({ ...base, reports: { total: 'x', pending: 'y' } })?.reports, 0);
});

test('오늘 숫자, 백업 줄, 잠기는 인원을 읽고 낡은 서버는 null (#152)', () => {
  const day = (n: number) => ({
    day: `2026-10-${n}`,
    signups: n,
    active: n + 1,
    asks: n + 2,
    costMicros: n * 1000,
  });
  const s = adminSummaryOf({
    ...base,
    trend: { days: [day(21), day(22), day(23)] },
    backup: { enabled: true, files: 4, lastUploadAt: 1_700_000_000_000, bytes: 5 },
    versions: { locked: { min: '0.5.0', restrict: null, locked: 3, restricted: 1, unknown: 2 } },
  });
  assert.deepEqual(s?.today, { signups: 23, active: 24, asks: 25, costMicros: 23000 });
  assert.deepEqual(s?.backup, { enabled: true, lastUploadAt: 1_700_000_000_000, files: 4 });
  assert.deepEqual(s?.locked, { force: 3, restricted: 1 });
  // 기준이 없으면 잠기는 줄 자체를 보이지 않는다
  const none = adminSummaryOf({
    ...base,
    versions: { locked: { min: null, restrict: null, locked: 0, restricted: 0, unknown: 0 } },
  });
  assert.equal(none?.locked, null);
  // 모양이 틀린 칸은 null
  const bad = adminSummaryOf({ ...base, trend: { days: [{ day: 'x' }] }, backup: { enabled: 'yes' } });
  assert.equal(bad?.today, null);
  assert.equal(bad?.backup, null);
  assert.equal(
    adminSummaryOf({ ...base, backup: { enabled: false, files: 0, lastUploadAt: null } })?.backup
      ?.lastUploadAt,
    null,
  );
});

test('백업 확인할 것 글은 ko, en 둘 다 (#152)', () => {
  const item = { kind: 'backup', level: 'warn', n: 83, place: 'settings/backup' } as const;
  setLang('ko');
  assert.equal(todoLabel(item), '서버 백업이 상한의 83%');
  setLang('en');
  assert.equal(todoLabel(item), 'Server backups use 83% of the limit');
  setLang('ko');
  assert.equal(adminSummaryOf({ ...base, todo: [item] })?.todo[0]?.place, 'settings/backup');
});
