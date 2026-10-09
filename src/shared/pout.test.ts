import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts } from './i18n/index.ts';
import {
  canPout,
  forgive,
  grabbed,
  initPout,
  isPraise,
  POUT,
  POUT_REASONS,
  type PoutContext,
  type PoutState,
  pickLine,
  pout,
  poutStage,
  remember,
  soothe,
  tickPout,
} from './pout.ts';

const MIN = 60_000;
const DAY = '2026-10-08';
const T0 = Date.UTC(2026, 9, 8, 1);
/** 매운맛, 자리에 있음, 방해 금지 아님 */
const SPICY: PoutContext = {
  spicy: true,
  calm: false,
  present: true,
  hungry: false,
  overdue: 0,
  userHidden: false,
};
const MILD: PoutContext = { ...SPICY, spicy: false };

/** 1분 틱을 n 번. 처음 삐진 까닭과 그때 분을 돌려준다 */
function run(s0: PoutState, ctx: PoutContext, minutes: number, start = T0) {
  let s = s0;
  let first: { reason: string; at: number } | undefined;
  for (let m = 1; m <= minutes; m++) {
    const r = tickPout(s, ctx, start + m * MIN, DAY, 1);
    s = r.state;
    if (r.pouted && !first) first = { reason: r.pouted, at: m };
  }
  return { s, first };
}

test('단계: 두 점이 한 단계, 세 단계까지', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(poutStage), [0, 1, 1, 2, 2, 3, 3, 3]);
});

test('순한맛(끔)은 예전 그대로: 오래 안 놀아 줘도, 이벤트가 와도 안 토라진다', () => {
  const { s, first } = run(initPout(DAY, T0), { ...MILD, hungry: true, overdue: 3 }, 600);
  assert.equal(first, undefined);
  assert.equal(s.points, 0);
  for (const reason of POUT_REASONS) assert.equal(pout(s, reason, MILD, T0).pouted, undefined, reason);
  const petted = soothe(initPout(DAY, T0), 'pet', T0).state;
  assert.equal(grabbed(petted, MILD, T0 + 1000).pouted, undefined);
});

test('매운맛을 끄면 토라짐이 바로 풀린다', () => {
  const s = pout(initPout(DAY, T0), 'friend', SPICY, T0).state;
  assert.equal(poutStage(s.points), 2);
  const r = tickPout(s, MILD, T0 + MIN, DAY, 1);
  assert.equal(r.state.points, 0);
  assert.equal(r.from, 2);
  assert.equal(r.to, 0);
});

test('안 놀아 줌: 자리에 있는 시간으로 75분, 자리 비움과 방해 금지는 세지 않는다', () => {
  assert.deepEqual(run(initPout(DAY, T0), SPICY, 200).first, { reason: 'lonely', at: POUT.lonelyMin });
  assert.equal(run(initPout(DAY, T0), { ...SPICY, present: false }, 300).first, undefined);
  assert.equal(run(initPout(DAY, T0), { ...SPICY, calm: true }, 300).first, undefined);
  // 자리를 비운 시간은 쌓이지 않는다: 300분 비우고 돌아와 1분 만에 토라지지 않는다
  const away = run(initPout(DAY, T0), { ...SPICY, present: false }, 300).s;
  assert.equal(run(away, SPICY, 1, T0 + 300 * MIN).first, undefined);
  // 74분에 쓰다듬으면 안 놀아 줌은 처음부터 (말 안 걸기는 그대로 세어 120분에 온다)
  let s = run(initPout(DAY, T0), SPICY, 74).s;
  s = soothe(s, 'pet', T0 + 74 * MIN).state;
  assert.deepEqual(run(s, SPICY, 74, T0 + 74 * MIN).first, { reason: 'unheard', at: POUT.unheardMin - 74 });
  // 쓰다듬고 눌러 말도 걸면 둘 다 처음부터
  s = soothe(s, 'click', T0 + 74 * MIN).state;
  assert.equal(run(s, SPICY, 74, T0 + 74 * MIN).first, undefined);
});

test('배고픔이 25분, 미룬 할 일은 자리에 15분 있은 뒤, 말 안 걸기는 120분', () => {
  assert.deepEqual(run(initPout(DAY, T0), { ...SPICY, hungry: true }, 60).first, {
    reason: 'hungry',
    at: POUT.hungryMin,
  });
  assert.deepEqual(run(initPout(DAY, T0), { ...SPICY, overdue: 2 }, 60).first, {
    reason: 'todoLate',
    at: POUT.todoLateAfterMin,
  });
  // 누르기만 하면(스킨십 없음) 안 놀아 줌은 오지만 말 안 걸기는 안 온다. 놀아만 주면 말 안 걸기가 온다
  let s = initPout(DAY, T0);
  let unheard: number | undefined;
  for (let m = 1; m <= 200; m++) {
    const now = T0 + m * MIN;
    s = soothe(s, 'play', now).state;
    const r = tickPout(s, SPICY, now, DAY, 1);
    s = r.state;
    if (r.pouted) {
      assert.equal(r.pouted, 'unheard');
      unheard ??= m;
    }
  }
  assert.equal(unheard, POUT.unheardMin);
});

test('오래 숨김: 90분 넘게 숨겨 뒀다 꺼내면 삐진다. 짧게 숨기거나 발표(사용자 숨김 아님)는 아니다', () => {
  const hide = (minutes: number) => {
    let s = tickPout(initPout(DAY, T0), { ...SPICY, userHidden: true, calm: true }, T0, DAY, 0).state;
    s = tickPout(s, { ...SPICY, userHidden: true, calm: true }, T0 + minutes * MIN, DAY, 1).state;
    return tickPout(s, SPICY, T0 + (minutes + 0.5) * MIN, DAY, 0.5).pouted;
  };
  assert.equal(hide(POUT.hiddenLongMin + 1), 'hiddenLong');
  assert.equal(hide(POUT.hiddenLongMin - 5), undefined);
  // 꺼낸 그 순간 자리를 비웠어도(입력 없음) 오래 숨김은 센다
  let s = tickPout(initPout(DAY, T0), { ...SPICY, userHidden: true, calm: true }, T0, DAY, 0).state;
  s = tickPout(s, { ...SPICY, userHidden: true, calm: true }, T0 + 120 * MIN, DAY, 1).state;
  assert.equal(tickPout(s, { ...SPICY, present: false }, T0 + 121 * MIN, DAY, 1).pouted, 'hiddenLong');
});

test('쓰다듬다 4초 안에 들면 삐지고, 그 뒤면 괜찮다', () => {
  const s = soothe(initPout(DAY, T0), 'pet', T0).state;
  assert.equal(grabbed(s, SPICY, T0 + 3000).pouted, 'yanked');
  assert.equal(grabbed(s, SPICY, T0 + 5000).pouted, undefined);
  assert.equal(grabbed(initPout(DAY, T0), SPICY, T0).pouted, undefined);
  // 같은 쓰다듬기로 두 번 삐지지 않는다
  const once = grabbed(s, SPICY, T0 + 1000).state;
  assert.equal(grabbed(once, SPICY, T0 + 1500).pouted, undefined);
});

test('방해하지 않기: 방해 금지, 간격 15분, 하루 6번, 까닭별 쉬는 시간, 화해 뒤 45분', () => {
  const s0 = initPout(DAY, T0);
  assert.equal(canPout(s0, 'friend', { ...SPICY, calm: true }, T0), false);
  const a = pout(s0, 'friend', SPICY, T0).state;
  assert.equal(canPout(a, 'yanked', SPICY, T0 + 14 * MIN), false);
  assert.equal(canPout(a, 'yanked', SPICY, T0 + 15 * MIN), true);
  assert.equal(canPout(a, 'friend', SPICY, T0 + 30 * MIN), false);
  assert.equal(canPout(a, 'friend', SPICY, T0 + 60 * MIN), true);
  assert.equal(canPout({ ...a, today: POUT.dailyMax }, 'lonely', SPICY, T0 + 300 * MIN), false);
  const made = soothe(a, 'play', T0 + MIN).state;
  assert.equal(canPout(made, 'yanked', SPICY, T0 + 44 * MIN), false);
  assert.equal(canPout(made, 'yanked', SPICY, T0 + 46 * MIN), true);
});

test('상한과 자연 회복: 6점에서 멈추고 20분에 한 점, 두 시간이면 다 풀린다', () => {
  let s = initPout(DAY, T0);
  let now = T0;
  for (const reason of ['friend', 'restIgnored', 'yanked', 'hungry'] as const) {
    s = pout(s, reason, SPICY, now).state;
    now += POUT.gapMs;
  }
  assert.ok(s.points <= POUT.maxPoints);
  s = { ...s, points: POUT.maxPoints, decayAt: now };
  const away = { ...SPICY, present: false };
  assert.equal(tickPout(s, away, now + 19 * MIN, DAY, 1).state.points, 6);
  assert.equal(tickPout(s, away, now + 20 * MIN, DAY, 1).state.points, 5);
  assert.equal(tickPout(s, away, now + 120 * MIN, DAY, 1).state.points, 0);
  // 날이 바뀌면 새로
  const next = tickPout(s, away, now + MIN, '2026-10-09', 1);
  assert.equal(next.state.points, 0);
  assert.equal(next.state.today, 0);
});

test('달래기: 쓰다듬기 2, 칭찬 3, 밥 3, 놀기는 다, 다 풀리면 화해', () => {
  const at3 = { ...pout(initPout(DAY, T0), 'friend', SPICY, T0).state, points: 6 };
  const p = soothe(at3, 'pet', T0 + MIN);
  assert.equal(p.result, 'softer');
  assert.equal(p.state.points, 4);
  assert.equal(p.from, 3);
  assert.equal(p.to, 2);
  assert.equal(soothe(at3, 'praise', T0).state.points, 3);
  assert.equal(soothe(at3, 'feed', T0).state.points, 3);
  const play = soothe(at3, 'play', T0 + MIN);
  assert.equal(play.result, 'madeUp');
  assert.equal(play.state.madeUpAt, T0 + MIN);
  assert.equal(soothe(at3, 'click', T0).result, 'none');
  assert.equal(soothe(initPout(DAY, T0), 'pet', T0).result, 'none');
  // 세 번 쓰다듬으면 화해
  let s: PoutState = at3;
  for (let i = 0; i < 3; i++) s = soothe(s, 'pet', T0 + i * 3000).state;
  assert.equal(s.points, 0);
  assert.equal(forgive(at3, T0).points, 0);
});

test('맛별 비교: 같은 하루(3시간, 배고픔, 미룬 할 일, 쓰다듬다 끌기)에 순한맛은 0번, 매운맛은 여러 번', () => {
  const day = (ctx: PoutContext) => {
    let s = initPout(DAY, T0);
    let count = 0;
    let top = 0;
    for (let m = 1; m <= 180; m++) {
      const now = T0 + m * MIN;
      const c = { ...ctx, hungry: m > 60, overdue: 1 };
      const r = tickPout(s, c, now, DAY, 1);
      s = r.state;
      if (r.pouted) count++;
      if (m === 100) {
        s = soothe(s, 'pet', now).state;
        const g = grabbed(s, c, now + 1000);
        s = g.state;
        if (g.pouted) count++;
      }
      top = Math.max(top, poutStage(s.points));
    }
    return { count, top };
  };
  assert.deepEqual(day(MILD), { count: 0, top: 0 });
  const spicy = day(SPICY);
  assert.ok(spicy.count >= 3, `매운맛 ${spicy.count}번`);
  assert.ok(spicy.top >= 2, `매운맛 최고 단계 ${spicy.top}`);
  assert.ok(spicy.count <= POUT.dailyMax);
});

test('칭찬 알아보기 (한국어, 영어)', () => {
  for (const s of [
    '고마워!',
    '사랑해 콩아',
    '귀여워',
    '미안해 ㅠ',
    '최고야',
    'thanks',
    'Love you',
    "you're the best",
    'sorry',
  ])
    assert.ok(isPraise(s), s);
  for (const s of ['', '내일 회의 몇 시야?', 'what time is it', 'cutest'.slice(0, 3), 'x'.repeat(500)])
    assert.equal(isPraise(s), false, s);
});

test('말 고르기: 최근에 한 말은 피하고, 다 했으면 아무거나', () => {
  const pool = ['a', 'b', 'c'];
  assert.equal(
    pickLine(pool, ['a', 'b'], () => 0),
    'c',
  );
  assert.equal(
    pickLine(pool, ['a', 'b', 'c'], () => 0.99),
    'c',
  );
  let recent: string[] = [];
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    const l = pickLine(pool, recent, () => 0);
    seen.push(l);
    recent = remember(recent, l);
  }
  assert.deepEqual(seen.sort(), ['a', 'b', 'c']);
  assert.equal(remember(['1', '2', '3'], '4', 3).join(), '2,3,4');
});

test('토라짐 말: 까닭마다 네 줄, 달래기와 화해는 여섯 줄, 한국어와 영어 모두 서로 다르다', () => {
  for (const dict of [dicts.ko, dicts.en]) {
    const d = dict as Record<string, unknown>;
    const say = (k: string) => {
      const v = d[k];
      return typeof v === 'function'
        ? (v as (x: object) => string)({ n: 2, friend: '냥이', name: '콩이' })
        : v;
    };
    for (const [prefix, n] of [
      ...POUT_REASONS.map((r) => [`pout.${r}`, 4] as const),
      ['pout.stage3', 4] as const,
      ['pout.softer', 6] as const,
      ['pout.madeUp', 6] as const,
    ]) {
      const lines = Array.from({ length: n }, (_, i) => say(`${prefix}.${i + 1}`));
      for (const l of lines) assert.equal(typeof l, 'string', prefix);
      assert.equal(new Set(lines).size, n, `${prefix} 줄이 겹친다`);
    }
    for (const r of POUT_REASONS) assert.equal(typeof say(`pout.why.${r}`), 'string', r);
  }
});
