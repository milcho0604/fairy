import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanIcsUrl, parseIcs, zonedToUtc } from './ics.ts';

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
