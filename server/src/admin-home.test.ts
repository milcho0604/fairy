import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupPercent, barChart, fillDays, lockedStats, TREND_DAYS } from './admin-home';
import { esc, todoOf, todoText } from './admin-page';

test('fillDays: 오늘까지 14일을 오래된 날부터 채우고 빈 날은 0, 창 밖 날짜는 버린다 (#152)', () => {
  const d = fillDays('2026-10-23', [
    { day: '2026-10-23', signups: 2 },
    { day: '2026-10-23', active: 5, asks: 7, costMicros: 900 },
    { day: '2026-10-10', signups: 1 },
    { day: '2026-10-09', signups: 99 },
    { day: '2026-11-01', signups: 99 },
  ]);
  assert.equal(d.length, TREND_DAYS);
  assert.equal(d[0]?.day, '2026-10-10');
  assert.equal(d[13]?.day, '2026-10-23');
  assert.deepEqual(d[13], { day: '2026-10-23', signups: 2, active: 5, asks: 7, costMicros: 900 });
  assert.equal(d[0]?.signups, 1);
  assert.equal(
    d.reduce((s, x) => s + x.signups, 0),
    3,
  );
  // 달 경계
  assert.deepEqual(
    fillDays('2026-03-02', [], 4).map((x) => x.day),
    ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'],
  );
});

test('lockedStats: 서버 관문과 같은 규칙으로 센다. 판을 모르면 0.0.0 (#152)', () => {
  const rows = [
    { v: '0.4.9', n: 3 },
    { v: '0.5.0', n: 2 },
    { v: '0.5.4', n: 4 },
    { v: '0.6.0', n: 5 },
    { v: null, n: 1 },
    { v: '이상한 판', n: 2 },
  ];
  assert.deepEqual(lockedStats(rows, {}), {
    min: null,
    restrict: null,
    locked: 0,
    restricted: 0,
    unknown: 0,
  });
  // 강제만
  assert.deepEqual(lockedStats(rows, { min: '0.5.0' }), {
    min: '0.5.0',
    restrict: null,
    locked: 3 + 1 + 2,
    restricted: 0,
    unknown: 3,
  });
  // 강제와 기능 제한: 강제에 든 계정은 기능 제한에 또 세지 않는다
  assert.deepEqual(lockedStats(rows, { min: '0.5.0', restrict: '0.5.5' }), {
    min: '0.5.0',
    restrict: '0.5.5',
    locked: 6,
    restricted: 2 + 4,
    unknown: 3,
  });
  // 기능 제한만: 판 모름도 막힌다
  const r = lockedStats(rows, { restrict: '0.5.5' });
  assert.equal(r.locked, 0);
  assert.equal(r.restricted, 3 + 2 + 4 + 1 + 2);
  // 권장만 있으면 아무도 막히지 않는다
  assert.equal(lockedStats(rows, { recommend: '9.9.9' }).locked, 0);
});

test('backupPercent: 상한이 없거나 0 이면 null, 아니면 내림 (#152)', () => {
  assert.equal(backupPercent({ bytes: 5, maxBytes: null }), null);
  assert.equal(backupPercent({ bytes: 5, maxBytes: 0 }), null);
  assert.equal(backupPercent({ bytes: 799, maxBytes: 1000 }), 79);
  assert.equal(backupPercent({ bytes: 800, maxBytes: 1000 }), 80);
  assert.equal(backupPercent({ bytes: 1500, maxBytes: 1000 }), 150);
});

test('todoOf: 백업은 80% 부터 warn, 95% 부터 bad, 상한이 없으면 줄이 없다 (#152)', () => {
  const o = { reports: 0, costMicros: 0, budgetMicros: 1, events: [], coupons: [], now: 0 };
  const at = (bytes: number, maxBytes: number | null) =>
    todoOf({ ...o, backup: { bytes, maxBytes } }).find((x) => x.kind === 'backup');
  assert.equal(at(79, 100), undefined);
  assert.deepEqual(at(80, 100), { kind: 'backup', level: 'warn', n: 80, place: 'settings/backup' });
  assert.equal(at(94, 100)?.level, 'warn');
  assert.equal(at(95, 100)?.level, 'bad');
  assert.equal(at(50, null), undefined);
  assert.equal(
    todoOf(o).some((x) => x.kind === 'backup'),
    false,
    '백업 정보가 없으면 줄이 없다',
  );
  assert.equal(
    todoText({ kind: 'backup', level: 'warn', n: 83, place: 'settings/backup' }),
    '서버 백업이 상한의 83%를 썼어요',
  );
});

test('barChart: 막대마다 값 글, 오늘만 today, 0 은 얇은 바닥, 값이 모두 0 이어도 깨지지 않는다 (#152)', () => {
  const days = ['2026-10-21', '2026-10-22', '2026-10-23'];
  const svg = barChart('질문', days, [0, 4, 8], String, esc);
  assert.equal((svg.match(/<rect /g) ?? []).length, 3);
  assert.match(svg, /<rect class="bar zero"[^>]*height="1"[^>]*><title>10-21 0<\/title>/);
  assert.match(svg, /class="bar today"[^>]*><title>10-23 8<\/title>/);
  assert.match(svg, /aria-label="질문, 최근 3일, 가장 큰 날 8"/);
  // 가장 큰 값이 그림 높이를 채운다 (64 - 6)
  assert.match(svg, /class="bar today" x="[\d.]+" y="6" width="[\d.]+" height="58"/);
  // 모두 0
  const flat = barChart('가입', days, [0, 0, 0], String, esc);
  assert.doesNotMatch(flat, /NaN|Infinity/);
  assert.equal((flat.match(/class="bar zero"|class="bar today"/g) ?? []).length, 3);
  // 글은 가려진다
  const evil = barChart('<b>"x"', ['2026-10-23'], [1], (n) => `<i>${n}</i>`, esc);
  assert.doesNotMatch(evil, /<b>|<i>/);
  assert.doesNotMatch(evil, /\sstyle=|\sonload=/);
});

test('todoOf: 백업 상한 0 은 나쁨 카드 (n -1), 비율 줄은 없다 (#152)', () => {
  const o = { reports: 0, costMicros: 0, budgetMicros: 1, events: [], coupons: [], now: 0 };
  const t = todoOf({ ...o, backup: { bytes: 0, maxBytes: 0 } }).filter((x) => x.kind === 'backup');
  assert.deepEqual(t, [{ kind: 'backup', level: 'bad', n: -1, place: 'settings/backup' }]);
  assert.match(todoText(t[0] as never), /상한이 0/);
});
