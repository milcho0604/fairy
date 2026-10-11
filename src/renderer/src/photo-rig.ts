// 그림 펫 뼈대 (2D 그물 변형, Live2D 나 컷아웃 애니메이션과 같은 방식). 그림 한 장 위에 촘촘한 그물을 깔고,
// 그물 꼭짓점마다 뼈(몸, 머리, 귀, 앞발, 뒷발, 꼬리)의 무게를 둔 뒤 뼈를 움직이면 그물이 따라 휘어 그림이 같이 움직인다.
// 그림 픽셀은 그대로 쓰니 사진 느낌이 남고, 다리 사이가 비지 않는다 (잘라 붙이는 방식은 다리를 들면 뒤가 뚫린다).
// 뼈 자리는 그림마다 사람이 정한 값 (photo-rig-data.ts). 나중에 사진 펫은 분할로 이 값을 스스로 찾으면 된다.
// 그리기 없이 숫자만 다뤄 시험한다 (photo-rig.test.ts). 그리기는 photo-rig-draw.ts.
// 단위는 모두 그림 픽셀 (그림 왼쪽 위가 0, y 는 아래로). 각도는 화면에서 시계 방향이 +.
import { trotLeg } from './pet3d-gait.ts';
import { footSlide } from './walk-pace.ts';

export type Vec = readonly [number, number];

export type BoneId = 'body' | 'head' | 'earL' | 'earR' | 'legL' | 'legR' | 'hindL' | 'hindR' | 'tail';

/** 뼈가 그림을 쥐는 자리: 선분 a~b 둘레 반지름 r 안은 다 쥐고, 그 밖 soft 동안 부드럽게 놓는다 */
export interface Capsule {
  a: Vec;
  b: Vec;
  r: number;
  soft: number;
}

export interface BoneDef {
  id: BoneId;
  /** 없으면 뿌리 (몸). 뿌리는 하나이고 맨 앞에 둔다. 부모는 자식보다 앞에 */
  parent?: BoneId;
  /** 돌리고 키우는 가운데. 다리는 발 가운데 (발을 들면 발이 그 자리에서 커진다) */
  pivot: Vec;
  /** 쥐는 자리 (여럿이면 가장 센 것). 뿌리는 없어도 된다 (남는 무게를 다 가진다) */
  grip?: readonly Capsule[];
  /**
   * 첫 쥐는 자리의 a→b 진행 t 가 ramp[0] 일 때 0, ramp[1] 일 때 1 로 오르는 무게.
   * 다리는 어깨 쪽이 몸에 붙어 있고 발 쪽만 움직여 다리가 접혔다 펴진다
   */
  ramp?: readonly [number, number];
}

/** 그림 하나의 뼈대 */
export interface RigDef {
  /** 그림 크기 (다르면 다른 그림이라 쓰지 않는다) */
  w: number;
  h: number;
  /** 그물 칸 크기 (그림 px) */
  cell: number;
  /** 발바닥 y (바닥) */
  ground: number;
  bones: readonly BoneDef[];
  /** 움직임 크기 (그림 px, 라디안) */
  motion: RigMotionSpec;
}

export interface RigMotionSpec {
  /** 앞발을 드는 높이 */
  paw: number;
  /** 뒷발(엉덩이)을 드는 높이 */
  hind: number;
  /** 걸을 때 일어서는 높이 (앉은 그림이라 걸을 땐 몸을 세운다) */
  rise: number;
  /** 걸음마다 몸이 들썩이는 높이 */
  bob: number;
  /** 앉을 때 몸이 내려앉는 높이 */
  settle: number;
  /** 걸을 때 꼬리 흔드는 각 */
  tail: number;
  /** 귀가 걸음에 흔들리는 각 (늘어진 귀는 크게) */
  ear: number;
}

/** 2D 아핀 변환 [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (DOMMatrix 와 같은 순서) */
export type Affine = [number, number, number, number, number, number];
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** m 다음 n 이 아니라, n 을 먼저 하고 m 을 한다 (m∘n) */
export function mul(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** 뼈 하나의 움직임. 가운데(pivot)를 축으로 키우고(sx, sy) 돌린 뒤(rot) 옮긴다(dx, dy) */
export interface BoneMove {
  rot?: number;
  dx?: number;
  dy?: number;
  sx?: number;
  sy?: number;
  /**
   * 부모를 따라가지 않고 그림 기준으로 둔다. 바닥을 딛은 발은 몸이 들썩이고 일어서도 바닥에 그대로 있어야 해서
   * (몸만 움직이고 다리는 늘어난다)
   */
  ground?: boolean;
}

export type RigPose = Partial<Record<BoneId, BoneMove>>;

/** 가운데 p 둘레의 움직임을 아핀으로 */
export function moveMatrix(p: Vec, m: BoneMove): Affine {
  const r = m.rot ?? 0;
  const sx = m.sx ?? 1;
  const sy = m.sy ?? 1;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // T(p + d) R S T(-p)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const e = p[0] + (m.dx ?? 0) - (a * p[0] + c * p[1]);
  const f = p[1] + (m.dy ?? 0) - (b * p[0] + d * p[1]);
  return [a, b, c, d, e, f];
}

/** 뼈마다 그림 기준 변환 (def.bones 순서). 자식은 부모 변환 위에 제 움직임을 얹는다 (ground 면 그림 기준) */
export function boneMatrices(def: RigDef, pose: RigPose): Affine[] {
  const out: Affine[] = [];
  const at = new Map<BoneId, number>();
  def.bones.forEach((bone, i) => {
    const m = pose[bone.id];
    const local = m ? moveMatrix(bone.pivot, m) : IDENTITY;
    const pi = bone.parent ? at.get(bone.parent) : undefined;
    const parent = pi === undefined ? undefined : out[pi];
    out.push(parent && !m?.ground ? mul(parent, local) : [...local]);
    at.set(bone.id, i);
  });
  return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

/** 선분 a~b 위 가장 가까운 점까지 거리와 그 진행 t (0~1) */
export function segDistance(a: Vec, b: Vec, x: number, y: number): { d: number; t: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? clamp01(((x - a[0]) * vx + (y - a[1]) * vy) / len2) : 0;
  return { d: Math.hypot(x - (a[0] + vx * t), y - (a[1] + vy * t)), t };
}

/** 뼈 하나가 (x, y) 를 쥐는 세기 0~1 (부모 무게를 나누기 전) */
export function grip(bone: BoneDef, x: number, y: number): number {
  let best = 0;
  bone.grip?.forEach((c, i) => {
    const { d, t } = segDistance(c.a, c.b, x, y);
    let w = 1 - smooth((d - c.r) / Math.max(1e-6, c.soft));
    if (i === 0 && bone.ramp) w *= smooth((t - bone.ramp[0]) / Math.max(1e-6, bone.ramp[1] - bone.ramp[0]));
    best = Math.max(best, w);
  });
  return best;
}

/**
 * (x, y) 의 뼈 무게 (def.bones 순서, 합 1). 뿌리가 1 을 갖고 시작해 자식마다 쥐는 만큼 넘겨준다.
 * 자식은 부모가 가진 무게 안에서만 가져가서 (귀는 머리 무게에서) 부모를 따라 움직이며 제 움직임을 더한다.
 * 형제가 겹쳐 합이 1 을 넘으면 나눠 가진다
 */
export function weightsAt(def: RigDef, x: number, y: number): number[] {
  const n = def.bones.length;
  const g = def.bones.map((b) => (b.parent ? grip(b, x, y) : 0));
  const mass = new Array<number>(n).fill(0);
  const w = new Array<number>(n).fill(0);
  if (n === 0) return w;
  mass[0] = 1;
  def.bones.forEach((bone, i) => {
    let total = 0;
    def.bones.forEach((c, j) => {
      if (c.parent === bone.id) total += g[j] ?? 0;
    });
    const norm = Math.max(1, total);
    def.bones.forEach((c, j) => {
      if (c.parent === bone.id) mass[j] = ((mass[i] ?? 0) * (g[j] ?? 0)) / norm;
    });
    w[i] = (mass[i] ?? 0) * (1 - total / norm);
  });
  return w;
}

/** 그물: 쉬는 자리 꼭짓점, 세모, 꼭짓점마다 뼈 무게 */
export interface RigMesh {
  /** 꼭짓점 쉬는 자리 [x0, y0, x1, y1, ...] */
  rest: Float32Array;
  /** 세모 꼭짓점 번호 [i0, i1, i2, ...] */
  tris: Uint16Array;
  /** 꼭짓점마다 뼈 무게 (꼭짓점 i 의 뼈 j 는 i * bones + j) */
  weights: Float32Array;
  bones: number;
}

/**
 * 그림 위에 칸 cell 의 그물을 깐다. 그림이 빈 칸(alpha 가 모두 낮은 칸)은 빼서 세모 수를 줄인다.
 * alpha(x, y) 는 그림 픽셀의 불투명도 0~255 (그림 밖은 0)
 */
export function buildMesh(def: RigDef, alpha: (x: number, y: number) => number): RigMesh {
  const cell = Math.max(4, def.cell);
  const cols = Math.ceil(def.w / cell);
  const rows = Math.ceil(def.h / cell);
  const step = Math.max(2, Math.floor(cell / 6));
  const filled = (cx: number, cy: number) => {
    const x0 = cx * cell;
    const y0 = cy * cell;
    for (let y = y0; y < Math.min(def.h, y0 + cell + 1); y += step)
      for (let x = x0; x < Math.min(def.w, x0 + cell + 1); x += step) if (alpha(x, y) > 8) return true;
    return false;
  };
  const index = new Map<number, number>();
  const rest: number[] = [];
  const vert = (vx: number, vy: number) => {
    const key = vy * (cols + 1) + vx;
    let i = index.get(key);
    if (i === undefined) {
      i = rest.length / 2;
      index.set(key, i);
      rest.push(Math.min(def.w, vx * cell), Math.min(def.h, vy * cell));
    }
    return i;
  };
  const tris: number[] = [];
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      if (!filled(cx, cy)) continue;
      const a = vert(cx, cy);
      const b = vert(cx + 1, cy);
      const c = vert(cx + 1, cy + 1);
      const d = vert(cx, cy + 1);
      // 칸마다 대각선 방향을 번갈아 (한쪽으로 쏠린 휘어짐이 덜 보인다)
      if ((cx + cy) % 2 === 0) tris.push(a, b, c, a, c, d);
      else tris.push(a, b, d, b, c, d);
    }
  const nb = def.bones.length;
  const nv = rest.length / 2;
  const weights = new Float32Array(nv * nb);
  for (let i = 0; i < nv; i++) {
    const w = weightsAt(def, rest[i * 2] as number, rest[i * 2 + 1] as number);
    for (let j = 0; j < nb; j++) weights[i * nb + j] = w[j] ?? 0;
  }
  return { rest: new Float32Array(rest), tris: new Uint16Array(tris), weights, bones: nb };
}

/** 꼭짓점을 뼈 무게대로 섞어 옮긴다 (선형 블렌드 스키닝). out 을 주면 거기에 쓴다 */
export function skin(mesh: RigMesh, mats: readonly Affine[], out?: Float32Array): Float32Array {
  const res = out ?? new Float32Array(mesh.rest.length);
  const nb = mesh.bones;
  for (let i = 0; i < mesh.rest.length / 2; i++) {
    const x = mesh.rest[i * 2] as number;
    const y = mesh.rest[i * 2 + 1] as number;
    let px = 0;
    let py = 0;
    for (let j = 0; j < nb; j++) {
      const w = mesh.weights[i * nb + j] as number;
      if (w === 0) continue;
      const m = mats[j] as Affine;
      px += w * (m[0] * x + m[2] * y + m[4]);
      py += w * (m[1] * x + m[3] * y + m[5]);
    }
    res[i * 2] = px;
    res[i * 2 + 1] = py;
  }
  return res;
}

/** 세모 (u0, u1, u2) 를 (d0, d1, d2) 로 보내는 아핀. 세모가 납작하면 undefined */
export function triangleAffine(
  u: readonly [number, number, number, number, number, number],
  d: readonly [number, number, number, number, number, number],
): Affine | undefined {
  const ux1 = u[2] - u[0];
  const uy1 = u[3] - u[1];
  const ux2 = u[4] - u[0];
  const uy2 = u[5] - u[1];
  const det = ux1 * uy2 - ux2 * uy1;
  if (Math.abs(det) < 1e-9) return undefined;
  const dx1 = d[2] - d[0];
  const dy1 = d[3] - d[1];
  const dx2 = d[4] - d[0];
  const dy2 = d[5] - d[1];
  // M = D U^-1
  const a = (dx1 * uy2 - dx2 * uy1) / det;
  const c = (dx2 * ux1 - dx1 * ux2) / det;
  const b = (dy1 * uy2 - dy2 * uy1) / det;
  const dd = (dy2 * ux1 - dy1 * ux2) / det;
  return [a, b, c, dd, d[0] - (a * u[0] + c * u[1]), d[1] - (b * u[0] + dd * u[1])];
}

/** 아무 뼈도 움직이지 않는 자세인지 (그물 없이 그림을 그대로 그린다: 쉬는 동안 드는 값이 예전과 같다) */
export function isRestPose(pose: RigPose, eps = 1e-3): boolean {
  return Object.values(pose).every(
    (m) =>
      !m ||
      (Math.abs(m.rot ?? 0) < eps * 0.01 &&
        Math.abs(m.dx ?? 0) < eps &&
        Math.abs(m.dy ?? 0) < eps &&
        Math.abs((m.sx ?? 1) - 1) < eps * 0.01 &&
        Math.abs((m.sy ?? 1) - 1) < eps * 0.01),
  );
}

// ---- 움직임 → 뼈 자세 ----

/** 그리기 상태에서 뽑은 움직임. 0 이나 없음이면 쉬는 자세 */
export interface RigMotion {
  /** 걷기. phase 는 걸음 진행 0~1, stride 는 한 걸음 길이(그림 px), k 는 보폭 세기 0~1, rise 는 일어선 정도 0~1 */
  walk?: { phase: number; dir: -1 | 1; stride: number; k: number; rise: number };
  /** 앉은 정도 0~1 (내려앉는다) */
  sit?: number;
  /** 앞발 드는 정도 [왼쪽, 오른쪽] 0~1 (그림의 왼쪽, 오른쪽. 발 구르기 같은 몸짓) */
  legs?: readonly [number, number];
  /** 손 흔들기: 오른 앞발을 들고 흔든다. k 는 든 정도 0~1, swing 은 흔드는 쪽 -1~1 */
  wave?: { k: number; swing: number };
  /** 꼬리 각 (라디안, 몸짓) */
  tail?: number;
  /** 귀 젖히는 각 [왼쪽, 오른쪽] (바깥쪽이 +) */
  ears?: readonly [number, number];
  /** 고개: 돌리기 look(-1~1), 갸웃 tilt(라디안), 숙이기 pitch(라디안, + 가 아래), 위아래 보기 up(-1~1) */
  head?: { look?: number; tilt?: number; pitch?: number; up?: number };
  /** 몸 비틀기 (라디안, 몸 털기) */
  twist?: number;
  /** 들려서 다리가 늘어진 정도 0~1 */
  dangle?: number;
}

const has = (def: RigDef, id: BoneId) => def.bones.some((b) => b.id === id);

/**
 * 네 발 걸음 한 발의 들기와 밀기. 대각선 쌍(trotLeg): 왼앞발과 오른뒷발, 오른앞발과 왼뒷발이 같이 든다.
 * slide 는 몸에 대해 발이 놓인 앞뒤(보폭 단위 -0.25~0.25, walk-pace.ts footSlide). 발이 드는 반 걸음 동안 앞으로
 * 나가고 딛는 동안 몸이 간 만큼 뒤로 밀려 바닥에서 미끄러지지 않는다
 */
export function legStep(leg: 'fl' | 'fr' | 'hl' | 'hr', phase: number): { lift: number; slide: number } {
  // trotLeg 의 들기는 cos 가 + 인 반 걸음: 왼앞발은 phase 0 가운데, 오른앞발은 0.5 가운데.
  // footSlide 는 swingAt 부터 반 걸음 동안 나가고 그 가운데가 swingAt + 0.25
  const swingAt = leg === 'fl' || leg === 'hr' ? 0.75 : 0.25;
  return { lift: trotLeg(leg, phase).lift, slide: footSlide(phase, swingAt) };
}

/** 움직임을 뼈 자세로. 그림에 없는 뼈는 빼고 */
export function rigPose(def: RigDef, m: RigMotion): RigPose {
  const s = def.motion;
  const pose: RigPose = {};
  const w = m.walk;
  const wk = w ? clamp01(w.k) : 0;
  const rise = w ? clamp01(w.rise) : 0;
  const tau = Math.PI * 2;
  // 몸: 걸으면 일어서고(앉은 그림이라) 걸음마다 들썩이며 좌우로 살짝 흔들린다. 앉으면 내려앉는다
  const bob = w ? Math.abs(Math.sin(w.phase * tau)) * s.bob * wk : 0;
  const sway = w ? Math.sin(w.phase * tau) * 0.03 * wk : 0;
  const bodyDy = -s.rise * rise - bob + s.settle * clamp01(m.sit ?? 0);
  const bodyRot = sway + (m.twist ?? 0);
  if (bodyDy || bodyRot) pose.body = { dy: bodyDy, rot: bodyRot };

  // 앞발: 걸음, 몸짓 발 들기, 손 흔들기, 들렸을 때 늘어짐. 바닥 기준이라 몸이 일어서도 발은 바닥에
  const dangle = clamp01(m.dangle ?? 0);
  const front = [
    ['legL', 'fl', 0],
    ['legR', 'fr', 1],
  ] as const;
  for (const [id, leg, side] of front) {
    if (!has(def, id)) continue;
    const step = w ? legStep(leg, w.phase) : { lift: 0, slide: 0 };
    let lift = step.lift * wk + clamp01(m.legs?.[side] ?? 0);
    let dx = w ? w.dir * step.slide * w.stride * wk : 0;
    let rot = 0;
    if (id === 'legR' && m.wave && m.wave.k > 0) {
      lift = Math.max(lift, 1.25 * clamp01(m.wave.k));
      dx += m.wave.swing * s.paw * 0.4 * clamp01(m.wave.k);
      rot = m.wave.swing * 0.25 * clamp01(m.wave.k);
    }
    // 든 발은 보는 사람 쪽으로 나와 조금 커 보인다
    const grow = 1 + 0.08 * Math.min(1.5, lift);
    const dy = -lift * s.paw + dangle * s.paw * 0.5;
    if (lift || dx || dangle || rot) pose[id] = { dx, dy, rot, sx: grow, sy: grow, ground: true };
    else pose[id] = { ground: true };
  }
  // 뒷발: 앞발과 대각선 쌍으로 엉덩이를 살짝 든다. 앉으면 엉덩이가 옆으로 퍼진다
  const hind = [
    ['hindL', 'hl', -1],
    ['hindR', 'hr', 1],
  ] as const;
  for (const [id, leg, out] of hind) {
    if (!has(def, id)) continue;
    const step = w ? legStep(leg, w.phase) : { lift: 0, slide: 0 };
    const dx =
      (w ? w.dir * step.slide * w.stride * wk * 0.6 : 0) + out * clamp01(m.sit ?? 0) * s.settle * 0.6;
    const dy = -step.lift * wk * s.hind + dangle * s.hind * 0.5;
    pose[id] = { dx, dy, ground: true };
  }
  // 머리: 고개 돌리기, 갸웃, 숙이기. 걸을 땐 가는 쪽을 조금 보고, 몸이 흔들리는 만큼 반대로 버텨 시선이 덜 흔들린다
  if (has(def, 'head')) {
    const h = m.head ?? {};
    const look = (h.look ?? 0) + (w ? w.dir * 0.5 * rise : 0);
    const pitch = h.pitch ?? 0;
    const up = h.up ?? 0;
    const rot = (h.tilt ?? 0) + look * 0.05 - sway * 0.6;
    const dx = look * def.w * 0.03;
    // 숙이면 머리가 내려오며 위아래로 조금 눌린다 (앞으로 숙인 머리가 짧아 보인다). 걸을 땐 걸음마다 끄덕인다
    const nod = w ? Math.cos(w.phase * tau * 2) * s.bob * 0.3 * wk : 0;
    const dy = Math.sin(pitch) * def.h * 0.06 - up * def.h * 0.012 - nod;
    const sy = 1 - Math.min(0.12, Math.abs(Math.sin(pitch)) * 0.15);
    if (rot || dx || dy || sy !== 1) pose.head = { rot, dx, dy, sy };
  }
  // 귀: 걸음에 흔들리고(늘어진 귀는 크게), 몸짓대로 젖힌다. 왼귀는 바깥이 시계 반대 방향
  const earSwing = w ? Math.sin(w.phase * tau * 2 - 0.8) * s.ear * wk : 0;
  for (const [id, side, sign] of [
    ['earL', 0, -1],
    ['earR', 1, 1],
  ] as const) {
    if (!has(def, id)) continue;
    const rot = sign * (m.ears?.[side] ?? 0) * 0.35 + earSwing;
    if (rot) pose[id] = { rot };
  }
  // 꼬리: 걸음에 맞춰 흔들고, 몸짓(꼬리 흔들기)대로
  if (has(def, 'tail')) {
    const rot = (w ? Math.sin(w.phase * tau + Math.PI / 2) * s.tail * wk : 0) + (m.tail ?? 0);
    if (rot) pose.tail = { rot };
  }
  return pose;
}
