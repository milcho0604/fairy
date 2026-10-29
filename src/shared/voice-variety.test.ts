import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChatterGate, MAX_PER_HOUR, quieter, talksToSelf } from './chatter.ts';
import { dicts, setLang, t } from './i18n/index.ts';
import {
  IDLE_GAP_MS,
  type IdleFacts,
  IdleTalker,
  idleVars,
  SOMETIMES_GAP_MS,
  type TalkEnv,
} from './idle-talk.ts';
import { voiced } from './persona-voice.ts';
import { isQuietNow, parseQuiet } from './quiet-hours.ts';
import { DEFAULT_SETTINGS, keepOldChatter, parseSettings } from './settings.ts';
import { VariantPicker, variants, variantsOf } from './variants.ts';

// 말이 얼마나 되풀이되는지 재는 시험 (2026-10-28 사용자 요청: 페어리가 하는 말이 너무 똑같다).
// 실제 IdleTalker 와 사전을 가짜 시계로 며칠 돌린다. 수다쟁이는 같은 날 되풀이가 10% 이하, 가끔 한마디는 거의 없다

const ENV: TalkEnv = { chatty: true, focusing: false, hidden: false, locked: false, idleSec: 5 };

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** 평일 9~19시(점심 자리 비움)를 며칠 돌려 말한 열쇠를 날짜별로 */
function simulate(days: number, gap: typeof IDLE_GAP_MS | typeof SOMETIMES_GAP_MS, seed: number): string[][] {
  const rand = lcg(seed);
  const base = new Date(2026, 9, 5).getTime();
  const out: string[][] = [];
  const talker = new IdleTalker(base + 9 * 3_600_000, rand, gap);
  for (let d = 0; d < days; d++) {
    const dayStart = base + d * 86_400_000;
    const said: string[] = [];
    let done = 0;
    let lastDone: number | undefined;
    const open = 3 + Math.floor(rand() * 4);
    let sinceBreak = 0;
    let hourly: number[] = [];
    for (let now = dayStart + 9 * 3_600_000; now < dayStart + 19 * 3_600_000; now += 15_000) {
      const hr = (now - dayStart) / 3_600_000;
      const away = hr >= 12.5 && hr < 13.2;
      sinceBreak = away ? 0 : sinceBreak + 0.25;
      if (rand() < 0.0008 && done < open) {
        done++;
        lastDone = now;
      }
      const facts = (): IdleFacts => ({
        now,
        doneToday: done,
        ...(lastDone ? { lastDoneAt: lastDone } : {}),
        openToday: Math.max(0, open - done),
        overdue: 1,
        todoTitle: '보고서',
        eventsLeftToday: 1,
        eventsUsed: true,
        nextEventMin: hr < 10 ? 40 : 300,
        workedMin: sinceBreak,
        mood: 30 + Math.floor(rand() * 60),
        affection: 150 + d * 20,
        hungry: rand() < 0.05,
        yesterdayDone: 3,
        streak: 2 + d,
        weekDone: 4,
        focusMin: hr > 15 ? 50 : 0,
        daysTogether: 9 + d,
      });
      const r = talker.due(now, { ...ENV, idleSec: away ? 3000 : 5 + rand() * 20 }, facts);
      if (!('key' in r)) continue;
      hourly = hourly.filter((x) => now - x < 3_600_000);
      if (hourly.length >= MAX_PER_HOUR[gap === IDLE_GAP_MS ? 'chatty' : 'sometimes']) {
        talker.shown(now, false);
        continue;
      }
      hourly.push(now);
      talker.shown(now, true);
      said.push(r.key);
    }
    out.push(said);
  }
  return out;
}

const repeatsWithinDay = (days: string[][]): number => {
  let rep = 0;
  for (const day of days) rep += day.length - new Set(day).size;
  return rep;
};

test('수다쟁이 2주: 같은 날 되풀이가 10% 이하이고 서로 다른 말이 150개 넘게 나온다', () => {
  const days = simulate(14, IDLE_GAP_MS, 12345);
  const total = days.reduce((n, d) => n + d.length, 0);
  assert.ok(total > 1000, `${total}`);
  const repeat = repeatsWithinDay(days);
  assert.ok(repeat / total <= 0.1, `같은 날 되풀이 ${repeat}/${total}`);
  const distinct = new Set(days.flat()).size;
  assert.ok(distinct >= 150, `서로 다른 말 ${distinct}`);
  // 같은 말이 다시 나오기까지 중앙값이 80줄(약 한 나절) 이상
  const last = new Map<string, number>();
  const gaps: number[] = [];
  days.flat().forEach((k, i) => {
    const p = last.get(k);
    if (p !== undefined) gaps.push(i - p);
    last.set(k, i);
  });
  gaps.sort((a, b) => a - b);
  assert.ok(
    (gaps[Math.floor(gaps.length / 2)] ?? 0) >= 80,
    `재등장 간격 중앙값 ${gaps[Math.floor(gaps.length / 2)]}`,
  );
});

test('가끔 한마디 2주: 하루 8~25번, 같은 날 되풀이는 3% 이하', () => {
  const days = simulate(14, SOMETIMES_GAP_MS, 777);
  for (const [i, d] of days.entries()) assert.ok(d.length >= 8 && d.length <= 25, `${i}일째 ${d.length}번`);
  const total = days.reduce((n, d) => n + d.length, 0);
  assert.ok(repeatsWithinDay(days) / total <= 0.03, `${repeatsWithinDay(days)}/${total}`);
});

test('가끔 한마디: 보통 위에 혼잣말만 더한다 (상한 5, 간격 20~40분)', () => {
  assert.equal(talksToSelf('quiet'), false);
  assert.equal(talksToSelf('normal'), false);
  assert.equal(talksToSelf('sometimes'), true);
  assert.equal(talksToSelf('chatty'), true);
  const gate = new ChatterGate('sometimes');
  assert.ok(gate.allows('idle-talk') && gate.allows('system') && gate.allows('schedule'));
  assert.equal(new ChatterGate('normal').allows('idle-talk'), false);
  assert.equal(MAX_PER_HOUR.sometimes, 5);
  assert.ok(SOMETIMES_GAP_MS.min >= 20 * 60_000 && SOMETIMES_GAP_MS.max <= 40 * 60_000);
  // "나중에" 를 연달아 누르면 한 단계 조용하게
  assert.equal(quieter('sometimes'), 'normal');
  assert.equal(quieter('chatty'), 'normal');
  assert.equal(quieter('normal'), 'quiet');
});

test('수다 빈도를 바꾸면 이미 잡은 다음 때가 새 간격을 넘지 않는다', () => {
  const start = new Date(2026, 9, 6, 10).getTime();
  const talker = new IdleTalker(start, () => 1, SOMETIMES_GAP_MS);
  assert.equal(talker.nextAt, start + SOMETIMES_GAP_MS.max);
  talker.setGap(IDLE_GAP_MS);
  // 수다쟁이로 바꾼 뒤 처음 물으면 다음 때를 새 간격 안으로 다시 잡는다
  const r = talker.due(start, ENV, () => ({ now: start, doneToday: 0 }));
  assert.deepEqual(r, { block: 'wait' });
  assert.ok(talker.nextAt - start <= IDLE_GAP_MS.max, `${talker.nextAt - start}`);
});

test('말 안 하는 시간: 시간대, 밤을 넘기는 시간대, 주말', () => {
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
  const lunch = { on: true, from: 12 * 60, to: 13 * 60, weekend: false };
  assert.equal(isQuietNow(lunch, at(6, 12, 30)), true);
  assert.equal(isQuietNow(lunch, at(6, 13, 0)), false);
  assert.equal(isQuietNow(lunch, at(6, 11, 59)), false);
  assert.equal(isQuietNow({ ...lunch, on: false }, at(6, 12, 30)), false);
  // 밤을 넘긴다 22:00 ~ 08:00
  const night = { on: true, from: 22 * 60, to: 8 * 60, weekend: false };
  assert.equal(isQuietNow(night, at(6, 23)), true);
  assert.equal(isQuietNow(night, at(7, 7, 59)), true);
  assert.equal(isQuietNow(night, at(7, 8)), false);
  assert.equal(isQuietNow(night, at(7, 15)), false);
  // 시작과 끝이 같으면 시간대로는 쉬지 않는다
  assert.equal(isQuietNow({ on: true, from: 600, to: 600, weekend: false }, at(6, 10)), false);
  // 주말 (10-10 토, 10-11 일)
  const weekend = { on: false, from: 0, to: 0, weekend: true };
  assert.equal(isQuietNow(weekend, at(10, 15)), true);
  assert.equal(isQuietNow(weekend, at(11, 9)), true);
  assert.equal(isQuietNow(weekend, at(9, 15)), false);
});

test('말 안 하는 시간 값: 모르는 값은 기본값, 설정에 들어간다', () => {
  assert.deepEqual(parseQuiet(undefined), { on: false, from: 720, to: 780, weekend: false });
  assert.deepEqual(parseQuiet({ on: true, from: 2000, to: -1, weekend: 'yes' }), {
    on: true,
    from: 720,
    to: 780,
    weekend: false,
  });
  assert.deepEqual(
    parseSettings({ quietHours: { on: true, from: 600, to: 660, weekend: true } }).quietHours,
    {
      on: true,
      from: 600,
      to: 660,
      weekend: true,
    },
  );
  assert.deepEqual(parseSettings({}).quietHours, DEFAULT_SETTINGS.quietHours);
});

test('수다 빈도 기본: 새 사용자는 가끔 한마디, 옛 설정 파일은 지금 값(없으면 보통)을 지킨다', () => {
  assert.equal(DEFAULT_SETTINGS.chatter, 'sometimes');
  // 설정 파일이 없다 = 새 사용자
  assert.equal(parseSettings(keepOldChatter({})).chatter, 'sometimes');
  // 파일은 있는데 수다 빈도가 없다 = 옛 사용자
  assert.equal(parseSettings(keepOldChatter({ petName: '밤' })).chatter, 'normal');
  // 값이 있으면 그대로
  for (const c of ['quiet', 'normal', 'sometimes', 'chatty'] as const)
    assert.equal(parseSettings(keepOldChatter({ petName: '밤', chatter: c })).chatter, c);
  assert.equal(parseSettings({ chatter: 'loud' }).chatter, 'sometimes');
});

test('변형: 기본 열쇠가 첫째, 번호 순으로 이어진다', () => {
  assert.deepEqual(variantsOf('pet.fed').slice(0, 3), ['pet.fed', 'pet.fed.2', 'pet.fed.3']);
  assert.deepEqual(variantsOf('pet.rest').slice(0, 4), [
    'pet.rest.1',
    'pet.rest.2',
    'pet.rest.3',
    'pet.rest.4',
  ]);
  // 번호 열 자리 수가 늘어도 숫자 순서 (pet.rest.10 이 pet.rest.2 앞에 오지 않는다)
  const rest = variantsOf('pet.rest');
  assert.equal(rest.indexOf('pet.rest.10') > rest.indexOf('pet.rest.9'), true);
  assert.deepEqual(variantsOf('nope.none'), []);
});

test('말 변형 수: 일상 말도 여러 가지', () => {
  const need: Record<string, number> = {
    'pet.rest': 16,
    'briefing.hi.morning': 4,
    'briefing.hi.day': 4,
    'briefing.hi.evening': 4,
    'companion.cheer.clear': 5,
    'companion.cheer.streak': 5,
    'companion.cheer.count': 5,
    'pet.fed': 8,
    'pet.fedWith': 3,
    'idle.todo.left': 8,
    'idle.todo.clear': 6,
    'idle.done': 8,
    'idle.event.soon': 6,
    'idle.event.free': 6,
    'idle.mood.high': 6,
    'idle.mood.low': 6,
    'idle.together': 5,
    'idle.back': 6,
  };
  for (const [base, n] of Object.entries(need))
    assert.ok(variantsOf(base).length >= n, `${base}: ${variantsOf(base).length}`);
});

test('VariantPicker: 바로 앞에 한 말은 피한다', () => {
  const p = new VariantPicker();
  const rand = lcg(5);
  let prev = '';
  for (let i = 0; i < 200; i++) {
    const k = p.pick('pet.rest', rand);
    assert.notEqual(k, prev);
    prev = k ?? '';
  }
  // 하나뿐이면 그것
  assert.equal(new VariantPicker().pick('pet.unlock.wave'), 'pet.unlock.wave');
  // 사전에 없으면 받은 열쇠
  assert.equal(new VariantPicker().pick('nope.none'), 'nope.none');
  assert.ok(variants instanceof VariantPicker);
});

test('성격마다 변형 문구가 있다: 휴식 16, 인사, 축하, 먹이기 모두 존댓말 비서, 츤데레, 차분 판', () => {
  setLang('ko');
  const bases = [
    'pet.rest',
    'briefing.hi.morning',
    'briefing.hi.day',
    'briefing.hi.evening',
    'companion.cheer.clear',
    'pet.fed',
  ];
  for (const b of bases)
    for (const key of variantsOf(b))
      for (const p of ['friend', 'polite', 'tsundere', 'calm'] as const) {
        const line = voiced(key as never, { name: '콩이', n: 3 }, p);
        assert.ok(line.length > 1 && !/\{|undefined/.test(line), `${p} ${key}: ${line}`);
      }
});

test('츤데레와 차분한 선생님 문구가 각각 30줄 넘게 새로 있다 (한국어, 영어)', () => {
  for (const p of ['tsundere', 'calm']) {
    const mine = Object.keys(dicts.ko).filter((k) => k.startsWith(`voice.${p}.`));
    assert.ok(mine.length >= 100, `${p}: ${mine.length}`);
    for (const lang of ['ko', 'en'] as const)
      assert.ok(
        mine.every((k) => k in dicts[lang]),
        `${p} ${lang}`,
      );
  }
});

test('새 말의 틀: 이름 뒤 조사가 받침에 맞는다 ({이름:은} 같은 글 틀)', () => {
  setLang('ko');
  const looseT = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  assert.equal(looseT('idle.any.17', { name: '콩이' }), '콩이는 방금 한 바퀴 돌았어. 기분 전환 끝!');
  assert.equal(looseT('idle.any.17', { name: '밤' }), '밤은 방금 한 바퀴 돌았어. 기분 전환 끝!');
  assert.equal(looseT('idle.any.20', { name: '밤' }), '밤이 옆에서 같이 일하는 중이야. 조용히, 열심히.');
  setLang('en');
  assert.equal(looseT('idle.any.17', { name: 'Bean' }), 'Bean just spun around once. Mood reset done!');
  setLang('ko');
});

test('영어 존댓말 비서는 격식 있는 말이다 (옛 혼잣말도 따로 쓴다)', () => {
  setLang('en');
  assert.equal(
    voiced('idle.any.3' as never, { name: 'Bean' }, 'polite'),
    'It may be time for some water. Would you like a sip?',
  );
  assert.notEqual(
    voiced('idle.any.3' as never, { name: 'Bean' }, 'polite'),
    voiced('idle.any.3' as never, { name: 'Bean' }, 'friend'),
  );
  assert.equal(voiced('idle.back.2' as never, { name: 'Bean' }, 'polite'), 'Welcome back. You were missed.');
  setLang('ko');
});

test('먼저 할 일 제목은 한 줄로 자르고 따옴표, 중괄호를 걷는다', () => {
  const v = idleVars({ now: 0, doneToday: 0, todoTitle: `  "분기\n보고서" {초안}  ${'ㅋ'.repeat(40)}` });
  assert.ok(v.todo.length <= 24, v.todo);
  assert.ok(!/["{}\n]/.test(v.todo), v.todo);
  assert.equal(idleVars({ now: 0, doneToday: 0 }).todo, '');
});

test('말에 제목을 넣는 문구가 말풍선까지 이어진다 (할 일 제목 틀)', () => {
  setLang('ko');
  const looseT = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  assert.equal(looseT('idle.todo.title.1', { name: '콩이', todo: '보고서' }), '"보고서"부터 시작해 볼까?');
  setLang('en');
  assert.equal(
    looseT('idle.todo.title.1', { name: 'Bean', todo: 'Report' }),
    'Shall we start with "Report"?',
  );
  setLang('ko');
});
