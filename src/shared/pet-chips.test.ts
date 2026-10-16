import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setLang } from './i18n/index.ts';
import {
  CHIP_IDS,
  type ChipEvent,
  type ChipFacts,
  chipAnswer,
  chipButtons,
  isChipId,
  minutesLabel,
  nextEventOf,
  shortTitle,
  whenLabel,
} from './pet-chips.ts';

afterEach(() => setLang('ko'));

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(16, 14, 0);

const base: ChipFacts = {
  now: NOW,
  doneToday: 0,
  open: [],
  events: [],
  focusMin: 0,
  focusing: false,
  coins: 0,
};
const ev = (title: string, startAt: number, o: Partial<ChipEvent> = {}): ChipEvent => ({
  title,
  startAt,
  endAt: null,
  allDay: false,
  ...o,
});

test('칩은 다섯 개이고 단추 글이 비지 않는다', () => {
  assert.equal(CHIP_IDS.length, 5);
  const buttons = chipButtons();
  assert.deepEqual(
    buttons.map((b) => b.id),
    [...CHIP_IDS],
  );
  for (const b of buttons) assert.ok(b.label.length > 0 && !b.label.startsWith('chips.'));
  assert.ok(isChipId('coins'));
  assert.ok(!isChipId('nope'));
});

test('오늘 얼마나: 0개, 남은 게 있을 때, 다 했을 때', () => {
  assert.match(chipAnswer('todoDone', base), /아직 끝낸 할 일이 없어/);
  assert.equal(
    chipAnswer('todoDone', { ...base, doneToday: 3, open: ['a', 'b'] }),
    '오늘 할 일 3개 끝냈어! 남은 건 2개야.',
  );
  assert.equal(chipAnswer('todoDone', { ...base, doneToday: 3 }), '오늘 할 일 3개 끝냈어! 남은 건 없어.');
});

test('남은 할 일: 없으면 쉬라고, 있으면 개수와 첫 할 일', () => {
  assert.match(chipAnswer('todoLeft', base), /남은 할 일이 없어/);
  assert.equal(
    chipAnswer('todoLeft', { ...base, open: ['보고서 쓰기', '메일'] }),
    '남은 할 일이 2개야. 먼저 "보고서 쓰기" 어때?',
  );
});

test('긴 제목은 잘라 보이고 줄바꿈은 한 줄로', () => {
  assert.equal(shortTitle('가'.repeat(30)), `${'가'.repeat(23)}…`);
  assert.equal(shortTitle('두 줄\n제목'), '두 줄 제목');
});

test('자른 끝이 공백이면 떼고 말줄임표를 붙인다', () => {
  const t = shortTitle('보내기 전에 한 번 더 확인하기 아주 길게', 7);
  assert.equal(t, '보내기 전에…');
  assert.ok(!/\s…$/.test(t));
  assert.equal(shortTitle('가나다 라마바사', 5), '가나다…');
});

test('다음 일정: 가장 가까운 것, 끝난 것은 건너뛴다', () => {
  const events = [
    ev('어제 회의', at(15, 10)),
    ev('끝난 회의', at(16, 9), { endAt: at(16, 10) }),
    ev('내일 치과', at(17, 9, 30)),
    ev('오늘 저녁', at(16, 19)),
  ];
  assert.equal(nextEventOf(events, NOW)?.title, '오늘 저녁');
  assert.equal(
    chipAnswer('nextEvent', { ...base, events }),
    '다음 일정은 오늘 오후 7:00에 있는 "오늘 저녁" 일정이야.',
  );
  assert.match(chipAnswer('nextEvent', base), /2주 안에 일정이 없어/);
});

test('다음 일정: 지금 도는 일정과 종일 일정', () => {
  const running = [ev('스터디', at(16, 13), { endAt: at(16, 15) }), ev('나중', at(16, 20))];
  assert.equal(chipAnswer('nextEvent', { ...base, events: running }), '지금 "스터디" 일정이 진행 중이야.');
  const allDay = [ev('휴가', at(17, 0), { allDay: true }), ev('저녁', at(16, 21))];
  assert.equal(
    chipAnswer('nextEvent', { ...base, events: allDay }),
    '다음 일정은 오늘 오후 9:00에 있는 "저녁" 일정이야.',
  );
  assert.equal(whenLabel(allDay[0] as ChipEvent, NOW), '내일 종일');
  assert.equal(whenLabel(ev('먼 일정', at(20, 0)), NOW), '10월 20일 오전 12:00');
  // 며칠 걸친 종일 일정은 오늘이 그 안이면 오늘 종일
  const span = ev('출장', at(15, 0), { allDay: true, endAt: at(18, 0) });
  assert.equal(whenLabel(span, NOW), '오늘 종일');
});

test('오늘 집중: 0분, 분, 시간, 지금 도는 중', () => {
  assert.match(chipAnswer('focusToday', base), /아직 집중한 시간이 없어/);
  assert.equal(chipAnswer('focusToday', { ...base, focusMin: 45 }), '오늘 45분 집중했어.');
  assert.equal(chipAnswer('focusToday', { ...base, focusMin: 60 }), '오늘 1시간 집중했어.');
  assert.equal(
    chipAnswer('focusToday', { ...base, focusMin: 85, focusing: true }),
    '오늘 1시간 25분 집중했어. 지금도 집중 중이야!',
  );
  assert.equal(minutesLabel(0), '0분');
});

test('코인', () => {
  assert.equal(chipAnswer('coins', { ...base, coins: 120 }), '코인 120개 가지고 있어.');
});

test('영어 답: 단수 복수와 시각', () => {
  setLang('en');
  assert.equal(
    chipAnswer('todoDone', { ...base, doneToday: 1, open: ['x'] }),
    'You finished 1 to-do today! 1 left.',
  );
  assert.equal(chipAnswer('coins', { ...base, coins: 1 }), 'You have 1 coin.');
  assert.equal(
    chipAnswer('nextEvent', { ...base, events: [ev('Dentist', at(16, 19, 5))] }),
    'Your next event is "Dentist", today at 7:05 PM.',
  );
  assert.equal(chipAnswer('focusToday', { ...base, focusMin: 70 }), 'You focused for 1 hr 10 min today.');
});

test('모든 칩 답에 줄표와 가운뎃점이 없다 (ko, en)', () => {
  const facts: ChipFacts = {
    ...base,
    doneToday: 2,
    open: ['a'],
    events: [ev('x', at(16, 15))],
    focusMin: 30,
    coins: 5,
  };
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const id of CHIP_IDS) assert.ok(!/[—·]/.test(chipAnswer(id, facts)), `${lang} ${id}`);
  }
});
