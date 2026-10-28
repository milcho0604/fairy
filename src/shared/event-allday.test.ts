// 종일 일정 (일정 탭에 "내일 제주도 여행"처럼 시각 없이 적은 것). 2026-10-06 화요일, 지금 오전 9시 기준.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { briefingText } from './briefing.ts';
import { plusDays } from './day.ts';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import {
  ALL_DAY_EVE_MIN,
  allDayLabel,
  allDaySpan,
  allDayTimes,
  dayStartMs,
  EventStore,
  parseEventInput,
  parseQuickEvent,
} from './event-store.ts';
import { setLang } from './i18n/index.ts';
import { parseIcs } from './ics.ts';
import { parseQuickTodo } from './quick-add.ts';
import { variants } from './variants.ts';

const today = '2026-10-06';
const nine = 9 * 60;
const p = (s: string) => parseEventInput(s, today, nine);
const one = (title: string, day: string) => ({ title, day, lastDay: null, allDay: true });
const span = (title: string, day: string, lastDay: string) => ({ title, day, lastDay, allDay: true });

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { db, events: new EventStore(db) };
}

test('날짜만 있으면 그 날 종일 (한국어, 영어)', () => {
  const table: [string, unknown][] = [
    ['내일 제주도 여행', one('제주도 여행', '2026-10-07')],
    ['모레 이사', one('이사', '2026-10-08')],
    ['글피 건강검진', one('건강검진', '2026-10-09')],
    ['오늘 재택', one('재택', today)],
    ['금요일 휴가', one('휴가', '2026-10-09')],
    ['화요일 휴가', one('휴가', today)], // 오늘 요일이면 오늘 (종일은 "지난 시각"이 없다)
    ['다음 주 월요일 휴가', one('휴가', '2026-10-12')],
    ['다음주 화요일 워크숍', one('워크숍', '2026-10-13')],
    ['10월 12일 엄마 생일', one('엄마 생일', '2026-10-12')],
    ['10/12 엄마 생일', one('엄마 생일', '2026-10-12')],
    ['엄마 생일 10.12', one('엄마 생일', '2026-10-12')],
    ['1월 3일 신년회', one('신년회', '2027-01-03')], // 지난 날짜는 내년
    ['next friday day off', one('day off', '2026-10-16')],
    ['friday day off', one('day off', '2026-10-09')],
    ['day off on fri', one('day off', '2026-10-09')],
    ["oct 12 mom's birthday", one("mom's birthday", '2026-10-12')],
    ["mom's birthday on the 12th of october", one("mom's birthday", '2026-10-12')],
    ['jeju trip tomorrow', one('jeju trip', '2026-10-07')],
    ['Jeju trip TOMORROW', one('Jeju trip', '2026-10-07')],
    ['sun cream shopping tomorrow', one('sun cream shopping', '2026-10-07')], // sun 은 요일이 아니다
    ['내일 3시간 운동', one('3시간 운동', '2026-10-07')], // 길이만 있고 시각이 없으면 제목에 남는다
  ];
  for (const [text, want] of table) assert.deepEqual(p(text), want, text);
});

test('기간: 부터 N일, 박, 물결, 줄표, 까지, for N days, to', () => {
  const table: [string, unknown][] = [
    ['내일부터 3일 제주도 여행', span('제주도 여행', '2026-10-07', '2026-10-09')],
    ['내일부터 3일간 제주도 여행', span('제주도 여행', '2026-10-07', '2026-10-09')],
    ['내일부터 3일 동안 제주도 여행', span('제주도 여행', '2026-10-07', '2026-10-09')],
    ['내일 3일간 출장', span('출장', '2026-10-07', '2026-10-09')],
    ['내일부터 2박 3일 부산', span('부산', '2026-10-07', '2026-10-09')],
    ['금요일 2박 3일 캠핑', span('캠핑', '2026-10-09', '2026-10-11')],
    ['10월 10일~12일 제주도', span('제주도', '2026-10-10', '2026-10-12')],
    ['10월 10일 ~ 10월 12일 제주도', span('제주도', '2026-10-10', '2026-10-12')],
    ['10월 10일부터 12일까지 제주도', span('제주도', '2026-10-10', '2026-10-12')],
    ['10월 10일부터 12일 제주도', span('제주도', '2026-10-10', '2026-10-12')], // 첫날보다 큰 수는 끝 날
    ['10월 10일부터 3일 제주도', span('제주도', '2026-10-10', '2026-10-12')], // 작은 수는 날 수
    ['10/10-10/12 워크숍', span('워크숍', '2026-10-10', '2026-10-12')],
    ['10/10~12 워크숍', span('워크숍', '2026-10-10', '2026-10-12')],
    ['10/30~11/2 출장', span('출장', '2026-10-30', '2026-11-02')],
    ['10/30~2 출장', span('출장', '2026-10-30', '2026-11-02')], // 끝이 작으면 다음 달
    ['12/30-1/2 휴가', span('휴가', '2026-12-30', '2027-01-02')], // 해를 넘긴다
    ['금요일부터 일요일까지 캠핑', span('캠핑', '2026-10-09', '2026-10-11')],
    ['내일부터 모레까지 출장', span('출장', '2026-10-07', '2026-10-08')],
    ['from tomorrow for 3 days jeju trip', span('jeju trip', '2026-10-07', '2026-10-09')],
    ['jeju trip from tomorrow for 3 days', span('jeju trip', '2026-10-07', '2026-10-09')],
    ['jeju trip tomorrow for three days', span('jeju trip', '2026-10-07', '2026-10-09')],
    ['conference for 3 days from tomorrow', span('conference', '2026-10-07', '2026-10-09')],
    ['vacation next monday for a week', span('vacation', '2026-10-12', '2026-10-18')],
    ['vacation oct 10 for 2 weeks', span('vacation', '2026-10-10', '2026-10-23')],
    ['jeju trip oct 10-12', span('jeju trip', '2026-10-10', '2026-10-12')],
    ['retreat oct 10 to 12', span('retreat', '2026-10-10', '2026-10-12')],
    ['retreat oct 10 to oct 12', span('retreat', '2026-10-10', '2026-10-12')],
    ['retreat from oct 30 through nov 2', span('retreat', '2026-10-30', '2026-11-02')],
    ['camping fri-sun', span('camping', '2026-10-09', '2026-10-11')],
    ['day off from fri to sun', span('day off', '2026-10-09', '2026-10-11')],
    ['sprint next mon to next fri', span('sprint', '2026-10-12', '2026-10-16')],
    ['trip tomorrow for 1 day', one('trip', '2026-10-07')], // 하루면 하루짜리
    ['10/5-10/7 워크숍', span('워크숍', '2026-10-05', '2026-10-07')], // 첫날이 지났어도 오늘까지 이어지면 올해
    ['10월 5일부터 3일 워크숍', span('워크숍', '2026-10-05', '2026-10-07')],
    ['10/1-10/3 지난 워크숍', span('지난 워크숍', '2027-10-01', '2027-10-03')], // 다 지난 기간은 내년
    ['1/3-1/5 신년 휴가', span('신년 휴가', '2027-01-03', '2027-01-05')],
  ];
  for (const [text, want] of table) assert.deepEqual(p(text), want, text);
});

test('시각이 있으면 지금처럼 시각 일정, 날짜도 시각도 없거나 틀리면 null', () => {
  assert.deepEqual(p('내일 3시 회의'), parseQuickEvent('내일 3시 회의', today, nine));
  assert.equal((p('meeting tomorrow at 3pm') as { minute: number }).minute, 15 * 60);
  for (const bad of [
    '제주도 여행', // 날짜 없음
    '내일', // 제목 없음
    '10/10-10/12', // 제목 없음
    '내일 25시 파티', // 틀린 시각은 종일로 넘기지 않는다
    '내일 3시', // 시각만 있고 제목 없음
    '2/30 휴가', // 없는 날짜
    '13/1 휴가',
    '모레부터 내일까지 출장', // 끝이 앞섬
    '1/1~12/31 올해', // 92일 넘음
    'sat exam', // 줄임말 요일은 앞말이 있어야
    'sun cream',
  ])
    assert.equal(p(bad), null, bad);
});

test('빠른 입력(펫 메뉴)은 그대로: 날짜만 있으면 일정이 아니라 마감 있는 할 일', () => {
  for (const text of ['내일 제주도 여행', '금요일 휴가', 'tomorrow buy milk', '10월 12일 엄마 생일']) {
    assert.equal(parseQuickEvent(text, today, nine), null, text);
  }
  assert.equal(parseQuickTodo('내일 제주도 여행', today).due, '2026-10-07');
});

test('저장 모양: 첫날 0시, 여러 날이면 마지막 날 다음 날 0시, 하루면 끝 없음', () => {
  assert.deepEqual(allDayTimes('2026-10-07', null), { startAt: dayStartMs('2026-10-07'), endAt: null });
  assert.deepEqual(allDayTimes('2026-10-10', '2026-10-12'), {
    startAt: dayStartMs('2026-10-10'),
    endAt: dayStartMs('2026-10-13'),
  });
  assert.equal(allDayTimes('2026-10-10', '2026-10-10').endAt, null); // 끝이 첫날과 같으면 하루
  assert.deepEqual(allDaySpan(allDayTimes('2026-10-10', '2026-10-12')), {
    first: '2026-10-10',
    last: '2026-10-12',
  });
  assert.deepEqual(allDaySpan(allDayTimes('2026-10-07', null)), { first: '2026-10-07', last: '2026-10-07' });
  // 서머타임으로 끝이 한 시간 밀려도 같은 날로 읽는다
  const t = allDayTimes('2026-10-10', '2026-10-12');
  assert.equal(allDaySpan({ startAt: t.startAt, endAt: (t.endAt ?? 0) + 3_600_000 }).last, '2026-10-12');
  assert.equal(allDaySpan({ startAt: t.startAt, endAt: (t.endAt ?? 0) - 3_600_000 }).last, '2026-10-12');
});

test('표시: 하루면 종일, 여러 날이면 10/10~10/12. 영어도', () => {
  assert.equal(allDayLabel(allDayTimes('2026-10-07', null)), '종일');
  assert.equal(allDayLabel(allDayTimes('2026-10-10', '2026-10-12')), '10/10~10/12');
  assert.equal(allDayLabel(allDayTimes('2026-12-30', '2027-01-02')), '12/30~1/2');
  setLang('en');
  try {
    assert.equal(allDayLabel(allDayTimes('2026-10-07', null)), 'All day');
    assert.equal(allDayLabel(allDayTimes('2026-10-10', '2026-10-12')), '10/10-10/12');
  } finally {
    setLang('ko');
  }
});

test('저장하고 다시 읽기: 종일 표시, 알림 없음 기본, 범위 조회에 이어지는 여러 날', () => {
  const { events } = fresh();
  const now = dayStartMs(today) + nine * 60_000;
  const trip = events.add(
    { title: '제주도 여행', ...allDayTimes('2026-10-05', '2026-10-07'), allDay: true },
    now,
  );
  const bday = events.add({ title: '엄마 생일', ...allDayTimes('2026-10-06', null), allDay: true }, now);
  const meet = events.add({ title: '회의', startAt: now + 60 * 60_000 }, now);
  assert.equal(trip.allDay, true);
  assert.equal(trip.remindMin, 0);
  assert.equal(trip.endAt, dayStartMs('2026-10-08'));
  assert.equal(meet.allDay, false);
  assert.equal(meet.remindMin, 10);
  // 오늘 목록: 어제 시작한 여행도 나온다. 어제 끝난 하루짜리는 안 나온다
  events.add({ title: '어제 일', ...allDayTimes('2026-10-05', null), allDay: true }, now);
  const from = dayStartMs(today);
  assert.deepEqual(
    events.between(from, dayStartMs('2026-10-07')).map((e) => e.title),
    ['제주도 여행', '엄마 생일', '회의'],
  );
  // 여행이 끝난 다음 날에는 안 나온다
  assert.deepEqual(
    events.between(dayStartMs('2026-10-08'), dayStartMs('2026-10-09')).map((e) => e.title),
    [],
  );
  assert.equal(events.get(bday.id)?.allDay, true);
});

test('알림: 종일은 기본으로 알리지 않고(아침 브리핑), 전날 저녁을 고르면 전날 8시에 한 번', () => {
  const { events } = fresh();
  const day = '2026-10-07';
  const e = events.add({ title: '제주도 여행', ...allDayTimes(day, null), allDay: true }, 0);
  const at = (d: string, h: number) => dayStartMs(d) + h * 3_600_000;
  for (const t of [at(today, 20), at(day, 0) + 60_000, at(day, 0) + 4 * 60_000])
    assert.deepEqual(events.dueReminders(t), []);
  events.update(e.id, { remindMin: ALL_DAY_EVE_MIN });
  assert.deepEqual(events.dueReminders(at(today, 19)), []);
  assert.deepEqual(
    events.dueReminders(at(today, 20)).map((x) => x.title),
    ['제주도 여행'],
  );
  events.markNotified(e.id, at(today, 20));
  assert.deepEqual(events.dueReminders(at(today, 21)), []);
  // 다시 알림 없음으로
  events.update(e.id, { remindMin: 0 });
  assert.deepEqual(events.dueReminders(at(day, 0)), []);
});

test('고치기: 종일과 시각 일정 사이를 바꾸면 알림도 그쪽 기본으로, 가져온 일정이면 사용자 것으로', () => {
  const { events } = fresh();
  const timed = events.add({ title: '면접', startAt: dayStartMs('2026-10-07') + 10 * 3_600_000 }, 0);
  const a = events.update(timed.id, { allDay: true, startAt: dayStartMs('2026-10-07'), endAt: null });
  assert.equal(a?.allDay, true);
  assert.equal(a?.remindMin, 0);
  assert.equal(a?.notifiedAt, null);
  const b = events.update(timed.id, { allDay: false, startAt: dayStartMs('2026-10-07') + 9 * 3_600_000 });
  assert.equal(b?.allDay, false);
  assert.equal(b?.remindMin, 10);
  // 알림을 같이 주면 그 값
  const c = events.update(timed.id, {
    allDay: true,
    startAt: dayStartMs('2026-10-07'),
    remindMin: ALL_DAY_EVE_MIN,
  });
  assert.equal(c?.remindMin, ALL_DAY_EVE_MIN);
  // 날짜만 옮기기 (여러 날 유지)
  const trip = events.add({ title: '여행', ...allDayTimes('2026-10-10', '2026-10-12'), allDay: true }, 0);
  const moved = events.update(trip.id, allDayTimes('2026-10-17', '2026-10-19'));
  assert.deepEqual(allDaySpan(moved as never), { first: '2026-10-17', last: '2026-10-19' });
  assert.equal(moved?.allDay, true);

  // 가져온 시각 일정을 종일로 바꾸면 다음 가져오기가 되돌리지 않는다
  const from = dayStartMs('2026-10-01');
  const to = dayStartMs('2026-11-01');
  const ics = {
    uid: 'x',
    title: '외부',
    startAt: dayStartMs('2026-10-08') + 3_600_000,
    endAt: null,
    allDay: false,
  };
  events.syncExternal('ics', [ics], from, to, 0);
  const got = events.between(from, to).find((e) => e.title === '외부');
  events.update(got?.id ?? 0, { allDay: true, startAt: dayStartMs('2026-10-08') });
  events.syncExternal('ics', [ics], from, to, 0);
  assert.equal(events.get(got?.id ?? 0)?.allDay, true);
});

test('가져온 ics 종일 일정과 같은 모양: 하루는 끝 없음, 여러 날은 끝 날 다음 날 0시, 알림 없음', () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:one',
    'DTSTART;VALUE=DATE:20261012',
    'DTEND;VALUE=DATE:20261013',
    'SUMMARY:엄마 생일',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:trip',
    'DTSTART;VALUE=DATE:20261010',
    'DTEND;VALUE=DATE:20261013',
    'SUMMARY:제주도',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const list = parseIcs(ics, tz, dayStartMs('2026-10-01'), dayStartMs('2026-11-01'));
  const { events } = fresh();
  events.syncExternal('ics', list, dayStartMs('2026-10-01'), dayStartMs('2026-11-01'), 0);
  const typed = [p('10월 12일 엄마 생일'), p('10월 10일~12일 제주도')].map((x) => {
    const q = x as { title: string; day: string; lastDay: string | null };
    return events.add({ title: q.title, ...allDayTimes(q.day, q.lastDay), allDay: true }, 0);
  });
  const shape = (e: { title: string; startAt: number; endAt: number | null; allDay: boolean }) => [
    e.title,
    e.startAt,
    e.endAt,
    e.allDay,
  ];
  const imported = events
    .between(dayStartMs('2026-10-01'), dayStartMs('2026-11-01'))
    .filter((e) => e.source === 'ics');
  assert.deepEqual(imported.map(shape).sort(), typed.map(shape).sort());
  // 가져온 것도 알림 없음
  assert.deepEqual(
    imported.map((e) => e.remindMin),
    [0, 0],
  );
  assert.deepEqual(events.dueReminders(dayStartMs('2026-10-10')), []);
  // 다시 맞춰도 고침이 없다
  assert.deepEqual(events.syncExternal('ics', list, dayStartMs('2026-10-01'), dayStartMs('2026-11-01'), 0), {
    added: 0,
    updated: 0,
    removed: 0,
  });
});

test('캘린더에서 0시 시각 일정을 종일로 바꾸면(시작은 같다) 종일로 고치고 알림도 없앤다', () => {
  const { events } = fresh();
  const from = dayStartMs('2026-10-01');
  const to = dayStartMs('2026-11-01');
  const base = { uid: 'f', title: '마감', startAt: dayStartMs('2026-10-20'), endAt: null };
  events.syncExternal('ics', [{ ...base, allDay: false }], from, to, 0);
  assert.deepEqual(events.syncExternal('ics', [{ ...base, allDay: true }], from, to, 0), {
    added: 0,
    updated: 1,
    removed: 0,
  });
  const [e] = events.between(from, to);
  assert.equal(e?.allDay, true);
  assert.equal(e?.remindMin, 0);
  assert.deepEqual(events.dueReminders(base.startAt - 60_000), []);
  // 다시 시각 일정으로 돌아오면 기본 알림
  events.syncExternal('ics', [{ ...base, allDay: false }], from, to, 0);
  assert.equal(events.between(from, to)[0]?.remindMin, 10);
  assert.equal(events.between(from, to)[0]?.allDay, false);
});

test('7판 올리기:6판이 가져온 종일 일정(알림 0, 알린 시각 = 시작)은 종일로 표시, 시각 일정은 그대로', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 6)) db.exec(sql);
  db.exec('pragma user_version = 6; commit');
  const s = dayStartMs('2026-10-09');
  db.exec(`insert into event (title, start_at, remind_min, notified_at, created_at, source, external_id)
           values ('한글날', ${s}, 0, ${s}, 0, 'ics', 'c3'),
                  ('가져온 회의', ${s + 3_600_000}, 10, null, 0, 'ics', 'm1'),
                  ('내 일정', ${s}, 0, ${s + 1}, 0, 'local', null)`);
  assert.deepEqual(migrate(db), { from: 6, to: SCHEMA_VERSION });
  const events = new EventStore(db);
  assert.deepEqual(
    events.between(s, s + 86_400_000).map((e) => [e.title, e.allDay]),
    [
      ['한글날', true],
      ['내 일정', false],
      ['가져온 회의', false],
    ],
  );
});

// 브리핑 인사는 여러 변형 가운데 고른다. 이 시험은 늘 첫째 변형(기본 말)으로
variants.setRandom(() => 0);

test('브리핑: 종일은 "오늘 종일: ..." 로 먼저, 시각 일정은 지금처럼', () => {
  const all = (title: string) => ({ minute: 0, title, allDay: true });
  assert.equal(
    briefingText({ events: [all('제주도 여행')], dueToday: 0, overdue: 0, nowMinute: 540 }),
    '좋은 아침! 오늘 종일: 제주도 여행.',
  );
  assert.equal(
    briefingText({
      events: [all('제주도 여행'), all('엄마 생일'), all('재택'), { minute: 900, title: '회의' }],
      dueToday: 1,
      overdue: 0,
      nowMinute: 540,
    }),
    '좋은 아침! 오늘 종일: 제주도 여행, 엄마 생일 외 1개. 오늘 일정은 오후 3:00 회의 하나야. 할 일은 오늘 마감 1개 있어.',
  );
  setLang('en');
  try {
    assert.equal(
      briefingText({ events: [all('Jeju trip')], dueToday: 0, overdue: 0, nowMinute: 540 }),
      'Good morning! All day today: Jeju trip.',
    );
  } finally {
    setLang('ko');
  }
});

test('여러 날 끝 날 계산이 하루 넘게 어긋나지 않는다 (92일 경계)', () => {
  const last = plusDays('2026-10-07', 91);
  assert.deepEqual(p(`내일부터 92일 긴 여행`), span('긴 여행', '2026-10-07', last));
  assert.equal(p('내일부터 93일 긴 여행'), null);
});
