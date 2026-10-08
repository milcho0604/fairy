// 영어 상대 날짜 (2026-10-08): 할 일 마감과 일정 날짜가 같은 낱말을 같은 셈으로 읽는다.
// 기준: 2026-10-06 화요일, 지금 오전 9시. "write report in 2 days" 가 마감 없이 들어가던 것.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthEnd, plusMonths } from './day.ts';
import { normalizeQuick, parseEventInput, parseQuickEvent } from './event-store.ts';
import { hasDeadlineWord, parseQuickTodo } from './quick-add.ts';
import { enRelDay } from './quick-words.ts';

const today = '2026-10-06';
const nine = 9 * 60;
const at = (h: number, m = 0) => h * 60 + m;
const todo = (s: string, day = today) => {
  const r = parseQuickTodo(s, day);
  return [r.title, r.due];
};
const E = (title: string, day: string, minute: number) => ({ title, day, minute, durationMin: null });
const one = (title: string, day: string) => ({ title, day, lastDay: null, allDay: true });

test('할 일 마감: in N days, weeks, months, 다음 주, 주 끝, 월말, 주말 (맨 앞이나 맨 끝)', () => {
  const table: [string, [string, string]][] = [
    ['write report in 2 days', ['write report', '2026-10-08']],
    ['in 2 days write report', ['write report', '2026-10-08']],
    ['write report in 1 day', ['write report', '2026-10-07']],
    ['write report in two days', ['write report', '2026-10-08']],
    ['pay rent in a week', ['pay rent', '2026-10-13']],
    ['pay rent in one week', ['pay rent', '2026-10-13']],
    ['tax in 3 weeks', ['tax', '2026-10-27']],
    ['tax in three weeks', ['tax', '2026-10-27']],
    ['renew passport in a month', ['renew passport', '2026-11-06']],
    ['renew passport in 2 months', ['renew passport', '2026-12-06']],
    ['dentist the day after tomorrow', ['dentist', '2026-10-08']],
    ['the day after tomorrow dentist', ['dentist', '2026-10-08']],
    ['day after tomorrow dentist', ['dentist', '2026-10-08']],
    ['report next week', ['report', '2026-10-12']], // 다음 주 월요일 (next monday 와 같다)
    ['next week report', ['report', '2026-10-12']],
    ['report end of week', ['report', '2026-10-09']], // 금요일
    ['report by end of the week', ['report', '2026-10-09']],
    ['report by the end of next week', ['report', '2026-10-16']],
    ['pay rent end of month', ['pay rent', '2026-10-31']],
    ['pay rent by the end of the month', ['pay rent', '2026-10-31']],
    ['card bill end of next month', ['card bill', '2026-11-30']],
    ['clean garage this weekend', ['clean garage', '2026-10-10']], // 토요일
    ['clean garage on the weekend', ['clean garage', '2026-10-10']],
    ['clean garage by the weekend', ['clean garage', '2026-10-10']],
    ['hike next weekend', ['hike', '2026-10-17']],
    ['report due in 2 days', ['report', '2026-10-08']],
    ['report within 3 days', ['report', '2026-10-09']],
    ['Write Report IN 2 DAYS', ['Write Report', '2026-10-08']], // 대소문자
    ['call mom friday next week', ['call mom', '2026-10-16']], // 이번 주 금요일이 아니다
    ['call mom next week friday', ['call mom', '2026-10-16']],
    ['call mom next week on fri', ['call mom', '2026-10-16']],
  ];
  for (const [text, want] of table) assert.deepEqual(todo(text), want, text);
  // 중요 표시와 같이
  assert.deepEqual(parseQuickTodo('report in 2 days!', today), {
    title: 'report',
    due: '2026-10-08',
    important: true,
    repeat: null,
  });
});

test('할 일: 문장 가운데나 날짜가 아닌 말은 제목에 그대로 (오인 방지)', () => {
  const titles = [
    'check in 2 days later', // 가운데: 다른 날짜 낱말처럼 맨 앞, 맨 끝만 읽는다
    'in 2 days later check', // 바로 뒤 later 는 문장의 일부
    'plan for next week meeting',
    'weekend trip plan', // the 나 this 없는 weekend
    'the weekend plan', // 앞말(on, by) 없는 the weekend
    'next weekly review',
    'end of season sale',
    'month end report',
    'in 0 days x', // 0 은 날 수가 아니다
    'in 2 hours call', // 시각은 일정이 읽는다(할 일 마감이 아니다)
    'in a minute',
  ];
  for (const text of titles) assert.deepEqual(todo(text), [text, null], text);
});

test('요일에 따라: 토, 일요일의 this weekend 는 오늘, 금요일의 end of week 는 오늘', () => {
  const sat = '2026-10-10';
  const sun = '2026-10-11';
  const fri = '2026-10-09';
  const table: [string, string, string][] = [
    ['x this weekend', sat, sat],
    ['x this weekend', sun, sun],
    ['x next weekend', sat, '2026-10-17'],
    ['x next weekend', sun, '2026-10-17'],
    ['x next week', sat, '2026-10-12'],
    ['x next week', sun, '2026-10-12'],
    ['x end of week', fri, fri],
    ['x end of week', sat, '2026-10-16'], // 이번 주 금요일이 지났으면 다음 금요일
    ['x end of next week', fri, '2026-10-16'],
    ['x next week', '2026-10-12', '2026-10-19'], // 월요일의 next week 는 이레 뒤
  ];
  for (const [text, day, want] of table) assert.equal(parseQuickTodo(text, day).due, want, `${text} @${day}`);
});

test('달 셈: 말일 넘치면 그 달 말일, 해 넘기기', () => {
  assert.equal(todo('x in a month', '2026-01-31')[1], '2026-02-28');
  assert.equal(todo('x in a month', '2028-01-31')[1], '2028-02-29');
  assert.equal(todo('x in 2 months', '2026-12-15')[1], '2027-02-15');
  assert.equal(todo('x end of next month', '2026-12-15')[1], '2027-01-31');
  assert.equal(todo('x end of month', '2028-02-03')[1], '2028-02-29');
  assert.equal(todo('x in 3 weeks', '2026-12-15')[1], '2027-01-05');
  assert.equal(plusMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(plusMonths('2026-10-06', 12), '2027-10-06');
  assert.equal(monthEnd('2026-11-10'), '2026-11-30');
  assert.equal(enRelDay('in 0 days', today), null);
  assert.equal(enRelDay('not a date', today), null);
});

test('일정: 같은 낱말을 시각 일정에서도 같은 날로 (상대 시각 in 30 min, in an hour 는 그대로)', () => {
  const table: [string, unknown][] = [
    ['dentist in 2 days at 3pm', E('dentist', '2026-10-08', at(15))],
    ['in a week 3pm review', E('review', '2026-10-13', at(15))],
    ['sync in 3 weeks at 11am', E('sync', '2026-10-27', at(11))],
    ['review in a month 10am', E('review', '2026-11-06', at(10))],
    ['standup next week 10am', E('standup', '2026-10-12', at(10))],
    ['meeting friday next week 3pm', E('meeting', '2026-10-16', at(15))],
    ['party this weekend 7pm', E('party', '2026-10-10', at(19))],
    ['bbq next weekend at noon', E('bbq', '2026-10-17', at(12))],
    ['call end of month 2pm', E('call', '2026-10-31', at(14))],
    ['dinner the day after tomorrow 7pm', E('dinner', '2026-10-08', at(19))],
    // 예전 그대로
    ['call in 30 min', E('call', today, at(9, 30))],
    ['call in an hour', E('call', today, at(10))],
    ['tea in half an hour', E('tea', today, at(9, 30))],
    ['dentist in 3 days at 2pm', E('dentist', '2026-10-09', at(14))],
    ['3일 뒤 2시 치과', E('치과', '2026-10-09', at(14))],
    // 가운데여도 뒤에 later 가 오면 날짜로 읽지 않는다
    ['check in 2 days later 3pm', E('check in 2 days later', today, at(15))],
  ];
  for (const [text, want] of table) assert.deepEqual(parseQuickEvent(text, today, nine), want, text);
  // 시각이 없으면 일정이 아니다 (빠른 입력에서는 할 일로)
  assert.equal(parseQuickEvent('write report in 2 days', today, nine), null);
});

test('일정 탭 종일: 하루와 기간의 첫날', () => {
  const table: [string, unknown][] = [
    ['move in a month', one('move', '2026-11-06')],
    ['workshop in 2 weeks', one('workshop', '2026-10-20')],
    ['trip next weekend', one('trip', '2026-10-17')],
    ['offsite next week', one('offsite', '2026-10-12')],
    ['rent end of month', one('rent', '2026-10-31')],
    ['trip in 2 weeks for 3 days', { title: 'trip', day: '2026-10-20', lastDay: '2026-10-22', allDay: true }],
    [
      'conference next week for 3 days',
      { title: 'conference', day: '2026-10-12', lastDay: '2026-10-14', allDay: true },
    ],
    [
      'jeju trip this weekend for 2 days',
      { title: 'jeju trip', day: '2026-10-10', lastDay: '2026-10-11', allDay: true },
    ],
  ];
  for (const [text, want] of table) assert.deepEqual(parseEventInput(text, today, nine), want, text);
});

test('할 일과 일정이 같은 날을 고른다 (같은 표)', () => {
  for (const word of [
    'in 2 days',
    'in a week',
    'in 3 weeks',
    'in a month',
    'the day after tomorrow',
    'next week',
    'end of week',
    'end of month',
    'this weekend',
    'next weekend',
  ]) {
    const due = parseQuickTodo(`x ${word}`, today).due;
    const ev = parseQuickEvent(`x ${word} 3pm`, today, nine);
    const allDay = parseEventInput(`x ${word}`, today, nine);
    assert.ok(due, word);
    assert.equal(ev?.day, due, `일정 ${word}`);
    assert.equal(allDay && 'day' in allDay ? allDay.day : null, due, `종일 ${word}`);
  }
});

test('마감 표시: by end of week, due in 2 days, by the weekend 는 시각이 있어도 할 일', () => {
  for (const s of ['report by end of week 5pm', 'report due in 2 days 5pm', 'report by the weekend 5pm'])
    assert.equal(hasDeadlineWord(s), true, s);
  for (const s of ['report within 3 days', 'report by the end of the month'])
    assert.equal(hasDeadlineWord(s), true, s);
  for (const s of ['party this weekend 7pm', 'standup next week 10am', 'dentist in 2 days at 3pm'])
    assert.equal(hasDeadlineWord(s), false, s);
});

test('다듬기: friday next week → next friday (다른 말은 그대로)', () => {
  assert.equal(normalizeQuick('call mom friday next week'), 'call mom next friday');
  assert.equal(normalizeQuick('call mom next week, on fri'), 'call mom next fri');
  assert.equal(normalizeQuick('trip next weekend'), 'trip next weekend');
  assert.equal(normalizeQuick('report next week'), 'report next week');
  assert.equal(normalizeQuick('다음 주 금요일 회의'), '다음 주 금요일 회의');
});
