// 매운맛 토라짐: 하루 중에도 잘 삐진다 (사용자 요청 2026-10-08 "매운맛을 훨씬 잘 삐지게").
// 날 단위 삐짐(pet-life.ts 칸 막대)은 그대로 두고, 그 위에 그날그날 토라지는 층을 하나 더 얹는다.
// 매운맛을 켰을 때만 움직인다. 순한맛(끔)은 예전 그대로 아무것도 하지 않는다.
//
// 잃는 것은 없다 (pet-life.ts 원칙): 코인, 친밀도, 기분은 건드리지 않고 모습과 말만 바뀐다.
// 앱을 끄면 사라지고(메모리에만), 가만둬도 20분마다 한 칸씩 풀려 가장 크게 삐져도 두 시간이면 다 풀린다.
// 방해하지 않는다: 집중, 숨김(발표 포함), 노는 중에는 새로 삐지지 않고 시간도 세지 않는다.
// 말은 부르는 쪽이 수다 빈도(system 말풍선)와 떠 있는 말풍선(일정 알림 등)을 보고 한다.

import { voiced } from './persona-voice.ts';

/** 삐지는 까닭. 앱이 실제로 아는 신호만 */
export type PoutReason =
  /** 쓰다듬기, 밥, 놀기 없이 오래 */
  | 'lonely'
  /** 누르기(패널), 대화 없이 오래 */
  | 'unheard'
  /** 배고픈 채로 오래 */
  | 'hungry'
  /** 마감 지난 할 일이 있다 (하루 한 번) */
  | 'todoLate'
  /** 휴식 권유를 넘겼다 (나중에, 그냥 닫음, 시간 끝) */
  | 'restIgnored'
  /** 오래 숨겨 뒀다 꺼냈다 */
  | 'hiddenLong'
  /** 다른 펫(친구)을 꺼냈다 */
  | 'friend';

export const POUT_REASONS: readonly PoutReason[] = [
  'lonely',
  'unheard',
  'hungry',
  'todoLate',
  'restIgnored',
  'hiddenLong',
  'friend',
];

/** 달래는 길. chat 은 대화, click 은 눌러서 패널 열기, praise 는 대화에 칭찬이나 사과 한마디 */
export type PoutSoothe = 'pet' | 'feed' | 'play' | 'todo' | 'praise' | 'chat' | 'click';

const MIN = 60_000;

export const POUT = {
  /** 점수 상한. 두 점이 한 단계, 세 단계까지 */
  maxPoints: 6,
  pointsPerStage: 2,
  maxStage: 3,
  /** 가만둬도 이만큼마다 한 점씩 풀린다 (6점이 두 시간) */
  decayMs: 20 * MIN,
  /** 화해한 뒤 이만큼은 새로 삐지지 않는다 */
  graceMs: 45 * MIN,
  /** 삐지는 일 사이 최소 간격 (한꺼번에 몰아 삐지지 않게) */
  gapMs: 15 * MIN,
  /** 하루에 새로 삐지는 횟수 상한 */
  dailyMax: 6,
  /** 사용자가 자리에 있다고 보는 입력 없는 시간(초) 상한 */
  presentIdleSec: 120,
  /**
   * 쓰다듬은 뒤 이 안에 들어 옮기면 "앗" 하고 놀란다 (삐지지 않는다). 쓰다듬기는 누르지 않고 문지르는 것이라
   * 쓰다듬고 바로 눌러 옮기는 것과 갈라 볼 수 없어서다 (사용자 결정 2026-10-09: 옮기려다 자주 삐졌다)
   */
  startleWindowMs: 4000,
  /** 놀라는 말은 이만큼에 한 번 */
  startleGapMs: 10 * MIN,
  /** 자리에 있는 시간(분)으로 센 문턱 */
  lonelyMin: 75,
  unheardMin: 120,
  hungryMin: 25,
  /** 마감 지난 할 일은 그날 자리에 이만큼 있은 뒤에 (켜자마자 덤비지 않게) */
  todoLateAfterMin: 15,
  /** 이만큼 넘게 숨겨 뒀다 꺼내면 */
  hiddenLongMin: 90,
  /** 까닭마다 더하는 점수 */
  points: {
    lonely: 2,
    unheard: 2,
    hungry: 2,
    todoLate: 2,
    restIgnored: 2,
    hiddenLong: 2,
    friend: 3,
  } satisfies Record<PoutReason, number>,
  /** 같은 까닭으로 다시 삐지기까지 */
  cooldownMs: {
    lonely: 90 * MIN,
    unheard: 120 * MIN,
    hungry: 90 * MIN,
    todoLate: 24 * 60 * MIN,
    restIgnored: 60 * MIN,
    hiddenLong: 60 * MIN,
    friend: 60 * MIN,
  } satisfies Record<PoutReason, number>,
  /** 달래기마다 빼는 점수. 놀기는 다 풀린다 */
  soothe: {
    pet: 2,
    feed: 3,
    play: 6,
    todo: 3,
    praise: 3,
    chat: 1,
    click: 0,
  } satisfies Record<PoutSoothe, number>,
} as const;

export interface PoutState {
  /** 이 상태의 날 (바뀌면 새로) */
  day: string;
  points: number;
  /** 가장 최근에 삐진 까닭 */
  reason?: PoutReason;
  /** 마지막으로 한 점 풀린 시각 (삐진 동안만 뜻이 있다) */
  decayAt: number;
  /** 마지막으로 삐진 시각. 없으면 0 */
  lastAt: number;
  /** 마지막 화해 시각. 없으면 0 */
  madeUpAt: number;
  /** 오늘 삐진 횟수 */
  today: number;
  /** 까닭마다 마지막으로 삐진 시각 */
  last: Partial<Record<PoutReason, number>>;
  /** 자리에 있는 시간(분)으로 센 것들 */
  lonelyMin: number;
  unheardMin: number;
  hungryMin: number;
  /** 오늘 자리에 있었던 시간(분) */
  presentMin: number;
  /** 마지막 쓰다듬기 시각. 없으면 0 */
  pettedAt: number;
  /** 마지막으로 "앗" 하고 놀란 시각. 없으면 0 */
  startledAt: number;
  /** 사용자가 숨긴 시각. 안 숨었으면 0 */
  hiddenSince: number;
}

/** 지금 상황 (부르는 쪽이 매번 읽어 준다) */
export interface PoutContext {
  /** 매운맛 */
  spicy: boolean;
  /** 방해하면 안 되는 때: 집중, 숨김(발표, 집 안 포함), 노는 중. 새로 삐지지도 시간을 세지도 않는다 */
  calm: boolean;
  /** 사용자가 자리에 있다 (입력 없는 시간이 presentIdleSec 아래) */
  present: boolean;
  /** 배고픔 (배부름이 낮다) */
  hungry: boolean;
  /** 마감이 지난 안 끝낸 할 일 수 */
  overdue: number;
  /** 사용자가 숨겨 둔 상태 (숨김 까닭 user) */
  userHidden: boolean;
}

export function initPout(day: string, now = 0): PoutState {
  return {
    day,
    points: 0,
    decayAt: now,
    lastAt: 0,
    madeUpAt: 0,
    today: 0,
    last: {},
    lonelyMin: 0,
    unheardMin: 0,
    hungryMin: 0,
    presentMin: 0,
    pettedAt: 0,
    startledAt: 0,
    hiddenSince: 0,
  };
}

/** 점수에 맞는 단계 0~3. 1 고개 돌리기, 2 흥(볼 부풀리고 흘겨보기), 3 등 돌리고 앉기 */
export function poutStage(points: number): number {
  if (points <= 0) return 0;
  return Math.min(POUT.maxStage, Math.ceil(points / POUT.pointsPerStage));
}

export interface PoutChange {
  state: PoutState;
  /** 이번에 새로 삐졌다 */
  pouted?: PoutReason;
  /** 바뀌기 전 단계 */
  from: number;
  /** 바뀐 뒤 단계 */
  to: number;
}

const change = (state: PoutState, from: number, pouted?: PoutReason): PoutChange => ({
  state,
  from,
  to: poutStage(state.points),
  ...(pouted ? { pouted } : {}),
});

/** 매운맛을 끄거나 날이 바뀌었을 때: 다 풀고 센 것도 지운다 (화해 시각과 숨긴 시각은 둔다) */
function cleared(s: PoutState, day: string, now: number): PoutState {
  return {
    ...initPout(day, now),
    madeUpAt: s.madeUpAt,
    hiddenSince: s.hiddenSince,
    pettedAt: s.pettedAt,
    startledAt: s.startledAt,
  };
}

/** 이 까닭으로 지금 삐질 수 있는지 (방해 금지, 화해 뒤 여유, 간격, 하루 상한, 까닭별 쉬는 시간) */
export function canPout(s: PoutState, reason: PoutReason, ctx: PoutContext, now: number): boolean {
  if (!ctx.spicy || ctx.calm) return false;
  if (s.madeUpAt > 0 && now - s.madeUpAt < POUT.graceMs) return false;
  if (s.lastAt > 0 && now - s.lastAt < POUT.gapMs) return false;
  if (s.today >= POUT.dailyMax) return false;
  const last = s.last[reason];
  if (last !== undefined && now - last < POUT.cooldownMs[reason]) return false;
  return true;
}

/** 삐진다. 못 삐지는 때면 그대로 돌려준다 (pouted 없음) */
export function pout(s: PoutState, reason: PoutReason, ctx: PoutContext, now: number): PoutChange {
  const from = poutStage(s.points);
  if (!canPout(s, reason, ctx, now)) return change(s, from);
  const next: PoutState = {
    ...s,
    points: Math.min(POUT.maxPoints, s.points + POUT.points[reason]),
    reason,
    // 삐진 순간부터 다시 센다 (막 삐졌는데 바로 한 점 풀리지 않게)
    decayAt: now,
    lastAt: now,
    today: s.today + 1,
    last: { ...s.last, [reason]: now },
  };
  // 그 까닭으로 센 시간은 처음부터
  if (reason === 'lonely') next.lonelyMin = 0;
  if (reason === 'unheard') next.unheardMin = 0;
  if (reason === 'hungry') next.hungryMin = 0;
  return change(next, from, reason);
}

/**
 * 1분쯤마다 부른다. minutes 는 지난번 뒤로 흐른 시간(분).
 * 날이 바뀌면 새로, 매운맛이 꺼지면 다 풀고, 삐진 동안은 decayMs 마다 한 점씩 풀린다.
 * 자리에 있고 방해 금지가 아닐 때만 시간을 세고, 문턱을 넘은 것 하나로 삐진다
 * (배고픔, 미룬 할 일, 안 놀아 줌, 말 안 걸기 순. 오래 숨김은 꺼낸 첫 틱에).
 */
export function tickPout(
  s0: PoutState,
  ctx: PoutContext,
  now: number,
  day: string,
  minutes: number,
): PoutChange {
  let s = s0.day === day ? s0 : cleared(s0, day, now);
  if (!ctx.spicy) {
    const off = cleared(s, day, now);
    return change(off, poutStage(s0.points));
  }
  const from = poutStage(s0.points);
  // 풀리기
  if (s.points > 0) {
    const steps = Math.floor((now - s.decayAt) / POUT.decayMs);
    if (steps > 0)
      s = { ...s, points: Math.max(0, s.points - steps), decayAt: s.decayAt + steps * POUT.decayMs };
  } else if (s.decayAt !== now) s = { ...s, decayAt: now };
  // 숨김: 숨긴 시각을 적어 두고, 꺼낸 첫 틱에 오래였으면 삐진다
  let revealedAfter = 0;
  if (ctx.userHidden && s.hiddenSince === 0) s = { ...s, hiddenSince: now };
  else if (!ctx.userHidden && s.hiddenSince > 0) {
    revealedAfter = now - s.hiddenSince;
    s = { ...s, hiddenSince: 0 };
  }
  // 시간 세기 (자리에 있고 방해 금지가 아닐 때만)
  const dt = Math.max(0, Math.min(minutes, 10));
  if (ctx.present && !ctx.calm) {
    s = {
      ...s,
      lonelyMin: s.lonelyMin + dt,
      unheardMin: s.unheardMin + dt,
      hungryMin: ctx.hungry ? s.hungryMin + dt : 0,
      presentMin: s.presentMin + dt,
    };
  } else if (!ctx.hungry && s.hungryMin > 0) s = { ...s, hungryMin: 0 };

  const want: PoutReason[] = [];
  if (revealedAfter >= POUT.hiddenLongMin * MIN) want.push('hiddenLong');
  if (s.hungryMin >= POUT.hungryMin) want.push('hungry');
  if (ctx.overdue > 0 && s.presentMin >= POUT.todoLateAfterMin) want.push('todoLate');
  if (s.lonelyMin >= POUT.lonelyMin) want.push('lonely');
  if (s.unheardMin >= POUT.unheardMin) want.push('unheard');
  for (const reason of want) {
    if (!ctx.present && reason !== 'hiddenLong') continue;
    const r = pout(s, reason, ctx, now);
    if (r.pouted) return { ...r, from };
  }
  return change(s, from);
}

/**
 * 들어 옮기기 시작했다. 매운맛이고 쓰다듬은 직후면 "앗" 하고 놀란다(startled). 점수는 그대로라 삐지지 않는다.
 * 같은 쓰다듬기로 두 번 놀라지 않고, startleGapMs 에 한 번만. 방해 금지 때는 놀라지 않는다
 */
export function grabbed(
  s: PoutState,
  ctx: PoutContext,
  now: number,
): { state: PoutState; startled: boolean } {
  if (s.pettedAt === 0 || now - s.pettedAt > POUT.startleWindowMs) return { state: s, startled: false };
  const state = { ...s, pettedAt: 0 };
  const startled = ctx.spicy && !ctx.calm && (s.startledAt === 0 || now - s.startledAt >= POUT.startleGapMs);
  return startled ? { state: { ...state, startledAt: now }, startled } : { state, startled };
}

export type SootheResult = 'none' | 'softer' | 'madeUp';

/**
 * 달랜다. 같이 한 일은 그 까닭의 센 시간을 처음으로 돌리고(쓰다듬기, 밥, 놀기는 안 놀아 줌, 누르기와 대화는 말 안 걸기,
 * 밥은 배고픔), 삐진 동안이면 점수를 뺀다. 0 이 되면 화해.
 */
export function soothe(s: PoutState, kind: PoutSoothe, now: number): PoutChange & { result: SootheResult } {
  const from = poutStage(s.points);
  const next: PoutState = { ...s };
  if (kind === 'pet' || kind === 'feed' || kind === 'play') next.lonelyMin = 0;
  if (kind === 'chat' || kind === 'click' || kind === 'praise' || kind === 'todo') next.unheardMin = 0;
  if (kind === 'feed') next.hungryMin = 0;
  if (kind === 'pet') next.pettedAt = now;
  if (s.points <= 0 || POUT.soothe[kind] <= 0) return { ...change(next, from), result: 'none' };
  next.points = Math.max(0, s.points - POUT.soothe[kind]);
  // 덜 풀렸으면 풀리는 시계도 처음부터 (달랜 직후 저절로 한 칸 더 내려가 헷갈리지 않게)
  next.decayAt = now;
  if (next.points === 0) {
    next.madeUpAt = now;
    return { ...change(next, from), result: 'madeUp' };
  }
  return { ...change(next, from), result: 'softer' };
}

/** 날 단위 화해(할 일, 쓰다듬기와 밥)와 같이 풀렸다: 말 없이 다 푼다 */
export function forgive(s: PoutState, now: number): PoutState {
  return s.points > 0 ? { ...s, points: 0, madeUpAt: now, decayAt: now } : s;
}

// 칭찬, 사과, 애정 표현. 대화창에 쓴 말에서 찾는다 (한국어, 영어)
const PRAISE_KO =
  /고마워|고맙|사랑해|좋아해|귀여워|귀엽|최고|미안|착하|착해|예뻐|예쁘|이뻐|잘했|보고\s?싶|짱|기특/;
const PRAISE_EN =
  /\b(thanks?|thank you|thx|love you|luv u|cute|sorry|you'?re (the )?best|good (boy|girl|job)|adorable|miss(ed)? you|like you|sweetie|well done)\b/i;

/** 대화에 쓴 말이 칭찬이나 사과인지 */
export function isPraise(text: string): boolean {
  const s = text.trim();
  if (!s || s.length > 400) return false;
  return PRAISE_KO.test(s) || PRAISE_EN.test(s);
}

/**
 * 줄 고르기: 최근에 한 말(recent)은 피한다. 다 했으면 아무거나.
 * 같은 말이 연달아 나오지 않게 (말 반복 줄이기)
 */
export function pickLine(pool: readonly string[], recent: readonly string[], rand: () => number): string {
  const fresh = pool.filter((l) => !recent.includes(l));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))] ?? '';
}

/** 최근 말 목록에 넣는다 (최근 n 개만) */
export function remember(recent: readonly string[], line: string, n = 6): string[] {
  return [...recent.filter((l) => l !== line), line].slice(-n);
}

const VOICED = voiced as unknown as (key: string, vars?: Record<string, string | number>) => string;
/**
 * 토라진 말 n 줄 (prefix.1 ~ prefix.n). 고른 성격 말투로 (shared/persona-voice.ts):
 * 예전엔 t 로 읽어 존댓말 비서도 토라진 말만 반말이었고, 고양이체 같은 말투 규칙도 붙지 않았다
 */
export const poutLines = (prefix: string, n: number, vars?: Record<string, string | number>): string[] =>
  Array.from({ length: n }, (_, i) => VOICED(`${prefix}.${i + 1}`, vars));
