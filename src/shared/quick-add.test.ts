import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueLabel, hasDeadlineWord, parseQuickTodo } from './quick-add.ts';

const today = '2026-10-31';

test('날짜 낱말과 느낌표', () => {
  assert.deepEqual(parseQuickTodo('내일 보고서 쓰기!', today), {
    title: '보고서 쓰기',
    due: '2026-11-01',
    important: true,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('보고서 쓰기 모레까지', today), {
    title: '보고서 쓰기',
    due: '2026-11-02',
    important: false,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('!! 오늘까지 메일 답장', today), {
    title: '메일 답장',
    due: today,
    important: true,
    repeat: null,
  });
});

test('날짜 낱말이 제목 가운데나 붙어 있으면 제목 그대로', () => {
  assert.deepEqual(parseQuickTodo('오늘의 메모 정리', today), {
    title: '오늘의 메모 정리',
    due: null,
    important: false,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('내일배움카드 신청', today), {
    title: '내일배움카드 신청',
    due: null,
    important: false,
    repeat: null,
  });
  assert.deepEqual(parseQuickTodo('  여러   칸  띄움  ', today), {
    title: '여러 칸 띄움',
    due: null,
    important: false,
    repeat: null,
  });
});

test('반복 낱말: 매일, 평일, 매주. 마감은 오늘(평일은 다음 평일)', () => {
  // 2026-10-31 은 토요일
  assert.deepEqual(parseQuickTodo('매일 운동', today), {
    title: '운동',
    due: today,
    important: false,
    repeat: 'daily',
  });
  assert.deepEqual(parseQuickTodo('평일 스탠드업!', today), {
    title: '스탠드업',
    due: '2026-11-02',
    important: true,
    repeat: 'weekdays',
  });
  assert.deepEqual(parseQuickTodo('매주 내일 주간 보고', today), {
    title: '주간 보고',
    due: '2026-11-01',
    important: false,
    repeat: 'weekly',
  });
  assert.equal(parseQuickTodo('매일매일 일기', today).repeat, null);
});

test('마감 표시', () => {
  assert.deepEqual(dueLabel(today, today), { text: '오늘', overdue: false });
  assert.deepEqual(dueLabel('2026-11-01', today), { text: '내일', overdue: false });
  assert.deepEqual(dueLabel('2026-10-29', today), { text: '10월 29일 지남', overdue: true });
  assert.deepEqual(dueLabel('2026-12-05', today), { text: '12월 5일', overdue: false });
});

test('영어 날짜 낱말은 대소문자를 가리지 않는다', () => {
  assert.equal(parseQuickTodo('Tomorrow buy milk', today).due, '2026-11-01');
  assert.equal(parseQuickTodo('buy milk TODAY', today).title, 'buy milk');
});

// ---- 영어 빠른 입력 (F). 2026-10-31 은 토요일 ----

const due = (s: string) => parseQuickTodo(s, today).due;
const title = (s: string) => parseQuickTodo(s, today).title;

test('영어 날짜 낱말: today, tonight, tomorrow, the day after tomorrow, 앞뒤 어디든', () => {
  assert.deepEqual(parseQuickTodo('tomorrow write report!', today), {
    title: 'write report',
    due: '2026-11-01',
    important: true,
    repeat: null,
  });
  assert.equal(due('tonight laundry'), today);
  assert.equal(due('tmrw call bank'), '2026-11-01');
  assert.equal(due('the day after tomorrow dentist'), '2026-11-02');
  assert.equal(due('dentist day after tomorrow'), '2026-11-02');
  assert.equal(due('send invoice by tomorrow'), '2026-11-01');
  assert.equal(title('send invoice by tomorrow'), 'send invoice');
});

test('영어 요일: 온 이름은 그대로, next 는 다음 주(월요일 시작), this 와 on 도 뗀다', () => {
  assert.equal(due('monday meeting notes'), '2026-11-02');
  assert.equal(title('monday meeting notes'), 'meeting notes');
  assert.equal(due('call mom on Friday'), '2026-11-06');
  assert.equal(title('call mom on Friday'), 'call mom');
  assert.equal(due('clean desk saturday'), today); // 오늘이 토요일이면 오늘
  assert.equal(due('meeting notes this sunday'), '2026-11-01');
  assert.equal(due('report by next mon'), '2026-11-02');
  assert.equal(due('next friday pay rent'), '2026-11-06');
  assert.equal(due('pay rent due thu'), '2026-11-05');
  assert.equal(title('pay rent due thu'), 'pay rent');
});

test('영어 낱말이 제목의 일부면 날짜로 읽지 않는다', () => {
  for (const s of [
    'sun cream',
    'buy sun cream',
    'Monica lunch',
    'sundays brunch',
    'todays plan',
    'wed planner',
  ]) {
    assert.deepEqual(parseQuickTodo(s, today), { title: s, due: null, important: false, repeat: null }, s);
  }
  assert.equal(due('fix the today widget'), null); // 가운데 낱말은 제목
  assert.equal(due('mondays'), null);
});

test('영어 반복: daily, every day, weekdays, weekly, every monday (앞뒤 어디든)', () => {
  assert.deepEqual(parseQuickTodo('daily stretch', today), {
    title: 'stretch',
    due: today,
    important: false,
    repeat: 'daily',
  });
  assert.equal(parseQuickTodo('journal every day', today).repeat, 'daily');
  assert.equal(parseQuickTodo('Every Day journal', today).title, 'journal');
  assert.deepEqual(parseQuickTodo('weekdays standup!', today), {
    title: 'standup',
    due: '2026-11-02',
    important: true,
    repeat: 'weekdays',
  });
  assert.equal(parseQuickTodo('standup every weekday', today).repeat, 'weekdays');
  assert.equal(parseQuickTodo('weekly review', today).repeat, 'weekly');
  assert.deepEqual(parseQuickTodo('gym every monday', today), {
    title: 'gym',
    due: '2026-11-02',
    important: false,
    repeat: 'weekly',
  });
  assert.equal(due('Every Saturday groceries'), today);
  assert.equal(parseQuickTodo('weekly tomorrow team sync', today).due, '2026-11-01');
  assert.equal(parseQuickTodo('dailyish notes', today).repeat, null);
  assert.equal(parseQuickTodo('everyday carry', today).repeat, null); // 붙여 쓴 everyday 는 형용사라 반복이 아니다
});

test('한국어 동작은 그대로 (영어를 읽어도)', () => {
  assert.equal(due('내일 보고서'), '2026-11-01');
  // 반복 없는 한국어 요일도 마감으로 읽는다. 영어 "friday report" 와 같은 날 (2026-10-08, 예전에는 null)
  assert.equal(due('금요일 보고서'), '2026-11-06');
  // 예전에는 "매주 월요일 회의" 가 마감 오늘(토), 제목 "월요일 회의" 였다. 영어 "gym every monday" 는 다음 월요일이라
  // 같은 뜻이 말에 따라 달랐다(2026-10-08 회귀 시험). 이제 반복 요일이 있으면 다가오는 그 요일이다
  assert.deepEqual(parseQuickTodo('매주 월요일 회의', today), {
    title: '회의',
    due: '2026-11-02',
    important: false,
    repeat: 'weekly',
  });
  assert.equal(title('오늘의 메모 정리'), '오늘의 메모 정리');
});

test('영어 마감 표시는 일정이 아니라 할 일로 보낸다', () => {
  for (const s of ['report by 5pm', 'pay rent due friday', 'finish deck until noon', '3시까지 보고서']) {
    assert.equal(hasDeadlineWord(s), true, s);
  }
  for (const s of [
    'stand by me 3pm',
    'lunch by the river at noon',
    'meeting tomorrow at 3pm',
    '내일 3시 회의',
  ]) {
    assert.equal(hasDeadlineWord(s), false, s);
  }
});

test('반복 요일은 한국어와 영어가 같은 날: 오늘이 그 요일이면 오늘, 아니면 다음 그 요일', () => {
  const ko = ['일', '월', '화', '수', '목', '금', '토'];
  const en = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  // 2026-11-01(일) 부터 한 주 내내 오늘을 바꿔 가며 일곱 요일을 모두 본다
  for (let d = 1; d <= 7; d++) {
    const day = `2026-11-0${d}`;
    for (let w = 0; w < 7; w++) {
      const want = `2026-11-${String(d + ((w - (d - 1) + 7) % 7)).padStart(2, '0')}`;
      const forms = [
        `매주 ${ko[w]}요일 회의`,
        `${ko[w]}요일마다 회의`,
        `회의 매주 ${ko[w]}요일`,
        `회의 ${ko[w]}요일마다`,
        `매주 ${ko[w]}요일마다 회의`,
        `every ${en[w]} 회의`,
        `회의 every ${en[w]}`,
      ];
      for (const s of forms)
        assert.deepEqual(
          parseQuickTodo(s, day),
          { title: '회의', due: want, important: false, repeat: 'weekly' },
          `${day} ${s}`,
        );
    }
  }
  // 오늘이 월요일이면 오늘
  assert.equal(parseQuickTodo('매주 월요일 회의', '2026-11-02').due, '2026-11-02');
  assert.equal(parseQuickTodo('gym every monday', '2026-11-02').due, '2026-11-02');
  // 느낌표, 날짜 낱말은 그대로 함께 읽는다 (날짜 낱말이 있으면 그 날이 첫 마감)
  assert.deepEqual(parseQuickTodo('매주 금요일 주간 보고!', today), {
    title: '주간 보고',
    due: '2026-11-06',
    important: true,
    repeat: 'weekly',
  });
  assert.equal(parseQuickTodo('매주 금요일 주간 보고 내일', today).due, '2026-11-01');
  // "마다" 없이 혼자인 요일은 반복이 아니라 그 요일 마감 (영어 "monday meeting" 과 같다)
  assert.deepEqual(parseQuickTodo('월요일 회의', today), {
    title: '회의',
    due: '2026-11-02',
    important: false,
    repeat: null,
  });
  assert.equal(parseQuickTodo('회의는 월요일마다 하기', today).repeat, null);
  // 요일 없는 "매주" 는 그대로 오늘
  assert.equal(parseQuickTodo('매주 주간 보고', today).due, today);
});
