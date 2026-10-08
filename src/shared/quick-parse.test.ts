// 한 줄 입력 해석 다듬기 (2026-10-08 사용 디테일 점검). 기준: 2026-10-06 화요일, 지금 오전 9시.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasTimeRange, normalizeQuick, parseEventInput, parseQuickEvent, takeKoDue } from './event-store.ts';
import { hasDeadlineWord, parseQuickTodo } from './quick-add.ts';

const today = '2026-10-06';
const nine = 9 * 60;
const ev = (s: string) => parseQuickEvent(s, today, nine);
const at = (h: number, m = 0) => h * 60 + m;
const E = (title: string, day: string, minute: number, durationMin: number | null = null) => ({
  title,
  day,
  minute,
  durationMin,
});
const tomorrow = '2026-10-07';

test('시각 뒤 조사: 에, 부터, 까지, 쯤, 경', () => {
  const table: [string, unknown][] = [
    ['내일 3시에 회의', E('회의', tomorrow, at(15))],
    ['오후 2시반에 미팅', E('미팅', today, at(14, 30))],
    ['오후 2시 반에 미팅', E('미팅', today, at(14, 30))],
    ['15:00에 면접', E('면접', today, at(15))],
    ['4시쯤 택배', E('택배', today, at(16))],
    ['내일 10시경 점검', E('점검', tomorrow, at(10))],
    ['3시 30분에 통화', E('통화', today, at(15, 30))],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
});

test('콜론 시각도 오전, 오후와 1~7시 규칙을 따른다. 두 자리(07:30)는 그대로', () => {
  const table: [string, unknown][] = [
    ['오후 3:30 미팅', E('미팅', today, at(15, 30))],
    ['오전 11:30 미팅', E('미팅', today, at(11, 30))],
    ['3:30 미팅', E('미팅', today, at(15, 30))], // "3시 반" 과 같다
    ['call at 3:30', E('call', today, at(15, 30))],
    ['07:30 조깅', E('조깅', tomorrow, at(7, 30))], // 두 자리는 24시 표기, 지났으니 내일
    ['9:30 스탠드업', E('스탠드업', today, at(9, 30))], // 지금 9시라 아직 안 지났다
    ['8:30 스탠드업', E('스탠드업', tomorrow, at(8, 30))],
    ['14:00 면접', E('면접', today, at(14))],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
});

test('새벽, 낮, 밤 12시, 자정, 정오', () => {
  const table: [string, unknown][] = [
    ['새벽 2시 비행기', E('비행기', tomorrow, at(2))], // 새벽은 오후로 옮기지 않는다 (지났으니 내일)
    ['새벽 5시 30분 기차', E('기차', tomorrow, at(5, 30))],
    ['낮 2시 미팅', E('미팅', today, at(14))],
    ['낮 12시 점심', E('점심', today, at(12))],
    ['밤 12시 야식', E('야식', tomorrow, 0)], // 오늘 밤 12시 = 내일 0시
    ['오늘 밤 12시 야식', E('야식', tomorrow, 0)],
    ['저녁 12시 마감', E('마감', tomorrow, 0)],
    ['금요일 밤 12시 파티', E('파티', '2026-10-10', 0)], // 금요일 밤 = 토요일 0시
    ['화요일 밤 12시 배포', E('배포', '2026-10-07', 0)], // 오늘(화) 밤 12시, 다음 주가 아니다
    ['자정 배포', E('배포', tomorrow, 0)],
    ['내일 자정 배포', E('배포', '2026-10-08', 0)],
    ['정오 점심', E('점심', today, at(12))],
    ['밤 11시 운동', E('운동', today, at(23))],
    ['오전 12시 점검', E('점검', tomorrow, 0)],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
});

test('시각 범위: 시작과 길이, 오전 오후 이어받기, 자정 넘기기', () => {
  const table: [string, unknown][] = [
    ['3시부터 5시까지 회의', E('회의', today, at(15), 120)],
    ['2시~4시 워크숍', E('워크숍', today, at(14), 120)],
    ['2시 ~ 4시 워크숍', E('워크숍', today, at(14), 120)],
    ['10월 20일 오전 10시~12시 워크숍', E('워크숍', '2026-10-20', at(10), 120)],
    ['오후 2시~4시 반 워크숍', E('워크숍', today, at(14), 150)],
    ['11시~오후 1시 점심', E('점심', today, at(11), 120)],
    ['밤 11시~1시 배포', E('배포', today, at(23), 120)],
    ['14:00-15:30 리뷰', E('리뷰', today, at(14), 90)],
    ['내일 2시부터 3시 반까지 면접', E('면접', tomorrow, at(14), 90)],
    ['workshop 3-5pm', E('workshop', today, at(15), 120)],
    ['call 3pm-5pm', E('call', today, at(15), 120)],
    ['review 3:30 to 5 pm', E('review', today, at(15, 30), 90)],
    ['standup from 10 to 11:30am', E('standup', today, at(10), 90)],
    ['lunch 11am-1pm', E('lunch', today, at(11), 120)],
    ['party 8-10pm', E('party', today, at(20), 120)], // 끝의 pm 을 시작이 이어받는다
    ['8시~밤 10시 파티', E('파티', today, at(20), 120)],
    ['sync 2:00-3:30 tomorrow', E('sync', tomorrow, at(14), 90)],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
  // 시각이 아닌 범위는 범위가 아니다
  assert.equal(ev('5-6 people dinner 7pm')?.title, '5-6 people dinner');
  assert.equal(ev('5-6 people dinner 7pm')?.durationMin, null);
  assert.deepEqual(ev('10시~6시 근무'), E('근무', today, at(10), 8 * 60)); // 끝은 시작 뒤 가장 가까운 그 시각
  assert.equal(ev('오후 5시~오후 3시 x'), null); // 둘 다 때를 적었는데 끝이 앞서면 틀린 범위
});

test('범위의 "까지", "until" 은 마감이 아니다 (빠른 입력이 일정으로)', () => {
  for (const s of ['3시부터 5시까지 회의', '2시~4시 워크숍', 'meeting 3pm until 5pm', 'workshop 3-5pm'])
    assert.equal(hasTimeRange(s), true, s);
  for (const s of ['보고서 3시까지', 'report by 5pm', '내일 3시 회의', 'oct 10-12 trip', '5-6 people'])
    assert.equal(hasTimeRange(s), false, s);
  // 마감 낱말 판정 자체는 그대로 (패널이 범위를 먼저 본다)
  assert.equal(hasDeadlineWord('3시부터 5시까지 회의'), true);
});

test('상대 시각과 날짜: 30분 뒤, 1시간 반 후, in 30 min, 3일 뒤, 다음 달 5일, 15일', () => {
  const table: [string, unknown][] = [
    ['30분 뒤 빨래', E('빨래', today, at(9, 30))],
    ['빨래 30분 후에', E('빨래', today, at(9, 30))],
    ['1시간 반 후 회의', E('회의', today, at(10, 30))],
    ['2시간 15분 뒤 약 먹기', E('약 먹기', today, at(11, 15))],
    ['laundry in 30 min', E('laundry', today, at(9, 30))],
    ['call in an hour', E('call', today, at(10))],
    ['stretch in 1.5 hours', E('stretch', today, at(10, 30))],
    ['tea in half an hour', E('tea', today, at(9, 30))],
    ['16시간 뒤 비행기', E('비행기', tomorrow, at(1))], // 자정 넘기면 다음 날
    ['3일 뒤 2시 치과', E('치과', '2026-10-09', at(14))],
    ['dentist in 3 days at 2pm', E('dentist', '2026-10-09', at(14))],
    ['다음 달 5일 3시 결제', E('결제', '2026-11-05', at(15))],
    ['이번 달 20일 3시 정산', E('정산', '2026-10-20', at(15))],
    ['15일 2시 월세', E('월세', '2026-10-15', at(14))],
    ['1일 2시 월세', E('월세', '2026-11-01', at(14))], // 이번 달 1일은 지났으니 다음 달
    ['이번주 금요일 4시 회식', E('회식', '2026-10-09', at(16))],
    ['이번 주 금요일 4시 회식', E('회식', '2026-10-09', at(16))],
    ['금요일에 3시 회의', E('회의', '2026-10-09', at(15))],
    ['10월 20일에 3시 회의', E('회의', '2026-10-20', at(15))],
  ];
  for (const [text, want] of table) assert.deepEqual(ev(text), want, text);
  assert.equal(ev('0분 뒤 x'), null);
  assert.equal(ev('31일 3시 x')?.day, '2026-10-31');
  assert.equal(ev('다음 달 31일 3시 x'), null); // 11월 31일은 없다
});

test('붙여 쓰기와 전각: 내일3시 회의, 3시회의, ！, ３시', () => {
  assert.equal(normalizeQuick('내일3시 회의'), '내일 3시 회의');
  assert.equal(normalizeQuick('3시에회의'), '3시에 회의');
  assert.equal(normalizeQuick('3시반에회의'), '3시반에 회의');
  assert.equal(normalizeQuick('3시에 회의'), '3시에 회의'); // 조사를 떼지 않는다
  assert.equal(normalizeQuick('15:00에면접'), '15:00에 면접');
  assert.equal(normalizeQuick('넷플릭스 4시즌 보기'), '넷플릭스 4시즌 보기'); // 시즌, 시간은 띄우지 않는다
  assert.equal(normalizeQuick('운동 3시간'), '운동 3시간');
  assert.equal(normalizeQuick('보고서！'), '보고서!');
  assert.equal(normalizeQuick('오후３시　회의'), '오후3시 회의');
  assert.deepEqual(ev('내일3시 회의'), E('회의', tomorrow, at(15)));
  assert.deepEqual(ev('3시회의'), E('회의', today, at(15)));
  assert.deepEqual(ev('오후３시　회의'), E('회의', today, at(15)));
  assert.equal(ev('넷플릭스 4시즌 보기'), null);
});

test('할 일 마감: 한국어 요일, 월일, 글피, 15일, 다음 달 (영어 friday report 와 같은 규칙)', () => {
  const due = (s: string) => {
    const r = parseQuickTodo(s, today);
    return [r.title, r.due];
  };
  const table: [string, [string, string | null]][] = [
    ['금요일까지 보고서', ['보고서', '2026-10-09']],
    ['금요일 보고서', ['보고서', '2026-10-09']],
    ['보고서 금요일까지', ['보고서', '2026-10-09']],
    ['화요일 보고서', ['보고서', today]], // 오늘이 그 요일이면 오늘
    ['다음주 월요일 회의 준비', ['회의 준비', '2026-10-12']],
    ['이번 주 금요일 회식 장소', ['회식 장소', '2026-10-09']],
    ['10월 15일까지 세금', ['세금', '2026-10-15']],
    ['10/15 세금', ['세금', '2026-10-15']],
    ['세금 10/15', ['세금', '2026-10-15']],
    ['글피 장보기', ['장보기', '2026-10-09']],
    ['15일 월세', ['월세', '2026-10-15']],
    ['다음 달 5일 카드값', ['카드값', '2026-11-05']],
    ['3일 뒤 이사 준비', ['이사 준비', '2026-10-09']],
    ['내일까지보고서', ['보고서', '2026-10-07']],
    ['금요일까지보고서', ['보고서', '2026-10-09']],
    ['보고서！', ['보고서', null]],
    // 날짜가 아닌 것
    ['오늘의 메모 정리', ['오늘의 메모 정리', null]],
    ['3일 동안 운동', ['3일 동안 운동', null]],
    ['버전 1.5 올리기', ['버전 1.5 올리기', null]],
    ['월요일병 극복', ['월요일병 극복', null]],
    ['내일보고서', ['내일보고서', null]], // 조사 없이 붙은 것은 제목일 수 있다
  ];
  for (const [text, want] of table) assert.deepEqual(due(text), want, text);
  assert.equal(parseQuickTodo('보고서！', today).important, true);
  assert.equal(takeKoDue('2/30 휴가', today), null); // 없는 날짜
});

test('반복: 붙여 쓴 매일운동, 시각이 있어도 반복 할 일 (일정이 아니다)', () => {
  assert.deepEqual(parseQuickTodo('매일운동', today), {
    title: '운동',
    due: today,
    important: false,
    repeat: 'daily',
  });
  // 띄어쓰기를 한 글의 "매일경제" 는 신문 이름이라 그대로
  assert.equal(parseQuickTodo('매일경제 읽기', today).repeat, null);
  const r = parseQuickTodo('매일 아침 7시 스트레칭', today);
  assert.equal(r.repeat, 'daily');
  assert.equal(r.title, '아침 7시 스트레칭'); // 시각은 제목에 남긴다 (반복 할 일에는 시각 알림이 없다)
  assert.equal(parseQuickTodo('every day 7am stretch', today).repeat, 'daily');
});

test('일정 탭도 같은 다듬기를 쓴다 (종일과 시각)', () => {
  assert.deepEqual(parseEventInput('다음 달 5일 결제', today, nine), {
    title: '결제',
    day: '2026-11-05',
    lastDay: null,
    allDay: true,
  });
  assert.deepEqual(parseEventInput('15일 월세', today, nine), {
    title: '월세',
    day: '2026-10-15',
    lastDay: null,
    allDay: true,
  });
  assert.deepEqual(parseEventInput('move in 3 days', today, nine), {
    title: 'move',
    day: '2026-10-09',
    lastDay: null,
    allDay: true,
  });
  assert.deepEqual(parseEventInput('이번주 금요일 회식', today, nine), {
    title: '회식',
    day: '2026-10-09',
    lastDay: null,
    allDay: true,
  });
  assert.deepEqual(parseEventInput('내일3시에회의', today, nine), E('회의', tomorrow, at(15)));
  assert.deepEqual(parseEventInput('3시부터 5시까지 회의', today, nine), E('회의', today, at(15), 120));
});
