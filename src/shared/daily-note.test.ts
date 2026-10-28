import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canDeliver,
  canDeliverEvening,
  composeEvening,
  composeNote,
  composeWeek,
  EMPTY_NOTES,
  fileNote,
  heldNote,
  lastWeekDays,
  letterCovers,
  markRead,
  milestoneCoins,
  milestoneDue,
  NOTE_BOX_MAX,
  NOTE_VARIANTS,
  type NoteFacts,
  noteId,
  parseNotes,
  recentVariants,
  seasonOf,
  unreadCount,
  weekLetterDue,
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

test('쪽지는 2~5줄(추신이 붙으면 5줄)이고 사전에 있는 줄만 쓴다 (성격마다, 한국어와 영어)', () => {
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
        assert.ok(note.lines.length >= 2 && note.lines.length <= 5, `${note.lines.length}줄`);
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

test('특별한 편지: 7, 30, 50, 100, 200, 365, 500일과 그 뒤 해마다, 사흘 늦게까지', () => {
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
  assert.equal(milestoneDue(50, [7, 30]), 50);
  assert.equal(milestoneDue(100, [7, 30, 50]), 100);
  assert.equal(milestoneDue(200, [7, 30, 50, 100]), 200);
  assert.equal(milestoneDue(500, [7, 30, 50, 100, 200, 365]), 500);
  assert.equal(milestoneDue(300, [7, 30, 50, 100, 200]), undefined, '300일은 편지가 없다 (기념 말풍선만)');
  assert.deepEqual([7, 30, 50, 100, 200, 365, 500, 730].map(milestoneCoins), [5, 10, 10, 20, 20, 30, 30, 30]);
});

test('특별한 편지는 봉투 모양, 날 수와 코인, 성격 말투', () => {
  const note = composeNote({ ...base, milestone: 7, persona: 'tsundere' }, fixed(0));
  assert.equal(note.look, 'letter');
  assert.equal(note.milestone, 7);
  assert.equal(note.coins, 5);
  assert.equal(note.lines.length, 4);
  const lines = text(note);
  // 날 수는 제목(note.letterTitle)에만, 코인은 한 줄에만
  assert.match(t('note.letterTitle', { n: 7 }), /7/);
  assert.ok(!lines.some((l) => l.includes('7')));
  assert.equal(lines.filter((l) => l.includes('5')).length, 1);
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

test('특별한 편지는 날 수를 제목에만 말하고, 코인은 한 번만 말한다 (네 성격, 7, 30, 100, 365일)', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const persona of ['friend', 'polite', 'tsundere', 'calm'] as const)
      for (const milestone of [7, 30, 100, 365, 730]) {
        const n = composeNote({ ...base, persona, milestone }, () => 0.4);
        const body = text(n).join('\n');
        const coins = String(n.coins);
        assert.equal(body.split(coins).length - 1, 1, `${lang} ${persona} ${milestone}: ${body}`);
        assert.equal((body.match(/코인|coin/gi) ?? []).length, 1, body);
        assert.ok(!body.includes(String(milestone)), `${lang} ${persona} ${milestone}: ${body}`);
      }
    assert.match(t('note.letterTitle', { n: 365 }), lang === 'ko' ? /1년/ : /Year 1/);
    assert.match(t('note.letterTitle', { n: 730 }), lang === 'ko' ? /2년/ : /Year 2/);
    assert.match(t('note.letterTitle', { n: 30 }), /30/);
  }
  setLang('ko');
});

test('7, 30, 50, 100, 200일과 해마다 기념 말풍선은 특별한 편지가 대신한다 (300일은 말풍선)', () => {
  assert.ok(letterCovers({ mark: 7, key: 'companion.anniv.day' }));
  assert.ok(letterCovers({ mark: 100, key: 'companion.anniv.late' }));
  assert.ok(letterCovers({ mark: 366, key: 'companion.anniv.year' }));
  assert.ok(letterCovers({ mark: 50, key: 'companion.anniv.day' }));
  assert.ok(letterCovers({ mark: 200, key: 'companion.anniv.day' }));
  assert.ok(!letterCovers({ mark: 300, key: 'companion.anniv.day' }));
});

test('날마다 다른 말: 사전의 말 수가 NOTE_VARIANTS 와 같고 말마다 다르다 (성격마다, 한국어와 영어)', () => {
  const kinds = [
    ['note.open', NOTE_VARIANTS.open],
    ['note.close', NOTE_VARIANTS.close],
    ['note.ps', NOTE_VARIANTS.ps],
    ['note.week.open', NOTE_VARIANTS.weekOpen],
    ['note.week.close', NOTE_VARIANTS.weekClose],
    ['note.evening.open', NOTE_VARIANTS.evOpen],
    ['note.evening.close', NOTE_VARIANTS.evClose],
  ] as const;
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const p of ['friend', 'polite', 'tsundere', 'calm'])
      for (const [key, n] of kinds) {
        const all = Array.from({ length: n }, (_, i) => looseT(key, { p, v: i + 1, name: '콩이' }));
        assert.equal(new Set(all).size, n, `${lang} ${p} ${key}: ${all.join(' / ')}`);
        // n+1 번째 번호는 첫째로 돌아온다 (목록 밖이면 첫째)
        assert.equal(looseT(key, { p, v: n + 1, name: '콩이' }), all[0]);
      }
  }
  setLang('ko');
});

test('한 달 쪽지: 서로 다른 줄이 30개 넘고 쪽지 28통 넘게 서로 다르고, 같은 여는 말과 맺음이 이틀 연속 나오지 않는다', () => {
  let seed = 4242;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  let st = EMPTY_NOTES;
  const lines = new Set<string>();
  const wholes = new Set<string>();
  let prevOpen = -1;
  let prevClose = -1;
  for (let d = 1; d <= 30; d++) {
    const day = `2026-11-${String(d).padStart(2, '0')}`;
    const note = composeNote(
      {
        ...base,
        day,
        yesterdayDone: Math.floor(rand() * 5),
        ...(rand() < 0.6 ? { firstEvent: { time: '10:00', title: '회의' } } : {}),
        ...(rand() < 0.4 ? { habit: { title: '물 마시기', streak: 3 } } : {}),
        ...(rand() < 0.5 ? { yesterdayFocusMin: 50 } : {}),
        ...(rand() < 0.5 ? { streak: 5 } : {}),
        facts: rand() < 0.5 ? [{ kind: 'food', value: '고구마', at: 1 }] : [],
      },
      rand,
      recentVariants(st),
    );
    st = fileNote(st, note);
    const open = Number(note.lines[0]?.vars?.v);
    const close = Number(note.lines.find((l) => l.key === 'note.close')?.vars?.v);
    assert.notEqual(open, prevOpen, `${d}일 여는 말`);
    assert.notEqual(close, prevClose, `${d}일 맺음`);
    prevOpen = open;
    prevClose = close;
    for (const x of text(note)) lines.add(x);
    wholes.add(text(note).join('|'));
  }
  assert.ok(lines.size >= 30, `서로 다른 줄 ${lines.size}`);
  assert.ok(wholes.size >= 28, `서로 다른 쪽지 ${wholes.size}/30`);
});

test('최근 쪽지에서 쓴 말 번호를 읽는다 (최근 14통, 새 저장 칸 없이)', () => {
  let st = EMPTY_NOTES;
  for (let d = 1; d <= 20; d++)
    st = fileNote(st, composeNote({ ...base, day: `2026-11-${String(d).padStart(2, '0')}` }, fixed(0)));
  const r = recentVariants(st);
  assert.equal(r.open.length, 14);
  assert.equal(r.close.length, 14);
  assert.deepEqual(recentVariants(EMPTY_NOTES).open, []);
});

test('새 줄: 어제 집중 25분부터, 연속 3일부터 쪽지 줄로 고를 수 있다. 추신은 가끔 맺음 뒤에', () => {
  const keys = (extra: Partial<NoteFacts>) =>
    new Set(
      [0, 0.2, 0.4, 0.6, 0.8, 0.99].flatMap((r) =>
        composeNote({ ...base, ...extra }, fixed(r)).lines.map((l) => l.key),
      ),
    );
  assert.ok(!keys({ yesterdayFocusMin: 10 }).has('note.focus'));
  assert.ok(keys({ yesterdayFocusMin: 50 }).has('note.focus'));
  assert.ok(!keys({ streak: 2 }).has('note.streak'));
  assert.ok(keys({ streak: 4 }).has('note.streak'));
  // 추신: rand 가 0.2 보다 작으면 (맺음 뒤 마지막 줄)
  const withPs = composeNote(base, fixed(0.05));
  assert.equal(withPs.lines.at(-1)?.key, 'note.ps');
  assert.equal(withPs.lines.at(-2)?.key, 'note.close');
  assert.notEqual(composeNote(base, fixed(0.5)).lines.at(-1)?.key, 'note.ps');
});

test('주간 편지: 월요일부터 수요일까지, 그 주에 한 통, 코인 없음, 봉투 모양', () => {
  // 2026-10-26 월, 10-27 화, 10-28 수, 10-29 목
  assert.equal(weekLetterDue(EMPTY_NOTES, '2026-10-26'), true);
  assert.equal(weekLetterDue(EMPTY_NOTES, '2026-10-28'), true, '월요일에 못 만났으면 수요일까지 늦게');
  assert.equal(weekLetterDue(EMPTY_NOTES, '2026-10-29'), false);
  assert.equal(weekLetterDue(EMPTY_NOTES, '2026-10-31'), false);
  assert.equal(weekLetterDue(EMPTY_NOTES, '2026-11-01'), false, '일요일');
  const week = composeWeek(
    { day: '2026-10-26', persona: 'friend', petName: '콩이', lastWeekDone: 12, lastWeekFocusMin: 140 },
    fixed(0),
  );
  assert.equal(week.kind, 'week');
  assert.equal(week.look, 'letter');
  assert.equal(week.coins, undefined);
  assert.equal(week.milestone, undefined);
  assert.deepEqual(
    week.lines.map((l) => l.key),
    ['note.week.open', 'note.week.done', 'note.week.focus', 'note.week.close'],
  );
  assert.ok(text(week).some((x) => x.includes('12')));
  // 지난주 기록이 없으면 쉬어 간 주, 집중이 짧으면 집중 줄 없음
  const rest = composeWeek(
    { day: '2026-10-26', persona: 'calm', petName: '콩이', lastWeekDone: 0, lastWeekFocusMin: 10 },
    fixed(0),
  );
  assert.deepEqual(
    rest.lines.map((l) => l.key),
    ['note.week.open', 'note.week.doneNone', 'note.week.close'],
  );
  // 편지를 넣으면 그 주에는 다시 안 줌, 다음 주 월요일에는 다시
  const st = fileNote(EMPTY_NOTES, week);
  assert.equal(weekLetterDue(st, '2026-10-27'), false);
  assert.equal(weekLetterDue(st, '2026-11-02'), true);
  // 코인 칸이 없어서 마일스톤 표시는 편지 목록에 안 남는다 (marks 그대로)
  assert.deepEqual(st.marks, []);
  assert.deepEqual(lastWeekDays('2026-10-28'), [
    '2026-10-19',
    '2026-10-20',
    '2026-10-21',
    '2026-10-22',
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
  ]);
  assert.deepEqual(lastWeekDays('2026-11-01').at(0), '2026-10-19', '일요일은 그 주(월요일 시작)의 지난주');
});

test('저녁 쪽지: 켠 사람만, 밤 9시부터 11시 반 전, 하루 한 통, 매일 쪽지와 같은 날 따로', () => {
  const at = { day: '2026-10-28', minute: 21 * 60, present: true, calm: true, on: true };
  assert.equal(canDeliverEvening(EMPTY_NOTES, at), true);
  assert.equal(canDeliverEvening(EMPTY_NOTES, { ...at, on: false }), false);
  assert.equal(canDeliverEvening(EMPTY_NOTES, { ...at, minute: 20 * 60 + 59 }), false);
  assert.equal(canDeliverEvening(EMPTY_NOTES, { ...at, minute: 23 * 60 + 30 }), false);
  assert.equal(canDeliverEvening(EMPTY_NOTES, { ...at, present: false }), false);
  assert.equal(canDeliverEvening(EMPTY_NOTES, { ...at, calm: false }), false);
  const daily = composeNote({ ...base, day: '2026-10-28' }, fixed(0));
  const evening = composeEvening(
    { day: '2026-10-28', persona: 'polite', petName: '콩이', doneToday: 4, focusMin: 60 },
    fixed(0),
  );
  assert.equal(evening.kind, 'evening');
  assert.equal(evening.look, 'note');
  assert.deepEqual(
    evening.lines.map((l) => l.key),
    ['note.evening.open', 'note.evening.done', 'note.evening.focus', 'note.evening.close'],
  );
  assert.equal(noteId(evening), '2026-10-28~e');
  assert.equal(noteId(daily), '2026-10-28');
  let st = fileNote(EMPTY_NOTES, daily);
  st = fileNote(st, evening);
  assert.equal(st.box.length, 2, '같은 날 두 통');
  assert.equal(st.box[0]?.kind, 'evening', '같은 날은 저녁 쪽지가 앞');
  assert.equal(canDeliverEvening(st, at), false, '저녁 쪽지는 하루 한 통');
  // 저녁 쪽지가 있어도 오늘 매일 쪽지는 한 통 (canDeliver 는 매일 쪽지만 본다)
  assert.equal(
    canDeliver(fileNote(EMPTY_NOTES, evening), {
      day: '2026-10-28',
      minute: 10 * 60,
      present: true,
      calm: true,
    }),
    true,
  );
  // 읽기와 들기는 열쇠로
  assert.equal(heldNote(st, '2026-10-28')?.kind, 'evening');
  st = markRead(st, '2026-10-28~e');
  assert.equal(st.box.find((n) => n.kind === 'evening')?.read, true);
  assert.equal(st.box.find((n) => n.kind !== 'evening')?.read, false);
  assert.equal(heldNote(st, '2026-10-28')?.kind, undefined);
  // 저장 파일을 읽어도 종류가 남는다
  const back = parseNotes(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(back.box.map(noteId), ['2026-10-28~e', '2026-10-28']);
  assert.equal(back.box[0]?.kind, 'evening');
  // 모르는 종류는 매일 쪽지로
  assert.equal(parseNotes({ box: [{ ...daily, kind: 'weird' }] }).box[0]?.kind, undefined);
});

test('주간 편지와 저녁 쪽지 줄이 사전에 있고 성격마다 다르다 (한국어, 영어)', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const persona of ['friend', 'polite', 'tsundere', 'calm'] as const) {
      const w = composeWeek(
        { day: '2026-10-26', persona, petName: '콩이', lastWeekDone: 3, lastWeekFocusMin: 90 },
        fixed(0.3),
      );
      const e = composeEvening(
        { day: '2026-10-26', persona, petName: '콩이', doneToday: 3, focusMin: 90 },
        fixed(0.3),
      );
      for (const line of [...text(w), ...text(e)])
        assert.ok(line.trim() && !/undefined|\[object|NaN|\{/.test(line), line);
      for (const l of [...w.lines, ...e.lines]) assert.ok(l.key in dicts.ko, l.key);
    }
    const by = (persona: 'friend' | 'polite' | 'tsundere' | 'calm') =>
      text(
        composeWeek(
          { day: '2026-10-26', persona, petName: '콩이', lastWeekDone: 3, lastWeekFocusMin: 90 },
          fixed(0),
        ),
      ).join(' ');
    assert.equal(new Set(['friend', 'polite', 'tsundere', 'calm'].map((p) => by(p as never))).size, 4);
  }
  setLang('ko');
});

test('저녁 쪽지는 저녁에 맞는 말만 쓴다: 아침 인사가 없고 매일 쪽지의 여는 말, 맺음을 쓰지 않는다', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    for (const persona of ['friend', 'polite', 'tsundere', 'calm'] as const)
      for (const r of [0, 0.3, 0.6, 0.99]) {
        const e = composeEvening(
          { day: '2026-10-28', persona, petName: '콩이', doneToday: 2, focusMin: 40 },
          fixed(r),
        );
        assert.ok(
          !e.lines.some((l) => l.key === 'note.open' || l.key === 'note.close' || l.key === 'note.ps'),
        );
        for (const line of text(e))
          assert.ok(!/아침|morning|Morning/.test(line), `${lang} ${persona}: ${line}`);
      }
    for (const persona of ['friend', 'polite', 'tsundere', 'calm'])
      for (let v = 1; v <= NOTE_VARIANTS.evOpen; v++) {
        const line = looseT('note.evening.open', { p: persona, v });
        assert.ok(!/아침|morning|Morning/.test(line), line);
      }
  }
  setLang('ko');
});
