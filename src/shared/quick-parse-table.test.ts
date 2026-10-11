// 한 줄 입력 표 시험 (감사 3차). 기준: 2026-10-14 수요일, 지금 오전 10시.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEventInput, parseQuickEvent, parseQuickEventInfo } from './event-store.ts';
import { hasDeadlineWord, parseQuickTodo } from './quick-add.ts';
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

test('한 글자 요일: 시각이 뒤에 오거나 앞에 다음 주, 이번 주가 있을 때만', () => {
  const table: [string, unknown][] = [
    ['금 3시 회의', E('회의', '2026-10-16', at(15))],
    ['월 9시 스탠드업', E('스탠드업', '2026-10-19', at(9))],
    ['토 오전 10시 브런치', E('브런치', '2026-10-17', at(10))],
    ['수 9시 회의', E('회의', '2026-10-21', at(9))], // 오늘 수요일 9시는 지났다
    ['금에 3시 회의', E('회의', '2026-10-16', at(15))],
    ['다음주 월 9시 회의', E('회의', '2026-10-19', at(9))],
    ['다음 주 금 3시 회의', E('회의', '2026-10-23', at(15))],
    ['다다음 주 화 2시 면접', E('면접', '2026-10-27', at(14))],
    ['이번 주 토 오전 10시 브런치', E('브런치', '2026-10-17', at(10))],
    ['다음 주 금 회의 3시', E('회의', '2026-10-23', at(15))],
    ['다음 주 일 3시 브런치', E('브런치', '2026-10-25', at(15))],
    // "일"은 일하다일 수 있어 앞말 없이는 요일로 보지 않는다
    ['일 3시 시작', E('일 시작', today, at(15))],
    ['금목걸이 3시 찾기', E('금목걸이 찾기', today, at(15))],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
});

test('한 글자 요일 할 일 마감: 다음 주, 이번 주가 있을 때만', () => {
  const td = (s: string) => {
    const q = parseQuickTodo(s, today);
    return [q.title, q.due];
  };
  assert.deepEqual(td('다음주 월 보고서'), ['보고서', '2026-10-19']);
  assert.deepEqual(td('다음 주 금까지 보고서'), ['보고서', '2026-10-23']);
  assert.deepEqual(td('보고서 이번 주 금'), ['보고서', '2026-10-16']);
  assert.deepEqual(td('금 목걸이 사기'), ['금 목걸이 사기', null]);
  assert.deepEqual(
    td('다음 주 일 정리'),
    ['일 정리', '2026-10-19'],
    '"일"은 앞말이 있어도 시각 없이는 요일이 아니다',
  );
  assert.deepEqual(td('다음 주 화이트보드 정리'), ['화이트보드 정리', '2026-10-19']);
});

test('오전, 오후 없는 1~7시: 아침 말이 있으면 오전, 아니면 오후로 읽고 오전으로 바꿀 길을 준다', () => {
  const table: [string, unknown][] = [
    ['내일 7시 조깅', E('조깅', tomorrow, at(7))],
    ['7시 아침 운동', E('아침 운동', tomorrow, at(7))], // 오늘 7시는 지났다
    ['내일 6시 기상', E('기상', tomorrow, at(6))],
    ['내일 7시 반 출근', E('출근', tomorrow, at(7, 30))],
    ['내일 5:30 첫차', E('첫차', tomorrow, at(5, 30))],
    ['tomorrow at 6 jog', E('jog', tomorrow, at(6))],
    ['내일 7시 저녁 약속', E('저녁 약속', tomorrow, at(19))],
    ['3시 회의', E('회의', today, at(15))],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
  const info = parseQuickEventInfo('3시 회의', today, ten);
  assert.deepEqual(info.am, E('회의', tomorrow, at(3)), '오전 3시는 지났으니 내일');
  assert.deepEqual(parseQuickEventInfo('내일 4시 미팅', today, ten).am, E('미팅', tomorrow, at(4)));
  assert.deepEqual(
    parseQuickEventInfo('금 2시~4시 회의', today, ten).am,
    E('회의', '2026-10-16', at(2), 120),
  );
  for (const text of ['오후 3시 회의', '15:00 회의', '내일 7시 조깅', '9시 회의', '07:30 회의', '3pm call'])
    assert.equal(parseQuickEventInfo(text, today, ten).am, undefined, text);
});

test('영어 eod, cob, end of day, tonight 9, this evening', () => {
  const table: [string, unknown][] = [
    ['call mom tonight 9', E('call mom', today, at(21))],
    ['dinner this evening at 7', E('dinner', today, at(19))],
    ['movie this evening 8:30', E('movie', today, at(20, 30))],
    ['review eod', E('review', today, at(18))],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
  const tds: [string, unknown][] = [
    ['report by eod', D('report', today, at(18))],
    ['report by EOD tomorrow', D('report', tomorrow, at(18))],
    ['report by cob', D('report', today, at(18))],
    ['report by end of day', D('report', today, at(18))],
    ['send invoice eod', D('send invoice', today, at(18))],
  ];
  for (const [text, want] of tds) assert.deepEqual(todo(text), want, text);
  for (const text of ['report by eod', 'send invoice eod', 'report end of day'])
    assert.ok(hasDeadlineWord(text), text);
});

test('"오전 중", "오후 중": 할 일은 그때까지, 일정 탭은 그 시간대', () => {
  const tds: [string, unknown][] = [
    ['내일 오전 중 보고서', D('보고서', tomorrow, at(12))],
    ['오후 중 보고서 보내기', D('보고서 보내기', today, at(18))],
    ['오전 중 보고서', D('보고서', today, at(12))], // 오전이 아직 안 끝났다
  ];
  for (const [text, want] of tds) assert.deepEqual(todo(text), want, text);
  assert.ok(hasDeadlineWord('내일 오전 중 보고서'));
  assert.deepEqual(parseEventInput('내일 오전 중 대청소', today, ten), E('대청소', tomorrow, at(9), 180));
  assert.deepEqual(parseEventInput('오후 중 외근', today, ten), E('외근', today, at(13), 300));
});

test('주말에 적은 "이번 주 금요일"은 다가오는 금요일 (확인 글에 날짜와 요일이 나온다)', () => {
  const sat = '2026-10-17';
  assert.equal(parseQuickTodo('이번 주 금요일 보고서', sat).due, '2026-10-23');
  assert.equal(parseQuickEvent('이번 주 금요일 3시 회의', sat, ten)?.day, '2026-10-23');
});

test('"오전 중" 이 다 지났으면 내일', () => {
  const r = parseTodoLine('오전 중 보고서', today, 13 * 60);
  assert.deepEqual([r.title, r.due, r.dueMin], ['보고서', tomorrow, at(12)]);
});
