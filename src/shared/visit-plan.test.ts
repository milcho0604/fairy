import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decide,
  deferReason,
  emptyState,
  interruptReason,
  parseState,
  pickVisitor,
  recordVisit,
  setPaused,
  VISIT,
  type VisitFacts,
} from './visit-plan.ts';

const TODAY = '2026-10-28';
const NOW = Date.UTC(2026, 9, 28, 3);
const ok: VisitFacts = {
  today: TODAY,
  now: NOW,
  serverOk: true,
  hidden: false,
  focus: false,
  playing: false,
  seeking: false,
  awaySec: 5,
  saver: false,
  eventSoon: false,
  mainIdle: true,
  present: false,
};
const A = { code: 'F-AAAA-AAAA' };
const B = { code: 'F-BBBB-BBBB' };
const first = () => 0;

test('상수: 하루 6번, 쿨다운 20분, 같은 친구 3시간, 한 번 3분', () => {
  assert.equal(VISIT.dayMax, 6);
  assert.equal(VISIT.cooldownMs, 20 * 60_000);
  assert.equal(VISIT.perFriendMs, 3 * 3600_000);
  assert.equal(VISIT.lengthMs, 3 * 60_000);
});

test('미룸 판정 표: 하나씩 걸면 그 까닭이 나온다', () => {
  const s = emptyState(TODAY);
  assert.equal(deferReason(s, ok), null);
  const rows: [Partial<VisitFacts>, string][] = [
    [{ present: true }, 'present'],
    [{ serverOk: false }, 'server'],
    [{ hidden: true }, 'hidden'],
    [{ focus: true }, 'focus'],
    [{ playing: true }, 'play'],
    [{ seeking: true }, 'seek'],
    [{ awaySec: VISIT.awaySec }, 'away'],
    [{ saver: true }, 'saver'],
    [{ eventSoon: true }, 'calendar'],
    [{ mainIdle: false }, 'busy'],
  ];
  for (const [patch, why] of rows) assert.equal(deferReason(s, { ...ok, ...patch }), why, why);
  assert.equal(deferReason(s, { ...ok, awaySec: VISIT.awaySec - 1 }), null);
});

test('미룸 판정: 오늘은 그만, 하루 상한, 쿨다운은 날짜와 시각 경계에서', () => {
  let s = emptyState(TODAY);
  assert.equal(deferReason(setPaused(s, true, TODAY), ok), 'paused');
  assert.equal(deferReason(setPaused(s, true, TODAY), { ...ok, today: '2026-10-29' }), null, '이튿날 풀림');
  for (let i = 0; i < VISIT.dayMax; i++) s = recordVisit(s, `F-AAAA-AAA${i}`, NOW - 10 * 3600_000 + i, TODAY);
  assert.equal(s.count, VISIT.dayMax);
  assert.equal(deferReason(s, ok), 'dayMax');
  assert.equal(deferReason(s, { ...ok, today: '2026-10-29' }), null, '날짜가 바뀌면 센 수가 0');
  assert.equal(parseState(s, '2026-10-29').count, 0);
  const one = recordVisit(emptyState(TODAY), A.code, NOW, TODAY);
  assert.equal(deferReason(one, { ...ok, now: NOW + VISIT.cooldownMs - 1 }), 'cooldown');
  assert.equal(deferReason(one, { ...ok, now: NOW + VISIT.cooldownMs }), null);
});

test('까닭 순서: 서버 문제는 숨김 같은 펫 쪽 까닭보다 먼저 (조용히)', () => {
  const s = emptyState(TODAY);
  assert.equal(deferReason(s, { ...ok, serverOk: false, hidden: true }), 'server');
  assert.equal(deferReason(s, { ...ok, hidden: true, focus: true }), 'hidden');
});

test('친구 고르기: 3시간 안에 온 친구는 뺀다. 둘 다 쉬는 중이면 friend', () => {
  let s = recordVisit(emptyState(TODAY), A.code, NOW - VISIT.cooldownMs - 1, TODAY);
  assert.deepEqual(pickVisitor([A, B], s, NOW, first), B);
  assert.equal(pickVisitor([A], s, NOW, first), undefined);
  assert.deepEqual(pickVisitor([A], s, NOW - VISIT.cooldownMs - 1 + VISIT.perFriendMs, first), A);
  const d = decide(s, ok, [A], first, true);
  assert.deepEqual(d, { go: false, reason: 'friend' });
  s = emptyState(TODAY);
  assert.deepEqual(
    decide(s, ok, [A, B], () => 0.99, true),
    { go: true, visitor: B },
  );
});

test('확률: 0.35 미만일 때만 부른다. force 는 건너뛴다', () => {
  const s = emptyState(TODAY);
  assert.deepEqual(
    decide(s, ok, [A], () => VISIT.chance, false),
    { go: false, reason: 'chance' },
  );
  assert.deepEqual(
    decide(s, ok, [A], () => 0.1, false),
    { go: true, visitor: A },
  );
  assert.deepEqual(
    decide(s, ok, [A], () => 0.99, true),
    { go: true, visitor: A },
  );
  assert.deepEqual(decide(s, ok, [], first, true), { go: false, reason: 'friend' });
});

test('와 있는 동안 걸리는 것: 숨김, 집중, 놀이, 숨바꼭질, 자리 비움, 절전만 (일정과 바쁨은 쫓아내지 않는다)', () => {
  assert.equal(interruptReason(ok), null);
  assert.equal(interruptReason({ ...ok, hidden: true }), 'hidden');
  assert.equal(interruptReason({ ...ok, focus: true }), 'focus');
  assert.equal(interruptReason({ ...ok, playing: true }), 'play');
  assert.equal(interruptReason({ ...ok, seeking: true }), 'seek');
  assert.equal(interruptReason({ ...ok, awaySec: 600 }), 'away');
  assert.equal(interruptReason({ ...ok, saver: true }), 'saver');
  const quiet: VisitFacts = { ...ok, eventSoon: true, mainIdle: false };
  assert.equal(interruptReason(quiet), null);
});

test('파일 읽기: 깨진 값, 이상한 코드, 다른 날짜의 오늘은 그만은 버린다', () => {
  for (const raw of [null, 5, 'x', [], { count: -3, last: [] }]) {
    const s = parseState(raw, TODAY);
    assert.equal(s.count, 0);
    assert.equal(s.pausedDay, null);
    assert.deepEqual(s.last, {});
  }
  const s = parseState(
    {
      day: TODAY,
      count: 3,
      pausedDay: '2026-10-27',
      lastAt: 5,
      last: { 'F-AAAA-AAAA': 7, evil: 8, 'F-BBBB-BBBB': -1 },
    },
    TODAY,
  );
  assert.equal(s.count, 3);
  assert.equal(s.pausedDay, null, '어제 누른 오늘은 그만은 풀린다');
  assert.deepEqual(s.last, { 'F-AAAA-AAAA': 7 });
  assert.equal(parseState({ day: TODAY, pausedDay: TODAY }, TODAY).pausedDay, TODAY);
});

test('시계가 미래로 갔다 돌아와도 미래 기록은 지금으로 잘려 쉬는 시간이 풀린다', () => {
  const future = NOW + 365 * 86400_000;
  const s = parseState({ day: TODAY, count: 1, lastAt: future, last: { [A.code]: future } }, TODAY, NOW);
  assert.equal(s.lastAt, NOW);
  assert.equal(s.last[A.code], NOW);
  assert.equal(deferReason(s, { ...ok, now: NOW + VISIT.cooldownMs }), null);
  assert.deepEqual(pickVisitor([A], s, NOW + VISIT.perFriendMs, first), A);
  assert.equal(pickVisitor([A], s, NOW, first), undefined, '지금 막 온 것으로 본다');
});

test('시간대를 서쪽으로 옮겨 저장 날짜가 하루 앞서면 센 수와 오늘은 그만이 유지된다. 며칠 앞선 날짜는 버린다', () => {
  const s = parseState(
    { day: '2026-10-28', count: VISIT.dayMax, pausedDay: '2026-10-28' },
    '2026-10-27',
    NOW,
  );
  assert.equal(s.count, VISIT.dayMax);
  assert.equal(s.day, '2026-10-28');
  assert.equal(deferReason(s, { ...ok, today: '2026-10-27' }), 'paused');
  assert.equal(deferReason({ ...s, pausedDay: null }, { ...ok, today: '2026-10-27' }), 'dayMax');
  const far = parseState({ day: '2027-10-28', count: 5, pausedDay: '2027-10-28' }, '2026-10-27', NOW);
  assert.equal(far.count, 0);
  assert.equal(far.pausedDay, null);
  // 날짜가 지나면 풀린다
  assert.equal(deferReason(s, { ...ok, today: '2026-10-29' }), null);
  assert.equal(parseState(s, '2026-10-29', NOW).count, 0);
});
