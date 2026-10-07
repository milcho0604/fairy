import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefingText, deadlineText, dueSlot, reviewText } from './briefing.ts';
import { breakFor, focusCoins, focusedMinutes, IDLE, remainLabel, startFocus, tickFocus } from './focus.ts';
import { setLang } from './i18n/index.ts';

const MIN = 60_000;

test('브리핑: 일정 하나, 여러 개, 마감, 아무것도 없을 때', () => {
  assert.equal(
    briefingText({ events: [{ minute: 600, title: '스탠드업' }], dueToday: 0, overdue: 0, nowMinute: 540 }),
    '좋은 아침! 오늘 일정은 오전 10:00 스탠드업 하나야.',
  );
  assert.equal(
    briefingText({
      events: [
        { minute: 600, title: '스탠드업' },
        { minute: 900, title: '회의' },
      ],
      dueToday: 2,
      overdue: 1,
      nowMinute: 13 * 60,
    }),
    '안녕! 오늘 일정 2개, 첫 일정은 오전 10:00 스탠드업. 할 일은 오늘 마감 2개, 지난 마감 1개 있어.',
  );
  assert.equal(
    briefingText({ events: [], dueToday: 0, overdue: 3, nowMinute: 20 * 60 }),
    '왔구나! 할 일은 지난 마감 3개 있어.',
  );
  assert.match(briefingText({ events: [], dueToday: 0, overdue: 0, nowMinute: 540 }), /일정도 마감도 없어/);
});

test('집중 타이머: 25분 뒤 쉬기로, 5분 뒤 멈춤. 늦게 깨도 한 단계씩', () => {
  const s = startFocus(0);
  assert.equal(tickFocus(s, 24 * MIN).event, undefined);
  const a = tickFocus(s, 25 * MIN);
  assert.equal(a.event, 'focus-done');
  assert.equal(a.state.phase, 'break');
  assert.equal(a.state.endsAt, 30 * MIN);
  const late = tickFocus(s, 120 * MIN);
  assert.equal(late.event, 'focus-done');
  assert.equal(late.state.phase, 'break');
  const b = tickFocus(a.state, 30 * MIN);
  assert.equal(b.event, 'break-done');
  assert.equal(b.state.phase, 'idle');
  assert.equal(tickFocus(IDLE, 999 * MIN).event, undefined);
});

test('집중한 분과 남은 시간 표시', () => {
  const s = startFocus(0);
  assert.equal(focusedMinutes(s, 10 * MIN + 59_000), 10);
  assert.equal(focusedMinutes(s, 99 * MIN), 25);
  assert.equal(focusedMinutes(IDLE, 5 * MIN), 0);
  assert.equal(remainLabel(s, 0), '25:00');
  assert.equal(remainLabel(s, 24 * MIN + 1000), '0:59');
});

test('하루 회고: 끝낸 수, 하나면 제목, 남은 오늘 마감이 있으면 묻는다', () => {
  assert.equal(reviewText({ doneTitles: [], leftToday: 0 }), '오늘은 끝낸 할 일이 없네. 그래도 수고했어.');
  assert.equal(reviewText({ doneTitles: ['보고서'], leftToday: 0 }), '오늘 "보고서" 끝냈어. 수고했어!');
  assert.equal(
    reviewText({ doneTitles: ['a', 'b', 'c'], leftToday: 2 }),
    '오늘 할 일 3개 끝냈어. 수고했어! 오늘 마감 2개가 남았는데 내일로 넘길까?',
  );
});

test('오늘 마감 알림 칸: 조용히는 없음, 보통은 14시부터 한 번, 수다쟁이는 10시와 15시, 회고 시각 뒤는 없음', () => {
  const review = 18 * 60;
  assert.equal(dueSlot(15 * 60, 'quiet', review), undefined);
  assert.equal(dueSlot(10 * 60, 'normal', review), undefined);
  assert.equal(dueSlot(13 * 60 + 59, 'normal', review), undefined);
  assert.equal(dueSlot(14 * 60, 'normal', review), 'pm');
  assert.equal(dueSlot(9 * 60 + 59, 'chatty', review), undefined);
  assert.equal(dueSlot(10 * 60, 'chatty', review), 'am');
  assert.equal(dueSlot(14 * 60 + 30, 'chatty', review), 'am');
  assert.equal(dueSlot(15 * 60, 'chatty', review), 'pm');
  assert.equal(dueSlot(18 * 60, 'chatty', review), undefined);
  assert.equal(dueSlot(18 * 60, 'normal', 20 * 60), 'pm');
});

test('오늘 마감 알림 글: 제목은 셋까지, 나머지는 개수로', () => {
  setLang('ko');
  assert.equal(deadlineText(['보고서']), '오늘 마감인 할 일이 1개 남았어. "보고서"');
  assert.equal(
    deadlineText(['a', 'b', 'c', 'd', 'e']),
    '오늘 마감인 할 일이 5개 남았어. "a", "b", "c" 외 2개',
  );
  setLang('en');
  assert.equal(deadlineText(['report']), 'One to-do is due today: "report"');
  setLang('ko');
});

test('집중 길이: 코인은 5분에 1개, 50분이면 쉬기 10분', () => {
  assert.deepEqual([15, 25, 50].map(focusCoins), [3, 5, 10]);
  assert.deepEqual([15, 25, 50].map(breakFor), [5, 5, 10]);
  const s = startFocus(0, 50);
  const r = tickFocus(s, 50 * MIN);
  assert.equal(r.event, 'focus-done');
  assert.equal(r.state.endsAt - r.state.startedAt, 10 * MIN);
  assert.equal(focusedMinutes(s, 50 * MIN), 50);
  const r15 = tickFocus(startFocus(0, 15), 15 * MIN);
  assert.equal(r15.state.endsAt - r15.state.startedAt, 5 * MIN);
});
