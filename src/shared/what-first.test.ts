// 오늘 뭐부터 (2026-10-11): 순서 세우기, 빈 시간에 집중 칸, 물음 알아듣기 (한국어, 영어)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from './i18n/index.ts';
import {
  type FirstTodo,
  firstAnswer,
  firstBubble,
  firstContext,
  isWhatFirstQuestion,
  planFirst,
  rankFirst,
  reasonText,
  todayGaps,
} from './what-first.ts';

const today = '2026-10-14';
const MIN = 60_000;
// 하루 0시를 0 으로 둔다 (시간대를 타지 않게)
const at = (h: number, m = 0) => (h * 60 + m) * MIN;
const minuteOf = (ms: number) => Math.round(ms / MIN);
const todo = (id: number, o: Partial<FirstTodo> = {}): FirstTodo => ({
  id,
  title: `할 일 ${id}`,
  due: null,
  important: false,
  createdAt: id,
  ...o,
});

test('순서: 지난 마감 → 오늘 시각 마감(이른 것) → 오늘 마감 → 중요 → 곧 마감 → 오늘 습관', () => {
  const todos = [
    todo(1, { due: '2026-10-16' }), // 곧 마감
    todo(2, { important: true }), // 중요
    todo(3, { due: today }), // 오늘 마감
    todo(4, { due: today, dueMin: 15 * 60 }), // 오늘 오후 3시
    todo(5, { due: today, dueMin: 11 * 60 }), // 오늘 오전 11시
    todo(6, { due: '2026-10-12' }), // 지난 마감
    todo(7, { due: '2026-10-10' }), // 더 지난 마감
    todo(8, { due: '2026-10-30' }), // 먼 마감: 넣지 않는다
    todo(9, { due: today, repeat: 'daily' }), // 반복은 습관 칸에서
    todo(10), // 아무것도 없음
  ];
  const habits = [
    { id: 9, title: '운동', status: 'todo' as const },
    { id: 11, title: '물 마시기', status: 'done' as const },
    { id: 12, title: '주간 회고', status: 'later' as const },
  ];
  assert.deepEqual(
    rankFirst(todos, habits, today).map((x) => x.id),
    [7, 6, 5, 4, 3, 2, 1, 9],
  );
});

test('같은 묶음은 중요가 먼저, 그다음 먼저 넣은 것. 아무것도 없으면 먼저 넣은 것 하나', () => {
  const r = rankFirst([todo(1, { due: today }), todo(2, { due: today, important: true })], [], today);
  assert.deepEqual(
    r.map((x) => x.id),
    [2, 1],
  );
  assert.deepEqual(
    rankFirst([todo(5), todo(3), todo(4, { repeat: 'weekly' })], [], today).map((x) => [x.id, x.reason.kind]),
    [[3, 'oldest']],
  );
  assert.deepEqual(rankFirst([], [], today), []);
});

test('까닭 말: 마감 지남, 오후 3시 마감, 중요, 내일 마감, 날짜 마감, 중요 덧붙임', () => {
  setLang('ko');
  const r = rankFirst(
    [
      todo(1, { due: '2026-10-12', important: true }),
      todo(2, { due: today, dueMin: 15 * 60 }),
      todo(3, { important: true }),
      todo(4, { due: '2026-10-15' }),
      todo(5, { due: '2026-10-17' }),
    ],
    [],
    today,
  );
  assert.deepEqual(
    r.map((x) => reasonText(x, today)),
    ['마감 지남, 중요', '오후 3:00 마감', '중요', '내일 마감', '10월 17일 마감'],
  );
  setLang('en');
  const timed = r[1];
  assert.ok(timed);
  assert.equal(reasonText(timed, today), 'due 3:00 PM');
  setLang('ko');
});

test('빈 시간: 일정 사이에서 지금이나 9시부터, 다음 빈 칸에 맨 위 할 일 집중 칸', () => {
  const events = [
    { title: '회의', startAt: at(10), endAt: at(11), allDay: false },
    { title: '여행', startAt: 0, endAt: at(24), allDay: true },
  ];
  // 9시 50분: 회의 5분 전까지는 25분이 안 되어 빈 시간이 아니다. 회의 끝나고 5분 뒤부터
  const gaps = todayGaps(events, 0, at(9, 50), 18 * 60);
  assert.equal(gaps[0]?.start, at(11, 5));
  const plan = planFirst({
    todos: [todo(1, { due: '2026-10-12' }), todo(2, { important: true })],
    habits: [],
    events,
    today,
    dayStart: 0,
    now: at(9, 50),
    endMinute: 18 * 60,
  });
  assert.deepEqual(plan.block, { start: at(11, 5), end: at(11, 55), todoId: 1 });
  assert.equal(plan.more, 0);
  // 빈 시간이 없으면 칸도 없다
  const busy = planFirst({
    todos: [todo(1, { due: today })],
    habits: [],
    events: [{ title: '워크숍', startAt: at(9), endAt: at(18), allDay: false }],
    today,
    dayStart: 0,
    now: at(9),
    endMinute: 18 * 60,
  });
  assert.equal(busy.block, undefined);
});

test('답 글: 셋과 까닭, 그 밖에 수, 집중 칸 제안. 없으면 급한 게 없다고', () => {
  setLang('ko');
  const plan = planFirst({
    todos: [
      todo(1, { title: '보고서', due: '2026-10-12' }),
      todo(2, { title: '자료 준비', due: today, dueMin: 15 * 60 }),
      todo(3, { title: '*발표*', important: true }),
      todo(4, { title: '메일', due: '2026-10-15' }),
    ],
    habits: [{ id: 9, title: '운동', status: 'todo' }],
    events: [],
    today,
    dayStart: 0,
    now: at(13, 2),
    endMinute: 18 * 60,
  });
  const text = firstAnswer(plan, today, minuteOf);
  assert.match(text, /1\. \*\*보고서\*\* · 마감 지남/);
  assert.match(text, /2\. \*\*자료 준비\*\* · 오후 3:00 마감/);
  assert.match(text, /3\. \*\*발표\*\* · 중요/);
  assert.match(text, /그 밖에 2개/);
  assert.match(text, /오후 1:05~오후 1:55에 시간이 비어\. 거기서 "보고서" 50분 집중 어때\?/);
  assert.match(firstBubble(plan, today), /^"보고서"부터 하자! \(마감 지남\) 그다음은 자료 준비, \*발표\*\.$/);
  const ctx = firstContext(plan, today, minuteOf);
  assert.match(ctx, /<<<JJ_DATA[\s\S]*1\. 보고서 \(마감 지남\)[\s\S]*JJ_DATA>>>/);
  assert.equal(firstContext({ items: [], more: 0 }, today), '');
  assert.match(firstAnswer({ items: [], more: 0 }, today), /급한 할 일은 없어/);
});

test('물음 알아듣기: 한국어', () => {
  for (const q of [
    '오늘 뭐부터 할까',
    '오늘 뭐부터 할까?',
    '뭐 먼저 해?',
    '뭐부터 하지',
    '무엇부터 하면 돼?',
    '지금 뭘 먼저 해야 해?',
    '어떤 일부터 할까',
    '할 일 뭐부터 처리할까',
    '오늘 우선순위 정해 줘',
    '오늘 뭐 해야 돼?',
    '오늘 뭐부터 하면 좋을까?', // 채팅 첫 화면 예시 질문
  ])
    assert.equal(isWhatFirstQuestion(q), true, q);
  for (const q of [
    '이 책 뭐부터 읽을까',
    '파이썬 공부 뭐부터 시작하면 좋을지 자세히 알려줘 기초 문법이랑 자료구조 중에',
    '오늘 날씨 어때?',
    '뭐해',
    '먼저 보고서 써 줘',
    '',
  ])
    assert.equal(isWhatFirstQuestion(q), false, q);
});

test('물음 알아듣기: 영어', () => {
  for (const q of [
    'what should I do first?',
    'What should I do today',
    'what should i work on first',
    'what do I start with today?',
    'what to do first',
    "what's first today?",
    'where should I start?',
    'help me prioritize my day',
  ])
    assert.equal(isWhatFirstQuestion(q), true, q);
  for (const q of ['what should I cook for dinner', 'what is a monad', 'first, summarize this article']) {
    assert.equal(isWhatFirstQuestion(q), false, q);
  }
});
