import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  briefingText,
  deadlineText,
  dueSlot,
  isInstallDay,
  leftForTomorrow,
  type NextUpTodo,
  nextUp,
  PREPARE_MS,
  reviewText,
  undoMoved,
} from './briefing.ts';
import { breakFor, focusCoins, focusedMinutes, IDLE, remainLabel, startFocus, tickFocus } from './focus.ts';
import { setLang } from './i18n/index.ts';
import { variants } from './variants.ts';

const MIN = 60_000;
// 인사는 여러 변형 가운데 고른다. 시험은 늘 첫째 변형(기본 말)으로
variants.setRandom(() => 0);

test('브리핑: 일정 하나, 여러 개, 마감, 아무것도 없을 때', () => {
  assert.equal(
    briefingText({ events: [{ minute: 600, title: '스탠드업' }], dueToday: 0, overdue: 0, nowMinute: 540 }),
    '좋은 아침! 오늘 일정은 오전 10:00 스탠드업 하나야.',
  );
  assert.equal(
    briefingText({
      events: [
        { minute: 600, title: '스탠드업' },
        { minute: 900, title: '회의' },
      ],
      dueToday: 2,
      overdue: 1,
      nowMinute: 13 * 60,
    }),
    '안녕! 오늘 일정 2개, 첫 일정은 오전 10:00 스탠드업. 할 일은 오늘 마감 2개, 지난 마감 1개 있어.',
  );
  assert.equal(
    briefingText({ events: [], dueToday: 0, overdue: 3, nowMinute: 20 * 60 }),
    '왔구나! 할 일은 지난 마감 3개 있어.',
  );
  assert.match(briefingText({ events: [], dueToday: 0, overdue: 0, nowMinute: 540 }), /일정도 마감도 없어/);
});

test('집중 타이머: 25분 뒤 쉬기로, 5분 뒤 멈춤. 늦게 깨도 한 단계씩', () => {
  const s = startFocus(0);
  assert.equal(tickFocus(s, 24 * MIN).event, undefined);
  const a = tickFocus(s, 25 * MIN);
  assert.equal(a.event, 'focus-done');
  assert.equal(a.state.phase, 'break');
  assert.equal(a.state.endsAt, 30 * MIN);
  const late = tickFocus(s, 120 * MIN);
  assert.equal(late.event, 'focus-done');
  assert.equal(late.state.phase, 'break');
  const b = tickFocus(a.state, 30 * MIN);
  assert.equal(b.event, 'break-done');
  assert.equal(b.state.phase, 'idle');
  assert.equal(tickFocus(IDLE, 999 * MIN).event, undefined);
});

test('집중한 분과 남은 시간 표시', () => {
  const s = startFocus(0);
  assert.equal(focusedMinutes(s, 10 * MIN + 59_000), 10);
  assert.equal(focusedMinutes(s, 99 * MIN), 25);
  assert.equal(focusedMinutes(IDLE, 5 * MIN), 0);
  assert.equal(remainLabel(s, 0), '25:00');
  assert.equal(remainLabel(s, 24 * MIN + 1000), '0:59');
});

test('하루 회고: 끝낸 수, 하나면 제목, 남은 오늘 마감이 있으면 묻는다', () => {
  assert.equal(reviewText({ doneTitles: [], leftToday: 0 }), '오늘은 끝낸 할 일이 없네. 그래도 수고했어.');
  assert.equal(reviewText({ doneTitles: ['보고서'], leftToday: 0 }), '오늘 "보고서" 끝냈어. 수고했어!');
  assert.equal(
    reviewText({ doneTitles: ['a', 'b', 'c'], leftToday: 2 }),
    '오늘 할 일 3개 끝냈어. 수고했어! 오늘 마감 2개가 남았는데 내일로 넘길까?',
  );
});

test('오늘 마감 알림 칸: 조용히는 없음, 보통은 14시부터 한 번, 수다쟁이는 10시와 15시, 회고 시각 뒤는 없음', () => {
  const review = 18 * 60;
  assert.equal(dueSlot(15 * 60, 'quiet', review), undefined);
  assert.equal(dueSlot(10 * 60, 'normal', review), undefined);
  assert.equal(dueSlot(13 * 60 + 59, 'normal', review), undefined);
  assert.equal(dueSlot(14 * 60, 'normal', review), 'pm');
  assert.equal(dueSlot(9 * 60 + 59, 'chatty', review), undefined);
  assert.equal(dueSlot(10 * 60, 'chatty', review), 'am');
  assert.equal(dueSlot(14 * 60 + 30, 'chatty', review), 'am');
  assert.equal(dueSlot(15 * 60, 'chatty', review), 'pm');
  assert.equal(dueSlot(18 * 60, 'chatty', review), undefined);
  assert.equal(dueSlot(18 * 60, 'normal', 20 * 60), 'pm');
});

test('오늘 마감 알림 글: 제목은 셋까지, 나머지는 개수로', () => {
  setLang('ko');
  assert.equal(deadlineText(['보고서']), '오늘 마감인 할 일이 1개 남았어. "보고서"');
  assert.equal(
    deadlineText(['a', 'b', 'c', 'd', 'e']),
    '오늘 마감인 할 일이 5개 남았어. "a", "b", "c" 외 2개',
  );
  setLang('en');
  assert.equal(deadlineText(['report']), 'One to-do is due today: "report"');
  setLang('ko');
});

test('집중 길이: 코인은 15분 5, 25분 10, 50분 25 (길수록 보너스, #76), 50분이면 쉬기 10분', () => {
  assert.deepEqual([15, 25, 50].map(focusCoins), [5, 10, 25]);
  // 50분 한 번이 25분 두 번보다 많다
  assert.ok(focusCoins(50) > 2 * focusCoins(25));
  assert.ok(focusCoins(25) > focusCoins(15) * (25 / 15));
  // 그 사이와 바깥 (잠자기로 줄어든 집중 분도 받는다): 0 이하와 숫자 아님은 0, 길수록 늘기만 한다
  assert.deepEqual([0, -5, Number.NaN, 1, 3, 20, 40, 60].map(focusCoins), [0, 0, 0, 0, 1, 8, 19, 25]);
  for (let m = 1; m <= 120; m++) assert.ok(focusCoins(m) >= focusCoins(m - 1), `${m}분`);
  assert.deepEqual([15, 25, 50].map(breakFor), [5, 5, 10]);
  const s = startFocus(0, 50);
  const r = tickFocus(s, 50 * MIN);
  assert.equal(r.event, 'focus-done');
  assert.equal(r.state.endsAt - r.state.startedAt, 10 * MIN);
  assert.equal(focusedMinutes(s, 50 * MIN), 50);
  const r15 = tickFocus(startFocus(0, 15), 15 * MIN);
  assert.equal(r15.state.endsAt - r15.state.startedAt, 5 * MIN);
});

test('회고 내일로 넘기기 되돌리기: 아직 내일 마감인 것만 원래 마감으로', () => {
  const moved = [
    { id: 1, due: '2026-10-08' },
    { id: 2, due: '2026-10-07' },
    { id: 3, due: '2026-10-08' },
    { id: 4, due: '2026-10-08' },
  ];
  // 1 은 그대로 내일, 2 도 그대로(지난 마감이었다), 3 은 손으로 모레로 바꿈, 4 는 끝냄(열린 목록에 없음)
  const open = [
    { id: 1, due: '2026-10-09' },
    { id: 2, due: '2026-10-09' },
    { id: 3, due: '2026-10-10' },
  ];
  assert.deepEqual(undoMoved(moved, open, '2026-10-09'), [
    { id: 1, due: '2026-10-08' },
    { id: 2, due: '2026-10-07' },
  ]);
});

test('다음 할 일: 30분 안 일정 준비 → 마감 지남 → 오늘 중요 → 중요 → 오늘 마감 → 습관', () => {
  const now = new Date(2026, 9, 10, 10, 0).getTime();
  let seq = 0;
  const todo = (title: string, due: string | null, important = false, more: Partial<NextUpTodo> = {}) => ({
    id: ++seq,
    title,
    due,
    important,
    createdAt: now - (100 - seq) * MIN,
    doneAt: null,
    ...more,
  });
  const oldImportant = todo('오래된 중요', null, true);
  const newImportant = todo('새 중요', '2026-10-20', true);
  const today = todo('오늘 보통', '2026-10-10');
  const todayEarly = todo('오늘 보통 9시', '2026-10-10', false, { dueMin: 9 * 60 });
  const todayImp = todo('오늘 중요', '2026-10-10', true);
  const lateImp = todo('지난 중요', '2026-10-08', true);
  const late = todo('지난 보통', '2026-10-01');
  const done = todo('끝낸 지난 중요', '2026-10-01', true, { doneAt: now - MIN });
  const all = [oldImportant, newImportant, today, todayEarly, todayImp, lateImp, late, done];
  const soon = { id: 9, title: '디자인 회의', startAt: now + 20 * MIN, allDay: false };
  const pick = (todos: typeof all, events = [soon]) => nextUp({ todos, events, now });

  assert.deepEqual(pick(all), { kind: 'event', id: 9, title: '디자인 회의', startAt: now + 20 * MIN });
  // 30분보다 멀거나, 이미 시작했거나, 종일 일정은 준비할 일이 아니다
  const notSoon = [
    { ...soon, startAt: now + PREPARE_MS + 1 },
    { ...soon, startAt: now - MIN },
    { ...soon, startAt: now + 5 * MIN, allDay: true },
  ];
  assert.deepEqual(pick(all, notSoon), { kind: 'todo', id: lateImp.id, title: '지난 중요', why: 'overdue' });
  // 마감 지난 할 일이 먼저 (중요가 아니어도). 그다음 중요(오늘 마감 먼저), 오늘 마감, 습관
  assert.equal(pick([oldImportant, today, todayImp, late], [])?.title, '지난 보통');
  assert.equal(pick([oldImportant, today, todayImp], [])?.title, '오늘 중요');
  assert.equal(pick([oldImportant, today], [])?.title, '오래된 중요');
  const habit = todo('습관 운동', '2026-10-08', false, { repeat: 'daily' });
  assert.equal(pick([habit, today], [])?.title, '오늘 보통');
  assert.deepEqual(pick([habit], []), { kind: 'todo', id: habit.id, title: '습관 운동', why: 'habit' });
  // 오늘 마감끼리는 시각이 이른 것부터 (시각 없는 것은 뒤)
  assert.deepEqual(pick([today, todayEarly], []), {
    kind: 'todo',
    id: todayEarly.id,
    title: '오늘 보통 9시',
    why: 'today',
  });
  // 오래된 중요: 먼저 넣은 것
  assert.deepEqual(pick([newImportant, oldImportant], []), {
    kind: 'todo',
    id: oldImportant.id,
    title: '오래된 중요',
    why: 'important',
  });
  assert.equal(pick([late, done], [])?.title, '지난 보통');
  assert.equal(pick([done], []), undefined);
  assert.equal(nextUp({ todos: [], events: [], now }), undefined);
});

test('브리핑 끝에 먼저 할 일 한 문장. 다른 게 없으면 그 문장만', () => {
  assert.equal(
    briefingText({ events: [], dueToday: 1, overdue: 0, nowMinute: 540, next: '보고서' }),
    "좋은 아침! 할 일은 오늘 마감 1개 있어. 먼저 '보고서'부터 해 볼까?",
  );
  assert.equal(
    briefingText({ events: [], dueToday: 0, overdue: 0, nowMinute: 540, next: '보고서' }),
    "좋은 아침! 먼저 '보고서'부터 해 볼까?",
  );
  setLang('en');
  try {
    assert.equal(
      briefingText({ events: [], dueToday: 0, overdue: 0, nowMinute: 540, next: 'Report' }),
      "Good morning! How about starting with 'Report'?",
    );
  } finally {
    setLang('ko');
  }
});

test('못 한 N개 내일로: 오늘 마감과 지난 마감만, 습관과 마감 없는 것과 내일 이후는 둔다', () => {
  const open = [
    { id: 1, due: '2026-10-09' },
    { id: 2, due: '2026-10-10' },
    { id: 3, due: '2026-10-11' },
    { id: 4, due: null },
    { id: 5, due: '2026-10-10', repeat: 'daily' },
    { id: 6, due: '2026-10-08', repeat: null },
  ];
  assert.deepEqual(
    leftForTomorrow(open, '2026-10-10').map((t) => t.id),
    [1, 2, 6],
  );
  assert.deepEqual(leftForTomorrow([], '2026-10-10'), []);
  // 넘긴 뒤(마감이 내일) 되돌리기는 마감이 그대로 내일인 것만 원래대로
  const moved = [
    { id: 1, due: '2026-10-09' },
    { id: 2, due: '2026-10-10' },
  ];
  assert.deepEqual(
    undoMoved(
      moved,
      [
        { id: 1, due: '2026-10-11' },
        { id: 2, due: '2026-10-12' },
      ],
      '2026-10-11',
    ),
    [{ id: 1, due: '2026-10-09' }],
  );
});

test('설치 첫날: 첫 기록이 없거나 오늘이면 회고를 하지 않고, 어제부터 쓴 사람은 한다', () => {
  assert.equal(isInstallDay(null, '2026-10-28'), true);
  assert.equal(isInstallDay('2026-10-28', '2026-10-28'), true);
  assert.equal(isInstallDay('2026-10-27', '2026-10-28'), false);
  assert.equal(isInstallDay('2026-01-01', '2026-10-28'), false);
});
