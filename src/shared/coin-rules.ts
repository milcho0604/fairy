// 코인 규칙 한 곳 (기획서 6절, 16절). 버는 값, 하루 상한, 상점 값을 여기 둔다.
// 앱(todo-store, routine, focus, shop 등)과 서버(server/, 빌드 때 이 파일만 복사해 쓴다)가 같은 값을 쓴다.
// 서버가 함께 읽으므로 이 파일은 아무것도 가져오지 않는다(import 없음, electron 과 앱 모듈 의존 없음).

export const COIN = {
  /** 할 일 하나 (사용자 결정 2026-10-14, #75: 10 에서 15) */
  todo: 15,
  /** 마감 전(마감일 당일 포함)에 끝냄 */
  early: 5,
  /** 하루에 코인을 받는 할 일 수 */
  dailyTodoLimit: 20,
  /** 기본 먹이 */
  food: 5,
  /** 집중 타이머 한 번 (25분 기준. 길이를 고르면 길수록 보너스: focusCoins) */
  focus: 10,
  /** 하루에 코인을 받는 집중 횟수 (25분 기준). 하루 집중 코인 상한 = focus x 이 값 = 100 (#76: 40 에서 100) */
  dailyFocusLimit: 10,
} as const;

/**
 * 만난 날 코인: 하루 한 번만. 연속 기록이 STREAK_EVERY 의 배수인 날은 STREAK_BONUS 를 더한다
 * (사용자 결정 2026-10-14, #75: 하루 3 에서 10, 5일마다 +5 를 7일 연속마다 +50 으로)
 */
export const MEET_COINS = 10;
export const STREAK_EVERY = 7;
export const STREAK_BONUS = 50;
/** 매주 선물: 한 주(월요일 시작, 현지 날짜)의 첫 출석 때 만난 날 코인과 함께 한 번 (#75) */
export const WEEKLY_COINS = 50;

/** 집중 길이 (분) */
export const FOCUS_LENGTHS = [15, 25, 50] as const;

/**
 * 집중 코인의 기준점 [분, 코인]. 사이는 직선으로 잇는다. 1분당 코인이 15분까지 1/3, 25분까지 1/2, 50분까지 3/5 로
 * 늘어 길게 집중할수록 보너스가 붙는다 (사용자 결정 2026-10-14, #76: 25분 두 번보다 50분 한 번이 낫게)
 */
const FOCUS_COIN_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [15, 5],
  [25, 10],
  [50, 25],
];

/** 집중을 끝내면 받는 코인 (15분 5, 25분 10, 50분 25). 50분 넘게 집중한 시간은 50분까지의 비율(3/5)로 더한다 */
export function focusCoins(focusMin: number): number {
  if (!Number.isFinite(focusMin) || focusMin <= 0) return 0;
  let prev = FOCUS_COIN_POINTS[0] as readonly [number, number];
  for (const p of FOCUS_COIN_POINTS) {
    if (focusMin <= p[0]) {
      const coins = prev[1] + ((focusMin - prev[0]) * (p[1] - prev[1])) / (p[0] - prev[0]);
      return Math.round(coins);
    }
    prev = p;
  }
  const [m1, c1] = FOCUS_COIN_POINTS[FOCUS_COIN_POINTS.length - 2] as readonly [number, number];
  return Math.round(prev[1] + ((focusMin - prev[0]) * (prev[1] - c1)) / (prev[0] - m1));
}

/** 놀이 코인: 놀이를 다 합쳐 하루 이만큼까지 (기본 먹이 5코인 남짓) */
export const PLAY_COIN = { reason: 'play', dailyLimit: 6 } as const;
/** 숨바꼭질: 찾으면 3, 하루 3판까지 */
export const HIDE_SEEK_COIN = { coins: 3, dailyLimit: 3 } as const;
/** 휴식 권유를 따르고 실제로 쉬었다 */
export const REST_COINS = 3;
/** 첫 7일 여정: 하나 해 볼 때마다 (밥 한 번 값쯤), 일곱 걸음 */
export const JOURNEY_COINS = 3;
export const JOURNEY_STEP_COUNT = 7;
/** 화해 보너스: 삐짐 한 칸에 4코인, 매운맛 최대 7칸이라 28. 7일에 한 번 */
export const SULK_MAX = 7;
export const MAKEUP_PER_LEVEL = 4;

/** 매일 쪽지의 특별한 편지에 넣는 코인 (함께한 7, 30, 100, 365일) */
export function milestoneCoins(day: number): number {
  if (day >= 365) return 30;
  if (day >= 100) return 20;
  if (day >= 30) return 10;
  return 5;
}

// ---- 상점 값 ----

/** 먹이 값. 기본 먹이는 COIN.food */
export const FOOD_COSTS = { basic: COIN.food, snack: 12, cake: 30 } as const;
/** 장난감 값 */
export const TOY_COSTS = { ball: 30, yarn: 60, cushion: 100 } as const;
/**
 * 집 단계 값: 200, 500, 1,000, 1,800, 3,000. 하루 코인은 할 일 몇 개와 집중으로 50~100 쯤이라
 * 3단계까지 2~3주, 5단계는 두어 달 걸린다
 */
export const HOUSE_COSTS = [200, 500, 1000, 1800, 3000] as const;
/** 집 모양 값 (한 번 사면 언제든 공짜로 바꾼다. 단계는 그대로). 나무집은 처음부터 있다 */
export const HOUSE_STYLE_COSTS = { wood: 0, mushroom: 300, igloo: 400, castle: 600 } as const;
/** 커스텀 먹이 만들기 값 (한 번). 먹일 때는 기본 먹이 값 */
export const CUSTOM_FOOD_COST = 50;

// ---- 서버가 다시 확인하는 규칙 (기획서 6절: 같은 규칙으로 확인, 하루 상한을 넘으면 상한까지만) ----

/**
 * 버는 기록의 까닭(coin_log.reason)마다: 한 기록의 최대(perEntry), 하루 합 상한(perDay), 한 주(월요일 시작) 합 상한(perWeek).
 * 앱 코드에 하루 상한이 따로 없는 것(rest, journey, makeup, note-gift)은 앱이 하루에 줄 수 있는 만큼으로 잡았다.
 */
export interface EarnRule {
  perEntry: number;
  perDay?: number;
  perWeek?: number;
}

export const EARN_RULES: Readonly<Record<string, EarnRule>> = {
  todo: { perEntry: COIN.todo, perDay: COIN.todo * COIN.dailyTodoLimit },
  early: { perEntry: COIN.early, perDay: COIN.early * COIN.dailyTodoLimit },
  focus: { perEntry: focusCoins(50), perDay: COIN.focus * COIN.dailyFocusLimit },
  meet: { perEntry: MEET_COINS + STREAK_BONUS, perDay: MEET_COINS + STREAK_BONUS },
  weekly: { perEntry: WEEKLY_COINS, perWeek: WEEKLY_COINS },
  play: { perEntry: PLAY_COIN.dailyLimit, perDay: PLAY_COIN.dailyLimit },
  'hide-seek': { perEntry: HIDE_SEEK_COIN.coins, perDay: HIDE_SEEK_COIN.coins * HIDE_SEEK_COIN.dailyLimit },
  // 휴식 권유는 수다쟁이도 1시간에 한 번이라 하루 10번이면 넉넉하다
  rest: { perEntry: REST_COINS, perDay: REST_COINS * 10 },
  // 여정 일곱 걸음을 하루에 다 해도 21
  journey: { perEntry: JOURNEY_COINS, perDay: JOURNEY_COINS * JOURNEY_STEP_COUNT },
  // 화해 보너스는 7일에 한 번 최대 28
  makeup: { perEntry: SULK_MAX * MAKEUP_PER_LEVEL, perDay: SULK_MAX * MAKEUP_PER_LEVEL },
  // 특별한 편지는 하루 하나, 최대 30
  'note-gift': { perEntry: milestoneCoins(365), perDay: milestoneCoins(365) },
};

/**
 * 쓰는 기록의 까닭마다 서버가 하는 일.
 * - buy: 물건을 산다. 양은 값과 같아야 하고(-price), 이미 가진 물건이면 거절한다. 집은 다음 단계만 산다.
 * - spend: 먹이처럼 물건 기록이 없는 쓰기. price 가 있으면(커스텀 먹이 만들기) 양이 그 값과 같아야 하고,
 *   없으면(먹이, 값은 고른 먹이에 따른다) 음수이기만 하면 된다.
 * - takeBack: 되돌리기(undo)와 초기화(reset). 잔액이 모자라면 잔액까지만 뺀다(앱도 0 에서 멈춘다).
 * 셋 다 잔액이 모자라면(buy, spend) 그 기록만 거절한다.
 */
export type SpendRule =
  | { kind: 'buy'; price: number; item: string; level?: number }
  | { kind: 'spend'; price?: number }
  | { kind: 'takeBack' };

export function spendRule(reason: string): SpendRule | undefined {
  if (reason === 'food') return { kind: 'spend' };
  if (reason === 'custom-food') return { kind: 'spend', price: CUSTOM_FOOD_COST };
  if (reason === 'undo' || reason === 'reset') return { kind: 'takeBack' };
  const [head, tail] = splitOnce(reason);
  if (head === 'toy' && tail !== undefined && Object.hasOwn(TOY_COSTS, tail))
    return { kind: 'buy', price: TOY_COSTS[tail as keyof typeof TOY_COSTS], item: reason };
  if (
    head === 'house-style' &&
    tail !== undefined &&
    tail !== 'wood' &&
    Object.hasOwn(HOUSE_STYLE_COSTS, tail)
  )
    return { kind: 'buy', price: HOUSE_STYLE_COSTS[tail as keyof typeof HOUSE_STYLE_COSTS], item: reason };
  if (head === 'house' && tail !== undefined && /^[1-9]$/.test(tail)) {
    const level = Number(tail);
    const price = HOUSE_COSTS[level - 1];
    if (price !== undefined) return { kind: 'buy', price, item: 'house', level };
  }
  return undefined;
}

function splitOnce(s: string): [string, string | undefined] {
  const i = s.indexOf(':');
  return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

/**
 * 상한 안에서 반영할 양 (0 이상, amount 이하). earnedDay 와 earnedWeek 는 그날, 그 주에 그 까닭으로 이미 반영한 합.
 * 한 기록이 perEntry 를 넘으면 앱 규칙에 없는 값이라 0 (부르는 쪽이 거절한다).
 */
export function earnAllowed(rule: EarnRule, amount: number, earnedDay: number, earnedWeek: number): number {
  if (!Number.isInteger(amount) || amount <= 0 || amount > rule.perEntry) return 0;
  let room = amount;
  if (rule.perDay !== undefined) room = Math.min(room, rule.perDay - earnedDay);
  if (rule.perWeek !== undefined) room = Math.min(room, rule.perWeek - earnedWeek);
  return Math.max(0, room);
}

/** 산 물건으로 인정하는 이름과 개수 (기존 잔액 옮기기, 서버의 owned_item). 집은 단계(1~5), 나머지는 1 */
export function ownedItemOk(item: string, count: number): boolean {
  if (!Number.isInteger(count) || count < 1) return false;
  if (item === 'house') return count <= HOUSE_COSTS.length;
  const rule = spendRule(item);
  return rule?.kind === 'buy' && rule.item === item && count === 1;
}

/** YYYY-MM-DD 인지 (달력에 있는 날만) */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** 그 날이 든 주의 월요일 (YYYY-MM-DD). 매주 선물의 주 */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
