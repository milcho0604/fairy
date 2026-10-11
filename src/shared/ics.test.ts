import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAL_FAIL_START,
  CAL_FAIL_TELL,
  calFailStep,
  calStatusResult,
  calTellNow,
  cleanIcsUrl,
  parseIcs,
  resolveTz,
  WINDOWS_ZONES,
  zonedToUtc,
} from './ics.ts';

const SEOUL = 'Asia/Seoul';
const from = Date.UTC(2026, 9, 1);
const to = Date.UTC(2026, 11, 31);

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:a1@google.com',
  'DTSTART;TZID=Asia/Seoul:20261007T150000',
  'DTEND;TZID=Asia/Seoul:20261007T160000',
  'SUMMARY:주간 회의\\, 2층',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:b2@google.com',
  'DTSTART:20261008T010000Z',
  'SUMMARY:아주 긴 제목이 다음 줄로',
  '  접혀 있다',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:c3',
  'DTSTART;VALUE=DATE:20261009',
  'SUMMARY:한글날',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:d4',
  'DTSTART:20261010T090000',
  'SUMMARY:취소된 것',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:e5',
  'DTSTART:20250101T090000Z',
  'SUMMARY:범위 밖',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261011T090000Z',
  'SUMMARY:UID 없음',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('시간대 바꾸기: 서울 15시는 UTC 6시, 뉴욕 서머타임 경계', () => {
  assert.equal(zonedToUtc(2026, 10, 7, 15, 0, SEOUL), Date.UTC(2026, 9, 7, 6, 0));
  assert.equal(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York'), Date.UTC(2026, 6, 1, 13, 0)); // EDT -4
  assert.equal(zonedToUtc(2026, 12, 1, 9, 0, 'America/New_York'), Date.UTC(2026, 11, 1, 14, 0)); // EST -5
});

test('일정 꺼내기: 시간대, UTC, 종일, 접힌 줄, 이스케이프. 취소, 범위 밖, UID 없는 것은 뺀다', () => {
  const list = parseIcs(ICS, SEOUL, from, to);
  assert.deepEqual(
    list.map((e) => [e.uid, e.title, e.allDay]),
    [
      ['a1@google.com', '주간 회의, 2층', false],
      ['b2@google.com', '아주 긴 제목이 다음 줄로 접혀 있다', false],
      ['c3', '한글날', true],
    ],
  );
  assert.equal(list[0]?.startAt, Date.UTC(2026, 9, 7, 6, 0));
  assert.equal(list[0]?.endAt, Date.UTC(2026, 9, 7, 7, 0));
  assert.equal(list[1]?.startAt, Date.UTC(2026, 9, 8, 1, 0));
  assert.equal(list[2]?.startAt, Date.UTC(2026, 9, 8, 15, 0)); // 서울 10월 9일 0시
  assert.equal(list[2]?.endAt, null);
});

test('주소 검사: https 와 webcal 만', () => {
  assert.equal(cleanIcsUrl(' webcal://example.com/a.ics '), 'https://example.com/a.ics');
  assert.equal(
    cleanIcsUrl('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics')?.startsWith('https://'),
    true,
  );
  assert.equal(cleanIcsUrl('http://example.com/a.ics'), undefined);
  assert.equal(cleanIcsUrl('file:///etc/passwd'), undefined);
  assert.equal(cleanIcsUrl('아무거나'), undefined);
});

// ---- 버그잡이 6차 ----

const cal = (...evs: string[][]) =>
  ['BEGIN:VCALENDAR', ...evs.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join(
    '\r\n',
  );
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

test('VALARM 안의 SUMMARY, UID, DESCRIPTION 은 일정 값을 덮지 않는다', () => {
  const text = cal([
    'BEGIN:VALARM',
    'ACTION:EMAIL',
    'SUMMARY:알림 메일 제목',
    'UID:alarm-uid',
    'TRIGGER:-PT10M',
    'END:VALARM',
    'UID:real@x',
    'DTSTART:20261008T010000Z',
    'SUMMARY:진짜 제목',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'SUMMARY:뒤에 온 알림',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:second',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'END:VALARM',
    'DTSTART:20261009T010000Z',
    'SUMMARY:알림 뒤에 온 속성도 읽는다',
  ]);
  assert.deepEqual(
    parseIcs(text, SEOUL, from, to).map((e) => [e.uid, e.title]),
    [
      ['real@x', '진짜 제목'],
      ['second', '알림 뒤에 온 속성도 읽는다'],
    ],
  );
});

test('윈도우 시간대 이름은 IANA 로, 모르는 TZID 는 UTC 가 아니라 사용자 시간대로', () => {
  const text = cal(
    ['UID:k', 'DTSTART;TZID=Korea Standard Time:20261007T150000', 'SUMMARY:아웃룩'],
    ['UID:p', 'DTSTART;TZID=Pacific Standard Time:20261007T090000', 'SUMMARY:태평양'],
    ['UID:q', 'DTSTART;TZID="(UTC+09:00) Seoul":20261007T150000', 'SUMMARY:따옴표 안 콜론'],
    ['UID:m', 'DTSTART;TZID=/mozilla.org/20050126_1/Europe/Paris:20261007T090000', 'SUMMARY:모질라'],
    ['UID:u', 'DTSTART;TZID=Customized Time Zone:20261007T150000', 'SUMMARY:모르는 이름'],
  );
  const at = Object.fromEntries(parseIcs(text, SEOUL, from, to).map((e) => [e.uid, iso(e.startAt)]));
  assert.deepEqual(at, {
    k: '2026-10-07T06:00',
    p: '2026-10-07T16:00', // PDT -7
    q: '2026-10-07T06:00',
    m: '2026-10-07T07:00', // CEST +2
    u: '2026-10-07T06:00', // 서울로 읽음 (예전엔 UTC 15시)
  });
  assert.equal(resolveTz('India Standard Time', 'UTC'), 'Asia/Kolkata');
  assert.equal(resolveTz('Asia/Tokyo', 'UTC'), 'Asia/Tokyo');
  assert.equal(resolveTz('Nope Standard Time', 'Europe/Berlin'), 'Europe/Berlin');
  // 표의 이름은 모두 이 실행 환경의 Intl 이 안다
  assert.ok(Object.keys(WINDOWS_ZONES).length >= 30);
  for (const [win, iana] of Object.entries(WINDOWS_ZONES)) assert.equal(resolveTz(win, 'X/None'), iana, win);
});

test('반복 일정: 범위 앞에서 시작한 매주 화목, EXDATE 빼기, 서머타임이 바뀌어도 벽시계 10시', () => {
  const text = cal([
    'UID:w',
    'DTSTART;TZID=America/New_York:20260106T100000',
    'DTEND;TZID=America/New_York:20260106T110000',
    'RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
    'EXDATE;TZID=America/New_York:20261013T100000,20261015T100000',
    'SUMMARY:스탠드업',
  ]);
  const list = parseIcs(text, SEOUL, Date.UTC(2026, 9, 1), Date.UTC(2026, 10, 6));
  assert.deepEqual(
    list.map((e) => iso(e.startAt)),
    [
      '2026-10-01T14:00',
      '2026-10-06T14:00',
      '2026-10-08T14:00',
      '2026-10-20T14:00',
      '2026-10-22T14:00',
      '2026-10-27T14:00',
      '2026-10-29T14:00',
      '2026-11-03T15:00', // 11월 1일 서머타임 끝 (EST -5)
      '2026-11-05T15:00',
    ],
  );
  assert.equal(list[0]?.endAt, Date.UTC(2026, 9, 1, 15, 0));
  assert.equal(list[0]?.recurrenceId, '20261001T140000Z');
  assert.equal(new Set(list.map((e) => e.recurrenceId)).size, list.length);
});

test('반복 일정: COUNT, UNTIL, INTERVAL, 매일', () => {
  const r = (rule: string, start = '20261001T090000Z') =>
    parseIcs(cal(['UID:r', `DTSTART:${start}`, `RRULE:${rule}`]), SEOUL, from, to).map((e) => iso(e.startAt));
  assert.deepEqual(r('FREQ=DAILY;COUNT=3'), ['2026-10-01T09:00', '2026-10-02T09:00', '2026-10-03T09:00']);
  assert.deepEqual(r('FREQ=DAILY;INTERVAL=2;UNTIL=20261005T090000Z'), [
    '2026-10-01T09:00',
    '2026-10-03T09:00',
    '2026-10-05T09:00',
  ]);
  // COUNT 는 범위 앞 회차도 센다: 9월 28일부터 5번이면 범위(10월~) 안에는 2번
  assert.deepEqual(r('FREQ=DAILY;COUNT=5', '20260928T090000Z'), ['2026-10-01T09:00', '2026-10-02T09:00']);
  // 격주 월요일
  assert.deepEqual(r('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3', '20261005T090000Z'), [
    '2026-10-05T09:00',
    '2026-10-19T09:00',
    '2026-11-02T09:00',
  ]);
  // 아주 오래전에 시작한 매일 일정도 범위 안 회차가 나온다
  assert.equal(r('FREQ=DAILY', '19900101T090000Z').length, 91); // 10월 1일~12월 30일
});

test('반복 일정: 매월(둘째 월요일, 31일, 마지막 날), 매년(2월 29일)', () => {
  const r = (start: string, rule: string, a: number, b: number) =>
    parseIcs(cal(['UID:r', `DTSTART;VALUE=DATE:${start}`, `RRULE:${rule}`]), 'UTC', a, b).map((e) =>
      iso(e.startAt).slice(0, 10),
    );
  const Y26 = Date.UTC(2026, 0, 1);
  const Y27 = Date.UTC(2027, 0, 1);
  assert.deepEqual(r('20250113', 'FREQ=MONTHLY;BYDAY=2MO', Date.UTC(2026, 9, 1), Y27), [
    '2026-10-12',
    '2026-11-09',
    '2026-12-14',
  ]);
  assert.deepEqual(r('20260131', 'FREQ=MONTHLY', Y26, Date.UTC(2026, 6, 1)), [
    '2026-01-31',
    '2026-03-31',
    '2026-05-31',
  ]);
  assert.deepEqual(r('20260131', 'FREQ=MONTHLY;BYMONTHDAY=-1', Y26, Date.UTC(2026, 3, 1)), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
  ]);
  assert.deepEqual(r('20240229', 'FREQ=YEARLY', Date.UTC(2024, 0, 1), Date.UTC(2033, 0, 1)), [
    '2024-02-29',
    '2028-02-29',
    '2032-02-29',
  ]);
  assert.deepEqual(r('20201126', 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', Y26, Date.UTC(2028, 0, 1)), [
    '2026-11-26',
    '2027-11-25',
  ]);
});

test('반복 일정: 회차 고침(RECURRENCE-ID)은 그 회차를 바꾸고, 취소한 회차는 뺀다. 모르는 규칙은 첫 회만', () => {
  const text = cal(
    [
      'UID:s',
      'DTSTART:20261005T010000Z',
      'DTEND:20261005T020000Z',
      'RRULE:FREQ=DAILY;COUNT=4',
      'SUMMARY:회의',
    ],
    [
      'UID:s',
      'RECURRENCE-ID:20261006T010000Z',
      'DTSTART:20261006T050000Z',
      'SUMMARY:회의 (늦게)',
      'SEQUENCE:1',
    ],
    ['UID:s', 'RECURRENCE-ID:20261007T010000Z', 'DTSTART:20261007T010000Z', 'STATUS:CANCELLED'],
    ['UID:h', 'DTSTART:20261005T010000Z', 'RRULE:FREQ=HOURLY;COUNT=5', 'SUMMARY:모름'],
  );
  assert.deepEqual(
    parseIcs(text, SEOUL, from, to).map((e) => [
      e.uid,
      e.recurrenceId,
      iso(e.startAt),
      e.title,
      e.endAt && iso(e.endAt),
    ]),
    [
      ['h', '20261005T010000Z', '2026-10-05T01:00', '모름', null],
      ['s', '20261005T010000Z', '2026-10-05T01:00', '회의', '2026-10-05T02:00'],
      ['s', '20261006T010000Z', '2026-10-06T05:00', '회의 (늦게)', '2026-10-06T06:00'],
      ['s', '20261008T010000Z', '2026-10-08T01:00', '회의', '2026-10-08T02:00'],
    ],
  );
});

test('한 번뿐인 일정은 recurrenceId 가 없고, 같은 UID 가 두 번이면 SEQUENCE 가 큰 것 하나만', () => {
  const text = cal(
    ['UID:d', 'DTSTART:20261008T010000Z', 'SUMMARY:옛 판', 'SEQUENCE:2'],
    ['UID:d', 'DTSTART:20261009T010000Z', 'SUMMARY:새 판', 'SEQUENCE:3'],
  );
  assert.deepEqual(
    parseIcs(text, SEOUL, from, to).map((e) => [e.uid, e.recurrenceId, e.title]),
    [['d', null, '새 판']],
  );
});

test('종일 일정의 끝: 하루는 null, 여러 날은 끝 날 다음 날 0시 (짝꿍 종일 일정과 같은 모양)', () => {
  const list = parseIcs(
    [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:one',
      'DTSTART;VALUE=DATE:20261012',
      'DTEND;VALUE=DATE:20261013',
      'SUMMARY:하루',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:three',
      'DTSTART;VALUE=DATE:20261010',
      'DTEND;VALUE=DATE:20261013',
      'SUMMARY:사흘',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
    SEOUL,
    from,
    to,
  );
  assert.deepEqual(
    list.map((e) => [e.uid, e.startAt, e.endAt]),
    [
      ['three', Date.UTC(2026, 9, 9, 15), Date.UTC(2026, 9, 12, 15)],
      ['one', Date.UTC(2026, 9, 11, 15), null],
    ],
  );
});

test('캘린더를 계속 못 읽음: 세 번째에 한 번만 알리고, 인터넷 끊김은 세지 않고, 한 번 읽히면 처음부터', () => {
  type R = Parameters<typeof calFailStep>[1];
  const run = (results: R[]) => {
    let s = CAL_FAIL_START;
    const told: number[] = [];
    results.forEach((r, i) => {
      const step = calFailStep(s, r);
      s = step.state;
      if (step.tell) told.push(i);
    });
    return { s, told };
  };
  assert.equal(CAL_FAIL_TELL, 3);
  assert.deepEqual(run(['fail', 'fail', 'fail', 'fail', 'fail']).told, [2]);
  // 인터넷 끊김은 사이에 끼어도 세지도 지우지도 않는다
  assert.deepEqual(run(['fail', 'offline', 'fail', 'offline', 'fail']).told, [4]);
  assert.deepEqual(run(['offline', 'offline', 'offline', 'offline']).told, []);
  // 한 번 읽히면 처음부터: 다시 세 번 못 읽으면 또 알린다
  assert.deepEqual(run(['fail', 'fail', 'ok', 'fail', 'fail']).told, []);
  assert.deepEqual(run(['fail', 'fail', 'fail', 'ok', 'fail', 'fail', 'fail']).told, [2, 6]);
  assert.deepEqual(run(['fail', 'fail', 'fail', 'ok']).s, CAL_FAIL_START);
});

test('캘린더 응답 상태: 5xx 와 429 는 세지 않고, 다른 4xx 는 센다', () => {
  assert.equal(calStatusResult(200), 'ok');
  for (const s of [500, 502, 503, 504, 429]) assert.equal(calStatusResult(s), 'offline', String(s));
  for (const s of [400, 401, 403, 404, 410]) assert.equal(calStatusResult(s), 'fail', String(s));
});

test('계속 못 읽음 알림: 사용자가 직접 가져왔거나 설정 창이 열려 있으면 말하지 않는다', () => {
  assert.equal(calTellNow(true, { byUser: false, settingsOpen: false }), true);
  assert.equal(calTellNow(true, { byUser: true, settingsOpen: false }), false);
  assert.equal(calTellNow(true, { byUser: false, settingsOpen: true }), false);
  assert.equal(calTellNow(false, { byUser: false, settingsOpen: false }), false);
});
