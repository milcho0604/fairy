// 입체 펫 설계도 (6단계). 기본 펫도, AI 가 사진을 보고 만든 펫도 같은 모양으로 적고 앱이 three.js 로 조립한다.
// 좌표: 바닥이 y=0, 펫 키는 1 안팎, 앞(보는 사람 쪽)이 +z, 오른쪽이 +x. 각도는 도(°).

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

export const SHAPES = ['sphere', 'capsule', 'cone', 'cylinder', 'box', 'torus'] as const;
export type Shape = (typeof SHAPES)[number];

/** 겉 느낌: soft 말랑한 비닐, shiny 반짝, fuzzy 털 */
export const FINISHES = ['soft', 'shiny', 'fuzzy'] as const;
export type Finish = (typeof FINISHES)[number];

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
}

export const MOUTHS = ['smile', 'cat', 'beak'] as const;
export type MouthStyle = (typeof MOUTHS)[number];

/**
 * 쉬는 눈 모양 (요청사항으로 표정 고르기). round 동그란 눈(없을 때와 같다), happy 웃는 눈(^^),
 * sleepy 반쯤 감은 졸린 눈, sparkle 반짝이가 큰 눈. 신남, 잠 같은 상태 표정은 그대로 바뀐다
 */
export const EYES = ['round', 'happy', 'sleepy', 'sparkle'] as const;
export type EyeLook = (typeof EYES)[number];

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
}

export interface Blueprint {
  v: 1;
  parts: Part[];
  face: Face;
  /** 몸짓 세기. 없으면 기본 동작 그대로 */
  motion?: Motion;
}

export const MAX_PARTS = 40;

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d;
const vec = (v: unknown, lo: number, hi: number, d: number): Vec3 | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [num(v[0], lo, hi, d), num(v[1], lo, hi, d), num(v[2], lo, hi, d)]
    : undefined;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;
const color = (v: unknown): string | undefined =>
  typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined;

/**
 * 밖에서 온 설계도(AI 답, 저장 파일)를 고른다. 모르는 칸은 버리고 숫자는 범위 안으로 자른다.
 * 쓸 부품이 하나도 없으면 undefined.
 */
export function parseBlueprint(raw: unknown): Blueprint | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const parts: Part[] = [];
  for (const p of Array.isArray(r.parts) ? r.parts : []) {
    if (parts.length >= MAX_PARTS) break;
    if (typeof p !== 'object' || p === null) continue;
    const q = p as Record<string, unknown>;
    const slot = oneOf(SLOTS, q.slot);
    const shape = oneOf(SHAPES, q.shape);
    const at = vec(q.at, -1.5, 2.5, 0);
    const size = vec(q.size, 0.005, 1.2, 0.1);
    const c = color(q.color);
    if (!slot || !shape || !at || !size || !c) continue;
    const part: Part = { slot, shape, at, size, color: c };
    const rot = vec(q.rot, -180, 180, 0);
    if (rot) part.rot = rot;
    const finish = oneOf(FINISHES, q.finish);
    if (finish) part.finish = finish;
    if (q.mirror === true) part.mirror = true;
    parts.push(part);
  }
  // 얼굴을 붙일 몸이나 머리가 없으면 쓸 수 없다 (눈, 입이 허공에 뜨고 화면 맞추기가 깨진다)
  // 너무 작은 몸(반지름 0.05 아래)도 마찬가지 (눈과 입만 떠 보이고 잡을 곳이 없다)
  if (!parts.some((p) => (p.slot === 'body' || p.slot === 'head') && Math.max(...p.size) >= 0.05))
    return undefined;
  const f = (typeof r.face === 'object' && r.face !== null ? r.face : {}) as Record<string, unknown>;
  const hasHead = parts.some((p) => p.slot === 'head');
  const face: Face = {
    slot: hasHead && (f.slot !== 'body' || !parts.some((p) => p.slot === 'body')) ? 'head' : 'body',
    eyeY: num(f.eyeY, 0, 2.5, 0.55),
    eyeGap: num(f.eyeGap, 0.02, 0.6, 0.18),
    eyeSize: num(f.eyeSize, 0.015, 0.2, 0.055),
    mouth: oneOf(MOUTHS, f.mouth) ?? 'smile',
    mouthY: num(f.mouthY, 0, 2.5, 0.45),
  };
  for (const k of ['eyeColor', 'mouthColor', 'blush', 'whiskers'] as const) {
    const c = color(f[k]);
    if (c) face[k] = c;
  }
  const eyes = oneOf(EYES, f.eyes);
  if (eyes && eyes !== 'round') face.eyes = eyes;
  const bp: Blueprint = { v: 1, parts, face };
  const motion = motionOf(r.motion);
  if (motion) bp.motion = motion;
  return bp;
}

/** 몸짓 칸은 숫자만, 범위 안으로 자른다. 쓸 칸이 없으면 undefined (기본 동작) */
function motionOf(raw: unknown): Motion | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Motion = {};
  for (const k of Object.keys(MOTION_RANGE) as (keyof Motion)[]) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = MOTION_RANGE[k];
    out[k] = Math.round(clamp(v, lo, hi) * 100) / 100;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 거울 부품을 펼친다: x 와 y, z 축 회전을 뒤집고 L 슬롯은 R 로 (R 은 L 로) */
export function expandMirrors(parts: readonly Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const { mirror: _m, ...base } = p;
    out.push(base);
    if (!p.mirror) continue;
    const side = p.slot.at(-1);
    const slot =
      side === 'L' || side === 'R' ? (`${p.slot.slice(0, -1)}${side === 'L' ? 'R' : 'L'}` as Slot) : p.slot;
    const rot: Vec3 | undefined = p.rot ? [p.rot[0], -p.rot[1], -p.rot[2]] : undefined;
    out.push({ ...base, slot, at: [-p.at[0], p.at[1], p.at[2]], ...(rot ? { rot } : {}) });
  }
  return out;
}
