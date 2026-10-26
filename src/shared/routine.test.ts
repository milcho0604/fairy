import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plusDays } from './day.ts';
import { setLang, t } from './i18n/index.ts';
import { sulkLevel } from './pet-life.ts';
import {
  bodyClock,
  coversBriefing,
  coversReview,
  DEFAULT_ROUTINE,
  dayBounds,
  dueUntil,
  EMPTY_MEMO,
  type MeetTime,
  meetCoins,
  nextMeet,
  nextStreak,
  parseMemo,
  parseRoutine,
  type Routine,
  type RoutineMemo,
  restDaysOf,
  routineDue,
  routineTurns,
  weeklyCoins,
} from './routine.ts';
import {
  type FarewellInput,
  farewellNext,
  farewellText,
  greetText,
  restText,
  variant,
  weekdayName,
} from './routine-text.ts';
import { applyPatch, DEFAULT_SETTINGS, parseSettings } from './settings.ts';

// 2026-10-05 월요일 ~ 2026-10-11 일요일
const MON = '2026-10-05';
const TUE = '2026-10-06';
const FRI = '2026-10-09';
const SAT = '2026-10-10';
const SUN = '2026-10-11';
const NEXT_MON = '2026-10-12';
const H = (h: number, m = 0) => h * 60 + m;
const weekdays = (m: MeetTime): Routine => ({ on: true, week: [null, m, m, m, m, m, null] });
const NINE = weekdays({ start: H(9), end: H(18) });
const memo = (o: Partial<RoutineMemo> = {}): RoutineMemo => ({ ...EMPTY_MEMO, ...o });

test('설정 읽기: 기본은 꺼짐, 틀린 요일은 기본값, 시작과 끝이 같으면 쓸 수 없다', () => {
  assert.equal(DEFAULT_SETTINGS.routine.on, false);
  assert.deepEqual(parseRoutine(undefined), DEFAULT_ROUTINE);
  const r = parseRoutine({
    on: true,
    week: [null, { start: 600, end: 600 }, { start: -1, end: 30 }, { start: 1320, end: 360 }, 'x'],
  });
  assert.equal(r.on, true);
  assert.equal(r.week.length, 7);
  assert.equal(r.week[0], null);
  assert.deepEqual(r.week[1], DEFAULT_ROUTINE.week[1]);
  assert.deepEqual(r.week[2], DEFAULT_ROUTINE.week[2]);
  assert.deepEqual(r.week[3], { start: 1320, end: 360 });
  assert.deepEqual(r.week[4], DEFAULT_ROUTINE.week[4]);
  assert.equal(r.week[6], null);
  // 설정 바꾸기로 통째로 바꾸고, 엉터리 값이면 지금 값을 둔다
  const on = applyPatch(DEFAULT_SETTINGS, { routine: NINE });
  assert.deepEqual(on.routine, NINE);
  assert.deepEqual(applyPatch(on, { routine: 'off' }).routine, NINE);
  assert.deepEqual(parseSettings({ routine: { on: true } }).routine.week, DEFAULT_ROUTINE.week);
});

test('맞이: 일찍, 딱 맞춰, 늦게. 4시간 전부터 문을 연다', () => {
  assert.equal(routineDue(NINE, memo(), MON, H(4, 59)), undefined);
  assert.deepEqual(routineDue(NINE, memo(), MON, H(5)), {
    what: 'greet',
    day: MON,
    meet: { start: H(9), end: H(18) },
    clock: H(5),
    arrival: 'early',
  });
  const at = (m: number) => (routineDue(NINE, memo(), MON, m) as { arrival: string }).arrival;
  assert.equal(at(H(8, 49)), 'early');
  assert.equal(at(H(8, 50)), 'onTime');
  assert.equal(at(H(9, 10)), 'onTime');
  assert.equal(at(H(9, 11)), 'late');
  assert.equal(at(H(17, 59)), 'late');
  // 헤어진 뒤 처음 왔으면 맞이도 헤어짐도 없다 (예전 브리핑이 한다)
  assert.equal(routineDue(NINE, memo(), MON, H(18)), undefined);
  assert.equal(coversBriefing(NINE, memo(), MON, H(18)), false);
  assert.equal(coversBriefing(NINE, memo(), MON, H(7)), true);
});

test('맞이를 미뤘으면 처음 자리에 있던 때로 판정한다 (집중 중에 왔다가 끝나고 인사)', () => {
  const m = memo({ arrival: { day: MON, clock: H(8) } });
  const due = routineDue(NINE, m, MON, H(9, 40));
  assert.equal(due?.what, 'greet');
  assert.equal((due as { arrival: string }).arrival, 'early');
  // 다른 날 기록은 쓰지 않는다
  const old = routineDue(NINE, memo({ arrival: { day: '2026-10-02', clock: H(8) } }), MON, H(9, 40));
  assert.equal((old as { arrival: string }).arrival, 'late');
});

test('하루 한 번: 맞이, 시작 한마디, 헤어짐, 쉬는 날 한마디', () => {
  const met = memo({ greeted: MON, arrival: { day: MON, clock: H(8) } });
  // 앱을 다시 켜도 같은 날 다시 맞이하지 않는다
  assert.equal(routineDue(NINE, met, MON, H(8, 30)), undefined);
  // 일찍 왔으면 만나는 시간에 한마디 (30분 안에서만)
  assert.deepEqual(routineDue(NINE, met, MON, H(9)), {
    what: 'cue',
    day: MON,
    meet: { start: H(9), end: H(18) },
  });
  assert.equal(routineDue(NINE, met, MON, H(9, 30)), undefined);
  assert.equal(routineDue(NINE, { ...met, cued: MON }, MON, H(9, 5)), undefined);
  // 딱 맞춰 왔으면 한마디 없다
  assert.equal(
    routineDue(NINE, memo({ greeted: MON, arrival: { day: MON, clock: H(9) } }), MON, H(9, 5)),
    undefined,
  );
  // 헤어짐: 18시부터 그날 자정 전까지, 한 번
  assert.equal(routineDue(NINE, met, MON, H(17, 59))?.what, undefined);
  assert.equal(routineDue(NINE, met, MON, H(18))?.what, 'farewell');
  assert.equal(routineDue(NINE, met, MON, H(23, 59))?.what, 'farewell');
  assert.equal(routineDue(NINE, { ...met, farewelled: MON }, MON, H(19)), undefined);
  // 다음 날 아침에는 어제 헤어짐을 꺼내지 않고 오늘 맞이
  assert.equal(routineDue(NINE, met, TUE, H(7))?.what, 'greet');
  // 맞이하지 않은 날은 헤어지지도 않는다
  assert.equal(routineDue(NINE, memo(), MON, H(19)), undefined);
  // 쉬는 날: 5시부터 한 번
  assert.equal(routineDue(NINE, memo(), SAT, H(4, 59)), undefined);
  assert.deepEqual(routineDue(NINE, memo(), SAT, H(10)), { what: 'rest', day: SAT });
  assert.equal(routineDue(NINE, memo({ restSaid: SAT }), SAT, H(10)), undefined);
  assert.equal(coversBriefing(NINE, memo(), SAT, H(10)), true);
  // 꺼져 있으면 아무것도
  assert.equal(routineDue({ ...NINE, on: false }, memo(), MON, H(9)), undefined);
  assert.equal(coversBriefing({ ...NINE, on: false }, memo(), MON, H(9)), false);
});

test('밤 근무: 22시에 만나 다음 날 6시에 헤어진다. 일과는 시작한 날 것', () => {
  const night: Routine = weekdays({ start: H(22), end: H(6) });
  assert.deepEqual(dayBounds(night, MON), { start: H(22), end: H(30) });
  assert.equal(routineDue(night, memo(), MON, H(17, 59)), undefined);
  const g = routineDue(night, memo(), MON, H(21, 55));
  assert.equal(g?.what, 'greet');
  assert.equal((g as { arrival: string }).arrival, 'onTime');
  // 자정 넘어 처음 왔어도 월요일 일과의 맞이 (늦게)
  const late = routineDue(night, memo(), TUE, H(1));
  assert.deepEqual(late && { what: late.what, day: late.day }, { what: 'greet', day: MON });
  const met = memo({ greeted: MON });
  assert.equal(routineDue(night, met, TUE, H(5, 59)), undefined);
  assert.deepEqual(routineDue(night, met, TUE, H(6)), {
    what: 'farewell',
    day: MON,
    meet: { start: H(22), end: H(6) },
  });
  // 금요일 밤 근무가 토요일 아침까지: 끝나기 전에는 쉬는 날 한마디를 하지 않는다
  const fri = memo({ greeted: FRI });
  assert.equal(routineDue(night, fri, SAT, H(5)), undefined);
  assert.equal(routineDue(night, fri, SAT, H(6))?.what, 'farewell');
  // 쉬는 날 한마디는 헤어지는 인사를 기다리는 때(6시 + 4시간)가 지나서
  assert.equal(routineDue(night, { ...fri, farewelled: FRI }, SAT, H(9, 59)), undefined);
  assert.equal(routineDue(night, { ...fri, farewelled: FRI }, SAT, H(10))?.what, 'rest');
});

test('늦게까지 일하는 날: 어제 헤어짐을 기다리는 동안 오늘 맞이를 일찍 하지 않는다', () => {
  // 4시에 만나 23시에 헤어짐. 자정 넘어 1시에 아직 일하면 어제 헤어짐, 오늘 "일찍 왔네"가 아니다
  const r = weekdays({ start: H(4), end: H(23) });
  assert.equal(routineDue(r, memo({ greeted: MON }), TUE, H(1))?.what, 'farewell');
  assert.equal(routineDue(r, memo({ greeted: MON, farewelled: MON }), TUE, H(1)), undefined);
  assert.equal(routineDue(r, memo({ greeted: MON, farewelled: MON }), TUE, H(3))?.what, 'greet');
});

test('밤 근무 다음 날 낮 일과: 어제 헤어졌으면 오늘 맞이가 낮 12시까지 밀리지 않는다', () => {
  // 월 20시~화 8시 밤 근무, 화 9시~17시
  const r: Routine = {
    on: true,
    week: [null, { start: H(20), end: H(8) }, { start: H(9), end: H(17) }, null, null, null, null],
  };
  const done = memo({ greeted: MON, farewelled: MON });
  // 헤어진 뒤 만나는 시간 전에는 "일찍 왔네"로 맞지 않는다 (막 일을 끝낸 참이다)
  assert.equal(routineDue(r, done, TUE, H(8, 30)), undefined);
  const g = routineDue(r, done, TUE, H(9));
  assert.deepEqual(g && { what: g.what, day: g.day }, { what: 'greet', day: TUE });
  assert.equal((g as { arrival: string }).arrival, 'onTime');
  const g2 = routineDue(r, done, TUE, H(10));
  assert.deepEqual(g2 && { what: g2.what, day: g2.day }, { what: 'greet', day: TUE });
  // 아직 안 헤어졌으면 헤어짐이 먼저, 어제 만나지 않았으면 기다릴 헤어짐이 없다
  assert.equal(routineDue(r, memo({ greeted: MON }), TUE, H(9))?.what, 'farewell');
  assert.equal(routineDue(r, memo(), TUE, H(10))?.what, 'greet');
});

test('연속 기록: 쉬는 날은 건너뛰고, 만나는 날을 놓치면 1 부터, 같은 날과 시계 되돌림은 새로 세지 않는다', () => {
  assert.deepEqual(nextStreak(NINE, undefined, MON), { day: MON, n: 1, fresh: true });
  assert.deepEqual(nextStreak(NINE, { day: MON, n: 1 }, TUE), { day: TUE, n: 2, fresh: true });
  assert.deepEqual(nextStreak(NINE, { day: FRI, n: 5 }, NEXT_MON), { day: NEXT_MON, n: 6, fresh: true });
  // 화요일을 건너뛰고 수요일
  assert.equal(nextStreak(NINE, { day: MON, n: 4 }, '2026-10-07').n, 1);
  assert.deepEqual(nextStreak(NINE, { day: TUE, n: 3 }, TUE), { day: TUE, n: 3, fresh: false });
  assert.equal(nextStreak(NINE, { day: TUE, n: 3 }, MON).fresh, false);
  // 만나는 날이 하나도 없으면 늘 1
  assert.equal(
    nextStreak({ on: true, week: [null, null, null, null, null, null, null] }, { day: MON, n: 2 }, TUE).n,
    1,
  );
});

test('만난 날 코인은 하루 한 번 10, 7일 연속마다 +50 (#75)', () => {
  assert.equal(meetCoins({ n: 1, fresh: true }, 0), 10);
  // 5일 보너스는 없앴다
  assert.equal(meetCoins({ n: 5, fresh: true }, 0), 10);
  assert.equal(meetCoins({ n: 6, fresh: true }, 0), 10);
  assert.equal(meetCoins({ n: 7, fresh: true }, 0), 60);
  assert.equal(meetCoins({ n: 8, fresh: true }, 0), 10);
  assert.equal(meetCoins({ n: 10, fresh: true }, 0), 10);
  assert.equal(meetCoins({ n: 14, fresh: true }, 0), 60);
  // 오늘 이미 받았다 (껐다 켜기, 요일 바꾸기, 시계 돌리기)
  assert.equal(meetCoins({ n: 7, fresh: true }, 1), 0);
  assert.equal(meetCoins({ n: 2, fresh: false }, 0), 0);
  // 평일만 만나는 한 주 내내 하루 세 번씩 맞이해도 상한: 10*5 = 50
  let streak: RoutineMemo['streak'];
  let total = 0;
  for (const day of [MON, TUE, '2026-10-07', '2026-10-08', FRI]) {
    for (let again = 0; again < 3; again++) {
      const s = nextStreak(NINE, streak, day);
      total += meetCoins(s, again);
      streak = { day: s.day, n: s.n };
    }
  }
  assert.equal(total, 50);
  // 매일 만나면 7일째 보너스: 10*6 + 60 = 120
  const daily = { on: true, week: Array.from({ length: 7 }, () => ({ start: H(9), end: H(18) })) };
  streak = undefined;
  total = 0;
  for (let i = 0; i < 7; i++) {
    const s = nextStreak(daily, streak, plusDays(MON, i));
    total += meetCoins(s, 0);
    streak = { day: s.day, n: s.n };
  }
  assert.equal(streak?.n, 7);
  assert.equal(total, 120);
});

test('매주 선물 50은 그 주 출석이 있고 이번 주 기록이 없을 때만 (#75)', () => {
  assert.equal(weeklyCoins(10, 0), 50);
  assert.equal(weeklyCoins(60, 0), 50);
  // 이번 주에 이미 받았다
  assert.equal(weeklyCoins(10, 1), 0);
  // 오늘 출석 코인을 못 받았으면(같은 날 두 번째 맞이) 선물도 없다
  assert.equal(weeklyCoins(0, 0), 0);
});

test('회고와 마감 알림: 만난 날은 헤어짐이 회고를 맡고, 마감 알림은 헤어지는 시간까지', () => {
  assert.equal(coversReview(NINE, memo({ greeted: MON }), MON), true);
  assert.equal(coversReview(NINE, memo(), MON), false);
  assert.equal(coversReview(NINE, memo({ greeted: FRI }), SAT), false);
  assert.equal(dueUntil(weekdays({ start: H(10), end: H(19) }), MON, H(18)), H(19));
  assert.equal(dueUntil(NINE, SAT, H(18)), H(18));
  assert.equal(dueUntil(weekdays({ start: H(22), end: H(6) }), MON, H(18)), H(18));
});

test('다음 만나는 날', () => {
  assert.equal(nextMeet(NINE, MON)?.day, TUE);
  assert.deepEqual(
    nextMeet(NINE, FRI) && { day: nextMeet(NINE, FRI)?.day, inDays: nextMeet(NINE, FRI)?.inDays },
    {
      day: NEXT_MON,
      inDays: 3,
    },
  );
  assert.equal(nextMeet({ on: true, week: [null, null, null, null, null, null, null] }, MON), undefined);
});

test('몸 시계(기운용): 만나는 시간이 9시가 되게 옮긴다', () => {
  assert.equal(bodyClock({ ...NINE, on: false }, MON, H(7)), H(7));
  assert.equal(bodyClock(NINE, MON, H(9)), H(9));
  const late = weekdays({ start: H(13), end: H(22) });
  assert.equal(bodyClock(late, MON, H(13)), H(9));
  assert.equal(bodyClock(late, MON, H(2)), H(22));
  // 쉬는 날은 지난 만나는 날 시간으로 (주말에 갑자기 튀지 않게)
  assert.equal(bodyClock(late, SAT, H(13)), H(9));
  assert.equal(bodyClock(late, SUN, H(13)), H(9));
  // 밤 근무: 일하는 새벽 3시는 낮 14시처럼
  const night = weekdays({ start: H(22), end: H(6) });
  assert.equal(bodyClock(night, TUE, H(3)), H(14));
  assert.equal(bodyClock(night, MON, H(22)), H(9));
});

test('기록 읽기: 틀린 값은 버린다', () => {
  assert.deepEqual(parseMemo('x'), EMPTY_MEMO);
  const m = parseMemo({
    greeted: MON,
    farewelled: 'yesterday',
    restSaid: 3,
    cued: SAT,
    arrival: { day: MON, clock: 9999 },
    streak: { day: MON, n: 4 },
  });
  assert.deepEqual(m, { greeted: MON, farewelled: '', restSaid: '', cued: SAT, streak: { day: MON, n: 4 } });
});

test('말: 맞이, 헤어짐, 쉬는 날 (한국어, 영어)', () => {
  setLang('ko');
  const base = {
    day: MON,
    first: false,
    streak: 1,
    coins: 10,
    briefing: '오늘 일정은 오전 10:00 회의 하나야.',
    quiet: false,
  };
  const early = greetText({ ...base, arrival: 'early' });
  assert.match(early, /일찍|벌써/);
  assert.match(early, /만난 기념 코인 10개!/);
  assert.match(early, /오전 10:00 회의/);
  assert.match(greetText({ ...base, arrival: 'late', streak: 3 }), /3일째 만나는 중!/);
  assert.match(
    greetText({ ...base, arrival: 'onTime', streak: 7, coins: 60 }),
    /7일 연속 만난 기념으로 코인 60개!/,
  );
  // 매주 선물은 만난 날 코인 뒤, 브리핑 앞에 한 문장
  assert.match(
    greetText({ ...base, arrival: 'late', weekly: 50 }),
    /만난 기념 코인 10개! 이번 주 첫 만남 선물로 코인 50개 더! 오늘 일정은/,
  );
  assert.equal(greetText({ ...base, arrival: 'late', weekly: 0 }).includes('선물'), false);
  assert.equal(greetText({ ...base, arrival: 'late', weekly: 50, quiet: true }).includes('선물'), false);
  assert.equal(greetText({ ...base, arrival: 'late', quiet: true }).includes('코인'), false);
  assert.equal(
    greetText({ ...base, arrival: 'early', first: true }),
    `${t('routine.hi.first')} 만난 기념 코인 10개! ${base.briefing}`,
  );
  // 같은 날은 같은 말, 날마다 바뀔 수 있다
  assert.equal(variant(MON, 6), variant(MON, 6));
  assert.ok(new Set([MON, TUE, '2026-10-07', '2026-10-08', FRI].map((d) => variant(d, 3))).size > 1);

  const fri = farewellText({
    day: FRI,
    doneTitles: ['보고서'],
    next: { inDays: 3, day: NEXT_MON, meet: { start: H(9), end: H(18) } },
    tomorrow: [],
    leftToday: 0,
    quiet: false,
  });
  assert.equal(fri, '"보고서" 끝내느라 수고했어! 푹 쉬고 월요일에 만나!');
  const monIn = {
    day: MON,
    doneTitles: ['a', 'b'],
    next: { inDays: 1, day: TUE, meet: { start: H(9), end: H(18) } },
    tomorrow: [
      { minute: 0, title: '엄마 생일', allDay: true },
      { minute: H(10), title: '스탠드업' },
    ],
    leftToday: 2,
    quiet: false,
  };
  // 남은 마감을 물으면 미리 보기는 빼고(답을 누른 뒤 farewellNext 로), 두 문장
  assert.equal(farewellText(monIn), '할 일 2개나 끝냈네, 수고했어! 오늘 마감 2개가 남았는데 내일로 넘길까?');
  assert.equal(farewellNext(monIn), '내일은 오전 10:00 스탠드업부터야.');
  assert.equal(
    farewellText({ ...monIn, leftToday: 0 }),
    '할 일 2개나 끝냈네, 수고했어! 내일은 오전 10:00 스탠드업부터야.',
  );
  assert.match(
    farewellText({
      day: MON,
      doneTitles: [],
      next: { inDays: 1, day: TUE, meet: { start: H(9), end: H(18) } },
      tomorrow: [],
      leftToday: 0,
      quiet: false,
    }),
    /^오늘.+! 내일 오전 9:00에 또 만나!$/,
  );
  assert.equal(farewellNext({ tomorrow: [] }), '푹 쉬어!');
  assert.equal(
    farewellNext({ ...monIn, tomorrow: [{ minute: 0, title: '엄마 생일', allDay: true }] }),
    '내일은 종일 엄마 생일.',
  );
  // 조용히: 끝낸 일과 미리 보기 없이, 남은 마감 질문은 남긴다
  const q = farewellText({ day: MON, doneTitles: ['a'], tomorrow: [], leftToday: 1, quiet: true });
  assert.equal(q.includes('"a"'), false);
  assert.match(q, /내일로 넘길까/);
  assert.equal(
    farewellText({ ...monIn, leftToday: 0, quiet: true }),
    t('routine.bye.head', { i: variant(MON, 6) }),
  );
  assert.match(restText(SAT, ''), /쉬는 날/);
  assert.equal(t('routine.set.on', { name: '콩이' }), '콩이와 만나는 시간 정하기');
  assert.equal(t('routine.onb.title'), '일 시작과 마치는 시간');

  setLang('en');
  assert.match(greetText({ ...base, briefing: '', arrival: 'late' }), /\+10 coins for showing up!$/);
  assert.match(
    greetText({ ...base, briefing: '', arrival: 'late', weekly: 50 }),
    /\+10 coins for showing up! First visit this week, so here's a \+50 coin gift!$/,
  );
  assert.equal(weekdayName(NEXT_MON), 'Monday');
  assert.match(
    farewellText({
      day: FRI,
      doneTitles: [],
      next: { inDays: 3, day: NEXT_MON, meet: { start: H(9), end: H(18) } },
      tomorrow: [],
      leftToday: 0,
      quiet: false,
    }),
    /! Rest well, see you on Monday!$/,
  );
  assert.equal(t('routine.set.on', { name: 'Milk' }), 'Set a meeting time with Milk');
  setLang('ko');
});

test('쉬는 날 하나로: 만나는 시간을 켜면 만나지 않는 요일이 삐짐 쉬는 날, 끄면 설정의 쉬는 날 그대로', () => {
  // 예전 설정 파일 (만나는 시간 칸이 없고 쉬는 날은 월요일만): 꺼져 있으니 예전 그대로
  const old = parseSettings({ restDays: [1], spicy: true });
  assert.equal(old.routine.on, false);
  assert.deepEqual(restDaysOf(old), [1]);
  // 만나는 시간을 켜면(기본 평일) 토, 일이 쉬는 날. 저장된 restDays 는 지우지 않는다
  const on = applyPatch(old, { routine: { ...old.routine, on: true } });
  assert.deepEqual(restDaysOf(on), [0, 6]);
  assert.deepEqual(on.restDays, [1]);
  // 화~토 만나는 사람: 일, 월이 쉬는 날
  const m = { start: H(10), end: H(19) };
  const tueSat = applyPatch(on, { routine: { on: true, week: [null, null, m, m, m, m, m] } });
  assert.deepEqual(restDaysOf(tueSat), [0, 1]);
  // 끄면 예전에 고른 쉬는 날로 돌아간다
  assert.deepEqual(restDaysOf(applyPatch(tueSat, { routine: { ...tueSat.routine, on: false } })), [1]);
  // 매일 만나면 쉬는 날이 없고, 하루도 안 고르면 매일 쉬는 날
  assert.deepEqual(restDaysOf({ restDays: [0, 6], routine: { on: true, week: Array(7).fill(m) } }), []);
  assert.deepEqual(
    restDaysOf({ restDays: [], routine: { on: true, week: Array(7).fill(null) } }),
    [0, 1, 2, 3, 4, 5, 6],
  );
  // 삐짐 칸: 토요일에 쓰고 다음 화요일에 온 화~토 사람은 일, 월이 쉬는 날이라 0칸.
  // 예전 쉬는 날(월요일만)을 그대로 썼으면 일요일 한 칸이 찼다
  const NEXT_TUE = '2026-10-13';
  assert.equal(sulkLevel(SAT, NEXT_TUE, restDaysOf(tueSat), true), 0);
  assert.equal(sulkLevel(SAT, NEXT_TUE, tueSat.restDays, true), 1);
  // 꺼져 있으면 예전처럼 restDays 로 센다
  assert.equal(sulkLevel(SAT, NEXT_TUE, restDaysOf(old), true), 1);
});

test('헤어짐 말풍선 길이: 어떤 경우든 두 문장, 긴 제목도 줄여서 한국어 60자, 영어 100자 안', () => {
  const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  const long = '분기 보고서 최종본 검토하고 팀장님께 메일로 보내기';
  const meet = { start: H(9), end: H(18) };
  const cases: FarewellInput[] = [];
  for (const doneTitles of [[], [long], ['a', 'b', 'c']])
    for (const next of [undefined, { inDays: 1, day: TUE, meet }, { inDays: 3, day: NEXT_MON, meet }])
      for (const tomorrow of [
        [],
        [{ minute: H(10), title: long }],
        [
          { minute: 0, title: long, allDay: true },
          { minute: 0, title: long, allDay: true },
        ],
      ])
        for (const leftToday of [0, 3])
          for (const quiet of [false, true])
            cases.push({ day: FRI, doneTitles, ...(next ? { next } : {}), tomorrow, leftToday, quiet });
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    const max = lang === 'ko' ? 60 : 100;
    for (const c of cases) {
      for (const text of [farewellText(c), farewellNext(c)]) {
        assert.ok(sentences(text) <= 2, `${lang} 문장 ${sentences(text)}: ${text}`);
        assert.ok(text.length <= max, `${lang} ${text.length}자: ${text}`);
      }
      // 질문이 있을 때 답 뒤 한마디(넘겼어 + 미리 보기)도 두 문장
      if (c.leftToday > 0) {
        const after = `${t('panel.review.moved', { n: 3 })} ${farewellNext(c)}`;
        assert.ok(sentences(after) <= 2, after);
      }
    }
  }
  setLang('ko');
  // 긴 제목은 줄임표로
  const base = cases[0];
  assert.ok(base);
  assert.match(farewellText({ ...base, quiet: false, leftToday: 0, doneTitles: [long] }), /…" 끝내느라/);
});

test('routineTurns: 문턱 사이에서는 routineDue, coversBriefing, dueUntil 이 분마다 같다 (플래너가 문턱에만 깬다)', () => {
  const routines: Routine[] = [
    NINE,
    weekdays({ start: H(6), end: H(14, 30) }),
    // 밤 근무 (끝이 다음 날)
    weekdays({ start: H(22), end: H(6) }),
    {
      on: true,
      week: [null, null, { start: H(2), end: H(3) }, null, { start: H(23, 50), end: H(23, 55) }, null, null],
    },
    { on: false, week: [null, NINE.week[1] ?? null, null, null, null, null, null] },
  ];
  const memos = [
    memo(),
    memo({ greeted: MON }),
    memo({ greeted: TUE, arrival: { day: TUE, clock: H(7) } }),
    memo({ greeted: MON, farewelled: MON }),
    memo({ restSaid: SAT, greeted: FRI }),
  ];
  for (const r of routines)
    for (const day of [MON, TUE, FRI, SAT, SUN, NEXT_MON])
      for (const m of memos) {
        const turns = new Set(routineTurns(r, day).map((v) => Math.round(v)));
        // 할 일이 생기고 없어지는 때만 본다 (맞이의 지금 분, 일찍 왔는지는 깨서 말할 때 그 분으로 센다)
        const at = (minute: number) => {
          const due = routineDue(r, m, day, minute);
          return JSON.stringify([
            due?.what,
            due?.day,
            coversBriefing(r, m, day, minute),
            dueUntil(r, day, H(21)),
          ]);
        };
        let prev = at(0);
        for (let minute = 1; minute < 24 * 60; minute++) {
          const now = at(minute);
          if (now !== prev)
            assert.ok(
              turns.has(minute),
              `${day} ${minute}분에 바뀌었는데 문턱이 아니다 (${[...turns].join(',')}) ${prev} → ${now}`,
            );
          prev = now;
        }
      }
});
