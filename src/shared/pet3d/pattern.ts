// 무늬 (설계도 v2 Pattern). 점박이, 줄무늬, 두 색 나누기를 부품 겉에 얹는다.
// 같은 식을 JS(복슬복슬 녹인 몸의 정점 색)와 GLSL(피규어, 게임, 실사 재질)에서 쓴다. 둘이 같은 자리에 같은 무늬를 내야 해서
// 난수는 sin 이 아니라 정수 곱 해시로 (GPU 마다 sin 정밀도가 달라 자리가 어긋난다).
// 좌표: 모양 공간(geometry 좌표, 구는 -1~1). half 는 모양 상자의 반 크기, scale 은 부품 배율(mesh.scale)
import type { Pattern, Vec3 } from './blueprint.ts';

/** 점박이 한 칸 크기 (세상 단위, scale 1) */
const CELL = 0.09;
/** 줄무늬 한 주기 (세상 단위, scale 1) */
const BAND = 0.11;
/** 두 색 나누기 경계의 흐림 (부품 크기 비율). 인형의 솔기처럼 또렷하게 */
const SPLIT_EDGE = 0.035;
/** 가르마(notch) 세모 너비 배율과 앞쪽으로 들어오는 폭 (모양 공간) */
const NOTCH_WIDTH = 0.5;
const NOTCH_FRONT = 0.35;
/**
 * 가르마 세모 꼭짓점 높이 (모양 공간, 1 이 꼭대기). 꼭대기(1)까지 가면 좁은 세모 끝이 정수리를 넘어 뒤로 이어져
 * 3/4 와 옆에서 머리 위를 가르는 흰 띠로 보였다. 이마 위에서 끝나게 한다 (아래쪽 너비는 예전과 같다)
 */
const NOTCH_APEX = 0.65;
/** 높이 n 에서 세모 반너비 = notch × NOTCH_SLOPE × (꼭짓점 - n). 머리 가운데 높이(n = 0)에서 예전 너비 (notch × 0.5) */
const NOTCH_SLOPE = NOTCH_WIDTH / NOTCH_APEX;

/** 정수 셋의 해시 0~1 (GLSL jjHash 와 같은 값) */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h, 0x9e3779b1);
  h ^= h >>> 15;
  return (h & 0xffff) / 65535;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 모양 공간 한 점이 무늬 색으로 덮이는 정도 0~1.
 * p 는 모양 좌표, half 는 모양 상자 반 크기, scale 은 부품 배율
 */
export function patternMask(pat: Pattern, p: Vec3, half: Vec3, scale: Vec3): number {
  const m = rawMask(pat, p, half, scale);
  // 점박이와 줄무늬에 side 를 적으면 그쪽 반(조금 넘게)에만 (얼굴은 깨끗하고 등과 머리 위에만 줄무늬)
  return pat.type !== 'split' && pat.side ? m * sideMask(pat.side, SIDE_COVER, p, half) : m;
}

/** 점박이, 줄무늬를 side 쪽에 남길 비율 */
const SIDE_COVER = 0.6;

/** side 쪽에서 amount 만큼 1 (경계는 조금 흐리게) */
function sideMask(side: NonNullable<Pattern['side']>, amount: number, p: Vec3, half: Vec3): number {
  const n =
    side === 'top'
      ? p[1] / half[1]
      : side === 'bottom'
        ? -p[1] / half[1]
        : side === 'front'
          ? p[2] / half[2]
          : side === 'back'
            ? -p[2] / half[2]
            : side === 'right'
              ? p[0] / half[0]
              : -p[0] / half[0];
  const s = (n + 1) / 2;
  const th = 1 - amount;
  return smooth(th - SPLIT_EDGE, th + SPLIT_EDGE, s);
}

function rawMask(pat: Pattern, p: Vec3, half: Vec3, scale: Vec3): number {
  const amount = pat.amount ?? 0.5;
  const k = pat.scale ?? 1;
  // 세상 단위 자리 (부품이 커도 점 크기가 같게)
  const wx = p[0] * scale[0];
  const wy = p[1] * scale[1];
  const wz = p[2] * scale[2];
  if (pat.type === 'spots') {
    const cell = CELL * k;
    const qx = wx / cell;
    const qy = wy / cell;
    const qz = wz / cell;
    const cx = Math.floor(qx);
    const cy = Math.floor(qy);
    const cz = Math.floor(qz);
    let d = 9;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const ix = cx + a + 512;
          const iy = cy + b + 512;
          const iz = cz + c + 512;
          // 칸마다 점 하나, 70% 칸에만 (amount 가 작으면 더 드물게)
          if (hash3(ix, iy, iz) > 0.3 + 0.5 * amount) continue;
          const px = cx + a + hash3(ix + 7, iy, iz);
          const py = cy + b + hash3(ix, iy + 7, iz);
          const pz = cz + c + hash3(ix, iy, iz + 7);
          d = Math.min(d, Math.hypot(qx - px, qy - py, qz - pz));
        }
    const r = 0.22 + 0.4 * amount;
    return 1 - smooth(r - 0.08, r + 0.08, d);
  }
  if (pat.type === 'stripes') {
    const dir = pat.dir ?? 'z';
    const along = dir === 'x' ? wx : dir === 'y' ? wy : wz;
    const across = dir === 'x' ? wy : dir === 'y' ? wz : wy;
    const v = along / (BAND * k) + 0.18 * Math.sin((across / (BAND * k)) * 2.1);
    const f = Math.abs(v - Math.floor(v) - 0.5) * 2;
    return 1 - smooth(amount - 0.12, amount + 0.12, f);
  }
  // split: side 쪽에서 amount 만큼. 가르마가 있으면 앞 가운데를 세모로 비운다
  const m = sideMask(pat.side ?? 'bottom', amount, p, half);
  return pat.notch ? m * (1 - notchMask(pat, p, half)) : m;
}

/**
 * 가르마(Pattern.notch): split 이 top 이면 이마 가운데에서 위로 뾰족해지는 세모(ㅅ 모양, 꼭짓점은 이마 위 NOTCH_APEX)를, bottom 이면 아래로 뾰족한 세모를
 * 바탕색으로 비운다. 앞(+z) 쪽에만 (뒤통수는 그대로)
 */
function notchMask(pat: Pattern, p: Vec3, half: Vec3): number {
  const notch = pat.notch ?? 0;
  if (notch <= 0 || (pat.side !== 'top' && pat.side !== 'bottom')) return 0;
  const n = pat.side === 'top' ? p[1] / half[1] : -p[1] / half[1];
  const v = Math.abs(p[0] / half[0]) - notch * NOTCH_SLOPE * (NOTCH_APEX - n);
  return (1 - smooth(-SPLIT_EDGE, SPLIT_EDGE, v)) * smooth(0, NOTCH_FRONT, p[2] / half[2]);
}

/** 무늬 종류 번호 (셰이더 uniform) */
export const PATTERN_ID: Record<Pattern['type'], number> = { spots: 0, stripes: 1, split: 2 };
export const SIDE_ID: Record<NonNullable<Pattern['side']>, number> = {
  top: 0,
  bottom: 1,
  front: 2,
  back: 3,
  right: 4,
  left: 5,
};
export const AXIS_ID: Record<NonNullable<Pattern['dir']>, number> = { x: 0, y: 1, z: 2 };

/** 셰이더 uniform 값 (patternMask 와 같은 뜻) */
export function patternUniforms(pat: Pattern, half: Vec3, scale: Vec3) {
  return {
    uPatType: { value: PATTERN_ID[pat.type] },
    uPatAmount: { value: pat.amount ?? 0.5 },
    uPatScale: { value: pat.scale ?? 1 },
    // 점박이, 줄무늬는 side 가 없으면 -1 (온몸)
    uPatSide: { value: pat.side ? SIDE_ID[pat.side] : pat.type === 'split' ? SIDE_ID.bottom : -1 },
    uPatDir: { value: AXIS_ID[pat.dir ?? 'z'] },
    uPatNotch: {
      value: pat.type === 'split' && (pat.side === 'top' || pat.side === 'bottom') ? (pat.notch ?? 0) : 0,
    },
    uPatHalf: { value: half },
    uPatPartScale: { value: scale },
  };
}

/** 조각 셰이더 함수 jjPattern(vec3 p) (patternMask 와 같은 식). GLSL ES 3.00 (WebGL2) 정수 연산을 쓴다 */
export const PATTERN_GLSL = `
uniform int uPatType;
uniform float uPatAmount;
uniform float uPatScale;
uniform int uPatSide;
uniform int uPatDir;
uniform vec3 uPatHalf;
uniform vec3 uPatPartScale;
uniform float uPatNotch;
float jjHash(int x, int y, int z) {
  uint h = uint(x) * 73856093u ^ uint(y) * 19349663u ^ uint(z) * 83492791u;
  h = h * 0x9e3779b1u;
  h ^= h >> 15u;
  return float(h & 0xffffu) / 65535.0;
}
float jjSide(vec3 p, float amount) {
  float n = uPatSide == 0 ? p.y / uPatHalf.y : (uPatSide == 1 ? -p.y / uPatHalf.y : (uPatSide == 2 ? p.z / uPatHalf.z
    : (uPatSide == 3 ? -p.z / uPatHalf.z : (uPatSide == 4 ? p.x / uPatHalf.x : -p.x / uPatHalf.x))));
  float s = (n + 1.0) / 2.0;
  float th = 1.0 - amount;
  return smoothstep(th - ${SPLIT_EDGE}, th + ${SPLIT_EDGE}, s);
}
float jjRaw(vec3 p) {
  vec3 w = p * uPatPartScale;
  if (uPatType == 0) {
    float cell = ${CELL} * uPatScale;
    vec3 q = w / cell;
    ivec3 c = ivec3(floor(q));
    float d = 9.0;
    for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int e = -1; e <= 1; e++) {
      int ix = c.x + a + 512; int iy = c.y + b + 512; int iz = c.z + e + 512;
      if (jjHash(ix, iy, iz) > 0.3 + 0.5 * uPatAmount) continue;
      vec3 f = vec3(c + ivec3(a, b, e)) + vec3(jjHash(ix + 7, iy, iz), jjHash(ix, iy + 7, iz), jjHash(ix, iy, iz + 7));
      d = min(d, distance(q, f));
    }
    float r = 0.22 + 0.4 * uPatAmount;
    return 1.0 - smoothstep(r - 0.08, r + 0.08, d);
  }
  if (uPatType == 1) {
    float along = uPatDir == 0 ? w.x : (uPatDir == 1 ? w.y : w.z);
    float across = uPatDir == 0 ? w.y : (uPatDir == 1 ? w.z : w.y);
    float band = ${BAND} * uPatScale;
    float v = along / band + 0.18 * sin(across / band * 2.1);
    float f = abs(fract(v) - 0.5) * 2.0;
    return 1.0 - smoothstep(uPatAmount - 0.12, uPatAmount + 0.12, f);
  }
  float m = jjSide(p, uPatAmount);
  if (uPatNotch <= 0.0) return m;
  float n = uPatSide == 0 ? p.y / uPatHalf.y : -p.y / uPatHalf.y;
  float v = abs(p.x / uPatHalf.x) - uPatNotch * ${NOTCH_SLOPE.toFixed(6)} * (${NOTCH_APEX} - n);
  return m * (1.0 - (1.0 - smoothstep(-${SPLIT_EDGE}, ${SPLIT_EDGE}, v)) * smoothstep(0.0, ${NOTCH_FRONT}, p.z / uPatHalf.z));
}
float jjPattern(vec3 p) {
  float m = jjRaw(p);
  return uPatType != 2 && uPatSide >= 0 ? m * jjSide(p, ${SIDE_COVER}) : m;
}
`;
