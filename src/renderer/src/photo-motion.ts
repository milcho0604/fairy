// 한 장 그림 펫(사진 모습, 2.5D 판)의 걸음 몸짓 (draw.ts drawPhoto, pet3d.ts poseRelief).
// 그림 한 장은 다리를 굽힐 수 없어 몸 전체로 걷는다: 발을 디딜 때마다 살짝 눌렸다 늘어나고(찌그러짐), 한 걸음마다
// 좌우로 까딱(흔들기), 가는 쪽으로 조금 기울고(숙이기), 거꾸로 돌아설 때는 홱 뒤집지 않고 잠깐 좁아졌다 돌아온다.
// 모두 걷기 세기(walkEnvelope)를 따라 출발과 멈춤에서 0 이라 멈추는 틀에 툭 바뀌지 않는다. 그리기 없이 시험한다 (photo-motion.test.ts)
import { walkEnvelopeOf } from './pet3d-gait.ts';

/** 걸음마다 몸이 뜨는 높이 (160 캔버스 px). 예전 사진 걷기와 같다 */
export const STEP_LIFT = 3;
/** 디딜 때 눌리는 정도 (세로), 그만큼 가로로 조금 퍼진다 */
const STEP_SQUASH = 0.035;
/** 걸음 사이 가장 높이 떴을 때 늘어나는 정도 */
const STEP_STRETCH = 0.014;
/** 한 걸음마다 좌우로 까딱이는 각 (라디안). 예전엔 0.06 을 걷기 세기 없이 줘서 멈추는 틀에 툭 섰다 */
const STEP_ROCK = 0.045;
/** 가는 쪽으로 기우는 각 (라디안) */
export const WALK_LEAN = 0.05;

export interface PhotoStep {
  /** 몸을 띄우는 높이 (px) */
  lift: number;
  sx: number;
  sy: number;
  /** 걸음마다 까딱 (라디안, 화면에서 시계 방향 +) */
  rock: number;
  /** 가는 쪽으로 기울기 (라디안, 화면에서 시계 방향 +. 오른쪽으로 가면 +) */
  lean: number;
}

const REST: PhotoStep = Object.freeze({ lift: 0, sx: 1, sy: 1, rock: 0, lean: 0 });

/**
 * 걷는 동안 한 장 그림의 몸. phase 는 걸음 진행 (한 걸음에 발 둘이 한 번씩, 0.5 마다 한 발이 닿는다).
 * calm(움직임 줄이기)이면 찌그러짐과 까딱 없이 아주 작게 들썩이기만
 */
export function photoStep(
  act: { phase: number; dir: -1 | 1; since?: number; left?: number; segMs?: number },
  calm = false,
): PhotoStep {
  const env = walkEnvelopeOf(act);
  const go = env.stride;
  if (!(go > 0) && !(env.turn > 0)) return REST;
  // 발이 닿는 순간(b=0)에 가장 낮고 걸음 사이(b=1)에 가장 높다
  const b = Math.abs(Math.sin(act.phase * Math.PI * 2));
  const lean = act.dir * WALK_LEAN * env.turn;
  if (calm) return { lift: b * 1 * go, sx: 1, sy: 1, rock: 0, lean: lean * 0.5 };
  // 닿는 순간에 짧게 눌린다 (사인 곡선 그대로면 늘 반쯤 눌린 고무처럼 보였다)
  const impact = (1 - b) ** 3;
  const stretch = b * b;
  return {
    lift: b * STEP_LIFT * go,
    sx: 1 + (STEP_SQUASH * 0.7 * impact - STEP_STRETCH * 0.5 * stretch) * go,
    sy: 1 - (STEP_SQUASH * impact - STEP_STRETCH * stretch) * go,
    rock: Math.sin(act.phase * Math.PI * 2) * STEP_ROCK * go,
    lean,
  };
}

/** 거꾸로 돌아서는 시간 */
export const TURN_SQUASH_MS = 260;
/** 돌아서는 동안 가장 좁아지는 정도 */
const TURN_NARROW = 0.12;

/** 돌아서기 진행 t(0~1)의 가로 배율과 세로 배율, 살짝 뜨는 높이. 처음과 끝은 1 (쉬는 몸) */
export function turnSquash(t: number, calm = false): { sx: number; sy: number; lift: number } {
  if (!(t > 0 && t < 1)) return { sx: 1, sy: 1, lift: 0 };
  const k = Math.sin(t * Math.PI);
  if (calm) return { sx: 1 - TURN_NARROW * 0.4 * k, sy: 1, lift: 0 };
  return { sx: 1 - TURN_NARROW * k, sy: 1 + 0.025 * k, lift: 1.5 * k };
}

/** 이만큼 안에 다시 반대로 걸으면 돌아선 것으로 본다 (그보다 오래 쉬었다 걸으면 그냥 출발) */
const TURN_GAP_MS = 700;

/**
 * 한 장 그림이 걷다가 거꾸로 돌아서는 때를 기억한다 (사진, 2.5D 판 각자 하나). 그림은 어느 쪽을 보는지 몰라 뒤집지 않고,
 * 걷는 쪽이 바뀐 순간부터 잠깐 좁아졌다 돌아온다. now 가 없으면(한 장만 그릴 때) 늘 쉬는 몸
 */
export class TurnWatch {
  private dir: -1 | 1 | 0 = 0;
  private seen = Number.NEGATIVE_INFINITY;
  private at = Number.NEGATIVE_INFINITY;

  /** 지금 틀의 걷는 쪽 (안 걸으면 undefined). 돌아서는 중이면 진행 0~1, 아니면 -1 */
  update(now: number | undefined, dir: -1 | 1 | undefined): number {
    if (now === undefined) return -1;
    if (dir !== undefined) {
      if (this.dir !== 0 && dir !== this.dir && now - this.seen <= TURN_GAP_MS) this.at = now;
      this.dir = dir;
      this.seen = now;
    }
    const t = (now - this.at) / TURN_SQUASH_MS;
    return t >= 0 && t < 1 ? t : -1;
  }
}

/** 던져서 날아가다 바닥이나 벽에 부딪혀 찌그러졌다 돌아오는 시간 */
export const IMPACT_MS = 240;

/**
 * 날아가다 부딪힌 뒤 ms 가 지난 몸의 가로, 세로 배율. axis 'y' 는 바닥(세로로 눌린다), 'x' 는 벽(가로로 눌린다).
 * k 는 부딪힌 세기 0~1. 닿자마자 눌렸다가 살짝 되튀며 쉬는 몸으로 (예전엔 튀는 동안 들린 모습 그대로 미끄러지듯 튕겼다)
 */
export function impactSquash(
  ms: number,
  axis: 'x' | 'y',
  k: number,
  calm = false,
): { sx: number; sy: number } {
  const t = ms / IMPACT_MS;
  if (calm || !(t >= 0 && t < 1) || !(k > 0)) return { sx: 1, sy: 1 };
  const s = Math.min(1, t / 0.15) * Math.cos(t * Math.PI * 1.5) * (1 - t) * Math.min(1, k);
  return axis === 'y' ? { sx: 1 + 0.12 * s, sy: 1 - 0.16 * s } : { sx: 1 - 0.14 * s, sy: 1 + 0.08 * s };
}

/**
 * 바닥 가운데를 축으로 기울인 한 장 그림이 캔버스 가로(가운데에서 좌우 room)를 넘지 않게 기울기를 줄인다.
 * halfW 는 그림 반폭, h 는 높이. 기울이면 위 모서리가 h·sin 만큼 옆으로 나가서 넓은 사진(140px)은 걸음 까딱과
 * 숙이기를 더한 0.095 라디안에 캔버스 밖으로 2~3px 잘렸다 (이슈 #65 "걷는 중 창 왼쪽에 잘려 보임")
 */
export function fitTilt(tilt: number, halfW: number, h: number, room: number): number {
  const a = Math.abs(tilt);
  if (halfW * Math.cos(a) + h * Math.sin(a) <= room) return tilt;
  if (halfW >= room) return 0;
  // halfW·cos t + h·sin t = R·cos(t - φ) = room 의 작은 근
  const r = Math.hypot(halfW, h);
  const t = Math.atan2(h, halfW) - Math.acos(Math.min(1, room / r));
  return Math.sign(tilt) * Math.max(0, Math.min(a, t));
}
