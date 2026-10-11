import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  currentBlock,
  focusBlocks,
  freeGaps,
  PLAN_PREFS,
  parsePlanFile,
  parsePolishReply,
  pickScore,
  planCandidates,
  planRange,
  polishPlanPrompt,
  shouldAutoOpen,
  shouldNudge,
  suggestPicks,
} from './day-plan.ts';

const MIN = 60_000;
// 하루 0시를 0 으로 두고 분으로 센다 (시간대를 타지 않게)
const at = (h: number, m = 0) => (h * 60 + m) * MIN;
const todo = (id: number, o: Partial<Parameters<typeof pickScore>[0]> = {}) => ({
  id,
  title: `할 일 ${id}`,
  due: null,
  important: false,
  createdAt: id,
  ...o,
});

test('꼭 할 일 고르기: 지난 마감, 오늘 마감, 중요가 위로, 습관(반복)은 빼고, 셋까지', () => {
  const today = '2026-10-07';
  const open = [
    todo(1),
    todo(2, { due: '2026-10-08' }),
    todo(3, { due: today }),
    todo(4, { due: '2026-10-05' }),
    todo(5, { important: true }),
    todo(6, { due: today, repeat: 'daily' }),
    todo(7, { due: today, important: true }),
  ];
  assert.deepEqual(suggestPicks(open, today), [7, 4, 3]);
  assert.deepEqual(
    planCandidates(open, today).map((x) => x.id),
    [7, 4, 3, 5, 2, 1],
  );
  assert.ok(
    pickScore(todo(8, { due: '2026-10-08' }), today) > pickScore(todo(9, { due: '2026-10-10' }), today),
  );
  // 마감도 중요도 없으면 먼저 넣은 것 하나만 골라 준다
  assert.deepEqual(suggestPicks([todo(11), todo(10)], today), [10]);
  assert.deepEqual(suggestPicks([], today), []);
});

test('빈 시간: 일정 앞뒤 5분 여유, 종일 일정은 안 막고, 25분보다 짧은 틈은 버린다', () => {
  const events = [
    { title: '회의', startAt: at(10), endAt: at(11), allDay: false },
    { title: '점심', startAt: at(12), endAt: at(13), allDay: false },
    // 끝이 없으면 30분
    { title: '전화', startAt: at(13, 20), endAt: null, allDay: false },
    { title: '여행', startAt: 0, endAt: at(24), allDay: true },
  ];
  const gaps = freeGaps(events, at(9), at(18));
  assert.deepEqual(
    gaps.map((g) => [g.start / MIN, g.end / MIN]),
    [
      [9 * 60, 9 * 60 + 55],
      [11 * 60 + 5, 11 * 60 + 55],
      [13 * 60 + 55, 18 * 60],
    ],
  );
  // 13:05~13:15 은 짧아서 없다. 겹치는 일정도 하나로
  const overlap = freeGaps(
    [
      { title: 'a', startAt: at(9), endAt: at(12), allDay: false },
      { title: 'b', startAt: at(10), endAt: at(11), allDay: false },
    ],
    at(9),
    at(13),
  );
  assert.deepEqual(
    overlap.map((g) => g.start / MIN),
    [12 * 60 + 5],
  );
  assert.deepEqual(freeGaps([], at(10), at(9)), []);
  // 시작은 5분 단위로 올린다
  assert.equal((freeGaps([], at(9, 2), at(10))[0]?.start ?? 0) / MIN, 9 * 60 + 5);
});

test('집중 칸: 빈 시간에 50분씩, 사이 10분 쉬고, 꼭 할 일을 차례로 붙인다', () => {
  const gaps = [
    { start: at(9), end: at(9, 40) },
    { start: at(11, 5), end: at(11, 20) }, // 짧다
    { start: at(14), end: at(18) },
  ];
  const blocks = focusBlocks(gaps, [7, 4, 3]);
  assert.deepEqual(
    blocks.map((b) => [b.start / MIN, b.end / MIN, b.todoId]),
    [
      [9 * 60, 9 * 60 + 40, 7],
      [14 * 60, 14 * 60 + 50, 4],
      [15 * 60, 15 * 60 + 50, 3],
    ],
  );
  // 꼭 할 일이 없으면 칸 하나 (할 일 없이)
  assert.deepEqual(focusBlocks(gaps, []), [{ start: at(9), end: at(9, 40) }]);
  assert.deepEqual(focusBlocks([], [1]), []);
  assert.equal(currentBlock(blocks, at(14, 10))?.todoId, 4);
  assert.equal(currentBlock(blocks, at(14, 55)), undefined);
});

test('찾는 범위: 9시나 지금부터 회고 시각까지, 늦었으면 밤 10시까지', () => {
  assert.deepEqual(planRange(0, at(7), 18 * 60), { from: at(9), to: at(18) });
  assert.deepEqual(planRange(0, at(10, 3), 18 * 60), { from: at(10, 5), to: at(18) });
  assert.deepEqual(planRange(0, at(17, 50), 18 * 60), { from: at(17, 50), to: at(22) });
});

test('계획 파일 읽기: 틀린 칸은 버리고 기본 설정', () => {
  assert.deepEqual(parsePlanFile(undefined), { prefs: PLAN_PREFS });
  const f = parsePlanFile({
    prefs: { auto: false, fromMinute: 99999 },
    shownDay: '2026-10-07',
    nudgedDay: 'x',
    plan: {
      day: '2026-10-07',
      picks: [3, 3, -1, 'a', 4, 5, 6],
      blocks: [{ start: 10, end: 5 }, { start: 10, end: 20, todoId: 3 }, null],
      note: '  좋아  ',
      at: 1,
    },
  });
  assert.deepEqual(f.prefs, { auto: false, fromMinute: PLAN_PREFS.fromMinute });
  assert.equal(f.shownDay, '2026-10-07');
  assert.equal(f.nudgedDay, undefined);
  assert.deepEqual(f.plan, {
    day: '2026-10-07',
    picks: [3, 4, 5],
    blocks: [{ start: 10, end: 20, todoId: 3 }],
    note: '좋아',
    at: 1,
  });
});

test('저절로 띄우기와 펫 한마디: 정한 시각 뒤 아침에 하루 한 번, 계획이 있으면 안 한다', () => {
  const f = parsePlanFile({ prefs: { auto: true, fromMinute: 8 * 60 } });
  const today = '2026-10-07';
  assert.equal(shouldAutoOpen(f, today, 7 * 60 + 59), false);
  assert.equal(shouldAutoOpen(f, today, 8 * 60), true);
  assert.equal(shouldAutoOpen(f, today, 13 * 60), false); // 점심 넘어서는 안 띄운다
  assert.equal(shouldAutoOpen({ ...f, shownDay: today }, today, 9 * 60), false);
  assert.equal(
    shouldAutoOpen({ ...f, plan: { day: today, picks: [], blocks: [], at: 1 } }, today, 9 * 60),
    false,
  );
  assert.equal(shouldAutoOpen({ ...f, prefs: { auto: false, fromMinute: 0 } }, today, 9 * 60), false);
  // 늦게 정해 두면(오후 2시) 그 뒤 한 시간은 띄운다
  assert.equal(
    shouldAutoOpen({ ...f, prefs: { auto: true, fromMinute: 14 * 60 } }, today, 14 * 60 + 30),
    true,
  );
  // 펫 한마디는 패널을 저절로 띄운 것과 따로 하루 한 번
  assert.equal(shouldNudge({ ...f, shownDay: today }, today, 9 * 60), true);
  assert.equal(shouldNudge({ ...f, nudgedDay: today }, today, 9 * 60), false);
});

test('AI 다듬기: 글에 할 일 id 와 빈 시간, 답은 아는 id 만 셋까지', () => {
  const prompt = polishPlanPrompt({
    ask: '다듬어 줘',
    candidates: [todo(1, { title: '보고서', due: '2026-10-07', important: true }), todo(2)],
    picks: [1],
    events: [{ time: '10:00', title: '회의' }],
    gaps: [{ time: '14:00-15:00' }],
    today: '2026-10-07',
  });
  assert.match(prompt, /id 1: 보고서 \(due 2026-10-07\) \[important\]/);
  assert.match(prompt, /14:00-15:00/);
  assert.match(prompt, /JSON/);
  assert.deepEqual(parsePolishReply('좋아! {"picks":[2, 9, 1, 2], "why":"보고서부터\n하자"}', [1, 2]), {
    picks: [2, 1],
    why: '보고서부터 하자',
  });
  assert.deepEqual(parsePolishReply('{"picks":[1]}', [1]), { picks: [1] });
  assert.equal(parsePolishReply('몰라', [1]), undefined);
  assert.equal(parsePolishReply('{"picks":[5]}', [1]), undefined);
  assert.equal(parsePolishReply('{bad json}', [1]), undefined);
  assert.equal(parsePolishReply(undefined, [1]), undefined);
});
