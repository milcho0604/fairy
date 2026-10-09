import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { allDayTimes, EventStore } from './event-store.ts';
import { setLang } from './i18n/index.ts';
import {
  ABSORB_MS,
  type Anchor,
  armReminders,
  atLocal,
  DATE_CHOICES,
  DAY_MIN,
  dayBefore,
  EVE,
  fireAt,
  MAX_REMINDS,
  normalizeReminds,
  planReminders,
  resolveSpecs,
  SAME_MORNING,
  SNOOZE_LONG_MS,
  SNOOZE_SHORT_MS,
  snoozeFor,
  staleAt,
  TIMED_CHOICES,
  takeRemind,
} from './remind.ts';
import { parseTodoLine, remindsOf, splitRemind, todoPatchInput } from './remind-parse.ts';
import { missedLine, remindLabel, remindLine } from './remind-text.ts';
import { TodoStore } from './todo-store.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (day: string, h: number, m = 0) => atLocal(day, h * 60 + m);
const timeA = (day: string, h: number, m = 0): Anchor => ({ kind: 'time', at: at(day, h, m) });
const dayA = (day: string): Anchor => ({ kind: 'day', day });

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, events: new EventStore(db), todos: new TodoStore(db) };
}

// ---- 셈 ----

test('울릴 때: 시각 기준은 분 앞, 하루 단위는 같은 시각의 며칠 전, 날짜 기준은 그날 0시에서', () => {
  const meet = timeA('2026-10-20', 15);
  assert.equal(fireAt(meet, 0), at('2026-10-20', 15));
  assert.equal(fireAt(meet, 10), at('2026-10-20', 14, 50));
  assert.equal(fireAt(meet, 180), at('2026-10-20', 12));
  assert.equal(fireAt(meet, DAY_MIN), at('2026-10-19', 15));
  assert.equal(fireAt(meet, 7 * DAY_MIN), at('2026-10-13', 15));
  const due = dayA('2026-10-20');
  assert.equal(fireAt(due, EVE), at('2026-10-19', 20));
  assert.equal(fireAt(due, SAME_MORNING), at('2026-10-20', 9));
  assert.equal(fireAt(due, dayBefore(1, 9 * 60)), at('2026-10-19', 9));
  assert.equal(fireAt(due, dayBefore(3, 9 * 60)), at('2026-10-17', 9));
  assert.equal(fireAt(due, dayBefore(7, 9 * 60)), at('2026-10-13', 9));
  // 7판 종일 일정의 "전날 저녁 8시"(240)와 같은 값
  assert.equal(EVE, 240);
  // 달이 바뀌어도 (11월 1일의 3일 전 = 10월 29일)
  assert.equal(fireAt(dayA('2026-11-01'), dayBefore(3, 9 * 60)), at('2026-10-29', 9));
});

test('시간대가 바뀌거나 서머타임이 바뀌어도 현지 시각으로 (아침 9시는 그곳 아침 9시)', () => {
  const was = process.env.TZ;
  try {
    for (const tz of ['America/New_York', 'Asia/Seoul', 'Europe/London']) {
      process.env.TZ = tz;
      const d = new Date(fireAt(dayA('2026-11-02'), dayBefore(1, 9 * 60)));
      assert.deepEqual([d.getDate(), d.getHours(), d.getMinutes()], [1, 9, 0], tz);
    }
    // 뉴욕은 2026-11-01 새벽에 서머타임이 끝난다: 11월 1일 오후 3시 회의의 하루 전은 10월 31일 오후 3시 (25시간 전)
    process.env.TZ = 'America/New_York';
    const meet = new Date(2026, 10, 1, 15, 0).getTime();
    const d = new Date(fireAt({ kind: 'time', at: meet }, DAY_MIN));
    assert.deepEqual([d.getDate(), d.getHours()], [31, 15]);
    assert.equal(meet - d.getTime(), 25 * HOUR);
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

test('알림 목록 다듬기: 겹침과 범위 밖을 빼고 이른 것부터, 6개까지', () => {
  assert.deepEqual(normalizeReminds([10, 60, 10, 0, -5, 31 * DAY_MIN, 'x', Number.NaN], false), [60, 10, 0]);
  // 날짜 기준은 당일 아침(음수)이 된다
  assert.deepEqual(normalizeReminds([SAME_MORNING, EVE], true), [EVE, SAME_MORNING]);
  assert.deepEqual(normalizeReminds([SAME_MORNING], false), []);
  assert.equal(normalizeReminds([1, 2, 3, 4, 5, 6, 7, 8], false).length, MAX_REMINDS);
  // 고르기 칸은 이른 것부터
  for (const list of [TIMED_CHOICES, DATE_CHOICES])
    assert.deepEqual(
      [...list],
      [...list].sort((a, b) => b - a),
    );
});

test('지금 말할지: 제때, 여럿 지났으면 한 번, 늦었으면 곧 올 것도, 지난 기준은 넘김', () => {
  const meet = timeA('2026-10-20', 15);
  const marks = (...b: number[]) => b.map((before) => ({ before, notifiedAt: null }));
  const all = marks(DAY_MIN, 60, 10, 0);
  // 하루 전 오후 3시 전에는 없음, 그때가 되면 말하고 그것만
  assert.deepEqual(planReminders(meet, all, at('2026-10-19', 14, 59)), { speak: false, mark: [], skip: [] });
  assert.deepEqual(planReminders(meet, all, at('2026-10-19', 15)), {
    speak: true,
    mark: [DAY_MIN],
    skip: [],
  });
  // 컴퓨터가 꺼져 있다 오후 2시 5분에 켰다: 하루 전과 1시간 전이 지났다. 한 번 말하고 둘 다 적는다
  const p = planReminders(meet, all, at('2026-10-20', 14, 5));
  assert.equal(p.speak, true);
  assert.deepEqual(p.mark.sort(), [60, DAY_MIN].sort());
  // 늦게 켠 때가 10분 전 알림 바로 앞이면(15분 안) 그것도 같이 (5분 사이 두 번 말하지 않게)
  const q = planReminders(meet, all, at('2026-10-20', 14, 40));
  assert.deepEqual(
    q.mark.sort((a, b) => a - b),
    [10, 60, DAY_MIN],
  );
  // 제때(2분 안) 울린 것은 다음 알림을 당기지 않는다
  assert.deepEqual(planReminders(meet, marks(10, 0), at('2026-10-20', 14, 51)).mark, [10]);
  assert.ok(ABSORB_MS >= 10 * MIN);
  // 시작 5분이 지났으면 말하지 않고 넘긴다
  assert.deepEqual(planReminders(meet, all, at('2026-10-20', 15, 6)), {
    speak: false,
    mark: [],
    skip: [DAY_MIN, 60, 10, 0],
  });
  assert.equal(planReminders(meet, all, at('2026-10-20', 15, 4)).speak, true);
  // 이미 말한 것(숫자)과 넘긴 것(0)은 다시 말하지 않는다
  const done = [
    { before: DAY_MIN, notifiedAt: 5 },
    { before: 60, notifiedAt: 0 },
  ];
  assert.equal(planReminders(meet, done, at('2026-10-20', 14, 30)).speak, false);
  // 날짜 기준은 그날이 끝날 때까지 말한다 (당일 아침 9시 알림을 저녁에 켜도)
  const due = dayA('2026-10-20');
  assert.equal(planReminders(due, marks(SAME_MORNING), at('2026-10-20', 22)).speak, true);
  assert.deepEqual(planReminders(due, marks(SAME_MORNING), at('2026-10-21', 0, 1)).skip, [SAME_MORNING]);
  assert.equal(staleAt(due), at('2026-10-21', 0));
});

test('알림을 걸 때: 이미 지난 것은 넘기고, 1시간 안에 시작하는 시각 일정만 가장 가까운 하나를 바로 말한다', () => {
  const now = at('2026-10-20', 14, 30);
  // 오후 3시 회의를 2시 30분에 넣음: 하루 전과 1시간 전은 지남. 1시간 전 하나는 남겨 바로 말한다 (7판과 같다)
  assert.deepEqual(armReminders(timeA('2026-10-20', 15), [DAY_MIN, 60, 10], now), [
    { before: DAY_MIN, notifiedAt: 0 },
    { before: 60, notifiedAt: null },
    { before: 10, notifiedAt: null },
  ]);
  // 오늘 마감 할 일을 낮에 넣으면 전날 저녁, 당일 아침 알림은 넘긴다 (넣자마자 울리지 않게)
  assert.deepEqual(armReminders(dayA('2026-10-20'), [EVE, SAME_MORNING], now), [
    { before: EVE, notifiedAt: 0 },
    { before: SAME_MORNING, notifiedAt: 0 },
  ]);
  // 내일 마감이면 오늘 저녁 8시 알림은 아직
  assert.deepEqual(armReminders(dayA('2026-10-21'), [EVE], now), [{ before: EVE, notifiedAt: null }]);
  // 하루 뒤 회의: 지난 것 없음
  assert.deepEqual(
    armReminders(timeA('2026-10-21', 15), [DAY_MIN], now).map((m) => m.notifiedAt),
    [null],
  );
  // 이미 말한 알림은 그대로 두고 새로 더한 것만 본다
  const kept = armReminders(timeA('2026-10-21', 15), [DAY_MIN, 60], now, new Map([[DAY_MIN, 123]]));
  assert.deepEqual(kept, [
    { before: DAY_MIN, notifiedAt: 123 },
    { before: 60, notifiedAt: null },
  ]);
  // 마감일 없는 할 일: 그대로 기다린다
  assert.deepEqual(armReminders(null, [EVE], now), [{ before: EVE, notifiedAt: null }]);
});

test('미루기: 시작이 3시간 넘게 남았으면 1시간, 가까우면 5분, 미뤄도 늦으면 없음', () => {
  const now = at('2026-10-20', 9);
  assert.equal(snoozeFor(now, at('2026-10-23', 9), at('2026-10-23', 9, 10)), SNOOZE_LONG_MS);
  assert.equal(snoozeFor(now, now + 20 * MIN, now + 30 * MIN), SNOOZE_SHORT_MS);
  assert.equal(snoozeFor(now, now - 6 * MIN, now + 4 * MIN), undefined);
});

// ---- 빠른 입력 ----

test('빠른 입력의 알림 말: 한국어와 영어, 여러 개, 맨 끝과 맨 앞', () => {
  const cases: [string, unknown][] = [
    ['내일 3시 회의 1시간 전에 알려줘', { specs: [60], none: false, rest: '내일 3시 회의' }],
    ['보고서 금요일까지 하루 전 알림', { specs: [DAY_MIN], none: false, rest: '보고서 금요일까지' }],
    ['회의 내일 3시 3일 전', { specs: [3 * DAY_MIN], none: false, rest: '회의 내일 3시' }],
    [
      '하루 전이랑 1시간 전에 알려줘 내일 3시 회의',
      { specs: [DAY_MIN, 60], none: false, rest: '내일 3시 회의' },
    ],
    ['회의 하루랑 30분 전에 알려줘', { specs: [DAY_MIN, 30], none: false, rest: '회의' }],
    ['내일 3시 회의 1일 전, 3시간 전 알림', { specs: [DAY_MIN, 180], none: false, rest: '내일 3시 회의' }],
    ['내일 3시 회의 1시간 반 전에 알려줘', { specs: [90], none: false, rest: '내일 3시 회의' }],
    [
      '엄마 생일 10월 12일 일주일 전이랑 전날 저녁에 알려줘',
      { specs: [7 * DAY_MIN, 'eve'], none: false, rest: '엄마 생일 10월 12일' },
    ],
    ['회의 내일 10시 정각에 알려줘', { specs: [0], none: false, rest: '회의 내일 10시' }],
    ['내일 3시 회의 알림 없이', { specs: [], none: true, rest: '내일 3시 회의' }],
    [
      'meeting tomorrow 3pm, remind me 1 hour before',
      { specs: [60], none: false, rest: 'meeting tomorrow 3pm' },
    ],
    [
      'dentist friday 2pm 1 day and 30 min before',
      { specs: [DAY_MIN, 30], none: false, rest: 'dentist friday 2pm' },
    ],
    ['report friday, remind me the night before', { specs: ['eve'], none: false, rest: 'report friday' }],
    ['call mom friday, no reminders', { specs: [], none: true, rest: 'call mom friday' }],
    [
      'remind me 2 days before: rent due on the 1st',
      { specs: [2 * DAY_MIN], none: false, rest: 'rent due on the 1st' },
    ],
    [
      'remind me 2 days before rent due friday',
      { specs: [2 * DAY_MIN], none: false, rest: 'rent due friday' },
    ],
  ];
  for (const [text, want] of cases) assert.deepEqual(takeRemind(text), want, text);
  // 제목일 수 있는 것은 읽지 않는다: 맨 앞의 "~ 전"(알림 낱말 없이), 알림 낱말 없는 "정각", "on time", 알림 말만 있는 줄
  for (const text of [
    '3일 전 회의록 정리',
    '1시간 전',
    '회의 정각',
    'be on time',
    'report friday the night before',
    '회의 3일',
  ])
    assert.equal(takeRemind(text), null, text);
});

test('알림 말을 기준에 맞게: 날짜 기준의 "N일 전"은 아침 9시, 시간 단위는 버린다', () => {
  assert.deepEqual(resolveSpecs([DAY_MIN, 60, 0], false), [DAY_MIN, 60, 0]);
  assert.deepEqual(resolveSpecs([DAY_MIN, 3 * DAY_MIN, 'eve', 0], true), [
    dayBefore(3, 540),
    dayBefore(1, 540),
    EVE,
    SAME_MORNING,
  ]);
  assert.deepEqual(resolveSpecs([60], true), []);
  // 시각 기준의 "전날 저녁"은 전날 8시까지 거꾸로 센 분 (오후 3시 회의면 19시간 전)
  assert.deepEqual(resolveSpecs(['eve'], false, 15 * 60), [19 * 60]);
  // 뜻이 없는 말만 있으면 기본 알림 (undefined), "알림 없이"는 빈 목록
  assert.equal(remindsOf({ specs: [60], none: false }, true), undefined);
  assert.deepEqual(remindsOf({ specs: [], none: true }, false), []);
  assert.equal(remindsOf(null, false), undefined);
  assert.deepEqual(splitRemind('그냥 할 일'), { rest: '그냥 할 일', remind: null });
});

test('할 일 한 줄의 마감 시각: "까지"나 by 가 있을 때만, 반복 할 일과 시각 없는 마감은 그대로', () => {
  const today = '2026-10-08';
  const nine = 9 * 60;
  assert.deepEqual(parseTodoLine('내일 3시까지 보고서', today, nine), {
    title: '보고서',
    due: '2026-10-09',
    important: false,
    repeat: null,
    dueMin: 15 * 60,
  });
  assert.deepEqual(parseTodoLine('3시까지 보고서!', today, nine), {
    title: '보고서',
    due: today,
    important: true,
    repeat: null,
    dueMin: 15 * 60,
  });
  assert.equal(parseTodoLine('report by 5pm', today, nine).title, 'report');
  assert.equal(parseTodoLine('report by 5pm', today, nine).dueMin, 17 * 60);
  assert.deepEqual(parseTodoLine('보고서 금요일까지', today, nine), {
    title: '보고서',
    due: '2026-10-09',
    important: false,
    repeat: null,
    dueMin: null,
  });
  assert.equal(parseTodoLine('매일 아침 7시 스트레칭', today, nine).dueMin, null);
  assert.equal(parseTodoLine('우유 사기', today, nine).dueMin, null);
});

test('화면이 보낸 할 일 고치기는 아는 칸만', () => {
  assert.deepEqual(
    todoPatchInput({ dueMin: 600, reminds: [60, 'x'], due: '2026-1-1', evil: 1, important: true }),
    { important: true, dueMin: 600 },
  );
  assert.deepEqual(todoPatchInput({ dueMin: null, reminds: [60, 10], due: null }), {
    due: null,
    dueMin: null,
    reminds: [60, 10],
  });
  assert.deepEqual(todoPatchInput({ dueMin: 1440 }), {});
  assert.deepEqual(todoPatchInput(null), {});
});

// ---- 글 ----

test('고르기 칸 이름 (한국어, 영어)', () => {
  const ko = [0, 5, 60, 90, 180, DAY_MIN, 3 * DAY_MIN, 7 * DAY_MIN].map((b) => remindLabel(b, false));
  assert.deepEqual(ko, [
    '정각',
    '5분 전',
    '1시간 전',
    '1시간 30분 전',
    '3시간 전',
    '1일 전',
    '3일 전',
    '1주 전',
  ]);
  assert.deepEqual(
    DATE_CHOICES.map((b) => remindLabel(b, true)),
    ['1주 전 아침 9시', '3일 전 아침 9시', '전날 아침 9시', '전날 저녁 8시', '당일 아침 9시'],
  );
  setLang('en');
  try {
    assert.deepEqual(
      [0, 60, DAY_MIN, 2 * DAY_MIN, 7 * DAY_MIN].map((b) => remindLabel(b, false)),
      ['At start', '1 hr before', '1 day before', '2 days before', '1 week before'],
    );
    assert.equal(remindLabel(EVE, true), 'Day before, 8 PM');
    assert.equal(remindLabel(SAME_MORNING, true), 'Same day, 9 AM');
  } finally {
    setLang('ko');
  }
});

test('펫 말: 남은 시간에 맞춰 (지금, n분, n시간, 내일, n일), 종일과 할 일도', () => {
  const meet = { kind: 'event' as const, title: '디자인 회의', anchor: timeA('2026-10-20', 15) };
  const lines = [
    at('2026-10-20', 15),
    at('2026-10-20', 14, 50),
    at('2026-10-20', 12),
    at('2026-10-19', 15),
    at('2026-10-17', 15),
    at('2026-10-13', 15),
  ].map((now) => remindLine(meet, now));
  assert.deepEqual(lines, [
    '지금 디자인 회의 시작이야! (오후 3:00)',
    '10분 뒤 디자인 회의! 준비됐어? (오후 3:00)',
    '3시간 뒤에 디자인 회의가 있어 (오후 3:00)',
    '내일 오후 3:00에 디자인 회의가 있어! 준비됐어?',
    '디자인 회의까지 3일 남았어 (10월 20일 오후 3:00)',
    '디자인 회의까지 딱 일주일 남았어 (10월 20일 오후 3:00)',
  ]);
  // 받침: "면접이", "회의가"
  assert.equal(
    remindLine({ ...meet, title: '면접' }, at('2026-10-19', 15)),
    '내일 오후 3:00에 면접이 있어! 준비됐어?',
  );
  const trip = {
    kind: 'event' as const,
    title: '제주도 여행',
    anchor: dayA('2026-10-20'),
    range: '10/20~10/22',
  };
  assert.equal(remindLine(trip, at('2026-10-19', 20)), '내일은 종일 제주도 여행! 준비됐어? (10/20~10/22)');
  assert.equal(
    remindLine({ ...trip, range: undefined }, at('2026-10-20', 9)),
    '오늘은 종일 제주도 여행! 잊지 마',
  );
  const todo = { kind: 'todo' as const, title: '보고서', anchor: dayA('2026-10-20') };
  assert.equal(remindLine(todo, at('2026-10-19', 20)), '내일 마감: "보고서". 미리 해 둘까?');
  assert.equal(remindLine(todo, at('2026-10-20', 9)), '오늘 마감: "보고서"! 할 수 있어');
  assert.equal(remindLine(todo, at('2026-10-17', 9)), '"보고서" 마감까지 3일 남았어 (10월 20일)');
  const timed = { kind: 'todo' as const, title: '보고서', anchor: timeA('2026-10-20', 17) };
  assert.equal(remindLine(timed, at('2026-10-20', 16)), '"보고서" 마감까지 1시간 남았어 (오후 5:00)');
  assert.equal(
    remindLine(timed, at('2026-10-20', 16, 45)),
    '"보고서" 마감까지 15분! 거의 다 왔어 (오후 5:00)',
  );
  assert.equal(missedLine(timed), '보고서 (10월 20일 오후 5:00)');
  setLang('en');
  try {
    assert.equal(remindLine(meet, at('2026-10-20', 14, 50)), '디자인 회의 in 10 min! Ready? (3:00 PM)');
    assert.equal(remindLine(todo, at('2026-10-19', 20)), '"보고서" is due tomorrow. Get a head start?');
    assert.equal(remindLine(meet, at('2026-10-17', 15)), '3 days until 디자인 회의 (Oct 20, 3:00 PM)');
  } finally {
    setLang('ko');
  }
});

// ---- 저장 ----

test('8판 올리기: 일정 알림 하나는 첫 알림으로, 알림 없는 종일은 없음으로, 할 일은 기본 알림', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 7)) db.exec(sql);
  db.exec('pragma user_version = 7; commit');
  const future = Date.now() + 3 * 86_400_000;
  const past = Date.now() - 86_400_000;
  db.exec(`insert into event (id, title, start_at, remind_min, notified_at, created_at, all_day) values
    (1, '회의', ${future}, 30, null, 0, 0),
    (2, '여행', ${future}, 0, null, 0, 1),
    (3, '생일', ${future}, 240, null, 0, 1),
    (4, '지난 회의', ${past}, 10, null, 0, 0),
    (5, '알린 회의', ${future}, 10, 77, 0, 0)`);
  db.exec(`insert into todo (id, title, due, created_at, done_at) values
    (1, '내일 일', '2999-01-01', 0, null), (2, '마감 없음', null, 0, null), (3, '끝낸 일', '2999-01-01', 0, 5),
    (4, '지난 일', '2000-01-01', 0, null)`);
  assert.deepEqual(migrate(db), { from: 7, to: SCHEMA_VERSION });
  const rows = db
    .prepare('select kind, ref_id, before_min, notified_at from reminder order by kind, ref_id')
    .all();
  assert.deepEqual(
    rows.map((r) => ({ ...(r as object) })),
    [
      { kind: 'event', ref_id: 1, before_min: 30, notified_at: null },
      { kind: 'event', ref_id: 3, before_min: 240, notified_at: null },
      { kind: 'event', ref_id: 4, before_min: 10, notified_at: 0 },
      { kind: 'event', ref_id: 5, before_min: 10, notified_at: 77 },
      { kind: 'todo', ref_id: 1, before_min: 240, notified_at: null },
      { kind: 'todo', ref_id: 2, before_min: 240, notified_at: null },
      { kind: 'todo', ref_id: 3, before_min: 240, notified_at: 0 },
      { kind: 'todo', ref_id: 4, before_min: 240, notified_at: 0 },
    ],
  );
  const events = new EventStore(db);
  assert.deepEqual(events.get(1)?.reminds, [30]);
  assert.deepEqual(events.get(2)?.reminds, []);
  assert.equal(events.get(2)?.remindMin, 0);
  assert.equal(new TodoStore(db).get(1)?.dueMin, null);
});

test('일정 여러 알림: 1일 전, 1시간 전, 정각에 한 번씩, 시각을 옮기면 다시', () => {
  const { events } = fresh();
  const now = at('2026-10-18', 9);
  const e = events.add({ title: '면접', startAt: at('2026-10-20', 15), reminds: [0, 60, DAY_MIN] }, now);
  assert.deepEqual(e.reminds, [DAY_MIN, 60, 0]);
  const said: string[] = [];
  for (let t = now; t <= at('2026-10-20', 15, 10); t += 15_000) {
    if (events.dueReminders(t).length === 0) continue;
    said.push(new Date(t).toTimeString().slice(0, 5));
    events.markNotified(e.id, t);
  }
  assert.deepEqual(said, ['15:00', '14:00', '15:00']);
  // 시각을 옮기면 다시 (지금 시각을 주면 지난 알림은 넘긴다)
  events.update(e.id, { startAt: at('2026-10-21', 15) }, at('2026-10-20', 16));
  assert.equal(events.dueReminders(at('2026-10-20', 16)).length, 0);
  assert.equal(events.dueReminders(at('2026-10-21', 14)).length, 1);
  // 알림만 바꾸면 고친 것(user_edited)이 아니고, 이미 말한 알림은 그대로
  events.markNotified(e.id, at('2026-10-21', 14));
  events.update(e.id, { reminds: [60, 10] }, at('2026-10-21', 14, 1));
  assert.equal(events.dueReminders(at('2026-10-21', 14, 2)).length, 0);
  assert.equal(events.dueReminders(at('2026-10-21', 14, 50)).length, 1);
  // 지운 일정은 알리지 않는다
  events.remove(e.id, 0);
  assert.equal(events.dueReminders(at('2026-10-21', 14, 50)).length, 0);
});

test('컴퓨터가 꺼져 있던 사이: 켰을 때 한 번만, 시작이 지났으면 말하지 않는다', () => {
  const { events } = fresh();
  const created = at('2026-10-10', 9);
  const e = events.add(
    { title: '면접', startAt: at('2026-10-20', 15), reminds: [7 * DAY_MIN, DAY_MIN, 60] },
    created,
  );
  // 10-19 오후 4시에 켬: 1주 전, 1일 전이 지났다. 한 번
  const on = at('2026-10-19', 16);
  assert.equal(events.dueReminders(on).length, 1);
  events.markNotified(e.id, on);
  assert.equal(events.dueReminders(on + 15_000).length, 0);
  // 1시간 전은 제때
  assert.equal(events.dueReminders(at('2026-10-20', 14)).length, 1);
  // 다른 일정: 꺼져 있다 시작 30분 뒤에 켜면 없음
  const b = events.add({ title: '지난 것', startAt: at('2026-10-20', 9), reminds: [10] }, created);
  assert.ok(!events.dueReminders(at('2026-10-20', 9, 30)).some((x) => x.id === b.id));
});

test('종일 일정과 가져온 일정: 기본은 없음, 고르면 그 시각에, 가져온 반복 일정은 회차마다', () => {
  const { events } = fresh();
  const trip = events.add(
    { title: '여행', ...allDayTimes('2026-10-20', '2026-10-22'), allDay: true },
    at('2026-10-01', 9),
  );
  assert.deepEqual(trip.reminds, []);
  events.update(trip.id, { reminds: [dayBefore(3, 540), EVE] }, at('2026-10-01', 9));
  assert.equal(events.dueReminders(at('2026-10-17', 8, 59)).length, 0);
  assert.equal(events.dueReminders(at('2026-10-17', 9)).length, 1);
  events.markNotified(trip.id, at('2026-10-17', 9));
  assert.equal(events.dueReminders(at('2026-10-19', 20)).length, 1);
  // 가져온 일정: 시각 일정은 10분 전, 종일은 없음. 회차마다 따로 울린다
  const occ = (rid: string, startAt: number) => ({
    uid: 'u',
    recurrenceId: rid,
    title: '스탠드업',
    startAt,
    endAt: null,
    allDay: false,
  });
  events.syncExternal(
    'ics',
    [occ('a', at('2026-10-21', 10)), occ('b', at('2026-10-22', 10))],
    at('2026-10-20', 0),
    at('2026-11-20', 0),
    at('2026-10-20', 0),
  );
  assert.deepEqual(
    events.dueReminders(at('2026-10-21', 9, 50)).map((x) => x.reminds),
    [[10]],
  );
  assert.equal(events.dueReminders(at('2026-10-22', 9, 50)).length, 1);
  // 캘린더에서 시각이 바뀌면 다시 알린다
  const [first] = events.dueReminders(at('2026-10-21', 9, 50));
  events.markNotified(first?.id ?? 0, at('2026-10-21', 9, 50));
  events.syncExternal(
    'ics',
    [occ('a', at('2026-10-21', 11)), occ('b', at('2026-10-22', 10))],
    at('2026-10-20', 0),
    at('2026-11-20', 0),
    at('2026-10-21', 9, 55),
  );
  assert.equal(events.dueReminders(at('2026-10-21', 10, 50)).length, 1);
});

test('할 일 알림: 기본 전날 저녁, 오늘 마감을 넣으면 바로 울리지 않음, 끝내거나 지우면 없음, 반복은 다음 회차에', () => {
  const { todos } = fresh();
  const now = at('2026-10-19', 10);
  const a = todos.add({ title: '보고서', due: '2026-10-20' }, now);
  assert.deepEqual(a.reminds, [EVE]);
  const b = todos.add({ title: '오늘 일', due: '2026-10-19' }, now);
  assert.equal(todos.dueReminders(now).length, 0);
  assert.deepEqual(
    todos.dueReminders(at('2026-10-19', 20)).map((x) => x.title),
    ['보고서'],
  );
  todos.markNotified(a.id, at('2026-10-19', 20));
  assert.equal(todos.dueReminders(at('2026-10-19', 20, 1)).length, 0);
  assert.deepEqual([...todos.remindedSince(at('2026-10-19', 0))], [a.id]);
  // 당일 아침을 더하면 다음 날 9시
  todos.update(b.id, { due: '2026-10-21', reminds: [EVE, SAME_MORNING] }, now);
  todos.complete(b.id, now);
  assert.equal(todos.dueReminders(at('2026-10-20', 20)).length, 0);
  // 반복 할 일: 다음 회차도 같은 알림과 마감 시각
  const r = todos.add(
    { title: '주간 보고', due: '2026-10-19', repeat: 'weekly', dueMin: 17 * 60, reminds: [60] },
    now,
  );
  todos.complete(r.id, at('2026-10-19', 12));
  const next = todos.list(at('2026-10-19', 12)).open.find((x) => x.title === '주간 보고');
  assert.equal(next?.due, '2026-10-26');
  assert.equal(next?.dueMin, 17 * 60);
  assert.deepEqual(next?.reminds, [60]);
  assert.equal(todos.dueReminders(at('2026-10-26', 16)).length, 1);
  // 지운 할 일과 마감 지난 할 일은 없음
  const c = todos.add({ title: '지울 일', due: '2026-10-30' }, now);
  todos.remove(c.id, now);
  assert.equal(todos.dueReminders(at('2026-10-29', 20)).length, 0);
});

test('할 일 마감 시각: 넣고 빼면 알림도 그쪽 기본으로, 마감일을 지우면 시각도', () => {
  const { todos } = fresh();
  const now = at('2026-10-19', 10);
  const a = todos.add({ title: '보고서', due: '2026-10-22' }, now);
  const timed = todos.update(a.id, { dueMin: 15 * 60 }, now);
  assert.equal(timed?.dueMin, 15 * 60);
  assert.deepEqual(timed?.reminds, [DAY_MIN, 60]);
  assert.equal(todos.dueReminders(at('2026-10-21', 15)).length, 1);
  const back = todos.update(a.id, { dueMin: null }, now);
  assert.deepEqual(back?.reminds, [EVE]);
  const none = todos.update(a.id, { due: null, dueMin: 600 }, now);
  assert.equal(none?.due, null);
  assert.equal(none?.dueMin, null);
  // 마감일 없이 시각만은 받지 않는다
  assert.equal(todos.add({ title: 'x', dueMin: 600 }, now).dueMin, null);
});
