import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canNudge,
  EMPTY_JOURNEY,
  JOURNEY_STEPS,
  journeyActive,
  journeyDay,
  journeyView,
  markNudged,
  parseJourney,
  shouldStartLate,
  startJourney,
  todayStep,
  tryStep,
} from './journey.ts';

const started = startJourney(EMPTY_JOURNEY, '2026-10-11');

test('시작 전에는 아무것도 권하지 않고, 시작하면 첫날은 빠른 입력', () => {
  assert.equal(journeyDay(EMPTY_JOURNEY, '2026-10-11'), -1);
  assert.equal(todayStep(EMPTY_JOURNEY, '2026-10-11'), undefined);
  assert.equal(journeyView(EMPTY_JOURNEY, '2026-10-11'), undefined);
  assert.equal(todayStep(started, '2026-10-11'), 'quick');
  // 이미 시작했으면 날짜를 바꾸지 않는다
  assert.equal(startJourney(started, '2026-10-20').start, '2026-10-11');
});

test('하루에 하나씩 열리고, 안 한 앞날 것을 먼저 권한다', () => {
  assert.equal(todayStep(started, '2026-10-13'), 'quick');
  const s = { ...started, tried: ['quick' as const] };
  assert.equal(todayStep(s, '2026-10-13'), 'focus');
  assert.equal(todayStep({ ...s, tried: ['quick', 'focus', 'note'] }, '2026-10-13'), undefined);
  // 이레가 지나면 끝
  assert.equal(journeyActive(s, '2026-10-17'), true);
  assert.equal(journeyActive(s, '2026-10-18'), false);
  assert.equal(todayStep(s, '2026-10-18'), undefined);
});

test('해 보면 처음 한 번만 코인, 여정 밖이면 아무것도 안 바뀐다', () => {
  const a = tryStep(started, 'note', '2026-10-11');
  assert.equal(a.reward, true);
  assert.deepEqual(a.state.tried, ['note']);
  assert.equal(tryStep(a.state, 'note', '2026-10-11').reward, false);
  assert.equal(tryStep(EMPTY_JOURNEY, 'note', '2026-10-11').reward, false);
  assert.equal(tryStep({ ...started, skipped: true }, 'note', '2026-10-11').reward, false);
  assert.equal(tryStep(started, 'note', '2026-10-30').reward, false);
});

test('일곱 가지를 다 하면 끝냈다고 하고 그날은 축하 칸이 남는다', () => {
  let s = started;
  let last = false;
  for (const step of JOURNEY_STEPS) {
    const r = tryStep(s, step, '2026-10-14');
    s = r.state;
    last = r.finished;
  }
  assert.equal(last, true);
  assert.equal(s.finished, '2026-10-14');
  assert.equal(journeyActive(s, '2026-10-14'), false);
  const v = journeyView(s, '2026-10-14');
  assert.equal(v?.finishedToday, true);
  assert.equal(v?.coins, 21);
  assert.equal(journeyView(s, '2026-10-15'), undefined);
});

test('펫이 권하는 말은 하루 한 번, 그만 보면 안 권한다', () => {
  assert.equal(canNudge(started, '2026-10-11'), true);
  const n = markNudged(started, '2026-10-11');
  assert.equal(canNudge(n, '2026-10-11'), false);
  assert.equal(canNudge(n, '2026-10-12'), true);
  assert.equal(canNudge({ ...started, skipped: true }, '2026-10-12'), false);
  assert.equal(journeyView({ ...started, skipped: true }, '2026-10-12'), undefined);
});

test('칸: 몇째 날, 열린 칸, 오늘 것', () => {
  const v = journeyView({ ...started, tried: ['quick'] }, '2026-10-12');
  assert.equal(v?.day, 2);
  assert.deepEqual(
    v?.steps.map((x) => [x.id, x.tried, x.open]),
    [
      ['quick', true, true],
      ['focus', false, true],
      ['note', false, false],
      ['event', false, false],
      ['maker', false, false],
      ['look', false, false],
      ['week', false, false],
    ],
  );
  assert.equal(v?.today, 'focus');
  assert.equal(v?.coins, 3);
});

test('저장 파일 읽기: 모르는 단계와 틀린 날짜는 버리고 순서는 여정 순', () => {
  assert.deepEqual(
    parseJourney({
      start: '2026-10-11',
      tried: ['week', 'nope', 'quick', 'quick'],
      skipped: 'yes',
      nudged: 'x',
    }),
    { start: '2026-10-11', tried: ['quick', 'week'], skipped: false },
  );
  assert.deepEqual(parseJourney(null), { tried: [], skipped: false });
});

test('오래 쓴 사람은 여정을 시작하지 않는다 (처음 켠 날이 이틀 안이면 시작)', () => {
  assert.equal(shouldStartLate(null, '2026-10-11'), true);
  assert.equal(shouldStartLate('2026-10-09', '2026-10-11'), true);
  assert.equal(shouldStartLate('2026-10-08', '2026-10-11'), false);
});
