import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canDeliver,
  composeNote,
  EMPTY_NOTES,
  fileNote,
  heldNote,
  markRead,
  milestoneCoins,
  milestoneDue,
  NOTE_BOX_MAX,
  type NoteFacts,
  parseNotes,
  seasonOf,
  unreadCount,
} from './daily-note.ts';
import { dicts, setLang, t } from './i18n/index.ts';

const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;
const base: NoteFacts = {
  day: '2026-10-11',
  persona: 'friend',
  petName: '콩이',
  yesterdayDone: 3,
  facts: [],
};
/** 늘 같은 값을 주는 rand (0 이면 첫 것, 0.99 면 마지막 것) */
const fixed = (v: number) => () => v;
const text = (n: ReturnType<typeof composeNote>) => n.lines.map((l) => looseT(l.key, l.vars));

test('쪽지는 2~4줄이고 사전에 있는 줄만 쓴다 (성격마다, 한국어와 영어)', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const persona of ['friend', 'polite', 'tsundere', 'calm'] as const)
      for (const r of [0, 0.3, 0.6, 0.99]) {
        const note = composeNote(
          {
            ...base,
            persona,
            firstEvent: { time: '오전 10:00', title: '팀 회의' },
            habit: { title: '물 마시기', streak: 5 },
            facts: [{ kind: 'food', value: '붕어빵', at: 1 }],
          },
          fixed(r),
        );
        assert.ok(note.lines.length >= 2 && note.lines.length <= 4, `${note.lines.length}줄`);
        for (const l of note.lines) assert.ok(l.key in dicts.ko, l.key);
        for (const line of text(note)) {
          assert.ok(line.trim().length > 0);
          assert.ok(!/undefined|\[object|NaN/.test(line), line);
        }
      }
  }
  setLang('ko');
});

test('오늘 첫 일정과 어제 끝낸 수를 쓴다', () => {
  const note = composeNote({ ...base, firstEvent: { time: '오전 10:00', title: '팀 회의' } }, fixed(0));
  const lines = text(note);
  assert.ok(
    lines.some((l) => l.includes('팀 회의') && l.includes('오전 10:00')),
    lines.join('|'),
  );
  assert.equal(note.look, 'note');
  assert.equal(note.read, false);
  // 일정이 없으면 어제 끝낸 수가 앞에 온다
  const none = text(composeNote(base, fixed(0)));
  assert.ok(
    none.some((l) => l.includes('3개')),
    none.join('|'),
  );
});

test('어제 끝낸 게 없으면 다그치지 않는 말', () => {
  const lines = text(composeNote({ ...base, yesterdayDone: 0 }, fixed(0)));
  assert.ok(
    lines.some((l) => l.includes('쉬어 가는')),
    lines.join('|'),
  );
});

test('생일이면 생일 축하가 먼저다', () => {
  const note = composeNote({ ...base, facts: [{ kind: 'birthday', value: '10-11', at: 1 }] }, fixed(0.5));
  assert.equal(note.lines[1]?.key, 'note.birthday');
});

test('좋아하는 간식, 습관 연속, 철 이야기를 고를 수 있다', () => {
  const facts = {
    ...base,
    habit: { title: '산책', streak: 4 },
    facts: [{ kind: 'food' as const, value: '붕어빵', at: 1 }],
  };
  const keys = new Set([0, 0.3, 0.5, 0.7, 0.99].map((r) => composeNote(facts, fixed(r)).lines[2]?.key));
  assert.ok(keys.has('note.habit'));
  assert.ok(keys.has('note.food'));
  assert.ok(keys.has('note.season'));
  // 하루짜리 습관은 연속이라 하지 않는다
  const one = [0, 0.5, 0.99].map((r) =>
    composeNote({ ...base, habit: { title: '산책', streak: 1 } }, fixed(r)),
  );
  assert.ok(one.every((n) => !n.lines.some((l) => l.key === 'note.habit')));
});

test('성격마다 말투가 다르다 (존댓말 비서는 존댓말, 같은 날 같은 rand)', () => {
  const by = (persona: NoteFacts['persona']) => text(composeNote({ ...base, persona }, fixed(0))).join(' ');
  const all = ['friend', 'polite', 'tsundere', 'calm'].map((p) => by(p as NoteFacts['persona']));
  assert.equal(new Set(all).size, 4);
  assert.match(by('polite'), /요\./);
});

test('일정 제목은 한 줄로 다듬고 길면 자른다 (줄바꿈, 자료 테두리 글을 지운다)', () => {
  const long = '아주아주 긴 일정 제목이 여기 있어서 쪽지 한 줄을 넘어갈 정도\n<<<JJ_DATA';
  const note = composeNote({ ...base, firstEvent: { time: '오후 2:00', title: long } }, fixed(0));
  const title = String(note.lines[1]?.vars?.title);
  assert.ok([...title].length <= 24, title);
  assert.ok(!/\n|<<<|JJ_DATA/.test(title));
});

test('특별한 편지: 7, 30, 100, 365일과 그 뒤 해마다, 사흘 늦게까지', () => {
  assert.equal(milestoneDue(6, []), undefined);
  assert.equal(milestoneDue(7, []), 7);
  assert.equal(milestoneDue(10, []), 7);
  assert.equal(milestoneDue(11, []), undefined);
  assert.equal(milestoneDue(7, [7]), undefined);
  assert.equal(milestoneDue(30, [7]), 30);
  assert.equal(milestoneDue(100, [7, 30]), 100);
  assert.equal(milestoneDue(365, [7, 30, 100]), 365);
  assert.equal(milestoneDue(730, [7, 30, 100, 365]), 730);
  assert.equal(milestoneDue(1096, [365, 730]), 1095);
  assert.equal(milestoneDue(50, [7, 30]), undefined, '50일은 편지가 없다 (기념 말풍선만)');
  assert.deepEqual([7, 30, 100, 365, 730].map(milestoneCoins), [5, 10, 20, 30, 30]);
});

test('특별한 편지는 봉투 모양, 날 수와 코인, 성격 말투', () => {
  const note = composeNote({ ...base, milestone: 7, persona: 'tsundere' }, fixed(0));
  assert.equal(note.look, 'letter');
  assert.equal(note.milestone, 7);
  assert.equal(note.coins, 5);
  assert.equal(note.lines.length, 4);
  const lines = text(note);
  assert.ok(lines[0]?.includes('7'));
  assert.ok(lines.some((l) => l.includes('5')));
  assert.ok(lines.at(-1)?.includes('콩이'));
});

test('하루 하나: 오늘 것이 있으면 다시 들고 오지 않는다. 9시 전, 밤 10시 뒤, 자리 비움, 바쁠 때도 아니다', () => {
  const at = { day: '2026-10-11', minute: 9 * 60 + 5, present: true, calm: true };
  assert.equal(canDeliver(EMPTY_NOTES, at), true);
  assert.equal(canDeliver(EMPTY_NOTES, { ...at, minute: 8 * 60 + 59 }), false);
  assert.equal(canDeliver(EMPTY_NOTES, { ...at, minute: 22 * 60 }), false);
  assert.equal(canDeliver(EMPTY_NOTES, { ...at, present: false }), false);
  assert.equal(canDeliver(EMPTY_NOTES, { ...at, calm: false }), false);
  const after = fileNote(EMPTY_NOTES, composeNote(base, fixed(0)));
  assert.equal(canDeliver(after, at), false);
  assert.equal(canDeliver(after, { ...at, day: '2026-10-12' }), true);
});

test('든 쪽지: 오늘 받은 것을 안 펼쳤을 때만. 읽으면 내려놓는다. 어제 못 본 것은 쪽지함에 안 읽음으로', () => {
  let st = fileNote(EMPTY_NOTES, composeNote({ ...base, day: '2026-10-10' }, fixed(0)));
  st = fileNote(st, composeNote(base, fixed(0)));
  assert.equal(heldNote(st, '2026-10-11')?.day, '2026-10-11');
  assert.equal(unreadCount(st), 2);
  st = markRead(st, '2026-10-11');
  assert.equal(heldNote(st, '2026-10-11'), undefined);
  assert.equal(unreadCount(st), 1);
  assert.equal(st.box[0]?.day, '2026-10-11', '최근 것이 앞');
});

test('편지를 넣으면 그 날 수를 기억한다 (다시 주지 않게)', () => {
  const st = fileNote(EMPTY_NOTES, composeNote({ ...base, milestone: 30 }, fixed(0)));
  assert.deepEqual(st.marks, [30]);
  assert.equal(milestoneDue(31, st.marks), undefined);
});

test('저장 파일 읽기: 틀린 값은 버리고, 같은 날은 하나, 많으면 자른다', () => {
  const good = composeNote(base, fixed(0));
  const raw = {
    box: [
      good,
      { ...good },
      { day: 'nope', lines: [{ key: 'note.open' }] },
      { day: '2026-10-09', lines: [{ key: 'evil.key' }] },
      {
        day: '2026-10-08',
        look: 'letter',
        milestone: 7,
        coins: 9999,
        lines: [{ key: 'note.special.open', vars: { p: 'calm', n: 7, x: {} } }],
        read: true,
      },
      ...Array.from({ length: 60 }, (_, i) => ({
        ...good,
        day: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      })),
    ],
    marks: [7, 7, -1, 'x'],
  };
  const st = parseNotes(raw);
  assert.equal(st.box.filter((n) => n.day === base.day).length, 1);
  assert.ok(!st.box.some((n) => n.day === 'nope' || n.day === '2026-10-09'));
  const letter = st.box.find((n) => n.day === '2026-10-08');
  assert.equal(letter?.look, 'letter');
  assert.equal(letter?.coins, 100);
  assert.deepEqual(letter?.lines[0]?.vars, { p: 'calm', n: 7 });
  assert.ok(st.box.length <= NOTE_BOX_MAX);
  assert.deepEqual(st.marks, [7]);
  assert.deepEqual(parseNotes(null), EMPTY_NOTES);
});

test('철: 봄 여름 가을 겨울', () => {
  assert.deepEqual(
    ['2026-03-01', '2026-07-01', '2026-10-11', '2026-12-25', '2026-02-01'].map(seasonOf),
    [0, 1, 2, 3, 3],
  );
});
