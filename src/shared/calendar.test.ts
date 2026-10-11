// 달력 보기 (일정 탭). 날짜 칸 나누기, 키보드 이동, 반복 회차, 공휴일, 시간대, 많은 일정.
// 시간대 시험은 process.env.TZ 를 바꿔 가며 본다 (node 는 TZ 를 바꾸면 바로 따른다). 끝나면 되돌린다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CalItem,
  calendarDays,
  compareItems,
  eventSpan,
  fitItems,
  holidaysBetween,
  koreanHolidays,
  monthWeeks,
  moveDay,
  repeatDays,
  weekdayOrder,
  weekFirst,
  weekOf,
} from './calendar.ts';
import { plusDays } from './day.ts';
import { type CalEvent, dayStartMs, parseEventInput } from './event-store.ts';
import type { Todo } from './todo-store.ts';

const ORIGINAL_TZ = process.env.TZ;
/** 이 시간대로 바꿔 fn 을 돌리고 되돌린다 */
function inTz<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}

/** 현지 시각 ms */
const at = (day: string, h: number, m = 0) => dayStartMs(day) + (h * 60 + m) * 60_000;

let nextId = 1;
function ev(p: Partial<CalEvent> & Pick<CalEvent, 'startAt'>): CalEvent {
  return {
    id: nextId++,
    title: 'e',
    endAt: null,
    reminds: [],
    remindMin: 0,
    notifiedAt: null,
    source: 'local',
    allDay: false,
    ...p,
  };
}
function todo(p: Partial<Todo>): Todo {
  return {
    id: nextId++,
    title: 't',
    due: null,
    important: false,
    createdAt: 0,
    doneAt: null,
    coins: 0,
    repeat: null,
    dueMin: null,
    reminds: [],
    steps: [],
    ...p,
  };
}
const days = (m: Map<string, CalItem[]>) => [...m.keys()].sort();

// ---- 칸 만들기 ----

test('달 칸: 주 시작 요일에 따라 4~6주, 주마다 7일이 이어지고 첫 주에 1일이 든다', () => {
  // 2026-02-01 은 일요일, 평년 28일: 일요일 시작이면 딱 4주, 월요일 시작이면 5주
  assert.equal(monthWeeks('2026-02', 0).length, 4);
  assert.equal(monthWeeks('2026-02', 1).length, 5);
  // 2028 윤년 2월(1일 화요일, 29일)
  const leap = monthWeeks('2028-02', 0);
  assert.equal(leap.length, 5);
  assert.ok(leap.flat().includes('2028-02-29'));
  // 2026-08-01 토요일, 31일: 일요일 시작이면 6주
  assert.equal(monthWeeks('2026-08', 0).length, 6);
  assert.equal(monthWeeks('2026-08', 1).length, 6);
  for (const ws of [0, 1] as const)
    for (const month of ['2026-01', '2026-02', '2026-08', '2026-12', '2028-02']) {
      const weeks = monthWeeks(month, ws);
      const flat = weeks.flat();
      assert.ok(weeks.every((w) => w.length === 7));
      for (let i = 1; i < flat.length; i++) assert.equal(flat[i], plusDays(flat[i - 1] as string, 1));
      assert.ok(weeks[0]?.includes(`${month}-01`), `${month} ${ws}`);
      assert.equal(new Date(`${flat[0]}T00:00Z`).getUTCDay(), ws);
    }
});

test('주 시작: 일요일 시작과 월요일 시작, 요일 머리 줄', () => {
  // 2026-10-11 일요일
  assert.equal(weekFirst('2026-10-11', 0), '2026-10-11');
  assert.equal(weekFirst('2026-10-11', 1), '2026-10-05');
  assert.equal(weekFirst('2026-10-12', 1), '2026-10-12');
  assert.deepEqual(weekOf('2026-10-14', 1), [
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
  ]);
  // 해를 넘는 주
  assert.equal(weekFirst('2027-01-01', 0), '2026-12-27');
  assert.deepEqual(weekdayOrder(0), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(weekdayOrder(1), [1, 2, 3, 4, 5, 6, 0]);
});

test('키보드 이동: 화살표 하루, 한 주, Home, End, PageUp, PageDown 은 없는 날이면 말일', () => {
  assert.equal(moveDay('2026-10-15', 'ArrowLeft', 0), '2026-10-14');
  assert.equal(moveDay('2026-10-15', 'ArrowRight', 0), '2026-10-16');
  assert.equal(moveDay('2026-10-15', 'ArrowUp', 0), '2026-10-08');
  assert.equal(moveDay('2026-10-15', 'ArrowDown', 0), '2026-10-22');
  assert.equal(moveDay('2026-12-31', 'ArrowRight', 0), '2027-01-01');
  assert.equal(moveDay('2026-03-01', 'ArrowLeft', 0), '2026-02-28');
  assert.equal(moveDay('2028-03-01', 'ArrowLeft', 0), '2028-02-29');
  // 2026-10-15 목요일
  assert.equal(moveDay('2026-10-15', 'Home', 0), '2026-10-11');
  assert.equal(moveDay('2026-10-15', 'End', 0), '2026-10-17');
  assert.equal(moveDay('2026-10-15', 'Home', 1), '2026-10-12');
  assert.equal(moveDay('2026-10-15', 'End', 1), '2026-10-18');
  // 31일이 없는 달
  assert.equal(moveDay('2026-01-31', 'PageDown', 0), '2026-02-28');
  assert.equal(moveDay('2028-01-31', 'PageDown', 0), '2028-02-29');
  assert.equal(moveDay('2026-03-31', 'PageUp', 0), '2026-02-28');
  assert.equal(moveDay('2026-05-31', 'PageDown', 0), '2026-06-30');
  assert.equal(moveDay('2026-12-15', 'PageDown', 0), '2027-01-15');
  assert.equal(moveDay('2026-10-15', 'a', 0), undefined);
  assert.equal(moveDay('2026-10-15', 'Enter', 0), undefined);
});

// ---- 일정 나누기 ----

test('시각 일정: 자정을 넘으면 이틀, 자정에 딱 끝나면 하루, 끝이 없거나 거꾸로면 하루', () => {
  const night = ev({ startAt: at('2026-10-15', 23), endAt: at('2026-10-16', 1) });
  assert.deepEqual(eventSpan(night), { first: '2026-10-15', last: '2026-10-16' });
  const midnight = ev({ startAt: at('2026-10-15', 22), endAt: at('2026-10-16', 0) });
  assert.deepEqual(eventSpan(midnight), { first: '2026-10-15', last: '2026-10-15' });
  assert.deepEqual(eventSpan(ev({ startAt: at('2026-10-15', 9) })), {
    first: '2026-10-15',
    last: '2026-10-15',
  });
  const backwards = ev({ startAt: at('2026-10-15', 9), endAt: at('2026-10-14', 9) });
  assert.deepEqual(eventSpan(backwards), { first: '2026-10-15', last: '2026-10-15' });

  const m = calendarDays([night], [], '2026-10-11', '2026-10-24', '2026-10-12');
  assert.deepEqual(days(m), ['2026-10-15', '2026-10-16']);
  const [a] = m.get('2026-10-15') ?? [];
  const [b] = m.get('2026-10-16') ?? [];
  assert.equal(a?.part, 'first');
  assert.equal(a?.minute, 23 * 60);
  // 이어지는 날은 시각이 없다 (0시부터 이어짐)
  assert.equal(b?.part, 'last');
  assert.equal(b?.minute, null);
});

test('종일 일정: 하루짜리, 여러 날 (끝 날은 들지 않는다), 달력 앞에서 시작한 것은 첫 칸부터 가운데로', () => {
  const one = ev({ startAt: dayStartMs('2026-10-09'), allDay: true });
  // 10/30~11/2 여행 (저장은 11/3 0시 끝)
  const trip = ev({
    startAt: dayStartMs('2026-10-30'),
    endAt: dayStartMs('2026-11-03'),
    allDay: true,
    title: '여행',
  });
  const oct = calendarDays([one, trip], [], '2026-09-27', '2026-10-31', '2026-10-12');
  assert.deepEqual(days(oct), ['2026-10-09', '2026-10-30', '2026-10-31']);
  assert.equal(oct.get('2026-10-09')?.[0]?.part, 'one');
  assert.equal(oct.get('2026-10-30')?.[0]?.part, 'first');
  assert.equal(oct.get('2026-10-31')?.[0]?.part, 'middle');
  // 11월 달력 (일요일 시작이면 11/1 부터): 앞에서 시작한 여행이 11/1 가운데, 11/2 마지막
  const nov = calendarDays([trip], [], '2026-11-01', '2026-12-05', '2026-10-12');
  assert.deepEqual(days(nov), ['2026-11-01', '2026-11-02']);
  assert.equal(nov.get('2026-11-01')?.[0]?.part, 'middle');
  assert.equal(nov.get('2026-11-02')?.[0]?.part, 'last');
  assert.ok(nov.get('2026-11-01')?.every((i) => i.allDay && i.minute === null));
});

test('달력 밖 일정은 빠지고, 가져온 일정은 ics, 알림이 있으면 remind', () => {
  const before = ev({ startAt: at('2026-09-01', 9) });
  const after = ev({ startAt: at('2026-12-01', 9) });
  const ics = ev({ startAt: at('2026-10-20', 10), source: 'ics', reminds: [10] });
  const m = calendarDays([before, after, ics], [], '2026-09-27', '2026-10-31', '2026-10-12');
  assert.deepEqual(days(m), ['2026-10-20']);
  assert.equal(m.get('2026-10-20')?.[0]?.kind, 'ics');
  assert.equal(m.get('2026-10-20')?.[0]?.remind, true);
});

test('할 일: 마감 있는 안 끝낸 것만, 마감 시각이 있으면 그 시각', () => {
  const list = [
    todo({ due: '2026-10-20', dueMin: 18 * 60, title: '보고서' }),
    todo({ due: null, title: '마감 없음' }),
    todo({ due: '2026-10-20', doneAt: 1, title: '끝냄' }),
    todo({ due: '2026-10-21', reminds: [-540], important: true }),
  ];
  const m = calendarDays([], list, '2026-10-11', '2026-10-24', '2026-10-12');
  assert.deepEqual(days(m), ['2026-10-20', '2026-10-21']);
  assert.equal(m.get('2026-10-20')?.length, 1);
  assert.equal(m.get('2026-10-20')?.[0]?.minute, 18 * 60);
  assert.equal(m.get('2026-10-21')?.[0]?.remind, true);
  assert.equal(m.get('2026-10-21')?.[0]?.important, true);
});

test('칸 안 순서: 이어지는 일정, 종일, 시각 순, 시각 없는 할 일 (중요 먼저)', () => {
  const day = '2026-10-15';
  const items = [
    todo({ due: day, title: '할 일' }),
    todo({ due: day, title: '중요', important: true }),
    todo({ due: day, dueMin: 8 * 60, title: '8시 마감' }),
  ];
  const evs = [
    ev({ startAt: at(day, 14), title: '2시' }),
    ev({ startAt: at(day, 9), title: '9시' }),
    ev({ startAt: dayStartMs(day), allDay: true, title: '종일' }),
    ev({
      startAt: dayStartMs('2026-10-14'),
      endAt: dayStartMs('2026-10-17'),
      allDay: true,
      title: '여러 날',
    }),
  ];
  const got = calendarDays(evs, items, '2026-10-11', '2026-10-24', '2026-10-12')
    .get(day)
    ?.map((i) => i.title);
  assert.deepEqual(got, ['여러 날', '종일', '8시 마감', '9시', '2시', '중요', '할 일']);
  // compareItems 는 대칭
  const a = calendarDays(evs, items, day, day, day).get(day) ?? [];
  for (const x of a)
    for (const y of a) assert.equal(Math.sign(compareItems(x, y)), -Math.sign(compareItems(y, x)) || 0);
});

// ---- 반복 ----

test('매달 반복: 31일은 31일 없는 달에 말일, 윤년 2월 29일, 그다음 달은 다시 31일', () => {
  const t31 = { due: '2026-01-31', repeat: 'monthly' as const };
  assert.deepEqual(repeatDays(t31, '2026-01-20', '2026-01-01', '2026-06-30'), [
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
    '2026-06-30',
  ]);
  assert.deepEqual(
    repeatDays({ due: '2028-01-31', repeat: 'monthly' }, '2028-01-20', '2028-02-01', '2028-03-31'),
    ['2028-02-29', '2028-03-31'],
  );
  // 29일 반복도 평년 2월에는 28일
  assert.deepEqual(
    repeatDays({ due: '2026-01-29', repeat: 'monthly' }, '2026-01-01', '2026-02-01', '2026-02-28'),
    ['2026-02-28'],
  );
});

test('매일, 평일, 매주 반복 회차와 밀린 반복 (지난 회차는 만들지 않는다)', () => {
  // 2026-10-16 금요일
  assert.deepEqual(
    repeatDays({ due: '2026-10-16', repeat: 'weekdays' }, '2026-10-12', '2026-10-11', '2026-10-21'),
    ['2026-10-19', '2026-10-20', '2026-10-21'],
  );
  assert.deepEqual(
    repeatDays({ due: '2026-10-14', repeat: 'weekly' }, '2026-10-12', '2026-10-01', '2026-11-04'),
    ['2026-10-21', '2026-10-28', '2026-11-04'],
  );
  // 10/1 부터 밀린 매일 반복: 끝내면 오늘 다음 날로 가니 10/13 부터
  const late = repeatDays({ due: '2026-10-01', repeat: 'daily' }, '2026-10-12', '2026-09-27', '2026-10-15');
  assert.deepEqual(late, ['2026-10-13', '2026-10-14', '2026-10-15']);
  // 달력에는 지금 회차(10/1, 할 일)와 다음 회차(repeat)가 같이
  const m = calendarDays(
    [],
    [todo({ due: '2026-10-01', repeat: 'daily' })],
    '2026-09-27',
    '2026-10-15',
    '2026-10-12',
  );
  assert.equal(m.get('2026-10-01')?.[0]?.kind, 'todo');
  assert.equal(m.get('2026-10-13')?.[0]?.kind, 'repeat');
  assert.equal(m.get('2026-10-05'), undefined);
  // 다음 달을 볼 때: 달력 앞의 회차는 넣지 않는다
  assert.deepEqual(
    repeatDays({ due: '2026-10-12', repeat: 'daily' }, '2026-10-12', '2026-11-01', '2026-11-03'),
    ['2026-11-01', '2026-11-02', '2026-11-03'],
  );
  // 반복 아님, 마감 없음
  assert.deepEqual(
    repeatDays({ due: '2026-10-01', repeat: null }, '2026-10-12', '2026-10-01', '2026-10-31'),
    [],
  );
  assert.deepEqual(repeatDays({ due: null, repeat: 'daily' }, '2026-10-12', '2026-10-01', '2026-10-31'), []);
});

// ---- 줄 수 ----

test('칸에 다 못 그리면 앞 줄과 +N', () => {
  assert.deepEqual(fitItems([1, 2], 2), { shown: [1, 2], more: 0 });
  assert.deepEqual(fitItems([1, 2, 3], 2), { shown: [1], more: 2 });
  assert.deepEqual(fitItems([1, 2, 3, 4, 5], 4), { shown: [1, 2, 3], more: 2 });
  assert.deepEqual(fitItems([], 2), { shown: [], more: 0 });
});

// ---- 공휴일 ----

test('한국 공휴일: 양력 여덟 날과 설날, 추석 연휴. 겹치면 양력 이름, 해를 넘는 달력', () => {
  const y26 = koreanHolidays(2026);
  for (const d of ['2026-02-16', '2026-02-17', '2026-02-18']) assert.equal(y26.get(d), 'cal.holiday.seollal');
  for (const d of ['2026-09-24', '2026-09-25', '2026-09-26']) assert.equal(y26.get(d), 'cal.holiday.chuseok');
  assert.equal(y26.get('2026-10-09'), 'cal.holiday.hangul');
  assert.equal(y26.get('2026-12-25'), 'cal.holiday.christmas');
  assert.equal(y26.size, 14);
  // 2028 추석(10/3)은 개천절과 겹친다: 하루는 개천절, 앞뒤는 추석
  const y28 = koreanHolidays(2028);
  assert.equal(y28.get('2028-10-03'), 'cal.holiday.foundation');
  assert.equal(y28.get('2028-10-02'), 'cal.holiday.chuseok');
  assert.equal(y28.get('2028-10-04'), 'cal.holiday.chuseok');
  // 음력 표 밖의 해는 양력만
  assert.equal(koreanHolidays(2024).size, 8);
  const span = holidaysBetween('2026-12-27', '2027-02-06');
  assert.deepEqual([...span.keys()].sort(), ['2027-01-01', '2027-02-06']);
});

// ---- 시간대 ----

test('시간대: 같은 시각 일정이 서울과 뉴욕에서 다른 날 칸에 놓인다', () => {
  const instant = Date.UTC(2026, 9, 15, 15, 30); // 서울 10/16 00:30, 뉴욕 10/15 11:30
  const e = { ...ev({ startAt: instant }) };
  const seoul = inTz('Asia/Seoul', () => calendarDays([e], [], '2026-10-11', '2026-10-24', '2026-10-12'));
  const ny = inTz('America/New_York', () => calendarDays([e], [], '2026-10-11', '2026-10-24', '2026-10-12'));
  assert.deepEqual(days(seoul), ['2026-10-16']);
  assert.equal(seoul.get('2026-10-16')?.[0]?.minute, 30);
  assert.deepEqual(days(ny), ['2026-10-15']);
  assert.equal(ny.get('2026-10-15')?.[0]?.minute, 11 * 60 + 30);
});

test('서머타임: 25시간인 날의 종일 일정과 23시간인 날 자정 넘는 일정이 날짜를 지킨다', () => {
  inTz('America/New_York', () => {
    // 2026-11-01 서머타임 끝 (25시간). 11/1~11/2 이틀 종일
    const back = ev({ startAt: dayStartMs('2026-11-01'), endAt: dayStartMs('2026-11-03'), allDay: true });
    const m = calendarDays([back], [], '2026-11-01', '2026-12-05', '2026-10-12');
    assert.deepEqual(days(m), ['2026-11-01', '2026-11-02']);
    // 2026-03-08 서머타임 시작 (23시간). 3/7 23시~3/8 3시
    const fwd = ev({ startAt: at('2026-03-07', 23), endAt: at('2026-03-08', 3) });
    assert.deepEqual(eventSpan(fwd), { first: '2026-03-07', last: '2026-03-08' });
    // 48시간으로 저장된 이틀 종일 (가져온 일정): 23시간인 날을 지나 끝이 3/10 1시여도 3/9 까지
    const twoDays = ev({
      startAt: dayStartMs('2026-03-08'),
      endAt: dayStartMs('2026-03-08') + 48 * 3_600_000,
      allDay: true,
    });
    assert.deepEqual(eventSpan(twoDays), { first: '2026-03-08', last: '2026-03-09' });
    // 하루 종일 일정 하나는 그날만
    const one = ev({ startAt: dayStartMs('2026-03-08'), allDay: true });
    assert.deepEqual(eventSpan(one), { first: '2026-03-08', last: '2026-03-08' });
  });
});

// ---- 고른 날에 넣기 (main/panel.ts eventAdd 의 day) ----

test('고른 날에 넣기: 시각만 적으면 그날 그 시각, 아무것도 없으면 "오늘" 을 붙여 그날 종일, 시각 같은 말은 되묻는다', () => {
  const ev1 = parseEventInput('3시 회의', '2026-10-20', 0);
  assert.ok(ev1 && !('allDay' in ev1));
  assert.equal(ev1.day, '2026-10-20');
  assert.equal(ev1.minute, 15 * 60);
  assert.equal(parseEventInput('장보기', '2026-10-20', 0), null);
  const all = parseEventInput('오늘 장보기', '2026-10-20', 0);
  assert.ok(all && 'allDay' in all);
  assert.equal(all.day, '2026-10-20');
  assert.equal(all.title, '장보기');
  // 영어도 같은 규칙 ("오늘" 은 말과 상관없이 읽는다)
  const en = parseEventInput('오늘 groceries', '2026-10-20', 0);
  assert.ok(en && 'allDay' in en && en.title === 'groceries');
  assert.equal(parseEventInput('오늘 25시 회의', '2026-10-20', 0), null);
  // "내일" 은 고른 날의 다음 날
  const next = parseEventInput('내일 소풍', '2026-10-20', 0);
  assert.ok(next && 'allDay' in next && next.day === '2026-10-21');
});

// ---- 많은 일정 ----

test('많은 일정: 한 달 1000건과 할 일 200개를 나누는 데 걸리는 시간', () => {
  const from = '2026-09-27';
  const to = '2026-11-07';
  const evs: CalEvent[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  for (let i = 0; i < 1000; i++) {
    const day = plusDays('2026-10-01', Math.floor(rnd() * 31));
    if (i % 10 === 0)
      evs.push(
        ev({
          startAt: dayStartMs(day),
          endAt: dayStartMs(plusDays(day, 1 + Math.floor(rnd() * 4))),
          allDay: true,
        }),
      );
    else {
      const s = at(day, Math.floor(rnd() * 24), 15);
      evs.push(ev({ startAt: s, endAt: s + Math.floor(rnd() * 180) * 60_000 }));
    }
  }
  const list = Array.from({ length: 200 }, (_, i) =>
    todo({ due: plusDays('2026-10-01', i % 31), repeat: i % 20 === 0 ? 'daily' : null }),
  );
  calendarDays(evs, list, from, to, '2026-10-12'); // 데우기
  const runs = 20;
  const t0 = performance.now();
  let m = new Map<string, CalItem[]>();
  for (let i = 0; i < runs; i++) m = calendarDays(evs, list, from, to, '2026-10-12');
  const ms = (performance.now() - t0) / runs;
  const total = [...m.values()].reduce((n, l) => n + l.length, 0);
  console.log(`calendarDays: 일정 1000, 할 일 200 → 칸 줄 ${total}개, 한 번 ${ms.toFixed(2)}ms`);
  assert.ok(total >= 1200);
  // 넉넉한 상한 (느린 CI 도 통과). 실제 값은 위 로그
  assert.ok(ms < 100, `${ms}ms`);
});
