import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatterGate, IDLE_AFTER_ANY_MS, MAX_PER_HOUR } from './chatter.ts';
import { dicts, setLang, t } from './i18n/index.ts';
import {
  ActivityWatch,
  FRESH_MS,
  IDLE_GAP_MS,
  IDLE_RECENT,
  type IdleFacts,
  IdleTalk,
  IdleTalker,
  idleCandidates,
  idleVars,
  MOUSE_BUSY_PX,
  seasonOf,
  type TalkEnv,
  talkBlock,
  WORKED_LONG_MIN,
} from './idle-talk.ts';

// 2026-10-05 은 월요일, 10-09 는 금요일
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();

test('시각과 요일로 고른다: 월요일 아침, 점심, 금요일 오후, 늦은 밤, 주말', () => {
  const fit = (day: number, h: number, m = 0) => idleCandidates({ now: at(day, h, m), doneToday: 0 }).fit;
  assert.deepEqual(fit(5, 9), [
    'idle.morning.1',
    'idle.morning.2',
    'idle.morning.3',
    'idle.morning.4',
    'idle.monday.1',
    'idle.monday.2',
  ]);
  assert.deepEqual(fit(6, 9), ['idle.morning.1', 'idle.morning.2', 'idle.morning.3', 'idle.morning.4']);
  assert.deepEqual(fit(6, 12), ['idle.lunch.1', 'idle.lunch.2', 'idle.lunch.3']);
  assert.ok(fit(9, 15).includes('idle.friday.2'));
  assert.ok(!fit(8, 15).includes('idle.friday.1'));
  assert.deepEqual(fit(6, 23, 30), ['idle.late.1', 'idle.late.2', 'idle.late.3']);
  // 새벽 1~5시는 지금 시를 말하는 대사가 더해진다
  assert.deepEqual(fit(6, 2), ['idle.late.1', 'idle.late.2', 'idle.late.3', 'idle.night.1', 'idle.night.2']);
  assert.deepEqual(fit(7, 0, 30), ['idle.late.1', 'idle.late.2', 'idle.late.3']);
  // 사이 시간(13:30~14:00, 17:00~18:00)은 시각 대사가 없다
  assert.deepEqual(fit(6, 13, 45), []);
  // 10-10 토요일, 10-11 일요일 낮에는 주말 대사. 밤에는 늦은 밤 대사만
  assert.ok(fit(10, 15).includes('idle.weekend.1'));
  assert.ok(fit(11, 10).includes('idle.weekend.2'));
  assert.ok(!fit(10, 23).includes('idle.weekend.1'));
  assert.ok(!fit(6, 15).includes('idle.weekend.1'));
});

test('오늘 끝낸 수로 칭찬이 달라진다', () => {
  const fit = (n: number) => idleCandidates({ now: at(6, 13, 45), doneToday: n }).fit;
  assert.deepEqual(fit(0), []);
  assert.deepEqual(fit(1), ['idle.praise.1']);
  assert.deepEqual(fit(3), ['idle.praise.3']);
  assert.deepEqual(fit(7), ['idle.praise.5']);
});

test('앱이 아는 신호마다 상황 대사가 붙는다', () => {
  const base = { now: at(6, 13, 45), doneToday: 0 };
  const fit = (more: Partial<IdleFacts>) => idleCandidates({ ...base, ...more }).fit;
  const has = (more: Partial<IdleFacts>, group: string) =>
    fit(more).some((k) => k.startsWith(`idle.${group}.`));
  assert.ok(has({ openToday: 2 }, 'todo.left'));
  assert.ok(!has({ openToday: 0 }, 'todo'));
  assert.ok(has({ openToday: 0, doneToday: 2 }, 'todo.clear'));
  // 다음 일정은 15~60분 사이만 (10분 전 일정 알림과 겹치지 않게)
  assert.ok(has({ nextEventMin: 30 }, 'event.soon'));
  assert.ok(!has({ nextEventMin: 10 }, 'event.soon'));
  assert.ok(!has({ nextEventMin: 90 }, 'event.soon'));
  assert.ok(has({ eventsLeftToday: 0 }, 'event.free'));
  assert.ok(
    !idleCandidates({ now: at(6, 20), doneToday: 0, eventsLeftToday: 0 }).fit.includes('idle.event.free.1'),
  );
  assert.ok(has({ workedMin: WORKED_LONG_MIN }, 'work'));
  assert.ok(!has({ workedMin: WORKED_LONG_MIN - 1 }, 'work'));
  assert.ok(has({ mouseBusy: true }, 'mouse'));
  assert.ok(has({ hungry: true }, 'hungry'));
  // 배고프면 놀자는 말 대신 밥 이야기
  assert.ok(has({ mood: 20 }, 'play'));
  assert.ok(!has({ mood: 20, hungry: true }, 'play'));
  assert.ok(!has({ mood: 80 }, 'play'));
  assert.deepEqual(fit({ affection: 50 }), ['idle.friend.new']);
  assert.deepEqual(fit({ affection: 100 }), ['idle.friend.1']);
  assert.deepEqual(fit({ affection: 350 }), ['idle.friend.2']);
  assert.deepEqual(fit({ affection: 700 }), ['idle.friend.3']);
  // 다른 쪽(기운 등)이 넣는 상황 대사 자리
  assert.deepEqual(fit({ more: ['idle.any.3'] }), ['idle.any.3']);
});

test('방금 끝낸 할 일과 오래 비웠다 돌아온 것은 먼저, 한 번만 말한다', () => {
  const now = at(6, 13, 45);
  const talk = new IdleTalk();
  const f = { now, doneToday: 1, lastDoneAt: now - 60_000 };
  const first = talk.pick(f, () => 0.5);
  assert.ok(first?.startsWith('idle.done.'), String(first));
  // 같은 할 일로는 다시 칭찬하지 않는다
  for (let i = 0; i < 5; i++)
    assert.ok(!talk.pick({ ...f, now: now + i * 60_000 })?.startsWith('idle.done.'));
  // 새로 끝내면 다시
  assert.ok(talk.pick({ ...f, lastDoneAt: now })?.startsWith('idle.done.'));
  // 15분 지난 일은 칭찬하지 않는다
  assert.equal(idleCandidates({ ...f, now: now + FRESH_MS + 60_000 }).now.length, 0);
  const back = talk.pick({ now, doneToday: 0, backAt: now - 30_000 }, () => 0.1);
  assert.ok(back?.startsWith('idle.back.'), String(back));
  // 못 띄워서 되돌리면 다음에 다시 반긴다
  talk.undo();
  assert.ok(talk.pick({ now, doneToday: 0, backAt: now - 30_000 })?.startsWith('idle.back.'));
});

test('같은 상황 묶음은 연달아 고르지 않는다 (다른 게 있으면)', () => {
  const talk = new IdleTalk();
  const f: IdleFacts = { now: at(6, 13, 45), doneToday: 0, hungry: true, mouseBusy: true, workedMin: 90 };
  let i = 0;
  const rand = () => ((i++ * 0.61) % 1) as number;
  const groups: string[] = [];
  for (let n = 0; n < 60; n++) groups.push((talk.pick(f, rand) ?? '').split('.')[1] ?? '');
  // 아무 때나 하는 말(any)은 서로 달라서 이어져도 된다. 상황 묶음만 본다
  for (let n = 1; n < groups.length; n++)
    if (groups[n] !== 'any') assert.notEqual(groups[n], groups[n - 1], `${n}: ${groups.join(',')}`);
});

test('최근에 한 말은 다시 고르지 않는다', () => {
  const talk = new IdleTalk();
  let i = 0;
  const rand = () => ((i++ * 0.37) % 1) as number;
  const picked: string[] = [];
  for (let n = 0; n < 40; n++) picked.push(talk.pick({ now: at(6, 9), doneToday: 1 }, rand) ?? '');
  assert.ok(picked.every((k) => k !== ''));
  for (let n = 1; n < picked.length; n++) {
    const window = picked.slice(Math.max(0, n - IDLE_RECENT), n);
    assert.ok(!window.includes(picked[n] ?? ''), `${n}: ${picked[n]} 가 최근 ${window} 에 있다`);
  }
});

test('대사마다 펫 이름이 자연스럽게 들어가고 조사가 맞는다', () => {
  setLang('ko');
  assert.equal(t('idle.any.1', { name: '콩이' }), '콩이는 여기서 조용히 응원 중.');
  assert.equal(t('idle.any.1', { name: '밤' }), '밤은 여기서 조용히 응원 중.');
  assert.equal(t('idle.any.4', { name: '밤' }), '심심하면 밤을 쓰다듬어 줘도 돼.');
  const keys = Object.keys(dicts.ko).filter((k) => k.startsWith('idle.'));
  const named = keys.filter((k) => (t as (k: string, v: object) => string)(k, { name: 'ZZ' }).includes('ZZ'));
  // 절반 넘게 이름이 들어간다
  assert.ok(named.length * 2 > keys.length, `${named.length}/${keys.length}`);
  setLang('en');
  assert.equal(t('idle.monday.1', { name: 'Bean' }), "It's Monday. Bean is sticking right by you.");
  setLang('ko');
});

test('펫 이름 뒤 조사가 받침에 맞고, 대사는 서로 다르다 (혼잣말, 친밀도, 놓친 알림)', () => {
  setLang('ko');
  const render = t as unknown as (k: string, v: object) => string;
  const keys = Object.keys(dicts.ko).filter((k) => k.startsWith('idle.') || k.startsWith('pet.unlock.'));
  // 받침 있는 이름, 없는 이름, ㄹ 받침, 영어 이름
  const cases: [string, boolean][] = [
    ['밤', true],
    ['콩이', false],
    ['달', true],
    ['Bean', true],
    ['Coco', false],
  ];
  for (const [name, final] of cases)
    for (const key of keys) {
      const text = render(key, { name });
      const at = text.indexOf(name);
      if (at < 0) continue;
      const next = text[at + name.length] ?? '';
      const wrong = final ? ['는', '가', '를', '와'] : ['은', '을', '과'];
      assert.ok(!wrong.includes(next), `${key} (${name}): ${text}`);
    }
  const texts = keys.map((k) => render(k, { name: '콩이' }));
  assert.equal(new Set(texts).size, texts.length);
  setLang('en');
  const en = keys.map((k) => render(k, { name: 'Bean' }));
  assert.equal(new Set(en).size, en.length);
  // 영어에 한글이 섞이지 않는다
  for (const s of en) assert.ok(!/[가-힣]/.test(s), s);
  setLang('ko');
});

test('아무 때나 하는 대사는 최근 기억보다 많아서 늘 고를 게 있다', () => {
  const any = idleCandidates({ now: at(6, 13, 45), doneToday: 0 }).any;
  assert.ok(any.length > IDLE_RECENT, `${any.length} > ${IDLE_RECENT}`);
  const talk = new IdleTalk();
  for (let n = 0; n < 200; n++) assert.ok(talk.pick({ now: at(6, 13, 45), doneToday: 0 }));
});

test('대사 값: 남은 할 일, 일정까지 분, 일한 시간이 글에 들어간다', () => {
  setLang('ko');
  const v = idleVars({ now: 0, doneToday: 0, openToday: 3, nextEventMin: 24.6, workedMin: 130 });
  assert.deepEqual(
    { open: v.open, eventMin: v.eventMin, workedH: v.workedH },
    { open: 3, eventMin: 25, workedH: 2 },
  );
  assert.equal(t('idle.todo.left.1', { name: '콩이', ...v }), '오늘 할 일 3개 남았어. 하나씩 하자.');
  assert.equal(t('idle.event.soon.1', { name: '콩이', ...v }), '25분 뒤에 일정 있어. 미리 물 한 잔?');
  assert.equal(t('idle.work.1', { name: '콩이', ...v }), '벌써 2시간 넘게 쉬지 않았어. 대단한데?');
  setLang('en');
  assert.equal(t('idle.todo.left.2', { name: 'Bean', open: 1 }), '1 to-do to go. Bean is rooting for you.');
  assert.equal(t('idle.work.1', { name: 'Bean', workedH: 1 }), 'Over 1 hour without a break. Impressive!');
  assert.equal(t('idle.work.1', { name: 'Bean', workedH: 3 }), 'Over 3 hours without a break. Impressive!');
  setLang('ko');
});

const ENV: TalkEnv = { chatty: true, focusing: false, hidden: false, locked: false, idleSec: 5 };

test('혼잣말을 막는 상태: 수다쟁이 아님, 브리핑, 집중, 숨김, 잠금, 자리 비움(잠), 놀이, 삐짐, 타이핑', () => {
  assert.equal(talkBlock(ENV), undefined);
  assert.equal(talkBlock({ ...ENV, chatty: false }), 'level');
  assert.equal(talkBlock({ ...ENV, briefing: true }), 'briefing');
  assert.equal(talkBlock({ ...ENV, focusing: true }), 'focus');
  assert.equal(talkBlock({ ...ENV, hidden: true }), 'hidden');
  assert.equal(talkBlock({ ...ENV, locked: true }), 'locked');
  assert.equal(talkBlock({ ...ENV, idleSec: 61 }), 'away');
  assert.equal(talkBlock({ ...ENV, idleSec: 60 }), undefined);
  assert.equal(talkBlock({ ...ENV, busy: true }), 'busy');
  assert.equal(talkBlock({ ...ENV, sulk: 1 }), 'sulk');
  assert.equal(talkBlock({ ...ENV, idleSec: 0 }), 'typing');
  assert.equal(talkBlock({ ...ENV, idleSec: 1 }), 'typing');
  assert.equal(talkBlock({ ...ENV, idleSec: 2 }), undefined);
});

/** 가짜 시계로 한 시간: 15초 틱마다 IdleTalker 를 부르고 ChatterGate 로 띄운다. 띄운 대사와 시각 */
function simulate(o: {
  minutes?: number;
  env?: (min: number) => Partial<TalkEnv>;
  facts?: (now: number) => Partial<IdleFacts>;
  /** 이 분에 상태 알림(system)이 뜬다 */
  system?: number[];
  seed?: number;
}) {
  let seed = o.seed ?? 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const start = at(6, 9);
  const gate = new ChatterGate('chatty');
  const talker = new IdleTalker(start, rand);
  const said: { min: number; key: string }[] = [];
  let systems = 0;
  for (let ms = 0; ms <= (o.minutes ?? 60) * 60_000; ms += 15_000) {
    const now = start + ms;
    const min = ms / 60_000;
    if (o.system?.includes(min) && gate.take('system', now)) systems++;
    const r = talker.due(now, { ...ENV, ...o.env?.(min) }, () => ({ now, doneToday: 0, ...o.facts?.(now) }));
    if (!('key' in r)) continue;
    const ok = gate.take('idle-talk', now);
    talker.shown(now, ok);
    if (ok) said.push({ min, key: r.key });
  }
  return { said, systems };
}

test('수다쟁이 한 시간: 9~14번 말하고, 사이는 3분 넘고, 최근 대사는 겹치지 않는다', () => {
  for (const seed of [1, 7, 42, 99, 1234]) {
    const { said } = simulate({ seed });
    assert.ok(said.length >= 9 && said.length <= MAX_PER_HOUR.chatty, `${seed}: ${said.length}`);
    for (let n = 1; n < said.length; n++) {
      const gap = (said[n]?.min ?? 0) - (said[n - 1]?.min ?? 0);
      assert.ok(gap >= IDLE_GAP_MS.min / 60_000, `${seed}: 간격 ${gap}분`);
      const recent = said.slice(Math.max(0, n - IDLE_RECENT), n).map((s) => s.key);
      assert.ok(!recent.includes(said[n]?.key ?? ''), `${seed}: ${said[n]?.key} 되풀이`);
    }
  }
});

test('막힌 동안은 한 마디도 하지 않고, 풀리면 곧 말한다', () => {
  for (const block of [
    { chatty: false },
    { focusing: true },
    { hidden: true },
    { locked: true },
    { idleSec: 600 },
    { busy: true },
    { sulk: 2 },
    { idleSec: 0 },
  ] as Partial<TalkEnv>[]) {
    assert.equal(simulate({ env: () => block }).said.length, 0, JSON.stringify(block));
    // 30분 막혔다 풀리면 1분 안에 말한다
    const { said } = simulate({ env: (min) => (min < 30 ? block : {}) });
    assert.ok(said[0] && said[0].min >= 30 && said[0].min <= 31, `${JSON.stringify(block)}: ${said[0]?.min}`);
  }
});

test('타이핑 중이면 손이 쉬는 틱까지 기다렸다 말한다', () => {
  // 틱 세 번 중 두 번은 타이핑 중
  let tick = 0;
  const { said } = simulate({ env: () => ({ idleSec: tick++ % 3 === 0 ? 4 : 0 }) });
  assert.ok(said.length >= 8, `${said.length}`);
});

test('상태 알림이 섞여도 시간당 상한을 넘지 않고, 알림 바로 뒤 2분은 혼잣말을 하지 않는다', () => {
  const system = [1, 5, 9, 13, 17, 21, 25, 29, 33, 37];
  const { said, systems } = simulate({ system, seed: 3 });
  assert.ok(said.length + systems <= MAX_PER_HOUR.chatty, `${said.length} + ${systems}`);
  for (const s of said)
    for (const m of system)
      assert.ok(!(s.min >= m && s.min - m < IDLE_AFTER_ANY_MS / 60_000), `${s.min} (알림 ${m})`);
});

test('ActivityWatch: 쉬지 않고 일한 분, 오래 비웠다 돌아옴, 마우스 바쁨', () => {
  const w = new ActivityWatch();
  const t0 = at(6, 9);
  for (let m = 0; m <= 80; m++) w.observe(t0 + m * 60_000, 3);
  assert.equal(w.workedMin(t0 + 80 * 60_000), 80);
  // 5분 넘게 입력이 없으면 0
  w.observe(t0 + 86 * 60_000, 6 * 60);
  assert.equal(w.workedMin(t0 + 86 * 60_000), 0);
  // 50분 비웠다 돌아오면 돌아온 때가 남는다
  w.observe(t0 + 136 * 60_000, 50 * 60);
  assert.equal(w.backAt, undefined);
  w.observe(t0 + 137 * 60_000, 1);
  assert.equal(w.backAt, t0 + 137 * 60_000);
  // 10분만 비우면 반기지 않는다
  const v = new ActivityWatch();
  v.observe(t0, 1);
  v.observe(t0 + 10 * 60_000, 10 * 60);
  v.observe(t0 + 11 * 60_000, 1);
  assert.equal(v.backAt, undefined);
  // 잠자기로 틱 사이가 한 시간 비면 돌아온 것
  const s = new ActivityWatch();
  s.observe(t0, 1);
  s.observe(t0 + 60 * 60_000, 1);
  assert.equal(s.backAt, t0 + 60 * 60_000);
  // 커서: 15초마다 크게 움직이면 바쁨, 가만있으면 2분 뒤 풀림
  const c = new ActivityWatch();
  for (let i = 0; i < 9; i++) c.observe(t0 + i * 15_000, 0, { x: i % 2 ? 1400 : 0, y: 300 });
  assert.ok(c.mouseBusy(), `${MOUSE_BUSY_PX}`);
  for (let i = 9; i < 20; i++) c.observe(t0 + i * 15_000, 0, { x: 1400, y: 300 });
  assert.equal(c.mouseBusy(), false);
});

test('수다쟁이 상한은 한 시간에 14개, 보통과 조용히는 그대로', () => {
  assert.deepEqual(MAX_PER_HOUR, { quiet: 0, normal: 3, chatty: 14 });
  const g = new ChatterGate('chatty');
  const taken = Array.from({ length: 16 }, (_, i) => g.take('system', i * 1000)).filter(Boolean).length;
  assert.equal(taken, 14);
  // 혼잣말은 보통에서 아예 하지 않는다
  assert.equal(new ChatterGate('normal').take('idle-talk', 0), false);
});

test('못 띄운 혼잣말은 되돌려서 1분 뒤에 다시 그 상황을 말한다', () => {
  const now = at(6, 13, 45);
  const talker = new IdleTalker(now - IDLE_GAP_MS.max);
  const facts = () => ({ now, doneToday: 0, backAt: now - 10_000 });
  const first = talker.due(now, ENV, facts);
  assert.ok('key' in first && first.key.startsWith('idle.back.'));
  talker.shown(now, false);
  assert.equal(talker.nextAt, now + 60_000);
  const again = talker.due(now + 60_000, ENV, () => ({ ...facts(), now: now + 60_000 }));
  assert.ok('key' in again && again.key.startsWith('idle.back.'), JSON.stringify(again));
});

test('기억 대사: 어제 일은 오전에만, 연속 2일부터, 이번 주는 금요일 오후와 주말, 집중 25분부터, 함께한 날 2일째부터', () => {
  const fit = (day: number, h: number, more: Partial<IdleFacts>) =>
    idleCandidates({ now: at(day, h), doneToday: 0, ...more }).fit;
  assert.ok(fit(6, 9, { yesterdayDone: 2 }).includes('idle.memory.yesterday.1'));
  assert.ok(!fit(6, 15, { yesterdayDone: 2 }).includes('idle.memory.yesterday.1'));
  assert.ok(!fit(6, 9, { yesterdayDone: 0 }).includes('idle.memory.yesterday.1'));
  assert.ok(fit(6, 15, { streak: 2 }).includes('idle.streak.1'));
  assert.ok(!fit(6, 15, { streak: 1 }).includes('idle.streak.1'));
  assert.ok(fit(9, 15, { weekDone: 3 }).includes('idle.week.1'));
  assert.ok(fit(10, 15, { weekDone: 8 }).includes('idle.week.2'));
  assert.ok(!fit(8, 15, { weekDone: 8 }).includes('idle.week.1'), '목요일은 아직');
  assert.ok(!fit(9, 15, { weekDone: 2 }).includes('idle.week.1'));
  assert.ok(fit(6, 15, { focusMin: 25 }).includes('idle.focus.1'));
  assert.ok(!fit(6, 15, { focusMin: 24 }).includes('idle.focus.1'));
  assert.ok(fit(6, 15, { daysTogether: 2 }).includes('idle.together.1'));
  assert.ok(!fit(6, 15, { daysTogether: 1 }).includes('idle.together.1'));
});

test('철 대사는 아무 때나 하는 말에 섞이고, 특별한 날은 상황 대사에', () => {
  const cand = (m: number, d: number, h = 15) =>
    idleCandidates({ now: new Date(2026, m, d, h).getTime(), doneToday: 0 });
  assert.ok(cand(9, 6).any.includes('idle.season.autumn.1'));
  assert.ok(cand(3, 6).any.includes('idle.season.spring.2'));
  assert.ok(cand(6, 6).any.includes('idle.season.summer.1'));
  assert.ok(cand(0, 6).any.includes('idle.season.winter.1'));
  assert.ok(!cand(0, 6).any.includes('idle.season.autumn.1'));
  assert.ok(cand(0, 1).fit.includes('idle.special.newyear'));
  assert.ok(cand(11, 24).fit.includes('idle.special.christmas'));
  assert.ok(cand(11, 25).fit.includes('idle.special.christmas'));
  assert.ok(cand(11, 31).fit.includes('idle.special.yearend'));
  assert.ok(!cand(11, 26).fit.some((k) => k.startsWith('idle.special')));
  assert.equal(seasonOf(1), 'winter');
  assert.equal(seasonOf(2), 'spring');
  assert.equal(seasonOf(11), 'winter');
});

test('기억과 새벽 값이 글에 들어간다', () => {
  setLang('ko');
  const v = idleVars({
    now: at(6, 2, 10),
    doneToday: 0,
    yesterdayDone: 4,
    streak: 5,
    weekDone: 12,
    focusMin: 49.6,
    daysTogether: 30,
  });
  assert.equal(v.hour, 2);
  assert.equal(v.focusMin, 50);
  assert.equal(t('idle.night.1', { name: '콩이', ...v }), '벌써 새벽 2시야. 콩이는 눈이 반쯤 감겼어.');
  assert.equal(t('idle.streak.2', { name: '콩이', ...v }), '연속 5일! 오늘도 하나만 끝내면 이어져.');
  assert.equal(
    t('idle.memory.yesterday.1', { name: '밤', ...v }),
    '어제 4개 끝낸 거 밤이 기억해. 오늘도 가 보자!',
  );
  assert.equal(
    t('idle.together.1', { name: '콩이', ...v }),
    '우리 같이 지낸 지 30일째야. 콩이는 매일이 좋아.',
  );
  setLang('en');
  assert.equal(t('idle.week.1', { name: 'Bean', week: 1 }), '1 to-do done this week. What a week!');
  assert.equal(
    t('idle.night.2', { name: 'Bean', hour: 3 }),
    "3 a.m.... Promise you'll sleep after this one!",
  );
  setLang('ko');
});

test('최근 혼잣말을 되살리면 다시 켜도 그 말은 고르지 않는다', () => {
  const a = new IdleTalk();
  const facts = { now: at(6, 13, 45), doneToday: 0 };
  const said = Array.from({ length: 5 }, () => a.pick(facts, () => 0)).filter((k) => k !== undefined);
  assert.equal(said.length, 5);
  const b = new IdleTalk();
  const known = (k: string): k is (typeof said)[number] => k in dicts.ko;
  b.restore([...a.recent, 'idle.gone.key'], known);
  assert.deepEqual(b.recent, said);
  const next = b.pick(facts, () => 0);
  assert.ok(next && !said.includes(next));
});
