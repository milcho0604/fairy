// 메뉴 막대에서 달리는 작은 펫 (사용자 요청 2026-10-09: "RunCat 처럼 바쁘면 움직이고, 귀엽게").
// 지금 고른 펫 종류(콩이, 냥이, 멍멍이, 토순이, 삐약이)의 옆모습이 CPU 에 따라 앉아 졸고, 걷고, 달리고, 땀 흘리며 질주한다.
// 그림 파일 없이 거리장(SDF: 점에서 모양 가장자리까지 거리)으로 그린다. 둥근 도형을 부드럽게 이어 붙여(smooth union)
// 통통한 몸이 되고, 가장자리는 거리로 바로 불투명도를 내 16px 에서도 매끄럽다. 화면 없는 계산만 둔다
// (main/system-monitor.ts 가 그림으로, main/monitor-core.ts 가 장 넘기기에 쓴다).
import { type Blueprint, expandMirrors } from './pet3d/blueprint.ts';
import { type PetKind, pickedGait, type Settings } from './settings.ts';

// ---- 상태와 시간 ----

/** rest 앉아서 꼬리 살랑과 졸기, walk 종종걸음, run 달리기, sprint 땀 흘리며 전력 질주 */
export const RUNNER_STATES = ['rest', 'walk', 'run', 'sprint'] as const;
export type RunnerState = (typeof RUNNER_STATES)[number];

/**
 * 상태마다 한 바퀴 장 수. 걷기는 8장으로 매끄럽게. 달리기는 장 바꾸기 상한(초당 5장) 아래에서 한 바퀴가
 * 1.2초로 빠르게 보이게 6장 (8장이면 꽉 차도 한 바퀴 1.6초라 느긋하게 걷는 것처럼 보인다)
 */
export const RUNNER_COUNTS: Record<RunnerState, number> = { rest: 4, walk: 8, run: 6, sprint: 6 };

/** 모든 상태의 장을 한 줄로 놓은 수 (그림은 이 순서로 한 번에 만든다) */
export const RUNNER_TOTAL = RUNNER_STATES.reduce((n, s) => n + RUNNER_COUNTS[s], 0);

/** 상태의 i 번째 장이 한 줄에서 몇 번째인지 */
export function runnerIndex(state: RunnerState, frame: number): number {
  let at = 0;
  for (const s of RUNNER_STATES) {
    if (s === state) {
      const n = RUNNER_COUNTS[s];
      return at + (((Math.floor(frame) % n) + n) % n);
    }
    at += RUNNER_COUNTS[s];
  }
  return 0;
}

/**
 * 상태가 바뀌는 CPU(%). 올라갈 때는 up 에서, 내려올 때는 down 아래에서 바뀐다 (경계에서 2초마다 오락가락하지 않게).
 * 5% 아래는 앉아서 쉬고, 35% 부터 달리고, 75% 부터 땀을 흘린다
 */
export const RUNNER_BANDS: Record<Exclude<RunnerState, 'rest'>, { up: number; down: number }> = {
  walk: { up: 5, down: 3 },
  run: { up: 35, down: 30 },
  sprint: { up: 75, down: 70 },
};

/** CPU 와 지금 상태로 다음 상태를 고른다. 이상한 값은 0 으로 */
export function runnerState(cpu: number, prev: RunnerState = 'rest'): RunnerState {
  const c = Number.isFinite(cpu) ? cpu : 0;
  const rank = RUNNER_STATES.indexOf(prev);
  let out: RunnerState = 'rest';
  for (const s of ['walk', 'run', 'sprint'] as const) {
    const band = RUNNER_BANDS[s];
    // 지금 상태 이상이면 내려가는 문턱, 아래면 올라가는 문턱
    const gate = RUNNER_STATES.indexOf(s) <= rank ? band.down : band.up;
    if (c >= gate) out = s;
  }
  return out;
}

/** 쉴 때 한 장 시간. 꼬리를 1.5초마다 한 번 살랑인다 (장 바꾸기가 아주 드물다) */
export const RUNNER_REST_MS = 1500;
/** 걷기와 달리기가 가장 느릴 때(걷기 시작)와 가장 빠를 때(100%). 메뉴 막대 그림 바꾸기는 창 서버 일이라 초당 5장이 끝 */
export const RUNNER_SLOW_MS = 420;
export const RUNNER_FAST_MS = 200;

/** 상태마다 CPU 구간과 그 양 끝의 한 장 시간 (구간 안에서는 곧게 이어진다) */
const MS_RANGE: Record<
  Exclude<RunnerState, 'rest'>,
  { lo: number; hi: number; slow: number; fast: number }
> = {
  walk: { lo: 3, hi: 35, slow: RUNNER_SLOW_MS, fast: 300 },
  run: { lo: 30, hi: 75, slow: 300, fast: 220 },
  sprint: { lo: 70, hi: 100, slow: 220, fast: RUNNER_FAST_MS },
};

/** 상태와 CPU(0~100)에 맞는 한 장 시간. 바쁠수록 짧고 RUNNER_FAST_MS 보다 짧지 않다 */
export function runnerFrameMs(cpu: number, state: RunnerState = runnerState(cpu)): number {
  if (state === 'rest') return RUNNER_REST_MS;
  const r = MS_RANGE[state];
  const c = Math.min(100, Math.max(0, Number.isFinite(cpu) ? cpu : 0));
  const k = Math.min(1, Math.max(0, (c - r.lo) / (r.hi - r.lo)));
  return Math.max(RUNNER_FAST_MS, Math.round(r.slow + (r.fast - r.slow) * k));
}

// ---- 종류 고르기 ----

/**
 * 메뉴 막대에서 달릴 모습. 기본 펫은 그 종류 그대로. 사진 펫은 설계도 특징으로 가장 가까운 기본 종류를 고른다:
 * 부리나 날개가 있으면 삐약이, 위로 선 긴 귀는 토순이, 고양이 입이나 수염, 뾰족 귀(원뿔)는 냥이, 그 밖에 귀가 있으면 멍멍이.
 * 귀 없는 몸은 걸음새(고른 값, 설계도 gait, 다리 수 짐작)로: 네 발이면 멍멍이, 두 발이면 콩이. 종류 특징이 걸음새보다 먼저다
 * (냥이, 멍멍이도 팔이 있어 두 발로 서지만 메뉴 막대에서는 네 발로 달린다, 2026-10-11).
 * 설계도가 없는 사진(평면, 2.5D)은 다리를 몰라 콩이
 */
export function runnerKindOf(
  s: Pick<Settings, 'petImage' | 'petModel' | 'petKind' | 'petGaits'>,
  model?: Pick<Blueprint, 'parts' | 'face' | 'gait'> | null,
): PetKind {
  if (!s.petImage) return s.petKind;
  if (!model) return 'kong';
  const parts = expandMirrors(model.parts);
  const legs = (slot: 'legL' | 'legR') => parts.filter((p) => p.slot === slot).length;
  const gait =
    pickedGait(s) ?? model.gait ?? (legs('legL') >= 2 && legs('legR') >= 2 ? 'quadruped' : 'biped');
  const ears = parts.filter((p) => p.slot === 'earL' || p.slot === 'earR');
  const bird = model.face.mouth === 'beak' || parts.some((p) => p.slot === 'wingL' || p.slot === 'wingR');
  if (bird) return 'chick';
  const head = parts.find((p) => p.slot === 'head') ?? parts.find((p) => p.slot === 'body');
  const headTop = head ? head.at[1] + head.size[1] * 0.5 : 0;
  // 토순이 귀는 반높이 0.24 로 머리 위에 서 있다. 멍멍이 귀(0.17)는 머리 옆에 늘어져 있다
  if (ears.some((e) => e.size[1] >= 0.2 && e.at[1] >= headTop)) return 'bunny';
  if (model.face.mouth === 'cat' || model.face.whiskers || ears.some((e) => e.shape === 'cone')) return 'cat';
  // 귀가 있으면 멍멍이 (멍멍이도 두 발로 선다). 귀 없는 몸은 걸음새로
  return ears.length || gait === 'quadruped' ? 'dog' : 'kong';
}

// ---- 그리기 ----

/**
 * 맥 메뉴 막대 그림 크기 (점). 동물이 옆으로 길어 정사각형보다 조금 넓게 쓴다. 레티나는 두 배 (44x36px).
 * 윈도우 알림 영역은 16x16 칸이 정해져 있어 정사각형에 맞춰 줄인다
 */
export const RUNNER_MAC_PT = { w: 22, h: 18 } as const;

/** 장면 크기: 높이 1, 너비 SCENE_W. 바닥은 GROUND. 오른쪽을 보고 달린다 */
const SCENE_W = 1.25;
const GROUND = 0.97;

type F = (x: number, y: number) => number;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const circle =
  (cx: number, cy: number, r: number): F =>
  (x, y) =>
    Math.hypot(x - cx, y - cy) - r;

/** 돌린 타원. 거리는 1차 근사(값/기울기)라 가장자리 근처에서 정확하다 */
function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): F {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * c + dy * s) / rx;
    const v = (-dx * s + dy * c) / ry;
    const k = Math.hypot(u, v);
    if (k < 1e-6) return -Math.min(rx, ry);
    const gx = (u * (c / rx) - v * (s / ry)) / k;
    const gy = (u * (s / rx) + v * (c / ry)) / k;
    return (k - 1) / Math.max(1e-6, Math.hypot(gx, gy));
  };
}

/** 두 끝 굵기가 다른 둥근 막대 (a 쪽 ra, b 쪽 rb). 귀, 다리, 꼬리, 부리 */
function cone(ax: number, ay: number, bx: number, by: number, ra: number, rb: number): F {
  const h = Math.hypot(bx - ax, by - ay);
  if (h < 1e-6) return circle(ax, ay, Math.max(ra, rb));
  // a 를 원점, b 를 +y 축 위로 옮겨 잰다
  const ux = (bx - ax) / h;
  const uy = (by - ay) / h;
  const b = clamp((ra - rb) / h, -0.999, 0.999);
  const a = Math.sqrt(1 - b * b);
  return (x, y) => {
    const dx = x - ax;
    const dy = y - ay;
    const py = dx * ux + dy * uy;
    const px = Math.abs(dx * uy - dy * ux);
    const k = -b * px + a * py;
    if (k < 0) return Math.hypot(px, py) - ra;
    if (k > a * h) return Math.hypot(px, py - h) - rb;
    return px * a + py * b - ra;
  };
}

const bar = (ax: number, ay: number, bx: number, by: number, r: number): F => cone(ax, ay, bx, by, r, r);

/** 부드러운 합치기: k 만큼 이음매가 살로 메워진다 (통통해 보이는 까닭) */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** 모양 하나를 그릴 조각. join 은 앞 모양과 이어 붙이는 살 두께, gap 은 둘레를 파내는 틈(몸 위에 겹친 귀, 날개 테두리) */
interface Piece {
  f: F;
  join?: number;
  gap?: number;
}

/** 그림 한 장: 이어 붙일 조각들과 파낼 구멍(눈) */
interface Scene {
  pieces: Piece[];
  holes: F[];
}

function evalScene(sc: Scene, x: number, y: number): number {
  let d = Number.POSITIVE_INFINITY;
  for (const p of sc.pieces) {
    const v = p.f(x, y);
    if (p.gap) d = Math.max(d, -(v - p.gap));
    d = p.join && Number.isFinite(d) ? smin(d, v, p.join) : Math.min(d, v);
  }
  for (const h of sc.holes) d = Math.max(d, -h(x, y));
  return d;
}

/** 두 마디 다리: 엉덩이와 발끝이 주어지면 무릎 자리. bend 가 +1 이면 무릎이 앞(+x), -1 이면 뒤 */
function knee(hx: number, hy: number, fx: number, fy: number, l1: number, l2: number, bend: number) {
  let dx = fx - hx;
  let dy = fy - hy;
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 1e-4;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-4);
  const a = Math.atan2(dy, dx);
  const off = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const k = a - bend * off;
  return { kx: hx + Math.cos(k) * l1, ky: hy + Math.sin(k) * l1, fx: hx + dx, fy: hy + dy };
}

/** 굽은 다리 하나 (허벅지, 정강이, 둥근 발) */
function legPieces(
  hx: number,
  hy: number,
  fx: number,
  fy: number,
  o: { l1: number; l2: number; r1: number; r2: number; foot: number; bend: number; join?: number },
): Piece[] {
  const k = knee(hx, hy, fx, fy, o.l1, o.l2, o.bend);
  return [
    { f: cone(hx, hy, k.kx, k.ky, o.r1, o.r2), join: o.join ?? 0.03 },
    { f: cone(k.kx, k.ky, k.fx, k.fy, o.r2, o.r2 * 0.95), join: 0.02 },
    { f: circle(k.fx, k.fy - o.foot * 0.2, o.foot), join: 0.015 },
  ];
}

/** 꼬리: base 에서 각도 a0 로 출발해 마디마다 curl 만큼 휜다. 굵기는 r0 에서 r1 로 */
function tailPieces(
  bx: number,
  by: number,
  a0: number,
  curl: number,
  len: number,
  r0: number,
  r1: number,
  segs = 5,
  join = 0.03,
): Piece[] {
  const out: Piece[] = [];
  let x = bx;
  let y = by;
  let a = a0;
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    const nx = x + Math.cos(a) * step;
    const ny = y + Math.sin(a) * step;
    const ra = r0 + ((r1 - r0) * i) / segs;
    const rb = r0 + ((r1 - r0) * (i + 1)) / segs;
    out.push({ f: cone(x, y, nx, ny, ra, rb), join: i === 0 ? join : 0.01 });
    x = nx;
    y = ny;
    a += curl;
  }
  return out;
}

/** 눈: 뜬 눈은 동그란 구멍, 감은 눈은 아래로 휜 가는 틈(졸음) */
function eye(cx: number, cy: number, r: number, closed: boolean): F[] {
  if (!closed) return [circle(cx, cy, r)];
  const w = r * 1.15;
  const t = r * 0.38;
  return [bar(cx - w, cy - t * 0.3, cx, cy + t * 0.9, t), bar(cx, cy + t * 0.9, cx + w, cy - t * 0.3, t)];
}

/** 땀방울 (위가 뾰족한 물방울) */
function drop(cx: number, cy: number, r: number, tilt: number): Piece {
  const tx = cx + Math.sin(tilt) * r * 2.1;
  const ty = cy - Math.cos(tilt) * r * 2.1;
  return { f: cone(cx, cy, tx, ty, r, r * 0.12) };
}

interface Motion {
  /** 한 바퀴 안 자리 0~1 */
  p: number;
  state: RunnerState;
  frame: number;
}

const TAU = Math.PI * 2;

/** 질주 때 땀방울 두 개가 머리 뒤로 날아간다 (장마다 자리를 바꿔 흩날리는 것처럼) */
function sweat(m: Motion, hx: number, hy: number, r: number, front = false): Piece[] {
  if (m.state !== 'sprint') return [];
  const k = m.frame % 2;
  // 토순이는 머리 뒤에 긴 귀가 있어 이마 앞으로 튄다
  const sx = front ? -1 : 1;
  if (front)
    return [
      drop(hx + r * 0.45 + 0.03 * k, hy - r * 1.3 + 0.02 * k, 0.042, 0.6),
      drop(hx + r * 0.95 + 0.02 * (1 - k), hy - r * 0.95 - 0.02 * k, 0.034, 0.9),
    ];
  return [
    drop(hx - sx * (r * 0.75 + 0.05 * k), hy - r * 1.2 + 0.02 * k, 0.045, -0.7 * sx),
    drop(hx - sx * (r * 1.35 + 0.04 * (1 - k)), hy - r * 0.55 - 0.02 * k, 0.038, -1.1 * sx),
  ];
}

/** 네 발 친구(냥이, 멍멍이, 토순이)의 몸 짜임 */
function quadScene(kind: 'cat' | 'dog' | 'bunny', m: Motion): Scene {
  const pieces: Piece[] = [];
  const holes: F[] = [];
  const { p, state } = m;
  const bunny = kind === 'bunny';
  const dog = kind === 'dog';
  const s = Math.sin(p * TAU);
  const c = Math.cos(p * TAU);

  // 몸과 머리 (머리가 큰 두 등신이라 귀엽다)
  let bx = 0.56;
  let by = 0.6;
  let rx = dog ? 0.27 : bunny ? 0.24 : 0.26;
  let ry = bunny ? 0.18 : 0.165;
  let tilt = 0;
  let hr = bunny ? 0.19 : 0.2;
  let hx = 0.88;
  // 토순이는 긴 귀가 그림 위로 잘리지 않게 머리를 조금 낮춘다
  let hy = bunny ? 0.46 : 0.4;
  let closed = false;

  if (state === 'rest') {
    // 앉은 모습: 몸을 세우고 뒷다리를 접어 엉덩이로 앉는다
    bx = 0.6;
    by = 0.66;
    rx = 0.22;
    ry = 0.17;
    tilt = -1.0;
    hx = 0.72;
    hy = bunny ? 0.43 : 0.33;
    hr = bunny ? 0.185 : 0.195;
    // 꼬리 살랑 0, 1, 2, 1 에서 셋째 장은 눈을 감고 꾸벅
    closed = m.frame === 2;
    if (closed) hy += 0.025;
  } else if (state === 'walk') {
    // 종종걸음: 걸음마다 몸이 살짝 들썩인다 (한 바퀴에 두 번)
    by += 0.012 * Math.cos(p * TAU * 2);
    hy += 0.016 * Math.cos(p * TAU * 2 + 0.6);
    if (bunny) {
      // 토순이는 걸어도 깡총: 한 바퀴에 한 번 뛴다
      const hop = Math.max(0, Math.sin(p * TAU));
      by -= 0.05 * hop;
      hy -= 0.05 * hop;
    }
  } else {
    // 달리기: 모을 때 몸이 짧고 통통, 뻗을 때 길고 떠 있다
    const air = Math.max(0, s);
    rx *= 1 + 0.12 * s;
    ry *= 1 - 0.08 * s;
    by -= 0.06 * air - 0.015 * Math.max(0, -s);
    hx += 0.02 * s + 0.02;
    hy += 0.03 - 0.06 * air;
    tilt = 0.08 * c;
  }

  pieces.push({ f: ellipse(bx, by, rx, ry, tilt) });
  // 엉덩이 쪽 살 (앉으면 바닥에 퍼진 엉덩이)
  if (state === 'rest') pieces.push({ f: ellipse(0.47, 0.82, 0.17, 0.14), join: 0.06 });

  // 다리
  const legO = (front: boolean) => ({
    l1: bunny && !front ? 0.15 : 0.13,
    l2: bunny && !front ? 0.15 : 0.13,
    r1: front ? 0.055 : 0.065,
    r2: 0.047,
    foot: bunny && !front ? 0.055 : 0.05,
    bend: front ? -1 : 1,
  });
  const footY = GROUND - 0.05;
  if (state === 'rest') {
    // 앞발은 곧게 짚고, 뒷발은 엉덩이 앞에 내민다
    pieces.push({ f: bar(0.7, 0.68, 0.72, footY, 0.05), join: 0.04 });
    pieces.push({ f: circle(0.73, footY, 0.052), join: 0.02 });
    pieces.push({ f: ellipse(0.58, footY + 0.005, bunny ? 0.1 : 0.075, 0.042), join: 0.05 });
  } else {
    const shoulder = { x: bx + rx * 0.62, y: by + ry * 0.35 };
    const hip = { x: bx - rx * 0.6, y: by + ry * 0.35 };
    // [엉덩이 자리, 앞인지, 위상]. 걷기는 대각선 쌍(앞 가까운 쪽과 뒤 먼 쪽)이 같이 딛는다
    const walkLegs: [typeof hip, boolean, number][] = [
      [hip, false, 0.5],
      [shoulder, true, 0.5],
      [hip, false, 0],
      [shoulder, true, 0],
    ];
    if (state === 'walk' && !bunny) {
      const stride = 0.17;
      for (const [h, front, ph] of walkLegs) {
        const q = (p + ph) % 1;
        // 0~0.6 바닥을 뒤로 밀고, 0.6~1 들어 앞으로
        let off: number;
        let lift = 0;
        if (q < 0.6) off = stride / 2 - (q / 0.6) * stride;
        else {
          const t = (q - 0.6) / 0.4;
          off = -stride / 2 + t * stride;
          lift = Math.sin(t * Math.PI) * 0.06;
        }
        const far = ph === 0 ? 0.02 : 0;
        pieces.push(...legPieces(h.x - far, h.y, h.x - far + off, footY - lift, legO(front)));
      }
    } else {
      // 달리기(토순이는 걷기도): 앞발 둘, 뒷발 둘이 같이 뻗고 모은다. 먼 쪽은 조금 늦게 (질주의 엇박)
      const hopping = bunny || state !== 'walk';
      const amp = state === 'walk' ? 0.55 : bunny ? 0.85 : 0.9;
      for (const [h, front, ph] of walkLegs) {
        const lag = hopping && ph === 0 ? 0.07 : 0;
        const sv = Math.sin((p - lag) * TAU);
        // 모을 때는 반만 접어 앞발과 뒷발이 배 밑에서 한 덩이로 붙지 않게
        const th = (front ? 1 : -1) * amp * (sv < 0 ? 0.45 * sv : sv);
        const reach = 0.27 + (front ? 0.02 : 0.03) * sv;
        let fx = h.x + Math.sin(th) * reach;
        let fy = h.y + Math.cos(th) * reach;
        // 모을 때 발이 배 밑에서 살짝 들린다 (몸 속으로 숨지 않게 조금만)
        fy = Math.min(fy, footY);
        if (sv < 0) fy -= 0.02 * -sv;
        fx -= ph === 0 ? 0.02 : 0;
        pieces.push(...legPieces(h.x, h.y, fx, fy, legO(front)));
      }
    }
  }

  // 머리 (몸과 살로 이어진 목)
  pieces.push({ f: circle(hx, hy, hr), join: 0.07 });
  // 주둥이: 멍멍이는 앞으로 나온 코, 냥이와 토순이는 볼록한 볼
  if (dog) {
    pieces.push({ f: ellipse(hx + hr * 0.82, hy + hr * 0.28, hr * 0.48, hr * 0.36), join: 0.04 });
    pieces.push({ f: circle(hx + hr * 1.22, hy + hr * 0.1, hr * 0.17), join: 0.02 });
  } else {
    pieces.push({ f: ellipse(hx + hr * 0.62, hy + hr * 0.32, hr * 0.42, hr * 0.32), join: 0.04 });
  }

  // 귀
  const running = state === 'run' || state === 'sprint';
  const flap = running ? 0.25 * s : state === 'walk' ? 0.06 * Math.sin(p * TAU * 2) : 0;
  if (kind === 'cat') {
    // 뾰족한 귀 둘 (먼 귀는 조금 뒤). 달리면 살짝 뒤로 젖힌다
    for (const [a, len] of [
      [-1.25, 0.16],
      [-1.95, 0.15],
    ] as const) {
      const aa = a - (running ? 0.18 : 0) + flap * 0.3;
      const ex = hx + Math.cos(aa) * hr * 0.72;
      const ey = hy + Math.sin(aa) * hr * 0.72;
      const ta = aa + (a > -1.6 ? 0.18 : -0.12);
      pieces.push({
        f: cone(ex, ey, ex + Math.cos(ta) * len, ey + Math.sin(ta) * len, 0.075, 0.018),
        join: 0.02,
      });
    }
  } else if (bunny) {
    // 긴 귀 둘. 달리면 뒤로 휘날리고 걸으면 살랑
    for (const [a, len] of [
      [-1.62, 0.26],
      [-2.08, 0.25],
    ] as const) {
      const ex = hx + Math.cos(a) * hr * 0.6;
      const ey = hy + Math.sin(a) * hr * 0.6;
      const lean =
        state === 'rest'
          ? 0.25 + ([0, 0.12, 0.5, 0.12][m.frame % 4] ?? 0) + (a > -1.8 ? 0 : 0.08)
          : running
            ? 0.75 + 0.18 * s
            : 0.45 + flap * 2;
      const ta = a - lean;
      pieces.push({
        f: cone(ex, ey, ex + Math.cos(ta) * len, ey + Math.sin(ta) * len, 0.058, 0.05),
        join: 0.02,
      });
    }
  } else {
    // 멍멍이: 머리 뒤쪽에 늘어진 귀. 둘레를 파서 머리와 떨어져 보이게. 달리면 펄럭
    const lift = running ? 0.35 + 0.35 * s : state === 'walk' ? 0.1 * Math.sin(p * TAU * 2) : 0;
    const ex = hx - hr * 0.25;
    const ey = hy - hr * 0.45;
    const ta = 1.95 + lift;
    const len = hr * 0.95;
    pieces.push({
      f: cone(ex, ey, ex + Math.cos(ta) * len, ey + Math.sin(ta) * len, 0.06, 0.07),
      gap: 0.022,
    });
  }

  // 꼬리
  const back = { x: bx - rx * 0.92, y: by - ry * 0.25 };
  if (kind === 'cat') {
    if (state === 'rest') {
      // 바닥에 둘러 놓고 끝만 살랑
      const sway = [0, 0.5, 1, 0.5][m.frame % 4] ?? 0;
      pieces.push(...tailPieces(0.36, 0.9, Math.PI + 0.1, -0.32 - 0.12 * sway, 0.3, 0.045, 0.04, 6));
    } else if (running) {
      pieces.push(
        ...tailPieces(back.x, back.y, Math.PI + 0.6, 0.12 * Math.sin(p * TAU + 1), 0.26, 0.045, 0.038),
      );
    } else {
      // 걸을 때는 물음표처럼 세운 꼬리가 흔들
      const sway = 0.12 * Math.sin(p * TAU);
      pieces.push(...tailPieces(back.x, back.y, -2.25 + sway, 0.2, 0.3, 0.045, 0.04));
    }
  } else if (dog) {
    // 짧게 선 꼬리가 장마다 반대로 흔들린다 (반가운 강아지)
    const wag = state === 'rest' ? ([-0.3, 0.1, 0, 0.1][m.frame % 4] ?? 0) : m.frame % 2 ? 0.35 : -0.25;
    const base = state === 'rest' ? { x: 0.36, y: 0.74 } : back;
    pieces.push(...tailPieces(base.x, base.y, -2.2 + wag, 0.18, 0.17, 0.045, 0.035, 3));
  } else {
    // 토순이: 동그란 솜꼬리
    // 둘레를 파서 몸에 묻히지 않고 동그랗게 보이게
    const tx = state === 'rest' ? 0.33 : back.x - 0.03;
    const ty = state === 'rest' ? 0.84 : back.y + 0.05;
    pieces.push({ f: circle(tx, ty, 0.075), gap: 0.018 });
  }

  pieces.push(...sweat(m, hx, hy, hr, bunny));
  // 눈 (머리 앞쪽 위)
  holes.push(...eye(hx + hr * 0.42, hy - hr * 0.08, hr * 0.2, closed));
  return { pieces, holes };
}

/** 두 발 친구(콩이, 삐약이). 둥근 몸 하나에 짧은 다리, 콩이는 새싹과 팔, 삐약이는 부리와 날개 */
function bipedScene(kind: 'kong' | 'chick', m: Motion): Scene {
  const pieces: Piece[] = [];
  const holes: F[] = [];
  const { p, state } = m;
  const chick = kind === 'chick';
  const running = state === 'run' || state === 'sprint';
  const rx = chick ? 0.27 : 0.3;
  const ry = chick ? 0.26 : 0.25;
  const cx = 0.6;
  let cy = chick ? 0.54 : 0.47;
  let lean = 0;
  let closed = false;
  if (state === 'rest') {
    // 앉으면 몸이 바닥에 닿는다. 셋째 장은 눈을 감고 꾸벅
    cy = GROUND - ry - (chick ? 0.02 : 0.08);
    closed = m.frame === 2;
    if (closed) cy += 0.012;
  } else {
    // 한 걸음에 한 번 들썩 (한 바퀴에 두 번)
    cy -= (running ? 0.05 : 0.022) * Math.abs(Math.cos(p * TAU));
    lean = running ? 0.22 : 0.08;
  }
  const hipY = cy + ry * 0.62;
  const legO = chick
    ? { l1: 0.1, l2: 0.1, r1: 0.03, r2: 0.026, foot: 0.03, bend: 1 }
    : { l1: 0.14, l2: 0.14, r1: 0.05, r2: 0.045, foot: 0.06, bend: 1, join: 0.012 };
  const footY = GROUND - legO.foot;
  if (state === 'rest') {
    if (!chick) {
      // 콩이는 두 발을 앞으로 뻗고 앉는다
      pieces.push({ f: bar(cx + 0.04, cy + ry * 0.7, cx + 0.22, footY - 0.01, 0.055), join: 0.04 });
      pieces.push({ f: ellipse(cx + 0.25, footY - 0.015, 0.065, 0.05, -0.3), join: 0.02 });
    }
  } else {
    for (const ph of [0.5, 0]) {
      // 반 장 비껴 두 발이 겹쳐 한 다리로 보이는 장이 없게
      const q = (p + ph + 0.5 / RUNNER_COUNTS[state]) % 1;
      const sv = Math.sin(q * TAU);
      const amp = running ? 0.8 : 0.5;
      const reach = legO.l1 + legO.l2 - 0.01;
      const hx = cx;
      let fx = hx + Math.sin(amp * sv) * reach;
      let fy = hipY + Math.cos(amp * sv) * reach;
      // 앞으로 나가는 발은 든다
      const fwd = Math.cos(q * TAU);
      if (fwd > 0) fy -= (running ? 0.08 : 0.045) * fwd;
      fy = Math.min(fy, footY);
      fx += lean * 0.12;
      pieces.push(...legPieces(hx, hipY, fx, fy, legO));
      if (chick) {
        // 삐약이 발가락
        const k = knee(hx, hipY, fx, fy, legO.l1, legO.l2, 1);
        pieces.push({ f: bar(k.fx - 0.01, k.fy + 0.012, k.fx + 0.065, k.fy + 0.02, 0.02), join: 0.01 });
      }
    }
  }

  // 몸 (달리면 앞으로 기운다)
  pieces.push({ f: ellipse(cx, cy, rx, ry, lean * 0.5), join: chick ? 0.03 : 0.05 });

  if (chick) {
    // 부리
    pieces.push({ f: cone(cx + rx * 0.82, cy - 0.01, cx + rx + 0.11, cy + 0.025, 0.06, 0.016), join: 0.012 });
    // 머리 깃털 두 가닥
    const tuft =
      state === 'rest' ? ([0, 0.15, 0.3, 0.15][m.frame % 4] ?? 0) : running ? 0.55 : 0.2 * Math.sin(p * TAU);
    for (const [dx, a, l] of [
      [-0.03, -1.8, 0.1],
      [0.03, -1.35, 0.08],
    ] as const) {
      const tx = cx + dx;
      const ty = cy - ry + 0.025;
      const aa = a - tuft;
      pieces.push({ f: cone(tx, ty, tx + Math.cos(aa) * l, ty + Math.sin(aa) * l, 0.03, 0.017), join: 0.02 });
    }
    // 꽁지
    pieces.push({ f: cone(cx - rx * 0.8, cy - 0.02, cx - rx - 0.09, cy - 0.09, 0.06, 0.02), join: 0.02 });
    // 날개: 둘레를 파서 몸 위에 얹힌 것처럼. 달리면 파닥
    const flap =
      state === 'rest'
        ? ([0, 0.12, 0, 0.12][m.frame % 4] ?? 0)
        : running
          ? 0.6 * Math.sin(p * TAU * 2)
          : 0.15 * Math.sin(p * TAU);
    pieces.push({ f: ellipse(cx - 0.06, cy + 0.04, 0.13, 0.08, -0.3 - flap), gap: 0.022 });
    pieces.push(...sweat(m, cx - 0.1, cy + 0.02, 0.22));
    holes.push(...eye(cx + rx * 0.45, cy - ry * 0.28, 0.042, closed));
    return { pieces, holes };
  }

  // 콩이: 머리 위 새싹 (줄기와 잎 둘). 달리면 뒤로 젖혀 나부낀다
  const rot = lean * 0.5;
  const topX = cx + Math.sin(rot) * ry * 0.92;
  const topY = cy - Math.cos(rot) * ry * 0.92;
  const sway =
    state === 'rest'
      ? ([0, 0.2, 0.35, 0.2][m.frame % 4] ?? 0)
      : running
        ? 0.55 + 0.15 * Math.sin(p * TAU * 2)
        : 0.2 * Math.sin(p * TAU);
  const sa = -1.5 - sway;
  const sx = topX + Math.cos(sa) * 0.1;
  const sy = topY + Math.sin(sa) * 0.1;
  pieces.push({ f: bar(topX, topY, sx, sy, 0.024), join: 0.015 });
  pieces.push({ f: ellipse(sx + 0.065, sy - 0.012, 0.078, 0.04, -0.45 - sway * 0.5), join: 0.01 });
  pieces.push({ f: ellipse(sx - 0.05, sy + 0.004, 0.052, 0.03, 0.5 - sway * 0.5), join: 0.01 });
  // 팔: 몸 앞쪽 아래에 붙은 짧은 팔이 몸 밖으로 나와 다리와 반대로 흔든다
  const armA = state === 'rest' ? 1.0 : 0.75 + (running ? 0.7 : 0.35) * Math.sin(p * TAU + Math.PI);
  const shx = cx + rx * 0.72;
  const shy = cy + ry * 0.35;
  pieces.push({
    f: cone(shx, shy, shx + Math.cos(armA) * 0.1, shy + Math.sin(armA) * 0.1, 0.042, 0.036),
    join: 0.02,
  });
  pieces.push(...sweat(m, cx + 0.05, cy - 0.05, 0.2));
  holes.push(...eye(cx + rx * 0.55, cy - ry * 0.22, 0.045, closed));
  return { pieces, holes };
}

function sceneOf(kind: PetKind, state: RunnerState, frame: number): Scene {
  const n = RUNNER_COUNTS[state];
  const f = ((Math.floor(frame) % n) + n) % n;
  const m: Motion = { p: f / n, state, frame: f };
  if (kind === 'cat' || kind === 'dog' || kind === 'bunny') return quadScene(kind, m);
  return bipedScene(kind, m);
}

/**
 * 한 장의 불투명도(0~255, w*h). 장면(너비 1.25, 높이 1)을 비율 그대로 칸에 맞춰 바닥에 붙이고 가운데에 둔다.
 * 2x2 로 나눠 재고 거리로 가장자리를 부드럽게 한다. 맥은 이 불투명도로 흑백 템플릿을 만들어 메뉴 막대 색을 따른다
 */
export function runnerAlpha(kind: PetKind, state: RunnerState, frame: number, w: number, h = w): Uint8Array {
  const out = new Uint8Array(w * h);
  const sc = sceneOf(kind, state, frame);
  // 위아래 여백 조금 (귀 끝과 발이 잘리지 않게)
  const scale = Math.min(w / SCENE_W, h / 1.02);
  const ox = (w - SCENE_W * scale) / 2;
  const oy = h - scale * 1.0;
  const N = 2;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = (px + (sx + 0.5) / N - ox) / scale;
          const y = (py + (sy + 0.5) / N - oy) / scale;
          const d = evalScene(sc, x, y) * scale;
          a += clamp(0.5 - d * N, 0, 1);
        }
      }
      out[py * w + px] = Math.round((a / (N * N)) * 255);
    }
  }
  return out;
}
