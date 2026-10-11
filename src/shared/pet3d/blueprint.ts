// 입체 펫 설계도 (6단계). 기본 펫도, AI 가 사진을 보고 만든 펫도 같은 모양으로 적고 앱이 three.js 로 조립한다.
// 좌표: 바닥이 y=0, 펫 키는 1 안팎, 앞(보는 사람 쪽)이 +z, 오른쪽이 +x. 각도는 도(°).
// v2 (2026-10-11): 무늬(spots, stripes, split), 안쪽 색(inner), 관(tube) 꼬리, 털 뭉치(tuft), 리본(bow),
// 눈 모양, 코, 눈썹, 속눈썹, 볼 털을 더했다. 모두 선택 칸이라 v1 설계도는 그대로 읽힌다.

export type Vec3 = [number, number, number];

/** 같이 움직이는 관절 묶음. L 이 펫의 왼쪽(-x) */
export const SLOTS = [
  'body',
  'head',
  'earL',
  'earR',
  'armL',
  'armR',
  'legL',
  'legR',
  'wingL',
  'wingR',
  'tail',
  'top',
] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * 이름 옆 얼굴 그림에 넣는 관절인지. 머리와 귀, 머리 위 장식은 늘 넣고, 몸은 얼굴(눈, 입)이 몸에 있을 때만
 * (콩이, 삐약이처럼 몸이 곧 얼굴). 팔, 날개, 다리, 꼬리는 어느 쪽이든 뺀다
 * (사진 피규어는 머리 없이 몸에 얼굴을 그리는 일이 많아 앞발이 얼굴 아래에 걸렸다)
 */
export function inFace(slot: Slot, faceOnHead: boolean): boolean {
  if (slot === 'head' || slot === 'earL' || slot === 'earR' || slot === 'top') return true;
  return slot === 'body' && !faceOnHead;
}

/**
 * 모양. sphere 는 축마다 반지름이 달라 타원체다. capsule, cylinder, cone 은 y 가 높이의 반.
 * tube 는 path 를 따라가는 관(꼬리, 말린 꼬리. size.x 가 반지름, taper 로 끝이 가늘어진다).
 * tuft 는 털 뭉치(부채꼴 세 가닥, +y 쪽으로 뻗는다. 볼 털, 가슴 털, 머리 털). bow 는 리본 매듭
 */
export const SHAPES = [
  'sphere',
  'capsule',
  'cone',
  'cylinder',
  'box',
  'torus',
  'tube',
  'tuft',
  'bow',
] as const;
export type Shape = (typeof SHAPES)[number];

/** 겉 느낌: soft 말랑한 비닐, shiny 반짝, fuzzy 털 */
export const FINISHES = ['soft', 'shiny', 'fuzzy'] as const;
export type Finish = (typeof FINISHES)[number];

/**
 * 무늬 (v2). 부품 겉에 다른 색을 얹는다. spots 점박이, stripes 줄무늬, split 두 색 나누기
 * (side 쪽 amount 만큼이 color: 흰 배는 bottom, 흰 얼굴은 front, 등 안장은 top).
 * scale 은 점과 줄의 크기(1 이 보통), amount 는 덮는 비율(0~1), dir 은 줄이 나아가는 축
 */
export const PATTERNS = ['spots', 'stripes', 'split'] as const;
export type PatternType = (typeof PATTERNS)[number];
export const SIDES = ['top', 'bottom', 'front', 'back', 'left', 'right'] as const;
export type Side = (typeof SIDES)[number];
export const AXES = ['x', 'y', 'z'] as const;
export type Axis = (typeof AXES)[number];
export interface Pattern {
  type: PatternType;
  color: string;
  scale?: number;
  amount?: number;
  side?: Side;
  dir?: Axis;
}

export interface Part {
  slot: Slot;
  shape: Shape;
  /** 가운데 위치 */
  at: Vec3;
  /** 반지름(축마다). 원기둥, 원뿔, 캡슐은 y 가 높이의 반 */
  size: Vec3;
  rot?: Vec3;
  color: string;
  finish?: Finish;
  /** 반대쪽에도 거울로 하나 더 (x 를 뒤집고 L 슬롯은 R 로) */
  mirror?: boolean;
  /** 안쪽 색 (귀 안 분홍, 발바닥). 같은 모양을 조금 작고 납작하게 앞면에 겹친다 (v2) */
  inner?: string;
  /** 끝 반지름 비율 0~1 (cylinder, capsule, tube: 1 이면 같은 굵기, 0 이면 뾰족) (v2) */
  taper?: number;
  /** box 모서리 둥글기 0~1 (기본 0.35) (v2) */
  round?: number;
  /** tube 가 지나는 점들 (절대 좌표, 2~8개) (v2) */
  path?: Vec3[];
  /** 무늬 (v2) */
  pattern?: Pattern;
}

export const MOUTHS = ['smile', 'cat', 'beak', 'grin', 'tiny'] as const;
export type MouthStyle = (typeof MOUTHS)[number];

/**
 * 쉬는 눈 모양 (요청사항으로 표정 고르기). round 동그란 눈(없을 때와 같다), happy 웃는 눈(^^),
 * sleepy 반쯤 감은 졸린 눈, sparkle 반짝이가 큰 눈. 신남, 잠 같은 상태 표정은 그대로 바뀐다
 */
export const EYES = ['round', 'happy', 'sleepy', 'sparkle'] as const;
export type EyeLook = (typeof EYES)[number];

/** 뜬 눈의 테두리 모양 (v2). oval 세로로 긴, almond 옆으로 긴 아몬드, droopy 바깥이 처진 */
export const EYE_SHAPES = ['round', 'oval', 'almond', 'droopy'] as const;
export type EyeShape = (typeof EYE_SHAPES)[number];
/** 눈 반짝이 (v2). small 작은 점 하나, big 큰 점과 작은 점, double 점 둘 */
export const CATCHLIGHTS = ['small', 'big', 'double'] as const;
export type Catchlight = (typeof CATCHLIGHTS)[number];
/** 눈동자 (v2). 눈 색이 있을 때: slit 세로로 긴 고양이 눈동자, round 동그란 */
export const PUPILS = ['round', 'slit'] as const;
export type Pupil = (typeof PUPILS)[number];
/** 코 모양 (v2). triangle 둥근 세모(고양이, 토끼), oval 납작한 타원(강아지), dot 작은 점, none 코 없음(인형) */
export const NOSES = ['triangle', 'oval', 'dot', 'none'] as const;
export type NoseShape = (typeof NOSES)[number];

export interface Nose {
  shape: NoseShape;
  /** none 이 아니면 있다 */
  color?: string;
  /** 높이. 없으면 눈과 입 사이 */
  y?: number;
  /** 반지름 배율 (1 이 보통) */
  size?: number;
}

export interface Brows {
  color: string;
  /** 높이. 없으면 눈 바로 위 */
  y?: number;
  /** 안쪽 끝이 올라간 각(도). 양수면 순한 팔자 눈썹, 음수면 찡그린 눈썹 */
  tilt?: number;
}

/**
 * 몸짓 세기 (요청사항으로 얌전하게, 통통 튀게). 1 이 기본 동작 그대로, 0 이면 그 움직임을 거의 안 한다.
 * bounce 신나서 뛰는 높이와 걸음 들썩임, sway 팔과 몸 흔들기, tailWag 꼬리, earWiggle 귀
 */
export interface Motion {
  bounce?: number;
  sway?: number;
  tailWag?: number;
  earWiggle?: number;
}
/** 몸짓 칸마다 범위. bounce 는 더 높이 뛰면 펫 화면(160) 위로 잘려서 1.5 까지 */
export const MOTION_RANGE: Record<keyof Motion, readonly [number, number]> = {
  bounce: [0, 1.5],
  sway: [0, 2],
  tailWag: [0, 2],
  earWiggle: [0, 2],
};

/** 얼굴. 눈과 입은 앞에서 쏜 선이 얼굴 슬롯 겉면에 닿는 자리에 붙는다(그래서 z 는 안 적는다) */
export interface Face {
  slot: 'head' | 'body';
  eyeY: number;
  /** 가운데에서 눈까지 x 거리 */
  eyeGap: number;
  eyeSize: number;
  eyeColor?: string;
  mouth: MouthStyle;
  mouthY: number;
  /** 부리 색 (mouth 가 beak 일 때) */
  mouthColor?: string;
  blush?: string;
  whiskers?: string;
  /** 쉬는 눈 모양. 없으면 round */
  eyes?: EyeLook;
  /** 뜬 눈 테두리 모양. 없으면 round (v2) */
  eyeShape?: EyeShape;
  /** 반짝이. 없으면 모습(게임은 double)에 따른다 (v2) */
  catchlight?: Catchlight;
  /** 눈동자. 없으면 모습에 따른다 (v2) */
  pupil?: Pupil;
  /** 속눈썹 (v2) */
  lashes?: boolean;
  /** 코 (v2). 없으면 cat 입에만 분홍 코 */
  nose?: Nose;
  /** 눈썹 (v2) */
  brows?: Brows;
  /** 볼 옆 털 뭉치 색 (v2) */
  fluff?: string;
  /** 볼 터치 위 빗금 (v2). 인형, 캐릭터 그림의 //// 볼 */
  blushLines?: boolean;
}

/**
 * 걸음새. quadruped 는 네 발 동물(고양이, 개, 토끼 등): 걸을 때 몸을 앞으로 숙이고 네 다리를 대각선 쌍으로 딛는다.
 * biped 는 두 발(사람, 새, 인형 캐릭터). 없으면 다리 모양으로 짐작한다 (renderer pet3d-gait.ts gaitOf)
 */
export const GAITS = ['biped', 'quadruped'] as const;
export type Gait = (typeof GAITS)[number];

export interface Blueprint {
  /** 설계도 판. 1 은 처음 것, 2 는 무늬와 얼굴 칸을 더한 것. 읽을 때는 둘 다 같은 길로 간다 */
  v: 1 | 2;
  parts: Part[];
  face: Face;
  /** 몸짓 세기. 없으면 기본 동작 그대로 */
  motion?: Motion;
  /** 걸음새. 없으면 다리 모양으로 짐작 */
  gait?: Gait;
  /** 털 느낌 (복슬복슬 모습). 없으면 부품 겉 느낌(fuzzy, soft)으로 정한다 */
  fur?: Fur;
}

/**
 * 털 느낌. 모두 0~1. length 짧은 솜털(0)~긴 털(1), curl 곧은 털(0)~곱슬(1, 푸들),
 * clump 고르게 흩어진 털(0)~뭉쳐 갈라진 털(1, 긴 털 고양이)
 */
export interface Fur {
  length?: number;
  curl?: number;
  clump?: number;
}

export const MAX_PARTS = 40;
/** tube 가 지나는 점 수 */
export const MAX_PATH = 8;

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d;
const optNum = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : undefined;
const vec = (v: unknown, lo: number, hi: number, d: number): Vec3 | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [num(v[0], lo, hi, d), num(v[1], lo, hi, d), num(v[2], lo, hi, d)]
    : undefined;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;
const color = (v: unknown): string | undefined =>
  typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined;
const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;

/** 위치 칸 범위 (at, path) */
const AT_RANGE = [-1.5, 2.5] as const;

/**
 * 밖에서 온 설계도(AI 답, 저장 파일)를 고른다. 모르는 칸은 버리고 숫자는 범위 안으로 자른다.
 * 쓸 부품이 하나도 없으면 undefined.
 */
export function parseBlueprint(raw: unknown): Blueprint | undefined {
  const r = obj(raw);
  if (!r) return undefined;
  const parts: Part[] = [];
  for (const p of Array.isArray(r.parts) ? r.parts : []) {
    if (parts.length >= MAX_PARTS) break;
    const part = parsePart(p);
    if (part) parts.push(part);
  }
  // 얼굴을 붙일 몸이나 머리가 없으면 쓸 수 없다 (눈, 입이 허공에 뜨고 화면 맞추기가 깨진다)
  // 너무 작은 몸(반지름 0.05 아래)도 마찬가지 (눈과 입만 떠 보이고 잡을 곳이 없다)
  if (!parts.some((p) => (p.slot === 'body' || p.slot === 'head') && Math.max(...p.size) >= 0.05))
    return undefined;
  const f = obj(r.face) ?? {};
  const hasHead = parts.some((p) => p.slot === 'head');
  const face: Face = {
    slot: hasHead && (f.slot !== 'body' || !parts.some((p) => p.slot === 'body')) ? 'head' : 'body',
    eyeY: num(f.eyeY, 0, 2.5, 0.55),
    eyeGap: num(f.eyeGap, 0.02, 0.6, 0.18),
    eyeSize: num(f.eyeSize, 0.015, 0.2, 0.055),
    mouth: oneOf(MOUTHS, f.mouth) ?? 'smile',
    mouthY: num(f.mouthY, 0, 2.5, 0.45),
  };
  for (const k of ['eyeColor', 'mouthColor', 'blush', 'whiskers', 'fluff'] as const) {
    const c = color(f[k]);
    if (c) face[k] = c;
  }
  const eyes = oneOf(EYES, f.eyes);
  if (eyes && eyes !== 'round') face.eyes = eyes;
  const eyeShape = oneOf(EYE_SHAPES, f.eyeShape);
  if (eyeShape && eyeShape !== 'round') face.eyeShape = eyeShape;
  const catchlight = oneOf(CATCHLIGHTS, f.catchlight);
  if (catchlight) face.catchlight = catchlight;
  const pupil = oneOf(PUPILS, f.pupil);
  if (pupil) face.pupil = pupil;
  if (f.lashes === true) face.lashes = true;
  if (f.blushLines === true && face.blush) face.blushLines = true;
  const nose = obj(f.nose);
  const noseShape = oneOf(NOSES, nose?.shape);
  const noseColor = color(nose?.color);
  if (noseShape === 'none') face.nose = { shape: 'none' };
  else if (nose && noseShape && noseColor) {
    face.nose = { shape: noseShape, color: noseColor };
    const y = optNum(nose.y, 0, 2.5);
    if (y !== undefined) face.nose.y = y;
    const size = optNum(nose.size, 0.3, 3);
    if (size !== undefined) face.nose.size = size;
  }
  const brows = obj(f.brows);
  const browColor = color(brows?.color);
  if (brows && browColor) {
    face.brows = { color: browColor };
    const y = optNum(brows.y, 0, 2.5);
    if (y !== undefined) face.brows.y = y;
    const tilt = optNum(brows.tilt, -45, 45);
    if (tilt !== undefined) face.brows.tilt = tilt;
  }
  const bp: Blueprint = { v: r.v === 2 ? 2 : 1, parts, face };
  const motion = motionOf(r.motion);
  if (motion) bp.motion = motion;
  const gait = oneOf(GAITS, r.gait);
  if (gait) bp.gait = gait;
  const fur = furOf(r.fur);
  if (fur) bp.fur = fur;
  return bp;
}

/** 부품 하나 고르기. 슬롯, 모양, 자리, 크기, 색이 다 맞아야 쓴다 */
function parsePart(p: unknown): Part | undefined {
  const q = obj(p);
  if (!q) return undefined;
  const slot = oneOf(SLOTS, q.slot);
  const shape = oneOf(SHAPES, q.shape);
  const at = vec(q.at, AT_RANGE[0], AT_RANGE[1], 0);
  const size = vec(q.size, 0.005, 1.2, 0.1);
  const c = color(q.color);
  if (!slot || !shape || !at || !size || !c) return undefined;
  const part: Part = { slot, shape, at, size, color: c };
  const rot = vec(q.rot, -180, 180, 0);
  if (rot) part.rot = rot;
  const finish = oneOf(FINISHES, q.finish);
  if (finish) part.finish = finish;
  if (q.mirror === true) part.mirror = true;
  const inner = color(q.inner);
  if (inner && (shape === 'sphere' || shape === 'cone' || shape === 'capsule' || shape === 'box'))
    part.inner = inner;
  const taper = optNum(q.taper, 0, 1);
  if (taper !== undefined && (shape === 'cylinder' || shape === 'capsule' || shape === 'tube'))
    part.taper = taper;
  const round = optNum(q.round, 0, 1);
  if (round !== undefined && shape === 'box') part.round = round;
  if (shape === 'tube') {
    const path: Vec3[] = [];
    for (const v of Array.isArray(q.path) ? q.path : []) {
      if (path.length >= MAX_PATH) break;
      const pt = vec(v, AT_RANGE[0], AT_RANGE[1], 0);
      if (pt) path.push(pt);
    }
    // 점이 둘은 있어야 관이다. 없으면 at 에서 위로 뻗는 짧은 관으로
    part.path = path.length >= 2 ? path : [at, [at[0], at[1] + size[1] * 2, at[2]]];
  }
  const pattern = patternOf(q.pattern);
  if (pattern) part.pattern = pattern;
  return part;
}

/** 무늬 칸 검사. 종류와 색이 있어야 쓴다 */
export function patternOf(raw: unknown): Pattern | undefined {
  const r = obj(raw);
  if (!r) return undefined;
  const type = oneOf(PATTERNS, r.type);
  const c = color(r.color);
  if (!type || !c) return undefined;
  const out: Pattern = { type, color: c };
  const scale = optNum(r.scale, 0.2, 4);
  if (scale !== undefined) out.scale = scale;
  const amount = optNum(r.amount, 0, 1);
  if (amount !== undefined) out.amount = amount;
  const side = oneOf(SIDES, r.side);
  if (side) out.side = side;
  const dir = oneOf(AXES, r.dir);
  if (dir) out.dir = dir;
  return out;
}

/** 몸짓 칸은 숫자만, 범위 안으로 자른다. 쓸 칸이 없으면 undefined (기본 동작) */
function motionOf(raw: unknown): Motion | undefined {
  const r = obj(raw);
  if (!r) return undefined;
  const out: Motion = {};
  for (const k of Object.keys(MOTION_RANGE) as (keyof Motion)[]) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = MOTION_RANGE[k];
    out[k] = Math.round(clamp(v, lo, hi) * 100) / 100;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 거울 부품을 펼친다: x 와 y, z 축 회전을 뒤집고 L 슬롯은 R 로 (R 은 L 로). 관의 길도 x 를 뒤집는다 */
export function expandMirrors(parts: readonly Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const { mirror: _m, ...base } = p;
    out.push(base);
    if (!p.mirror) continue;
    out.push(mirrored(base));
  }
  return out;
}

/** 거울로 뒤집은 부품 하나 */
export function mirrored(p: Part): Part {
  const side = p.slot.at(-1);
  const slot =
    side === 'L' || side === 'R' ? (`${p.slot.slice(0, -1)}${side === 'L' ? 'R' : 'L'}` as Slot) : p.slot;
  const rot: Vec3 | undefined = p.rot ? [p.rot[0], -p.rot[1], -p.rot[2]] : undefined;
  const { mirror: _m, ...base } = p;
  const out: Part = { ...base, slot, at: [-p.at[0], p.at[1], p.at[2]], ...(rot ? { rot } : {}) };
  if (p.path) out.path = p.path.map(([x, y, z]) => [-x, y, z]);
  if (p.pattern?.side === 'left' || p.pattern?.side === 'right')
    out.pattern = { ...p.pattern, side: p.pattern.side === 'left' ? 'right' : 'left' };
  return out;
}

/**
 * 안쪽 색(inner) 부품을 펼친다: 같은 모양을 조금 작고 납작하게 앞면(부품의 +z 쪽, 돌림을 따라)에 겹친 부품을 더한다.
 * 귀 안 분홍, 발바닥. 거울 칸은 그대로 따라가서 expandMirrors 앞에 부른다
 */
export function expandInners(parts: readonly Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const { inner, ...base } = p;
    out.push(base);
    if (!inner) continue;
    const [sx, sy, sz] = p.size;
    const [rx, ry, rz] = p.rot ?? [0, 0, 0];
    const size: Vec3 = [sx * 0.62, p.shape === 'cone' ? sy * 0.78 : sy * 0.72, sz * 0.5];
    // 원뿔은 밑면을 맞춰 끝이 같은 높이로. 나머지는 가운데 그대로
    const local: Vec3 = [0, p.shape === 'cone' ? -(sy - size[1]) : 0, sz * 0.62];
    const { pattern: _pat, taper: _tap, ...rest } = base;
    out.push({
      ...rest,
      size,
      at: addVec(p.at, rotateVec(local, rx, ry, rz)),
      color: inner,
      ...(p.finish === 'fuzzy' ? { finish: 'soft' as const } : {}),
    });
  }
  return out;
}

/** 그릴 부품 목록: 안쪽 색을 펼친 뒤 거울을 펼친다 */
export function expandParts(parts: readonly Part[]): Part[] {
  return expandMirrors(expandInners(parts));
}

const DEG = Math.PI / 180;
/** three.js Euler XYZ 순서와 같은 돌림 */
export function rotateVec(v: Vec3, rx: number, ry: number, rz: number): Vec3 {
  let [x, y, z] = v;
  const ax = rx * DEG;
  const ay = ry * DEG;
  const az = rz * DEG;
  // x 축
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  // y 축
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  // z 축
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x, y, z];
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** 털 느낌 칸 검사. 0~1 밖은 자르고 숫자가 아닌 칸은 뺀다. 남은 칸이 없으면 undefined */
export function furOf(raw: unknown): Fur | undefined {
  const r = obj(raw);
  if (!r) return undefined;
  const out: Fur = {};
  for (const key of ['length', 'curl', 'clump'] as const) {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = clamp(v, 0, 1);
  }
  return Object.keys(out).length ? out : undefined;
}
