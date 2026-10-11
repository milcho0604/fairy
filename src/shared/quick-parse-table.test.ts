// 한 줄 입력 표 시험 (감사 3차). 기준: 2026-10-14 수요일, 지금 오전 10시.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEventInput, parseQuickEvent } from './event-store.ts';
import { parseTodoLine } from './remind-parse.ts';

const today = '2026-10-14';
const tomorrow = '2026-10-15';
const ten = 10 * 60;
const at = (h: number, m = 0) => h * 60 + m;
const E = (title: string, day: string, minute: number, durationMin: number | null = null) => ({
  title,
  day,
  minute,
  durationMin,
});
const ev = (s: string) => parseQuickEvent(s, today, ten);
const todo = (s: string) => {
  const r = parseTodoLine(s, today, ten);
  return { title: r.title, due: r.due, dueMin: r.dueMin };
};
const D = (title: string, due: string | null, dueMin: number | null = null) => ({ title, due, dueMin });

test('자정을 넘는 범위: 끝에 새벽, 오전, am 을 적어도 다음 날로 읽는다', () => {
  const table: [string, unknown][] = [
    ['밤 11시~새벽 1시 파티', E('파티', today, at(23), 120)],
    ['오후 10시~오전 2시 파티', E('파티', today, at(22), 240)],
    ['밤 10시부터 새벽 2시까지 야근', E('야근', today, at(22), 240)],
    ['11pm-1am party', E('party', today, at(23), 120)],
    ['10pm to 2am party', E('party', today, at(22), 240)],
    ['내일 밤 11시~새벽 1시 파티', E('파티', tomorrow, at(23), 120)],
    ['오후 11시~1시 파티', E('파티', today, at(23), 120)], // 예전부터 되던 것
    ['밤 11시~밤 12시 파티', E('파티', today, at(23), 60)],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
});

test('자정을 넘는 범위도 24시간 넘게는 읽지 않는다. 끝이 오후인데 시작보다 이르면 틀린 범위', () => {
  for (const text of ['오후 3시~오후 2시 회의', '3pm-2pm meeting', '오전 10시~오전 9시 회의'])
    assert.equal(ev(text), null, text);
});

test('자정, 정오 뒤 조사: 까지, 부터, 쯤', () => {
  const table: [string, unknown][] = [
    ['자정부터 서버 점검', E('서버 점검', tomorrow, 0)],
    ['정오부터 회의', E('회의', today, at(12))],
    ['내일 정오쯤 점심', E('점심', tomorrow, at(12))],
    ['정오에 점심', E('점심', today, at(12))],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
});

test('할 일 "자정까지" 는 그날 밤 11시 59분 마감, "정오까지" 는 낮 12시', () => {
  const table: [string, unknown][] = [
    ['자정까지 보고서', D('보고서', today, at(23, 59))],
    ['오늘 자정까지 보고서', D('보고서', today, at(23, 59))],
    ['내일 자정까지 보고서', D('보고서', tomorrow, at(23, 59))],
    ['보고서 자정까지', D('보고서', today, at(23, 59))],
    ['report by midnight', D('report', today, at(23, 59))],
    ['정오까지 보고서', D('보고서', today, at(12))],
    ['내일 정오까지 보고서', D('보고서', tomorrow, at(12))],
  ];
  for (const [text, want] of table) assert.deepEqual(todo(text), want, text);
});

test('일정 탭: "오늘 자정부터 점검" 을 종일로 넣지 않는다', () => {
  const r = parseEventInput('오늘 자정부터 점검', today, ten);
  assert.deepEqual(r, E('점검', tomorrow, 0));
});
