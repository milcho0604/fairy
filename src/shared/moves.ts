// 펫이 제자리에서 하는 몸짓 (꼬리 흔들기, 귀 쫑긋, 몸 털기, 점프, 뒹굴기 등). 무엇을 고를지는 여기서 정하고
// 그리기는 renderer 의 move-pose.ts(시간에 따른 자세)를 2D(draw.ts), 사진, 입체(pet3d.ts)가 각자 몸에 옮긴다.
// 한 번에 몇 초만 움직이고 끝나면 다시 멈춘다 (L10: 계속 그리면 CPU 를 먹는다).
import { ENERGY_MOVE, type EnergyStage, energyLookOf } from './energy.ts';

export const MOVES = [
  'yawn',
  'stretch',
  'wag',
  'ears',
  'scan',
  'tilt',
  'stomp',
  'shake',
  'hop',
  'sniff',
  'roll',
  'nod',
] as const;
export type MoveType = (typeof MOVES)[number];

export interface MoveSpec {
  /** 몸짓 길이 (ms) */
  ms: number;
  /** 고를 때 무게 (클수록 자주) */
  weight: number;
  /** 한 번 하면 이만큼은 다시 안 한다 (ms) */
  cooldownMs: number;
  /** 몸에 이 부위가 있어야 한다 */
  needs?: 'tail' | 'ears';
  /** 몸 전체를 크게 흔든다. 움직임 줄이기(운영체제 설정)면 안 한다 */
  big?: boolean;
  /** 기운을 쓴다. 배고프면 안 하고 밤에는 덜 한다 */
  energetic?: boolean;
  /** 졸린 몸짓. 밤에는 더 자주 */
  sleepy?: boolean;
  /** 사진 펫은 안 한다 (사진이 옆으로 눕는 건 그림이 깨진 것처럼 보인다) */
  noPhoto?: boolean;
  /** 다른 창 위에 올라앉아 있으면 안 한다 (떨어질 것처럼 보인다) */
  noPerch?: boolean;
  /** 좌우가 있는 몸짓 (어느 쪽으로 갸웃, 어느 쪽부터 두리번) */
  sided?: boolean;
}

export const MOVE_SPECS: Record<MoveType, MoveSpec> = {
  yawn: { ms: 2200, weight: 8, cooldownMs: 60_000, sleepy: true },
  stretch: { ms: 2600, weight: 7, cooldownMs: 60_000 },
  wag: { ms: 2400, weight: 12, cooldownMs: 20_000, needs: 'tail' },
  ears: { ms: 1400, weight: 10, cooldownMs: 20_000, needs: 'ears', sided: true },
  scan: { ms: 2800, weight: 10, cooldownMs: 30_000, sided: true },
  tilt: { ms: 1900, weight: 9, cooldownMs: 30_000, sided: true },
  stomp: { ms: 1600, weight: 7, cooldownMs: 40_000 },
  shake: { ms: 1400, weight: 6, cooldownMs: 90_000, big: true },
  hop: { ms: 1100, weight: 6, cooldownMs: 60_000, big: true, energetic: true },
  sniff: { ms: 2400, weight: 7, cooldownMs: 45_000 },
  roll: {
    ms: 3200,
    weight: 3,
    cooldownMs: 5 * 60_000,
    big: true,
    energetic: true,
    noPhoto: true,
    noPerch: true,
    sided: true,
  },
  nod: { ms: 3200, weight: 5, cooldownMs: 2 * 60_000, sleepy: true },
};

/** 화면이 알려 주는 펫 몸과 상태 (renderer pet.ts). 메인이 고를 때 쓴다 */
export interface MoveAsk {
  /** 꼬리가 있다 (입체 설계도 tail 부위, 2D 냥이와 멍멍이) */
  tail: boolean;
  /** 귀가 있다 (입체 설계도 귀 부위, 2D 냥이, 토순이, 멍멍이) */
  ears: boolean;
  /** 사진 펫 (사진 그대로, 또는 2.5D 입체 판). 관절이 없어 몸 전체만 움직인다 */
  photo: boolean;
  /** 움직임 줄이기 (운영체제 설정) */
  calm: boolean;
  /** 배고프다 */
  hungry: boolean;
  /**
   * 기운 단계 (shared/energy.ts, 설정 "하루 리듬"). 있으면 밤 규칙 대신 이것으로 졸린 몸짓과 기운 쓰는 몸짓 무게를,
   * 걷기와 앉기 확률, 걷는 빠르기를 정한다. 없으면(꺼짐, 친구 펫, 옛 화면) 예전처럼 시각으로
   */
  energy?: EnergyStage;
}

/**
 * 입체 설계도 부품으로 꼬리와 귀가 있는지 본다. 꼬리는 공 모양(토순이 솜꼬리)뿐이면 없는 셈이다:
 * 몸 뒤에 붙은 작은 공은 흔들어도 앞에서 보이지 않는다
 */
export function bodyOfParts(parts: readonly { slot: string; shape: string }[]): {
  tail: boolean;
  ears: boolean;
} {
  return {
    tail: parts.some((p) => p.slot === 'tail' && p.shape !== 'sphere'),
    ears: parts.some((p) => p.slot === 'earL' || p.slot === 'earR'),
  };
}

/** 아무것도 모를 때 (옛 화면이 빈 요청을 보냈을 때). 부위가 필요 없는 몸짓만 */
export const PLAIN_ASK: MoveAsk = { tail: false, ears: false, photo: false, calm: false, hungry: false };

/** 화면이 보낸 값을 고른다. 모르는 칸은 버리고 참거짓만 받는다 */
export function moveAskOf(raw: unknown): MoveAsk {
  if (typeof raw !== 'object' || raw === null) return { ...PLAIN_ASK };
  const r = raw as Record<string, unknown>;
  const energy = energyLookOf({ stage: r.energy })?.stage;
  return {
    tail: r.tail === true,
    ears: r.ears === true,
    photo: r.photo === true,
    calm: r.calm === true,
    hungry: r.hungry === true,
    ...(energy ? { energy } : {}),
  };
}

/** 최근에 한 몸짓 (같은 몸짓이 연달아 나오지 않게) */
export interface MoveHistory {
  last?: MoveType;
  /** 몸짓마다 마지막으로 한 시각 (ms) */
  at: Partial<Record<MoveType, number>>;
}

export interface MoveContext {
  ask: MoveAsk;
  recent: MoveHistory;
  now: number;
  /** 지금 시 (0~23). 밤(22시~6시)에는 졸린 몸짓이 잦고 기운 쓰는 몸짓은 드물다 */
  hour?: number;
  /** 다른 창 위에 올라앉아 있다 */
  perched?: boolean;
}

export const isNight = (hour: number | undefined) => hour !== undefined && (hour >= 22 || hour < 6);

/**
 * 지금 할 수 있는 몸짓과 무게. 바로 전 몸짓과 쉬는 중(쿨다운)인 몸짓은 뺀다.
 * 기운을 알면 그 단계대로 (활발하면 폴짝, 뒹굴기가 잦고 하품은 드물다. 졸리면 하품, 꾸벅이 잦다), 모르면 밤 규칙
 */
export function moveWeights(c: MoveContext): [MoveType, number][] {
  const night = isNight(c.hour);
  const energy = c.ask.energy ? ENERGY_MOVE[c.ask.energy] : undefined;
  const out: [MoveType, number][] = [];
  for (const type of MOVES) {
    const s = MOVE_SPECS[type];
    if (s.needs && !c.ask[s.needs]) continue;
    if (s.big && c.ask.calm) continue;
    if (s.noPhoto && c.ask.photo) continue;
    if (s.noPerch && c.perched) continue;
    if (s.energetic && c.ask.hungry) continue;
    if (type === c.recent.last) continue;
    const at = c.recent.at[type];
    if (at !== undefined && c.now - at < s.cooldownMs) continue;
    let w = s.weight;
    if (energy) {
      if (s.sleepy) w *= energy.sleepy;
      if (s.energetic) w *= energy.energetic;
    } else {
      if (night && s.sleepy) w *= 2;
      if (night && s.energetic) w *= 0.5;
    }
    // 배고프면 먹을 것을 찾는 듯 킁킁
    if (c.ask.hungry && type === 'sniff') w *= 2;
    out.push([type, w]);
  }
  return out;
}

/** 몸짓 하나를 무게대로 고른다. 할 수 있는 것이 없으면 undefined */
export function pickMove(c: MoveContext, rand: () => number): MoveType | undefined {
  const list = moveWeights(c);
  const total = list.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return undefined;
  let r = rand() * total;
  for (const [type, w] of list) {
    r -= w;
    if (r < 0) return type;
  }
  return list.at(-1)?.[0];
}

/** 몸짓을 했다고 적는다 (새 기록을 돌려준다) */
export function rememberMove(h: MoveHistory, type: MoveType, now: number): MoveHistory {
  return { last: type, at: { ...h.at, [type]: now } };
}

export function isMove(type: string): type is MoveType {
  return (MOVES as readonly string[]).includes(type);
}
