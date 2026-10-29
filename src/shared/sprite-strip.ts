// 2D 그림 세트 만들기의 순수 계산 (2026-10-15, #89). 화면(만들기 창)과 시험이 같이 쓴다. Buffer, 캔버스 없이 RGBA 바이트만 다룬다.
//
// 흐름: 기준 그림(지금 페어리 그림을 단색 배경 위에 놓은 것) 하나를 그림 Space 에 넣고, 동작마다 한 번 "같은 캐릭터로
// 네 칸짜리 가로 띠" 를 그리게 한다. 받은 띠는 여기서
//   1. 배경색 재기 (요청한 색이 아니라 띠 가장자리에서 실제로 칠해진 색)
//   2. 크로마키로 배경 지우기 (테두리에 섞인 배경색은 빼고, 완전 투명 화소는 색까지 0)
//   3. 떨어진 작은 점 지우기
//   4. 칸 자르기 (빈 세로줄로 나누고, 안 되면 똑같이 나눈다)
//   5. 자동 검사 (빈 칸, 잘림, 배경색 남음, 칸끼리 크기 튐, 칸 수)
// 를 하고, 모든 동작이 끝나면 assembleSprites 가 한 배율, 한 바닥선으로 같은 크기 캔버스에 놓는다.
// 칸이 네 개보다 많은 동작(서기 8칸, 걷기 8칸)은 호출을 늘리지 않고 한 번에 줄 수만 늘린다: 한 줄 네 칸 x 두 줄 시트(1024x512)를
// 한 번 받아 줄마다 위 흐름으로 처리한다 (SpriteRow.lines. 무료 횟수는 호출 수로 세므로 동작 5개 = 호출 5번 그대로).
// 방식은 OpenAI hatch-pet 스킬(기준 그림 하나, 동작마다 가로 띠, 크로마키, 자동 검사, 실패한 줄만 다시)을 참고했고 코드는 따로 썼다

import { markCorner } from './gemini.ts';
import type { SpriteName } from './pet-sprites.ts';

/** RGBA 바이트 그림 (ImageData 와 같은 모양이라 화면에서 그대로 넣는다) */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

/** 동작 하나 = 그림 Space 한 번 = 가로 띠 한 장 */
export interface SpriteRow {
  id: SpriteRowId;
  /** 띠 왼쪽부터 칸마다 들어갈 자세 이름 */
  names: readonly SpriteName[];
  /** 칸마다 그릴 모습 (영어 요청문 조각, 순서는 names 와 같다) */
  frames: readonly string[];
  /** 옆모습인지 (걷기). 요청문에서 방향을 못 박는다 */
  side?: boolean;
  /** 한 번에 받는 그림의 줄 수 (한 줄 SHEET_COLS 칸). 없으면 1 */
  lines?: number;
}

/** 한 줄 칸 수 (칸 하나가 256 정사각형) */
export const SHEET_COLS = 4;
export const linesOf = (row: SpriteRow): number => row.lines ?? 1;

export type SpriteRowId = 'stand' | 'walk' | 'rest' | 'feel' | 'talk';

/**
 * 만들 동작 순서. 무료 횟수(토큰 없이 하루 3번쯤)가 먼저 끝나도 쓸모 있게 서기, 걷기가 먼저다.
 * 서기와 걷기 두 줄이면 서기, 깜빡임, 두리번, 걷기 네 장이 생기고 나머지 자세는 pet-sprites.ts fillSprites 가 가까운 그림으로 채운다
 */
export const SPRITE_ROWS: readonly SpriteRow[] = [
  {
    id: 'stand',
    lines: 2,
    names: ['idle', 'blink', 'look-l', 'look-r', 'look-u', 'look-d', 'look-ul', 'look-ur'],
    frames: [
      'standing, facing the viewer, eyes open',
      'the same standing pose with both eyes closed (blink)',
      'the same standing pose, head and eyes turned to the left side of the image',
      'the same standing pose, head and eyes turned to the right side of the image',
      'the same standing pose, head and eyes tilted up, looking at the sky',
      'the same standing pose, head and eyes tilted down, looking at the ground',
      'the same standing pose, head and eyes turned up and to the left side of the image',
      'the same standing pose, head and eyes turned up and to the right side of the image',
    ],
  },
  {
    id: 'walk',
    lines: 2,
    names: ['walk-0', 'walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6', 'walk-7'],
    side: true,
    frames: [
      'walking, side view facing right, front leg reaching forward, back leg pushing off behind',
      'walking, side view facing right, front leg landing, body slightly lower',
      'walking, side view facing right, legs passing under the body, body slightly raised',
      'walking, side view facing right, other front leg lifting forward',
      'walking, side view facing right, other front leg reaching forward, other back leg pushing off behind',
      'walking, side view facing right, other front leg landing, body slightly lower',
      'walking, side view facing right, legs passing under the body again, body slightly raised',
      'walking, side view facing right, first front leg lifting forward again',
    ],
  },
  {
    id: 'rest',
    names: ['sit', 'doze', 'sleep', 'yawn'],
    frames: [
      'sitting, facing the viewer',
      'sitting with drowsy half-closed eyes',
      'lying down curled up asleep, eyes closed',
      'sitting and yawning with the mouth wide open',
    ],
  },
  {
    id: 'feel',
    names: ['happy', 'hungry', 'sulky', 'wave'],
    frames: [
      'jumping with joy, big smile',
      'hungry, droopy sad eyes, looking up',
      'sulking, pouting and looking away',
      'waving one paw at the viewer',
    ],
  },
  {
    id: 'talk',
    names: ['talk-0', 'talk-1', 'grab', 'back'],
    frames: [
      'facing the viewer, talking with the mouth closed',
      'facing the viewer, talking with the mouth open',
      'being lifted up, legs dangling in the air',
      'seen from behind, facing away from the viewer',
    ],
  },
];

export const rowOf = (id: SpriteRowId): SpriteRow | undefined => SPRITE_ROWS.find((r) => r.id === id);
export const isRowId = (v: unknown): v is SpriteRowId => SPRITE_ROWS.some((r) => r.id === v);

/** 띠 한 장 크기. klein 은 한 변 1024 까지, 16 의 배수라 네 칸이면 칸 하나가 256 정사각형 */
export const STRIP_W = 1024;
export const STRIP_H = 256;
/** 동작 하나로 받는 그림 크기 (줄 수만큼 높아진다. 한 변 1024 안이면 klein 이 그린다) */
export const sheetSize = (row: SpriteRow): { w: number; h: number } => ({
  w: STRIP_W,
  h: STRIP_H * linesOf(row),
});
/** 다 만든 그림 한 장 크기. 펫 캔버스(160)의 두 배라 레티나에서도 또렷하고, 스물여덟 장이 6MB 상한 안에 든다 */
export const SPRITE_SIDE = 320;
/** 캔버스 아래 여백 (바닥선 = SPRITE_SIDE - FOOT_PAD) */
export const FOOT_PAD = 8;

/** 배경으로 고를 수 있는 색: 초록, 자홍, 파랑. 캐릭터 색에서 가장 먼 것을 쓴다 */
export const KEY_COLORS: readonly Rgb[] = [
  [0, 255, 0],
  [255, 0, 255],
  [0, 0, 255],
];

export const keyHex = (k: Rgb): string =>
  `#${k
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

/** 두 색 거리 (0~1, RGB 공간 대각선으로 나눈다) */
export function colorDist(r: number, g: number, b: number, k: Rgb): number {
  const dr = r - k[0];
  const dg = g - k[1];
  const db = b - k[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.673;
}

/**
 * 기준 그림(투명 배경 PNG)에 가장 덜 쓰인 배경색. 불투명한 화소마다 가장 가까운 후보와의 거리를 재고,
 * 너무 가까운(0.35 안) 화소가 가장 적은 색을 고른다 (초록 눈 고양이도 초록을 피한다)
 */
export function pickKeyColor(img: Rgba): Rgb {
  const near = KEY_COLORS.map(() => 0);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) < 128) continue;
    KEY_COLORS.forEach((k, j) => {
      if (colorDist(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, k) < 0.35) near[j] = (near[j] ?? 0) + 1;
    });
  }
  let best = 0;
  for (let j = 1; j < near.length; j++) if ((near[j] ?? 0) < (near[best] ?? 0)) best = j;
  return KEY_COLORS[best] ?? KEY_COLORS[0] ?? [0, 255, 0];
}

/**
 * 띠에 실제로 칠해진 배경색: 네 가장자리 화소의 채널별 가운뎃값. 그림 Space 는 요청한 #00FF00 대신
 * 조금 다른 초록(#16E21A 같은)을 칠하는 일이 많아 요청한 색으로 지우면 배경이 남는다.
 * 가장자리 가운뎃값이 요청한 색에서 너무 멀면(0.45 넘게) 배경을 단색으로 안 칠한 것이라 undefined
 */
export function measureKey(img: Rgba, asked: Rgb): Rgb | undefined {
  const { width: w, height: h, data: d } = img;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(d[i] ?? 0);
    gs.push(d[i + 1] ?? 0);
    bs.push(d[i + 2] ?? 0);
  };
  for (let x = 0; x < w; x += 2) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += 2) {
    take(0, y);
    take(w - 1, y);
  }
  const mid = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] ?? 0;
  const k: Rgb = [mid(rs), mid(gs), mid(bs)];
  return colorDist(k[0], k[1], k[2], asked) <= 0.45 ? k : undefined;
}

/** 배경으로 보는 거리 (이 안이면 완전 투명) */
export const KEY_INNER = 0.14;
/** 배경 가까운 테두리에서 이 밖이면 완전 불투명. 사이는 섞인 테두리 (주황과 초록 반반이 0.3 쯤이라 넉넉히) */
export const KEY_OUTER = 0.45;
/** 배경과 안 이어진 물든 틈으로 보는 너비 (양쪽으로 이만큼 안에 캐릭터 색). 1024 띠에서 겹친 다리 틈이 3~4 화소였다 */
const THIN_GAP = 3;

/**
 * 크로마키: 배경색 key 와의 거리로 알파를 정한다. inner 안은 배경(완전 투명). 배경에서 이어진 섞인 화소(거리 outer 안인 화소를
 * 배경부터 8방향으로 따라간 것)는 거리에 따라 반투명으로 하고 배경색을 덜어낸 색으로 되돌린다 (C = aF + (1-a)K 를 F 에 대해
 * 푼다. 덜어내지 않으면 테두리에 초록 띠가 남는다). 다리 사이처럼 좁은 틈은 순수한 배경 화소가 없어도 이렇게 닿는다.
 * 배경과 이어지지 않은 안쪽은 배경색과 비슷해도 불투명 (초록 눈은 그대로, 너무 비슷하면 검사 key 가 잡는다).
 * 원래 알파가 있으면(투명 PNG 로 받은 띠) 더 작은 쪽. 완전 투명 화소는 색도 0 으로 (숨은 색이 남지 않게)
 */
export function chromaKey(img: Rgba, key: Rgb, inner = KEY_INNER, outer = KEY_OUTER): Rgba {
  const { width: w, height: h, data: src } = img;
  const dist = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++)
    dist[p] = colorDist(src[p * 4] ?? 0, src[p * 4 + 1] ?? 0, src[p * 4 + 2] ?? 0, key);
  // 0 안쪽, 1 배경, 2 배경에서 이어진 섞인 화소
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let p = 0; p < w * h; p++)
    if ((dist[p] ?? 1) <= inner) {
      bg[p] = 1;
      stack.push(p);
    }
  while (stack.length) {
    const q = stack.pop() ?? 0;
    const qx = q % w;
    const qy = (q - qx) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx;
        const ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (bg[r] || (dist[r] ?? 1) >= outer) continue;
        bg[r] = 2;
        stack.push(r);
      }
  }
  // 배경과 안 이어졌어도 배경색 쪽으로 물든 화소(겹친 두 다리 사이 한 줄 틈)도 섞인 화소로 본다:
  // 거리 outer 안이고 배경색의 센 채널이 나머지보다 크다. 배경색은 캐릭터에 없는 색으로 고르므로(pickKeyColor) 캐릭터 무늬는 드물다
  const strong = [0, 1, 2].filter((c) => (key[c] ?? 0) >= 128);
  const weak = [0, 1, 2].filter((c) => (key[c] ?? 0) < 128);
  // 가는 틈(양쪽 THIN_GAP 화소 안에 캐릭터 색이 있는 것)만. 넓게 물든 곳은 불투명으로 두어 검사 key 가 잡게 한다
  const tinted: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (bg[p] || (dist[p] ?? 1) >= outer || weak.length === 0) continue;
    const top = Math.max(...weak.map((c) => src[p * 4 + c] ?? 0));
    if (strong.every((c) => (src[p * 4 + c] ?? 0) > top)) tinted.push(p);
  }
  const isTinted = new Uint8Array(w * h);
  for (const p of tinted) isTinted[p] = 1;
  const thin = tinted.filter((p) => {
    // 가로나 세로로 양쪽 THIN_GAP 화소 안에 캐릭터 색이 있어야 틈이다 (한쪽만이면 넓은 물든 곳의 가장자리)
    const x = p % w;
    const side = (dx: number, dy: number) => {
      for (let k = 1; k <= THIN_GAP; k++) {
        const nx = x + dx * k;
        const ny = (p - x) / w + dy * k;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return false;
        const q = ny * w + nx;
        if (bg[q] === 0 && !isTinted[q]) return true;
      }
      return false;
    };
    return (side(-1, 0) && side(1, 0)) || (side(0, -1) && side(0, 1));
  });
  for (const p of thin) bg[p] = 2;
  /** 섞인 화소 가까이(3화소 안)의 섞이지 않은 캐릭터 색. 없으면 undefined */
  const solidNear = (p: number): number | undefined => {
    const x = p % w;
    const y = (p - x) / w;
    for (let r = 1; r <= 3; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx] === 0) return ny * w + nx;
        }
    return undefined;
  };
  const out = new Uint8ClampedArray(src.length);
  for (let p = 0; p < w * h; p++) {
    if (bg[p] === 1) continue; // 0 그대로 (색도 0)
    const i = p * 4;
    const r = src[i] ?? 0;
    const g = src[i + 1] ?? 0;
    const b = src[i + 2] ?? 0;
    let a = 1;
    if (bg[p] === 2) {
      // 알파 = 배경색에서 가까운 캐릭터 색 쪽으로 얼마나 왔는지 (C - K 를 F - K 에 투영). 거리만 쓰면 밝은 털 테두리가 덜 지워졌다
      const f = solidNear(p);
      if (f !== undefined) {
        const fr = (src[f * 4] ?? 0) - key[0];
        const fg = (src[f * 4 + 1] ?? 0) - key[1];
        const fb = (src[f * 4 + 2] ?? 0) - key[2];
        const len = fr * fr + fg * fg + fb * fb;
        a = len > 0 ? ((r - key[0]) * fr + (g - key[1]) * fg + (b - key[2]) * fb) / len : 0;
      } else a = ((dist[p] ?? 1) - inner) / (outer - inner);
      a = Math.max(0, Math.min(1, a));
    }
    a = Math.min(a, (src[i + 3] ?? 255) / 255);
    if (a <= 0) continue;
    if (a < 1) {
      out[i] = (r - (1 - a) * key[0]) / a;
      out[i + 1] = (g - (1 - a) * key[1]) / a;
      out[i + 2] = (b - (1 - a) * key[2]) / a;
    } else {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
    out[i + 3] = Math.round(a * 255);
  }
  despill(out, w, h, key);
  return { width: w, height: h, data: out };
}

/**
 * 투명하거나 반투명한 곳 바로 옆 화소의 배경색 번짐을 뺀다. 배경색이 가장 센 채널(초록이면 G)이 나머지 채널 최댓값보다
 * 크면 그만큼 깎는다 (흔한 초록 스필 제거). 안쪽 화소는 건드리지 않는다 (초록 눈, 자홍 리본은 그대로)
 */
function despill(d: Uint8ClampedArray, w: number, h: number, key: Rgb) {
  const strong = [0, 1, 2].filter((c) => (key[c] ?? 0) >= 128);
  const weak = [0, 1, 2].filter((c) => (key[c] ?? 0) < 128);
  if (strong.length === 0 || weak.length === 0) return;
  const edge = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true;
        if ((d[(ny * w + nx) * 4 + 3] ?? 0) < 255) return true;
      }
    return false;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((d[i + 3] ?? 0) === 0 || !edge(x, y)) continue;
      const cap = Math.max(...weak.map((c) => d[i + c] ?? 0));
      for (const c of strong) if ((d[i + c] ?? 0) > cap) d[i + c] = cap;
    }
}

/** 불투명한 상자 (bottom, right 는 마지막 칸 다음). 알파 min 이상만 본다. 다 투명하면 undefined */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function opaqueBox(img: Rgba, min = 24): Box | undefined {
  const { width: w, height: h, data: d } = img;
  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if ((d[(y * w + x) * 4 + 3] ?? 0) < min) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  return right < 0 ? undefined : { left, top, right: right + 1, bottom: bottom + 1 };
}

/**
 * 떨어진 작은 덩어리(먼지, 별, 땀방울)를 지운다. 8방향으로 이어진 덩어리 가운데 가장 큰 것의 frac 보다 작은 것을 투명하게.
 * 큰 덩어리가 여럿이면(칸마다 캐릭터 하나) 모두 남는다
 */
export function dropSpecks(img: Rgba, frac = 0.02): Rgba {
  const { width: w, height: h } = img;
  const d = new Uint8ClampedArray(img.data);
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (label[p] !== -1 || (d[p * 4 + 3] ?? 0) === 0) continue;
    const id = sizes.length;
    let n = 0;
    label[p] = id;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop() ?? 0;
      n++;
      const qx = q % w;
      const qy = (q - qx) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const r = ny * w + nx;
          if (label[r] !== -1 || (d[r * 4 + 3] ?? 0) === 0) continue;
          label[r] = id;
          stack.push(r);
        }
    }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  for (let p = 0; p < w * h; p++) {
    const id = label[p] ?? -1;
    if (id >= 0 && (sizes[id] ?? 0) < big * frac) d.fill(0, p * 4, p * 4 + 4);
  }
  return { width: w, height: h, data: d };
}

/** 그림의 한 부분을 잘라 낸다 */
export function crop(img: Rgba, x0: number, y0: number, w: number, h: number): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= img.width) continue;
      const s = (sy * img.width + sx) * 4;
      out.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

/** 세로줄마다 불투명한 화소 수 */
function columnCounts(img: Rgba, min = 24): number[] {
  const cols = new Array<number>(img.width).fill(0);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if ((img.data[(y * img.width + x) * 4 + 3] ?? 0) >= min) cols[x] = (cols[x] ?? 0) + 1;
  return cols;
}

/**
 * 칸 경계 (n+1 개, 첫 값 0, 끝 값 width). 캐릭터 사이 빈 세로줄 구간을 찾아 가운데를 경계로 삼는다.
 * 빈 구간이 모자라면(캐릭터끼리 붙음) 똑같이 나눈다: 붙은 칸은 검사(clipped)가 잡는다.
 * 빈 구간이 남으면 똑같이 나눈 경계에 가장 가까운 것을 고른다
 */
export function cellEdges(img: Rgba, n: number): { edges: number[]; even: boolean } {
  const w = img.width;
  const even = Array.from({ length: n + 1 }, (_, i) => Math.round((w * i) / n));
  const cols = columnCounts(img);
  // 안쪽 빈 구간 (양 끝 여백은 빼고)
  const first = cols.findIndex((c) => c > 0);
  if (first < 0) return { edges: even, even: true };
  let last = w - 1;
  while (last > 0 && (cols[last] ?? 0) === 0) last--;
  const gaps: number[] = [];
  for (let x = first; x <= last; ) {
    if ((cols[x] ?? 0) > 0) {
      x++;
      continue;
    }
    const start = x;
    while (x <= last && (cols[x] ?? 0) === 0) x++;
    gaps.push(Math.round((start + x - 1) / 2));
  }
  if (gaps.length < n - 1) return { edges: even, even: true };
  // 똑같이 나눈 경계마다 가장 가까운 빈 구간 (칸 너비의 1/3 안). 하나라도 없으면 똑같이
  const cell = w / n;
  const picked: number[] = [];
  for (let i = 1; i < n; i++) {
    const want = even[i] ?? 0;
    let best: number | undefined;
    for (const g of gaps)
      if (
        !picked.includes(g) &&
        Math.abs(g - want) < cell / 3 &&
        (best === undefined || Math.abs(g - want) < Math.abs(best - want))
      )
        best = g;
    if (best === undefined) return { edges: even, even: true };
    picked.push(best);
  }
  picked.sort((a, b) => a - b);
  return { edges: [0, ...picked, w], even: false };
}

/** 칸 하나의 검사 결과. 하나라도 있으면 그 동작은 실패 */
export type FrameIssue = 'empty' | 'clipped' | 'key' | 'jump' | 'count';

export interface StripFrame {
  name: SpriteName;
  /** 배경 지운 칸 그림 (띠 높이 그대로) */
  img: Rgba;
  /** 칸 안 불투명 상자 */
  box?: Box;
  issues: FrameIssue[];
}

export interface StripResult {
  frames: StripFrame[];
  /** 동작 전체 문제 (칸마다 문제를 합친 것, 겹치지 않게) */
  issues: FrameIssue[];
  /** 실제로 지운 배경색 */
  key: Rgb;
}

/** 칸 넓이에 대한 불투명 화소 비율이 이보다 작으면 빈 칸 */
export const EMPTY_FRAC = 0.01;
/** 불투명 화소 가운데 배경색과 가까운(KEY_NEAR 안) 화소 비율이 이보다 크면 배경색이 남았다 */
export const KEY_LEFT_FRAC = 0.01;
/** 한 동작 안 칸끼리 키(높이) 비가 이보다 크면 크기가 튄다 */
export const JUMP_RATIO = 1.3;
/** 배경색이 남았다고 보는 거리 */
export const KEY_NEAR = 0.3;

/** 불투명 화소 수와 배경색에 가까운 불투명 화소 수 */
function keyStats(img: Rgba, key: Rgb): { opaque: number; keyish: number } {
  let opaque = 0;
  let keyish = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) < 128) continue;
    opaque++;
    if (colorDist(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, key) < KEY_NEAR) keyish++;
  }
  return { opaque, keyish };
}

/**
 * 받은 띠 한 장을 칸 그림들로. asked 는 요청한 배경색. 칸마다 검사하고 동작 전체 문제를 모은다.
 * 배경색을 못 재면(단색 배경이 아님) 모든 칸이 key 실패
 */
export function processStrip(strip: Rgba, row: SpriteRow, asked: Rgb): StripResult {
  const lines = linesOf(row);
  if (lines === 1) return processLine(strip, row, asked, true);
  // 여러 줄 시트: 같은 높이로 줄을 나눠 한 줄씩 위와 같이 처리한다(칸 수는 줄마다 SHEET_COLS). 크기 튐은 줄 안에서 따로 재고,
  // 줄끼리는 첫 줄을 기준으로 둘째 줄부터 견준다 (가운뎃값을 시트 전체로 재면 둘째 줄이 크거나 작을 때 멀쩡한 첫 줄이 튄 것으로 걸렸다)
  const bandH = Math.floor(strip.height / lines);
  const parts: StripResult[] = [];
  for (let l = 0; l < lines; l++) {
    const at = l * SHEET_COLS;
    const sub: SpriteRow = {
      id: row.id,
      names: row.names.slice(at, at + SHEET_COLS),
      frames: row.frames.slice(at, at + SHEET_COLS),
      ...(row.side ? { side: true } : {}),
    };
    parts.push(processLine(crop(strip, 0, l * bandH, strip.width, bandH), sub, asked, true));
  }
  const base = medianHeight(parts[0]?.frames ?? []);
  for (const p of parts.slice(1)) {
    const mine = medianHeight(p.frames);
    if (base > 0 && mine > 0 && Math.max(base, mine) / Math.min(base, mine) > JUMP_RATIO)
      for (const f of p.frames) if (f.box && !f.issues.includes('jump')) f.issues.push('jump');
  }
  const frames = parts.flatMap((p) => p.frames);
  const issues = [...new Set(frames.flatMap((f) => f.issues))];
  return { frames, issues, key: parts[0]?.key ?? asked };
}

/** 칸끼리 키(높이) 비교 (빈 칸은 빼고). 가운뎃값에서 JUMP_RATIO 넘게 벗어난 칸에 jump */
function markJumps(frames: StripFrame[]) {
  const heights = frames
    .filter((f) => f.box && !f.issues.includes('empty'))
    .map((f) => (f.box?.bottom ?? 0) - (f.box?.top ?? 0));
  if (heights.length > 1 && Math.max(...heights) / Math.max(1, Math.min(...heights)) > JUMP_RATIO) {
    const mid = [...heights].sort((a, b) => a - b)[heights.length >> 1] ?? 0;
    for (const f of frames) {
      const h = (f.box?.bottom ?? 0) - (f.box?.top ?? 0);
      if (f.box && Math.max(h, mid) / Math.max(1, Math.min(h, mid)) > JUMP_RATIO) f.issues.push('jump');
    }
  }
}

/** 칸들 키(높이)의 가운뎃값 (빈 칸은 빼고). 없으면 0 */
function medianHeight(frames: StripFrame[]): number {
  const hs = frames
    .filter((f) => f.box && !f.issues.includes('empty'))
    .map((f) => (f.box?.bottom ?? 0) - (f.box?.top ?? 0))
    .sort((a, b) => a - b);
  return hs[hs.length >> 1] ?? 0;
}

/** 한 줄 띠 처리 */
function processLine(strip: Rgba, row: SpriteRow, asked: Rgb, jumps = true): StripResult {
  const n = row.names.length;
  const key = measureKey(strip, asked);
  const keyed = dropSpecks(chromaKey(strip, key ?? asked));
  const { edges, even } = cellEdges(keyed, n);
  const frames: StripFrame[] = row.names.map((name, i) => {
    const x0 = edges[i] ?? 0;
    const x1 = edges[i + 1] ?? keyed.width;
    const img = crop(keyed, x0, 0, x1 - x0, keyed.height);
    const box = opaqueBox(img);
    const issues: FrameIssue[] = [];
    const { opaque, keyish } = keyStats(img, key ?? asked);
    if (!box || opaque < img.width * img.height * EMPTY_FRAC) issues.push('empty');
    else {
      // 띠 가장자리(위, 아래, 맨 왼쪽, 맨 오른쪽)나 똑같이 나눈 칸 경계에 닿으면 잘린 것 (빈 구간 경계는 닿을 수 없다)
      const touch =
        box.top === 0 ||
        box.bottom === img.height ||
        (box.left === 0 && (i === 0 || even)) ||
        (box.right === img.width && (i === n - 1 || even));
      if (touch) issues.push('clipped');
    }
    if (!key || (opaque > 0 && keyish / opaque > KEY_LEFT_FRAC)) issues.push('key');
    return { name, img, ...(box ? { box } : {}), issues };
  });
  // 칸끼리 키 비교 (빈 칸은 빼고)
  if (jumps) markJumps(frames);
  // 캐릭터 덩어리 수가 칸 수보다 적으면(그림을 덜 그림) 똑같이 나눈 칸 하나가 비어 empty 로 잡힌다. 많으면 even 경계라 clipped
  if (even && frames.every((f) => f.issues.length === 0) && countBlobs(keyed) !== n)
    for (const f of frames) f.issues.push('count');
  const issues = [...new Set(frames.flatMap((f) => f.issues))];
  return { frames, issues, key: key ?? asked };
}

/** 세로 빈 줄로 나뉜 덩어리 수 (칸 수 확인용) */
function countBlobs(img: Rgba): number {
  const cols = columnCounts(img);
  let n = 0;
  let inBlob = false;
  for (const c of cols) {
    if (c > 0 && !inBlob) n++;
    inBlob = c > 0;
  }
  return n;
}

/** 이중선형으로 크기 바꾸기 (알파를 곱한 채로 섞어 투명한 곳 색이 테두리로 번지지 않게) */
export function resize(img: Rgba, w: number, h: number): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  const s = img.data;
  const at = (x: number, y: number) =>
    (Math.min(img.height - 1, Math.max(0, y)) * img.width + Math.min(img.width - 1, Math.max(0, x))) * 4;
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const ps = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
      const ws = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 4; k++) {
        const p = ps[k] ?? 0;
        const wa = (ws[k] ?? 0) * (s[p + 3] ?? 0);
        a += wa;
        r += wa * (s[p] ?? 0);
        g += wa * (s[p + 1] ?? 0);
        b += wa * (s[p + 2] ?? 0);
      }
      const o = (y * w + x) * 4;
      if (a < 0.5) continue;
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = a;
    }
  }
  return { width: w, height: h, data: out };
}

/** 그림을 다른 그림 위 (x, y) 에 놓는다 (덮어쓰기, 놓을 그림이 투명한 곳은 건너뛴다) */
function paste(dst: Rgba, src: Rgba, x0: number, y0: number) {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      if ((src.data[s + 3] ?? 0) === 0) continue;
      dst.data.set(src.data.subarray(s, s + 4), (dy * dst.width + dx) * 4);
    }
  }
}

/**
 * 칸 그림들을 같은 크기(side) 캔버스에 놓는다. 배율은 모든 칸에 하나: 가장 큰 칸 상자가 캔버스 안(너비 92%, 키 바닥선 위 90%)에
 * 들도록. 그래서 동작끼리 크기가 Space 가 그린 그대로 이어진다 (칸마다 따로 맞추면 앉기가 서기만큼 커진다).
 * 칸마다 상자 아래를 바닥선(side - FOOT_PAD)에, 상자 가운데를 캔버스 가운데에 둔다
 */
export function assembleSprites(
  frames: readonly { name: SpriteName; img: Rgba }[],
  side = SPRITE_SIDE,
): { name: SpriteName; img: Rgba }[] {
  const boxed = frames.map((f) => ({ ...f, box: opaqueBox(f.img, 1) })).filter((f) => f.box);
  const maxW = Math.max(1, ...boxed.map((f) => (f.box?.right ?? 0) - (f.box?.left ?? 0)));
  const maxH = Math.max(1, ...boxed.map((f) => (f.box?.bottom ?? 0) - (f.box?.top ?? 0)));
  const ground = side - FOOT_PAD;
  const scale = Math.min((side * 0.92) / maxW, (ground * 0.9) / maxH);
  return boxed.map(({ name, img, box }) => {
    const b = box as Box;
    const part = crop(img, b.left, b.top, b.right - b.left, b.bottom - b.top);
    const w = Math.max(1, Math.round(part.width * scale));
    const h = Math.max(1, Math.round(part.height * scale));
    const small = resize(part, w, h);
    const out: Rgba = { width: side, height: side, data: new Uint8ClampedArray(side * side * 4) };
    paste(out, small, Math.round((side - w) / 2), ground - h);
    return { name, img: out };
  });
}

/** 띠 요청문 (영어: 그림 모델이 영어를 가장 잘 따른다). 모습 고정, 칸 배치, 배경색, 금지할 것 */
export function stripPrompt(row: SpriteRow, key: Rgb): string {
  const n = row.names.length;
  const lines = linesOf(row);
  const listFrames = (from: number, to: number) =>
    row.frames
      .slice(from, to)
      .map((f, i) => `${from + i + 1}) ${f}`)
      .join('; ');
  const layout =
    lines === 1
      ? `A sprite strip: one horizontal row of exactly ${n} separate full-body drawings of the SAME character from the reference image, ` +
        `evenly spaced left to right in ${n} equal square slots, each drawing centered in its slot with empty space around it, ` +
        `nothing touching the edges or the other drawings. Frames: ${listFrames(0, n)}. `
      : `A sprite sheet: a grid of exactly ${lines} horizontal rows with exactly ${SHEET_COLS} columns, ${n} separate full-body drawings of the SAME character from the reference image in equal square slots, ` +
        'read left to right, top to bottom, each drawing centered in its slot with empty space around it, ' +
        `nothing touching the edges, the slot borders or the other drawings. ${Array.from({ length: lines }, (_, l) => `Row ${l + 1}: ${listFrames(l * SHEET_COLS, (l + 1) * SHEET_COLS)}.`).join(' ')} `;
  return (
    layout +
    'Keep the identity locked to the reference: same face, eye color, markings, fur and colors, proportions and art style; ' +
    'do not add clothes or props. All drawings the same size. ' +
    `Background: one flat solid pure ${keyHex(key)} color everywhere, no gradient, no floor, no shadow, ` +
    `no text, no frames or borders, no motion lines, no sparkles. Do not use the color ${keyHex(key)} on the character.`
  );
}

/**
 * Gemini 앱에 붙여 넣을 띠 요청문 (2026-10-15). 띠 요청문 앞에 "그림을 만들어" 를 둬야 Gemini 가 글로만 답하지 않고,
 * 기준 그림은 사용자가 올리므로 "붙인 그림" 이라고 부른다. Gemini 는 4:1 을 잘 안 지켜 받은 그림은 fitStrip 이 맞춘다
 */
export function geminiStripPrompt(row: SpriteRow, key: Rgb): string {
  return (
    'Generate an image. The attached picture is the reference character. ' +
    stripPrompt(row, key) +
    (linesOf(row) === 1
      ? ' Make the whole image one wide banner, about 4 times wider than tall (for example 2048x512), ' +
        `with the ${row.names.length} drawings side by side in a single row.`
      : ` Make the whole image one wide sheet, about ${4 / linesOf(row)} times wider than tall (for example 2048x${512 * linesOf(row)}), ` +
        `with the ${row.names.length} drawings in ${linesOf(row)} rows of ${SHEET_COLS}.`)
  );
}

/** 받은 그림이 띠로 쓸 수 없는 까닭: key 배경이 단색 배경색이 아님, shape 한 줄로 놓이지 않음(너무 좁음), empty 캐릭터가 없음 */
export type FitWhy = 'key' | 'shape' | 'empty';
/** 캐릭터들이 차지한 상자의 가로세로 비가 이보다 작으면 한 줄이 아니다 (2x2 로 그렸거나 한 장만) */
export const FIT_MIN_RATIO = 2;
/** 상자 둘레 여백 (상자 키에 대한 몫). 그림 끝에 닿은 쪽은 여백 없이 닿은 채로 둬서 processStrip 이 잘림을 잡는다 */
const FIT_MARGIN = 0.08;
/** 캐릭터로 볼 배경색과의 거리, 세로줄과 가로줄에 이만큼 있어야 상자에 넣는다 (JPEG 잡티를 넘긴다) */
const FIT_NEAR = 0.3;
const FIT_MIN_PX = 3;

/** 가장자리 화소 가운데 거의 투명한 몫 (투명 PNG 로 받았는지) */
function clearEdgeFrac(img: Rgba): number {
  const { width: w, height: h, data: d } = img;
  let clear = 0;
  let all = 0;
  const take = (x: number, y: number) => {
    all++;
    if ((d[(y * w + x) * 4 + 3] ?? 255) < 16) clear++;
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    take(0, y);
    take(w - 1, y);
  }
  return all ? clear / all : 0;
}

/**
 * 크기나 비율이 다른 그림(Gemini 앱에서 받은 그림)을 1024x256 띠(여러 줄 시트면 줄 수만큼 높은 1024x512 등)로 맞춘다. 순서:
 *   1. 투명 PNG 면 요청한 배경색 위에 놓는다 (가장자리 절반 넘게 투명할 때). Gemini 반짝이 표시는 덮는다
 *   2. 가장자리로 배경색을 잰다 (measureKey). 단색이 아니면 key
 *   3. 배경색과 먼 화소가 든 상자를 찾는다. 없으면 empty, 상자가 2:1 보다 좁으면 shape
 *   4. 상자에 여백을 두고 자른 뒤, 모자란 쪽(4:1 보다 좁으면 좌우, 넓으면 위아래)을 배경색으로 채워 4:1 로 만들고 1024x256 으로 줄인다.
 *      그림 끝에 닿은 캐릭터는 그 쪽 여백 없이 닿은 채로 둔다
 * 그 뒤 자르기, 배경 지우기, 검사는 processStrip 이 서버 띠와 똑같이 한다
 */
export function fitStrip(
  img: Rgba,
  asked: Rgb,
  lines = 1,
): { ok: true; img: Rgba } | { ok: false; why: FitWhy } {
  const sheetH = STRIP_H * lines;
  const src =
    clearEdgeFrac(img) > 0.5 ? onKey(img, asked) : { ...img, data: new Uint8ClampedArray(img.data) };
  // Gemini 무료 그림의 오른쪽 아래 반짝이 표시는 둘레 바탕색으로 덮는다 (남기면 상자가 구석까지 늘어난다)
  const mark = markCorner(src.data, src.width, src.height);
  if (mark)
    for (let y = mark.y; y < mark.y + mark.height; y++)
      for (let x = mark.x; x < mark.x + mark.width; x++)
        src.data.set([...mark.color, 255], (y * src.width + x) * 4);
  const key = measureKey(src, asked);
  if (!key) return { ok: false, why: 'key' };
  const { width: w, height: h, data: d } = src;
  const cols = new Array<number>(w).fill(0);
  const rows = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (colorDist(d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, key) > FIT_NEAR) {
        cols[x] = (cols[x] ?? 0) + 1;
        rows[y] = (rows[y] ?? 0) + 1;
      }
    }
  const first = (a: number[]) => a.findIndex((v) => v >= FIT_MIN_PX);
  const last = (a: number[]) => a.length - 1 - [...a].reverse().findIndex((v) => v >= FIT_MIN_PX);
  const left = first(cols);
  const top = first(rows);
  if (left < 0 || top < 0) return { ok: false, why: 'empty' };
  const right = last(cols) + 1;
  const bottom = last(rows) + 1;
  const bw = right - left;
  const bh = bottom - top;
  if (bw / Math.max(1, bh) < FIT_MIN_RATIO / lines) return { ok: false, why: 'shape' };
  const m = Math.round(bh * FIT_MARGIN);
  const x0 = Math.max(0, left - m);
  const y0 = Math.max(0, top - m);
  const part = crop(src, x0, y0, Math.min(w, right + m) - x0, Math.min(h, bottom + m) - y0);
  const cw = part.width;
  const ch = part.height;
  const W = cw / ch < STRIP_W / sheetH ? Math.round((ch * STRIP_W) / sheetH) : cw;
  const H = cw / ch < STRIP_W / sheetH ? ch : Math.round((cw * sheetH) / STRIP_W);
  const canvas: Rgba = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let i = 0; i < canvas.data.length; i += 4) {
    canvas.data[i] = key[0];
    canvas.data[i + 1] = key[1];
    canvas.data[i + 2] = key[2];
    canvas.data[i + 3] = 255;
  }
  // 그림 끝에 닿은 쪽은 채우지 않고 닿은 채로 (그 쪽이 잘린 그림이면 processStrip 이 clipped 로 잡게)
  const place = (room: number, startTouch: boolean, endTouch: boolean) =>
    startTouch && !endTouch ? 0 : endTouch && !startTouch ? room : Math.round(room / 2);
  paste(canvas, part, place(W - cw, left === 0, right === w), place(H - ch, top === 0, bottom === h));
  return { ok: true, img: resize(canvas, STRIP_W, sheetH) };
}

/** 기준 그림을 배경색 위에 놓는다 (Space 에 넣을 그림. 투명 PNG 를 넣으면 배경을 제멋대로 칠했다) */
export function onKey(img: Rgba, key: Rgb): Rgba {
  const d = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = (img.data[i + 3] ?? 0) / 255;
    d[i] = (img.data[i] ?? 0) * a + key[0] * (1 - a);
    d[i + 1] = (img.data[i + 1] ?? 0) * a + key[1] * (1 - a);
    d[i + 2] = (img.data[i + 2] ?? 0) * a + key[2] * (1 - a);
    d[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: d };
}

/**
 * 이 실패면 남은 동작을 시도하지 않고 멈춘다: 무료 횟수 끝(quota, 이유 없는 거절 refused), 토큰 문제(auth, limit),
 * 그만두기(cancelled). 다른 실패(바쁨, 시간 초과, 이상한 답)는 그 동작만 실패로 두고 다음 동작으로 간다
 */
export const STOP_KINDS: readonly string[] = ['quota', 'refused', 'auth', 'limit', 'cancelled', 'reopen'];
/**
 * 내 컴퓨터에서 그릴 때 멈추는 실패 (local-draw-core.ts LocalDrawErrorKind): 준비가 깨짐(notReady, unsupported),
 * 다른 그리기가 도는 중(busy), 빈 공간, 메모리, 배터리, 그만두기. 다음 동작도 똑같이 막힌다.
 * 시간 초과, 이상한 그림(bad), 그 밖의 실패(failed)는 그 동작만 실패로 두고 다음으로 간다.
 * 서버의 busy(붐빔)는 다음으로 가지만 내 컴퓨터의 busy 는 멈춘다: 같은 이름이라 엔진으로 가른다
 */
export const LOCAL_STOP_KINDS: readonly string[] = [
  'notReady',
  'unsupported',
  'busy',
  'disk',
  'memory',
  'battery',
  'cancelled',
  'reopen',
];
export const stopsQueue = (kind: string, engine: 'cloud' | 'local' = 'cloud'): boolean =>
  (engine === 'local' ? LOCAL_STOP_KINDS : STOP_KINDS).includes(kind);
/** 서버 무료 횟수가 끝난 실패 (남은 동작을 내 컴퓨터나 Gemini 로 이어 가자고 권한다) */
export const isQuotaKind = (kind: string): boolean => kind === 'quota' || kind === 'refused';

/**
 * 여러 줄 시트(서기, 걷기)가 검사에 걸렸을 때 쓸 수 있는 줄만 건진다. 무료 횟수는 호출 수로 세어서 일부 줄이 틀렸다고 호출을 버리면
 * 아깝다. 건지는 규칙: 첫 줄(서기면 서기, 깜빡임, 옆 시선 / 걷기면 walk-0~3, 네 장 한 주기)이 온전해야 하고,
 * 문제 없는 줄만 남긴다 (문제 있는 줄은 이름이 겹치지 않게 통째로 뺀다). 첫 줄이 틀렸거나 모두 온전하면(건질 것 없음) undefined.
 * 크기 튐(jump)은 줄 안에서 따로, 줄끼리는 첫 줄 기준으로 재므로 첫 줄은 둘째 줄이 크든 작든 멀쩡하면 건진다
 */
export function salvageSheet(
  result: StripResult,
  row: SpriteRow,
): { frames: StripFrame[]; dropped: number } | undefined {
  const lines = linesOf(row);
  if (lines < 2 || result.issues.length === 0) return undefined;
  const bands = Array.from({ length: lines }, (_, l) =>
    result.frames.slice(l * SHEET_COLS, (l + 1) * SHEET_COLS),
  );
  const good = bands.map((b) => b.length > 0 && b.every((f) => f.issues.length === 0));
  if (!good[0] || good.every(Boolean)) return undefined;
  const frames = bands.filter((_, l) => good[l]).flat();
  return { frames, dropped: result.frames.length - frames.length };
}

/** 동작 하나의 상태 (창이 보이는 것) */
export type RowState =
  | { s: 'wait' }
  | { s: 'run' }
  | { s: 'ok'; frames: StripFrame[] /** 줄 일부만 쓴 경우 뺀 칸 수 (salvageSheet) */; dropped?: number }
  | { s: 'bad'; issues: FrameIssue[] }
  | { s: 'fail'; error: string };

/** 다음에 만들 동작들: 아직 안 된 것(ok 가 아닌 것)을 SPRITE_ROWS 순서로 */
export function rowsToMake(states: Partial<Record<SpriteRowId, RowState>>): SpriteRowId[] {
  return SPRITE_ROWS.map((r) => r.id).filter((id) => states[id]?.s !== 'ok');
}

/**
 * 된 동작의 칸들로 그림 세트 칸 목록. 서기 줄이 안 됐으면 서기(idle)는 지금 페어리 그림(투명 PNG)을 쓴다:
 * 받은 칸 가운데 가장 큰 키에 맞춰 줄여 넣어 assembleSprites 의 한 배율에서 크기가 튀지 않게
 */
export function setFrames(
  states: Partial<Record<SpriteRowId, RowState>>,
  own: Rgba | undefined,
): { name: SpriteName; img: Rgba }[] {
  const frames = SPRITE_ROWS.flatMap((r) => {
    const st = states[r.id];
    return st?.s === 'ok' ? st.frames.map((f) => ({ name: f.name, img: f.img })) : [];
  });
  if (frames.length === 0 || frames.some((f) => f.name === 'idle') || !own) return frames;
  const box = opaqueBox(own);
  if (!box) return frames;
  const tall = Math.max(
    1,
    ...frames.map((f) => {
      const b = opaqueBox(f.img);
      return b ? b.bottom - b.top : 0;
    }),
  );
  const part = crop(own, box.left, box.top, box.right - box.left, box.bottom - box.top);
  const k = tall / part.height;
  return [
    {
      name: 'idle',
      img: resize(part, Math.max(1, Math.round(part.width * k)), Math.max(1, Math.round(part.height * k))),
    },
    ...frames,
  ];
}
