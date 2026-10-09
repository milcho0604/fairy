// 이름 옆 펫 얼굴 그리기 (shared/face.ts). 지금 모습 그대로 한 번 그려 머리 쪽을 가깝게 자른다.
// - 입체(기본 펫 3D, 사진 펫 피규어): 펫 화면과 같은 렌더러로 머리 관절에 붙은 부품(머리, 귀, 얼굴)만 그린다.
//   머리 관절이 없는 콩이, 삐약이는 몸이 곧 얼굴이라 몸과 귀, 머리 위 장식만 (팔, 날개, 다리, 꼬리는 뺀다)
// - 2.5D 판, 사진: 목(가장 좁아지는 줄)을 찾아 그 아래를 부드럽게 지운다
// - 기본 펫 2D: draw.ts 그림에서 발만 뺀 둥근 몸 (다섯 종류 모두 몸과 머리가 한 덩어리다)
// 렌더러는 새로 만들지 않고 부르는 쪽 것을 빌린다 (창마다 하나만, pet3d.ts).
// 설정 창 "모습" 카드도 같은 그림을 쓰려면 renderFace 에 그 창의 Pet3D 를 넘기면 된다.

import { FACE_PX } from '../../shared/face.ts';
import type { PetKind } from '../../shared/settings.ts';
import { CANVAS_SIZE, type DrawState, drawPet, type Model3D } from './draw.ts';

/** 오른쪽(x1), 아래(y1) 끝은 넣지 않는 상자 */
export interface FaceRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 이보다 불투명한 픽셀만 몸으로 본다 (입체 바닥 그림자는 알파 0.16 이라 빠진다) */
const SOLID = 96;

/** RGBA 픽셀에서 불투명한 부분을 감싸는 상자. 다 비었으면 undefined */
export function solidRect(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  from = 0,
  to = h,
): FaceRect | undefined {
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = Math.max(0, from); y < Math.min(h, to); y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if ((rgba[row + x * 4 + 3] ?? 0) <= SOLID) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? undefined : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** 한 줄에서 칠해진 왼쪽 끝과 오른쪽 끝 너비 (없으면 0) */
function rowWidth(rgba: ArrayLike<number>, w: number, y: number): number {
  const row = y * w * 4;
  let l = -1;
  let r = -1;
  for (let x = 0; x < w; x++) {
    if ((rgba[row + x * 4 + 3] ?? 0) <= SOLID) continue;
    if (l < 0) l = x;
    r = x;
  }
  return l < 0 ? 0 : r - l + 1;
}

/**
 * 머리 아래 끝(목) 짐작 (사진, 2.5D 판처럼 관절을 모를 때). 위에서 내려오며 지금까지 가장 넓었던 줄(머리)보다
 * 15% 넘게 좁아지는 곳을 찾아 가장 좁은 줄까지 내려가고, 그 아래가 다시 넓어지면(몸, 팔) 거기가 목이다.
 * 귀 끝처럼 맨 위 15% 안의 좁은 줄은 보지 않는다. 목이 없는데 키가 너비보다 꽤 크면 위에서 머리 너비만큼.
 * 둘 다 아니면(동그란 몸) undefined: 전체가 얼굴
 */
export function neckOf(rgba: ArrayLike<number>, w: number, body: FaceRect): number | undefined {
  const bh = body.y1 - body.y0;
  const widths: number[] = [];
  for (let y = body.y0; y < body.y1; y++) widths.push(rowWidth(rgba, w, y));
  const at = (i: number) => widths[i] ?? 0;
  let most = 0;
  for (let i = 0; i < Math.round(bh * 0.8); i++) {
    if (i >= Math.round(bh * 0.15) && at(i) < most * 0.85) {
      let j = i;
      while (j + 1 < bh && at(j + 1) <= at(j)) j++;
      let below = 0;
      for (let k = j + 1; k < bh; k++) below = Math.max(below, at(k));
      if (below > at(j) * 1.05) return body.y0 + j;
    }
    most = Math.max(most, at(i));
  }
  const bw = body.x1 - body.x0;
  if (bh > bw * 1.15) return body.y0 + Math.round(Math.min(bh, Math.max(most * 1.1, bh * 0.5)));
  return undefined;
}

/** 목 아래를 부드럽게 지운다: cut - fade 부터 cut + fade 까지 알파를 1 에서 0 으로, 그 아래는 0 */
export function fadeBelow(rgba: Uint8ClampedArray, w: number, h: number, cut: number, fade: number): void {
  for (let y = Math.max(0, Math.floor(cut - fade)); y < h; y++) {
    const k = Math.max(0, Math.min(1, (cut + fade - y) / (2 * fade)));
    // 부드러운 곡선 (smoothstep) 이라 경계 줄이 보이지 않는다
    const m = k * k * (3 - 2 * k);
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4 + 3;
      rgba[i] = Math.round((rgba[i] ?? 0) * m);
    }
  }
}

/**
 * 상자를 가운데에 두는 정사각형. pad 는 한 변에 더하는 여백 비율 (한쪽마다).
 * 위는 적어도 topPad 만큼 띄운다 (귀 끝이 얇고 옅어 상자에 덜 잡혀도 잘리지 않게. 모자라면 아래(턱 밑)를 더 자른다)
 */
export function squareAround(r: FaceRect, pad: number, topPad = 0): { x: number; y: number; side: number } {
  const side = Math.max(r.x1 - r.x0, r.y1 - r.y0) * (1 + pad * 2);
  const y = Math.min((r.y0 + r.y1) / 2 - side / 2, r.y0 - side * topPad);
  return { x: (r.x0 + r.x1) / 2 - side / 2, y, side };
}

/** 옅은 검정 픽셀(입체 바닥 그림자)을 지운다. 지운 것이 있으면 true */
export function dropShadow(rgba: Uint8ClampedArray): boolean {
  let hit = false;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] ?? 0;
    if (a === 0 || a > 60) continue;
    if ((rgba[i] ?? 0) < 24 && (rgba[i + 1] ?? 0) < 24 && (rgba[i + 2] ?? 0) < 24) {
      rgba[i + 3] = 0;
      hit = true;
    }
  }
  return hit;
}

/** 머리만 그릴 수 있는 입체 (pet3d.ts Pet3D) */
interface HeadAware {
  drawHead?(ctx: CanvasRenderingContext2D, s: DrawState): number | undefined;
  maxPx?: number;
}

export interface FaceSource {
  kind: PetKind;
  /** 사진 펫 그림 (배경 지운 것). 입체로 그릴 때는 주지 않는다 */
  photo?: CanvasImageSource & { width: number; height: number };
  /** 입체 (설계도나 2.5D 판을 넣어 둔 것) */
  model3d?: Model3D & HeadAware;
  /** 2.5D 판(사진 + 깊이)이면 true. 관절이 없어 사진처럼 목을 찾는다 */
  relief?: boolean;
}

/** 기본 펫과 입체는 160 캔버스를 이만큼 키워 그린 다음 자른다 (머리가 잘린 크기에서도 선명하게) */
const SCALE = 4;
/** 사진은 원본을 이 크기 안으로 줄여 놓고 자른다 */
const PHOTO_MAX = 768;

/**
 * 지금 모습의 얼굴 그림 (PNG data URL). 그릴 수 없으면 undefined.
 * 머리(귀 포함)만 담는다: 입체는 머리 관절에 붙은 부품만 그려 머리 실루엣 그대로(목, 몸, 팔은 아예 안 그린다),
 * 사진과 2.5D 판은 목을 찾아 그 아래를 부드럽게 지운다. 어두운 바탕에서도 흰 몸이 따라 나오지 않는다
 */
export function renderFace(
  src: FaceSource,
  px = FACE_PX,
  mood: 'idle' | 'sleeping' = 'idle',
): string | undefined {
  const work = document.createElement('canvas');
  const g = work.getContext('2d', { willReadFrequently: true });
  if (!g) return undefined;
  const m = src.model3d;
  if (src.photo && !m) {
    const k = Math.min(1, PHOTO_MAX / Math.max(src.photo.width, src.photo.height));
    work.width = Math.max(1, Math.round(src.photo.width * k));
    work.height = Math.max(1, Math.round(src.photo.height * k));
    g.drawImage(src.photo, 0, 0, work.width, work.height);
  } else {
    work.width = CANVAS_SIZE * SCALE;
    work.height = CANVAS_SIZE * SCALE;
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    const idle: DrawState = {
      mood,
      elapsed: 0,
      blink: -1,
      viewSize: CANVAS_SIZE * SCALE,
      kind: src.kind,
      face: true,
    };
    // 잘라서 크게 보이니 이번 한 번은 렌더러 해상도 상한을 올린다 (다음 펫 그리기에서 제 크기로 돌아간다)
    const keep = m?.maxPx;
    if (m && keep !== undefined) m.maxPx = Math.max(keep, CANVAS_SIZE * SCALE * 2);
    const drawn = m?.drawHead?.(g, idle);
    if (m && keep !== undefined) m.maxPx = keep;
    // 입체를 못 그렸으면(머리만 그리기가 없거나 실패) 펫 화면과 같은 그림으로
    if (drawn === undefined) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, work.width, work.height);
      g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawPet(g, { ...idle, model3d: m });
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  const data = g.getImageData(0, 0, work.width, work.height);
  const pixels = data.data;
  // 입체 바닥 그림자(검정, 알파 0.16)는 얼굴 그림에 남기지 않는다
  let dirty = dropShadow(pixels);
  let body = solidRect(pixels, work.width, work.height);
  if (!body) return undefined;
  // 머리 관절을 모르는 그림(사진, 2.5D 판)만 목을 찾는다. 기본 펫 2D(발 뺀 몸)와 입체 머리는 그린 것이 곧 얼굴
  const neck = src.photo || src.relief ? neckOf(pixels, work.width, body) : undefined;
  if (neck !== undefined) {
    // 목 줄에서 이미 다 투명하게: 경계 띠를 목 위(턱 밑)에 둔다. 목 줄에 두면 목 한 토막이 반투명하게 남았다
    const fade = Math.max(2, (neck - body.y0) * 0.05);
    fadeBelow(pixels, work.width, work.height, neck - fade, fade);
    dirty = true;
    body = solidRect(pixels, work.width, work.height) ?? body;
  }
  if (dirty) g.putImageData(data, 0, 0);
  const sq = squareAround(body, 0.06, 0.06);
  const out = document.createElement('canvas');
  out.width = px;
  out.height = px;
  const o = out.getContext('2d');
  if (!o) return undefined;
  o.imageSmoothingQuality = 'high';
  o.drawImage(work, sq.x, sq.y, sq.side, sq.side, 0, 0, px, px);
  return out.toDataURL('image/png');
}

/** 집 안 그림 (집에서 쉬기): 깬 몸 전체 그림 한 변(px). 집 문간(가장 큰 집에서 약 50px)을 레티나 2배보다 넉넉히 */
export const BODY_PX = 128;

/**
 * 지금 모습의 몸 전체 그림 (문으로 걸어 들어가고 나오는 펫, shared/house-room.ts).
 * 펫 화면과 같은 그림(깬 눈, 발 포함, 바닥 그림자 뺌)을 몸에 맞게 정사각형으로 자르고,
 * 자른 자리(캔버스 한 변에 대한 비율)를 같이 준다. 펫 창이 그 그림과 같은 자리로 맞춰 넘겨주고 넘겨받는다
 */
export function renderBody(
  src: FaceSource,
  px = BODY_PX,
): { url: string; box: { x: number; y: number; side: number } } | undefined {
  const work = document.createElement('canvas');
  const g = work.getContext('2d', { willReadFrequently: true });
  if (!g) return undefined;
  const full = CANVAS_SIZE * SCALE;
  work.width = full;
  work.height = full;
  g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const m = src.model3d;
  const keep = m?.maxPx;
  if (m && keep !== undefined) m.maxPx = Math.max(keep, full);
  drawPet(g, {
    mood: 'idle',
    elapsed: 0,
    blink: -1,
    viewSize: full,
    kind: src.kind,
    photo: m ? undefined : src.photo,
    model3d: m,
  });
  if (m && keep !== undefined) m.maxPx = keep;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const data = g.getImageData(0, 0, full, full);
  if (dropShadow(data.data)) g.putImageData(data, 0, 0);
  const body = solidRect(data.data, full, full);
  if (!body) return undefined;
  const sq = squareAround(body, 0.04);
  const out = document.createElement('canvas');
  out.width = px;
  out.height = px;
  const o = out.getContext('2d');
  if (!o) return undefined;
  o.imageSmoothingQuality = 'high';
  o.drawImage(work, sq.x, sq.y, sq.side, sq.side, 0, 0, px, px);
  return { url: out.toDataURL('image/png'), box: { x: sq.x / full, y: sq.y / full, side: sq.side / full } };
}
