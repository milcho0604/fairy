// 제자리 몸짓(shared/moves.ts)의 시간별 자세. 2D(draw.ts), 사진, 입체(pet3d.ts)가 같은 값을 각자 몸에 옮긴다.
// 그리기 없이 계산만 해서 시험한다 (move-pose.test.ts). 처음(t=0)과 끝(t=1)은 늘 쉬는 자세라 앞뒤가 튀지 않는다.
// 하품과 기지개는 예전부터 draw.ts, pet3d.ts 가 직접 그려서 여기서는 쉬는 자세만 준다.
import type { MoveType } from '../../shared/moves.ts';

export type MoveEyes = 'closed' | 'happy' | 'half' | 'wide';
export type MoveMouth = 'yawn' | 'open' | 'o';
export type MoveMark = '?' | '!' | 'z' | 'sniff' | 'shake' | 'dust' | 'wag';

export interface MovePose {
  /** 몸을 띄우는 높이 (160 캔버스 px) */
  lift: number;
  sx: number;
  sy: number;
  /** 몸 전체를 몸 가운데 둘레로 돌리는 각 (라디안, 화면에서 시계 방향이 +). 뒹굴기 */
  turn: number;
  /** 몸을 좌우로 비트는 각 (라디안). 몸 털기. 입체는 세로축으로, 2D 는 조금 기울인다 */
  twist: number;
  /** 몸을 옆으로 옮기는 거리 (px) */
  dx: number;
  /** 얼굴, 고개 방향 -1(왼쪽) ~ 1(오른쪽) */
  look: number;
  /** 고개 기울기 (라디안, 화면에서 시계 방향이 +). 고개 갸웃 */
  tilt: number;
  /** 고개 숙이기 (라디안, + 가 아래). 킁킁, 꾸벅 */
  pitch: number;
  eyes?: MoveEyes;
  mouth?: MoveMouth;
  /** 꼬리 흔드는 각 (라디안) */
  tail: number;
  /** 2D 꼬리가 몸 뒤에서 나온 정도 0~1 (평소엔 몸 뒤에 숨어 있다) */
  tailOut: number;
  /** 귀 젖히는 각 [왼쪽, 오른쪽] (라디안, 바깥쪽이 +) */
  ears: [number, number];
  /** 발 드는 정도 [왼쪽, 오른쪽] 0~1 */
  legs: [number, number];
  /** 팔, 날개 드는 정도 0~1 */
  arms: number;
  /** 머리 옆에 뜨는 표시와 그 진하기 0~1 */
  mark?: { kind: MoveMark; k: number };
}

export const REST_POSE: MovePose = Object.freeze({
  lift: 0,
  sx: 1,
  sy: 1,
  turn: 0,
  twist: 0,
  dx: 0,
  look: 0,
  tilt: 0,
  pitch: 0,
  tail: 0,
  tailOut: 0,
  ears: [0, 0],
  legs: [0, 0],
  arms: 0,
}) as MovePose;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 부드럽게 0→1 */
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
/** 앞 a 동안 0→1, 뒤 b 동안 1→0 (사이는 1) */
export function envelope(t: number, a: number, b: number): number {
  return Math.min(smooth(t / a), smooth((1 - t) / b));
}
/** t0~t1 에서 0→1→0 종 모양 */
function bump(t: number, t0: number, t1: number): number {
  if (t <= t0 || t >= t1) return 0;
  return Math.sin(((t - t0) / (t1 - t0)) * Math.PI);
}
/** (시각, 값) 점들을 부드럽게 잇는다 */
function keys(t: number, pts: readonly (readonly [number, number])[]): number {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) break;
    if (t <= b[0]) return a[1] + (b[1] - a[1]) * smooth((t - a[0]) / Math.max(1e-6, b[0] - a[0]));
  }
  return pts.at(-1)?.[1] ?? 0;
}

/**
 * 몸짓 type 의 진행 t(0~1) 자세. dir 은 좌우가 있는 몸짓의 방향(-1 왼쪽, 1 오른쪽).
 * calm(움직임 줄이기)이면 뛰는 높이와 흔들기를 줄인다
 */
export function movePose(type: MoveType, t0: number, dir: -1 | 1 = 1, calm = false): MovePose {
  const t = clamp01(t0);
  const p: MovePose = { ...REST_POSE, ears: [0, 0], legs: [0, 0] };
  const big = calm ? 0.3 : 1;
  switch (type) {
    case 'wag': {
      // 꼬리를 꺼내 신나게 흔든다 (초당 2.5번). 엉덩이도 살짝 따라 흔들린다
      const e = envelope(t, 0.12, 0.16);
      const w = Math.sin(t * Math.PI * 2 * 6);
      p.tail = w * 0.65 * e;
      p.tailOut = e;
      p.twist = -w * 0.06 * e * big;
      p.lift = Math.abs(w) * 1.2 * e * big;
      if (e > 0.5) p.eyes = 'happy';
      p.mark = { kind: 'wag', k: e };
      break;
    }
    case 'ears': {
      // 한쪽 귀를 파닥, 그다음 두 귀를 쫑긋 세우고 눈을 동그랗게
      const f1 = bump(t, 0.04, 0.3) * 0.75 + bump(t, 0.22, 0.42) * 0.45;
      const f2 = bump(t, 0.5, 0.96);
      const one = f1 + f2 * -0.18;
      const both = f2 * -0.18;
      p.ears = dir < 0 ? [one, both] : [both, one];
      p.tilt = dir * 0.07 * bump(t, 0.02, 0.45);
      p.lift = f2 * 1.5;
      if (f2 > 0.4) p.eyes = 'wide';
      break;
    }
    case 'scan': {
      // 이쪽을 봤다가 저쪽을 보고 돌아온다
      p.look =
        dir *
        keys(t, [
          [0, 0],
          [0.14, 1],
          [0.38, 1],
          [0.56, -1],
          [0.8, -1],
          [0.96, 0],
          [1, 0],
        ]);
      p.pitch = -0.06 * envelope(t, 0.15, 0.15);
      // 고개를 돌릴 때마다 몸이 살짝 들썩
      p.lift = (bump(t, 0.06, 0.2) + bump(t, 0.46, 0.62)) * 1.5 * big;
      break;
    }
    case 'tilt': {
      // 고개를 갸웃하고 물음표
      const e = envelope(t, 0.18, 0.2);
      p.tilt = dir * 0.34 * e;
      p.look = dir * 0.25 * e;
      p.eyes = e > 0.3 ? 'wide' : undefined;
      p.mouth = e > 0.3 ? 'o' : undefined;
      p.mark = { kind: '?', k: smooth((t - 0.15) / 0.15) * smooth((1 - t) / 0.15) };
      break;
    }
    case 'stomp': {
      // 제자리에서 발을 번갈아 콩콩 (네 번)
      const e = envelope(t, 0.08, 0.1);
      const w = Math.sin(t * Math.PI * 2 * 2);
      p.legs = [Math.max(0, w) * e, Math.max(0, -w) * e];
      p.lift = Math.abs(w) * 2.5 * e * big;
      p.twist = w * 0.04 * e * big;
      p.eyes = e > 0.4 ? 'happy' : undefined;
      // 발이 땅에 닿을 때 먼지
      const land = 1 - Math.abs(w);
      p.mark = { kind: 'dust', k: e * land * land };
      break;
    }
    case 'shake': {
      // 젖은 강아지처럼 몸을 부르르 (점점 잦아든다). 눈은 질끈
      const e = envelope(t, 0.08, 0.4);
      const w = Math.sin(t * Math.PI * 2 * 5);
      p.twist = w * 0.42 * e * big;
      p.ears = [-w * 0.45 * e, w * 0.45 * e];
      p.tail = w * 0.5 * e;
      p.tailOut = e * 0.8;
      p.lift = 2 * e * big;
      p.sx = 1 + 0.03 * e;
      p.sy = 1 - 0.03 * e;
      p.eyes = e > 0.3 ? 'closed' : undefined;
      p.mark = { kind: 'shake', k: e };
      break;
    }
    case 'hop': {
      // 웅크렸다가 폴짝, 착지에서 찌그러졌다 돌아온다
      const crouch = bump(t, 0, 0.3);
      const air = bump(t, 0.24, 0.76);
      const land = bump(t, 0.72, 0.95);
      p.lift = air * (calm ? 5 : 24);
      const squash = (crouch * 0.12 + land * 0.1) * big;
      p.sx = 1 + squash - air * 0.04 * big;
      p.sy = 1 - squash + air * 0.06 * big;
      p.legs = [air * 0.6, air * 0.6];
      p.arms = air * 0.5;
      p.ears = [air * -0.3, air * -0.3];
      p.eyes = air > 0.3 ? 'happy' : undefined;
      p.mouth = air > 0.3 ? 'open' : undefined;
      p.mark = { kind: 'dust', k: land };
      break;
    }
    case 'sniff': {
      // 고개를 숙여 바닥을 킁킁 (좌우로 조금씩)
      const e = envelope(t, 0.16, 0.16);
      p.pitch = (0.32 + Math.sin(t * Math.PI * 2 * 7) * 0.05) * e;
      p.look = Math.sin(t * Math.PI * 2 * 1.2) * 0.45 * e;
      p.sy = 1 - 0.04 * e;
      p.sx = 1 + 0.02 * e;
      p.eyes = e > 0.4 ? 'half' : undefined;
      p.mark = { kind: 'sniff', k: e * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 7)) };
      break;
    }
    case 'roll': {
      // 옆으로 벌러덩 누워 발을 버둥거리다 일어난다
      const lie = keys(t, [
        [0, 0],
        [0.22, 1],
        [0.72, 1],
        [0.92, -0.06],
        [1, 0],
      ]);
      const on = envelope(t, 0.22, 0.28);
      const rock = Math.sin((t - 0.22) * Math.PI * 2 * 3) * 0.12 * on;
      p.turn = dir * (1.45 * lie + rock);
      // 누우면 바닥에 닿게 띄우는 것은 그리는 쪽이 몸 모양에 맞춰 한다 (2D draw.ts, 입체 groundRoot)
      // 누운 쪽 반대로 조금 옮겨 머리와 귀가 캔버스 밖으로 나가지 않게
      p.dx = -dir * 8 * Math.max(0, lie);
      const kick = Math.sin(t * Math.PI * 2 * 9);
      p.legs = [Math.max(0, kick) * on, Math.max(0, -kick) * on];
      p.arms = 0.5 * on;
      p.tail = Math.sin(t * Math.PI * 2 * 6) * 0.5 * on;
      if (on > 0.3) p.eyes = 'happy';
      break;
    }
    case 'nod': {
      // 꾸벅꾸벅 졸다가 화들짝 깬다
      const droop = keys(t, [
        [0, 0],
        [0.25, 0.18],
        [0.32, 0.1],
        [0.58, 0.42],
        [0.64, -0.1],
        [0.8, 0],
        [1, 0],
      ]);
      p.pitch = droop;
      p.sy = 1 - Math.max(0, droop) * 0.06;
      p.sx = 1 + Math.max(0, droop) * 0.03;
      const wake = bump(t, 0.6, 0.72);
      p.lift = wake * (calm ? 1.5 : 5);
      p.ears = [wake * -0.25, wake * -0.25];
      if (t < 0.6) p.eyes = t > 0.36 ? 'closed' : t > 0.08 ? 'half' : undefined;
      else if (t < 0.9) p.eyes = 'wide';
      p.mark =
        t < 0.6
          ? { kind: 'z', k: smooth((t - 0.3) / 0.15) * smooth((0.6 - t) / 0.04) }
          : { kind: '!', k: smooth((t - 0.6) / 0.04) * smooth((0.92 - t) / 0.1) };
      break;
    }
    default:
      break;
  }
  return p;
}

/** 그리는 빠르기: 빠른 몸짓(털기, 점프)은 30fps, 나머지는 20fps (움직이는 동안만) */
export function moveFps(type: MoveType): number {
  return type === 'shake' || type === 'hop' ? 30 : 20;
}

/** 앉는 정도: 처음 SIT_MS 동안 앉고, 끝나기 SIT_MS 전부터 일어난다 (0 서 있음 ~ 1 앉음) */
export const SIT_MS = 450;
export function sitDown(elapsed: number, ms: number): number {
  return smooth(Math.min(elapsed, ms - elapsed) / SIT_MS);
}

/** 몸짓 하나에서 가장 높이 뜬 순간 (t, 높이, 그때 세로 늘임). 뛰는 높이를 줄여야 할 때 곡선 모양째 줄이려고 쓴다 */
const peaks = new Map<string, { t: number; lift: number; sy: number }>();
export function movePeak(type: MoveType, calm = false): { t: number; lift: number; sy: number } {
  const key = `${type}:${calm}`;
  const got = peaks.get(key);
  if (got) return got;
  let best = { t: 0, lift: 0, sy: 1 };
  for (let i = 0; i <= 64; i++) {
    const p = movePose(type, i / 64, 1, calm);
    if (p.lift > best.lift) best = { t: i / 64, lift: p.lift, sy: p.sy };
  }
  peaks.set(key, best);
  return best;
}

/**
 * 뛰는 높이를 room 안에 넣는 배율 0~1. 꼭대기를 잘라 평평하게 만들지 않고 뛰는 곡선 전체를 같은 배율로 낮춘다
 * (예전엔 토순이 2D 가 24px 대신 6px 에서 잘려 판판하게 떠 있다 떨어졌다)
 */
export function hopScale(peak: number, room: number): number {
  if (!(peak > 0)) return 1;
  return Math.max(0, Math.min(1, room / peak));
}

/** 들렸다가 놓여 내려앉는 시간 */
export const LAND_MS = 380;
/** 들린 자세가 몸을 띄운 높이 (draw.ts 의 grabbed lift 와 같다) */
export const HELD_LIFT = 6;
/** 들린 자세의 가로 줄임과 세로 늘임 (draw.ts 의 grabbed sx 0.94, sy 1.08) */
export const HELD_SQUEEZE = { x: 0.06, y: 0.08 } as const;

/**
 * 놓인 뒤 ms 가 지난 몸: 들린 높이에서 툭 떨어지고(처음 22%) 닿을 때 납작했다가 살짝 튀어 돌아온다.
 * 움직임 줄이기면 찌그러짐 없이 내려오기만
 */
export function landPose(ms: number, calm = false): { lift: number; sx: number; sy: number } {
  const t = clamp01(ms / LAND_MS);
  const fall = 0.22;
  if (t < fall) {
    const k = t / fall;
    // 들린 모습(가늘고 길게 늘어남)에서 이어진다
    return {
      lift: HELD_LIFT * (1 - k * k),
      sx: 1 - HELD_SQUEEZE.x * (1 - k),
      sy: 1 + HELD_SQUEEZE.y * (1 - k),
    };
  }
  if (calm) return { lift: 0, sx: 1, sy: 1 };
  const u = (t - fall) / (1 - fall);
  // 닿자마자 빠르게 눌렸다가 조금 늘어났다 쉬는 몸으로
  const squash = Math.min(1, u / 0.12) * Math.exp(-u * 4) * Math.cos(u * Math.PI * 1.6) * (1 - u);
  return { lift: 0, sx: 1 + 0.13 * squash, sy: 1 - 0.17 * squash };
}
