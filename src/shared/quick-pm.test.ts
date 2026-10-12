// 때 낱말 없는 8~11시를 언제 오후로 읽나 (2026-10-12). 밤 8시에 "오늘 8시 저녁" 을 적으면 지난 오전 8시가 되던 것.
// 기준: 2026-10-06 화요일
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuickEvent } from './event-store.ts';
import { parseTodoLine } from './remind-parse.ts';

const today = '2026-10-06';
const tomorrow = '2026-10-07';
const at = (h: number, m = 0) => h * 60 + m;
const E = (title: string, day: string, minute: number, durationMin: number | null = null) => ({
  title,
  day,
  minute,
  durationMin,
});

test('저녁 말이 있으면 8~11시는 오후 (지금 시각과 상관없이)', () => {
  const table: [string, number, unknown][] = [
    ['오늘 8시 저녁', at(20), E('저녁', today, at(20))],
    ['오늘 8시 저녁', at(9), E('저녁', today, at(20))],
    ['8시 저녁 약속', at(9), E('저녁 약속', today, at(20))],
    ['내일 9시 저녁 모임', at(9), E('저녁 모임', tomorrow, at(21))],
    ['11시 밤 산책', at(9), E('밤 산책', today, at(23))],
    ['10시 회식', at(9), E('회식', today, at(22))],
    ['today at 8 dinner', at(20), E('dinner', today, at(20))],
    ['dinner tomorrow at 9', at(9), E('dinner', tomorrow, at(21))],
    ['8시~10시 저녁 파티', at(9), E('저녁 파티', today, at(20), 120)],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('오후, 밤, 저녁, pm, tonight 을 적으면 오후', () => {
  const table: [string, number, unknown][] = [
    ['오늘 오후 8시 운동', at(9), E('운동', today, at(20))],
    ['오늘 저녁 8시 운동', at(9), E('운동', today, at(20))],
    ['밤 10시 통화', at(9), E('통화', today, at(22))],
    ['call mom tonight at 8', at(9), E('call mom', today, at(20))],
    ['call mom tonight 8', at(9), E('call mom', today, at(20))],
    ['gym today 8pm', at(9), E('gym', today, at(20))],
    ['gym tomorrow 11 pm', at(9), E('gym', tomorrow, at(23))],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('"오늘" 인데 오전 그 시각이 지났고 오후 그 시각은 아직이면 오후', () => {
  const table: [string, number, unknown][] = [
    ['오늘 8시 회의', at(20), E('회의', today, at(20))],
    ['오늘 8시 회의', at(19, 59), E('회의', today, at(20))],
    ['오늘 9시 반 통화', at(12), E('통화', today, at(21, 30))],
    ['오늘 11시 마감 확인', at(11, 30), E('마감 확인', today, at(23))],
    ['meeting today at 10', at(13), E('meeting', today, at(22))],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('오전이 아직이면 그대로 오전, 오후도 지났으면 그대로 둔다', () => {
  const table: [string, number, unknown][] = [
    // 오전 8시가 아직: 오전
    ['오늘 8시 회의', at(7), E('회의', today, at(8))],
    ['meeting today at 10', at(9), E('meeting', today, at(10))],
    // 오후 8시도 지났다: 적은 그대로 (지난 시각)
    ['오늘 8시 회의', at(21), E('회의', today, at(8))],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('오전, 아침, 새벽, am 을 적으면 오전 그대로', () => {
  const table: [string, number, unknown][] = [
    ['오늘 오전 8시 회의', at(20), E('회의', today, at(8))],
    ['오늘 아침 8시 회의', at(20), E('회의', today, at(8))],
    ['내일 오전 9시 저녁 장보기', at(9), E('저녁 장보기', tomorrow, at(9))],
    ['오늘 8시 아침 운동', at(20), E('아침 운동', today, at(8))],
    ['standup today 8am', at(20), E('standup', today, at(8))],
    ['dinner prep tomorrow 9 am', at(9), E('dinner prep', tomorrow, at(9))],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('날짜를 안 적었거나 내일, 요일이면 예전처럼 (지난 오전은 내일 오전)', () => {
  const table: [string, number, unknown][] = [
    ['8시 회의', at(9), E('회의', tomorrow, at(8))],
    ['내일 8시 회의', at(20), E('회의', tomorrow, at(8))],
    ['tomorrow at 10 sync', at(20), E('sync', tomorrow, at(10))],
    // 두 자리 24시 표기는 그대로
    ['오늘 08:00 회의', at(20), E('회의', today, at(8))],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('12시와 0시는 옮기지 않는다', () => {
  const table: [string, number, unknown][] = [
    ['오늘 12시 저녁', at(20), E('저녁', today, at(12))],
    ['오늘 12시 점심', at(13), E('점심', today, at(12))],
    ['오늘 0시 저녁 정리', at(9), E('저녁 정리', today, at(0))],
    ['밤 12시 정리', at(9), E('정리', tomorrow, at(0))],
    ['오후 12시 점심', at(9), E('점심', today, at(12))],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('범위: 오후로 옮겨도 길이는 그대로, 자정을 넘기면 옮기지 않는다', () => {
  const table: [string, number, unknown][] = [
    ['오늘 8시~9시 회의', at(20), E('회의', today, at(20), 60)],
    ['오늘 8시~9시 회의', at(21, 30), E('회의', today, at(8), 60)],
    ['오늘 8시~9시 저녁 회의', at(9), E('저녁 회의', today, at(20), 60)],
    ['오늘 8시부터 10시까지 저녁 모임', at(9), E('저녁 모임', today, at(20), 120)],
    ['오늘 11시~1시 저녁', at(9), E('저녁', today, at(11), 120)],
  ];
  for (const [text, now, want] of table) assert.deepEqual(parseQuickEvent(text, today, now), want, text);
});

test('할 일 마감 시각도 같은 규칙', () => {
  const a = parseTodoLine('오늘 9시까지 보고서', today, at(20));
  assert.equal(a.title, '보고서');
  assert.equal(a.due, today);
  assert.equal(a.dueMin, at(21));
  const b = parseTodoLine('오늘 오전 9시까지 보고서', today, at(20));
  assert.equal(b.dueMin, at(9));
  const c = parseTodoLine('report due today at 10', today, at(13));
  assert.equal(c.dueMin, at(22));
});
