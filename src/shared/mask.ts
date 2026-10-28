// 사진 펫 만들기(P1-08)의 마스크 계산. 화면 없이 시험할 수 있게 배열만 다룬다.
// 마스크는 한 칸에 0~255 (0 = 지움, 255 = 남김).

/**
 * 모델 출력의 가장 큰 값이 이보다 작으면 펫을 못 찾은 것 (모델은 0~1 을 낸다. 흰 벽만 찍은 사진은 0.02 쯤).
 * 그대로 펴면 벽 한 조각이 "펫"으로 남았다
 */
export const MIN_MASK_PEAK = 0.2;

/** 모델 출력(정사각 size x size)을 최소 최대로 펴서 0~255 마스크로. rembg 와 같은 후처리. 못 찾았으면 다 0 */
export function outputToMask(out: ArrayLike<number>, sigmoid = false): Uint8ClampedArray {
  const n = out.length;
  const v = new Float32Array(n);
  let mi = Number.POSITIVE_INFINITY;
  let ma = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const x = sigmoid ? 1 / (1 + Math.exp(-(out[i] ?? 0))) : (out[i] ?? 0);
    v[i] = x;
    if (x < mi) mi = x;
    if (x > ma) ma = x;
  }
  const span = ma - mi || 1;
  const m = new Uint8ClampedArray(n);
  if (!sigmoid && ma < MIN_MASK_PEAK) return m;
  for (let i = 0; i < n; i++) m[i] = (((v[i] ?? 0) - mi) / span) * 255;
  return m;
}

/**
 * 붓질 한 번: (cx, cy) 를 중심으로 반지름 r 안을 value(0 지우개, 255 복원)로 칠한다.
 * 가장자리 1/4 은 부드럽게 섞어 칼로 자른 듯한 선이 안 생기게 한다.
 */
export function brush(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  value: number,
) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const soft = Math.max(1, r * 0.25);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const k = d < r - soft ? 1 : (r - d) / soft; // 0~1, 가운데는 1
      const i = y * w + x;
      const cur = mask[i] ?? 0;
      mask[i] = cur + (value - cur) * k;
    }
  }
}

/** 두 점 사이를 붓으로 이어 칠한다 (마우스가 빨리 움직여도 끊기지 않게). */
export function stroke(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  r: number,
  value: number,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, r / 3)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    brush(mask, w, h, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, r, value);
  }
}

/** 남긴 부분을 감싸는 사각형. 둘레에 pad 비율만큼 여유. 아무것도 없으면 undefined. */
export function contentBox(mask: ArrayLike<number>, w: number, h: number, threshold = 16, pad = 0.04) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((mask[y * w + x] ?? 0) <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return undefined;
  const p = Math.round(Math.max(x1 - x0, y1 - y0) * pad);
  const x = Math.max(0, x0 - p);
  const y = Math.max(0, y0 - p);
  return { x, y, width: Math.min(w, x1 + 1 + p) - x, height: Math.min(h, y1 + 1 + p) - y };
}

/** 남긴 넓이 비율 (0~1). 거의 다 지웠거나 하나도 안 지웠으면 다시 보게 한다. */
export function keptRatio(mask: ArrayLike<number>, threshold = 128): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if ((mask[i] ?? 0) > threshold) n++;
  return mask.length ? n / mask.length : 0;
}

/**
 * 가장자리 바탕색 빼기 (털 끝 흰 테두리 없애기). 반쯤 남긴 칸의 색에는 뒤 바탕색이 섞여 있어서, 어두운 곳에 놓으면
 * 밝은 테두리가 보였다 (AI 일러스트의 밝은 바탕, 2026-10-09). 그 자리 바탕색 B 와 몸색 F 로 색 C = a*F + (1-a)*B 를
 * 풀어 F 를 구한다. 털 가닥(반투명)은 그대로 두고 색만 고친다. rgba 를 바로 고치고, 고친 알파(마스크)를 돌려준다.
 * B 와 F 는 가까운 칸부터 본다 (둘레 2칸에 지운 칸이 있으면 그 평균, 없으면 넓혀 r 칸까지). 넓은 네모 평균을 쓰면 여러 색
 * 바탕(나무결, 그러데이션, 어지러운 방)에서 엉뚱한 바탕색을 빼 가장자리 1~2칸에 다른 색이 번졌다 (2026-10-10).
 * 마스크는 진짜 알파가 아니다 (모델의 흐린 경계, 붓 가장자리): 이미 털색인 칸을 그대로 풀면 a 로 나누며 검게 됐다.
 * 그래서 고친 색은 원래 색 C 와 둘레 몸색 사이(조금 여유)로만 둔다. 둘레에 몸이 없으면 손대지 않는다.
 * 알파: 바탕과 몸 색이 뚜렷이 다른데(밝은 벽 앞 어두운 펫) 칸 색이 바탕에 더 가까우면 그만큼 알파를 낮춘다. 옅은 값만
 * 지우게 된 뒤로 바탕색 칸이 알파 80 쯤으로 남아 어두운 펫 둘레에 밝은 테두리가 보였다 (2026-10-10)
 */
export function defringe(
  rgba: Uint8ClampedArray,
  mask: ArrayLike<number>,
  w: number,
  h: number,
  r?: number,
): Uint8ClampedArray {
  const rad = r ?? Math.max(4, Math.round(Math.max(w, h) / 130));
  const alpha = Uint8ClampedArray.from(mask);
  const W1 = w + 1;
  const size = W1 * (h + 1);
  // 바탕 칸(지움)과 몸 칸(꽉 남김)의 개수와 색 합을 적분 그림(합 표)으로: 어느 네모 안의 합이든 네 번 읽기로 구한다
  const bgN = new Float64Array(size);
  const fgN = new Float64Array(size);
  const bgC = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
  const fgC = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
  const rowB = [0, 0, 0, 0];
  const rowF = [0, 0, 0, 0];
  // 몸색은 꽉 남긴 칸 가운데 둘레 2칸도 다 꽉 남긴 칸에서만 잰다. 경계 바로 안쪽 칸에는 이미 바탕색이 번져 있어
  // 그 색 쪽으로 고치면 붉은 바탕 앞 흰 인형 가장자리가 붉게 남았다
  const solid = new Int32Array(size);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if ((mask[y * w + x] ?? 0) >= 250) run++;
      solid[(y + 1) * W1 + x + 1] = (solid[y * W1 + x + 1] ?? 0) + run;
    }
  }
  const deep = (x: number, y: number) => {
    const x0 = Math.max(0, x - 2);
    const y0 = Math.max(0, y - 2);
    const x1 = Math.min(w, x + 3);
    const y1 = Math.min(h, y + 3);
    const n =
      (solid[y1 * W1 + x1] ?? 0) -
      (solid[y0 * W1 + x1] ?? 0) -
      (solid[y1 * W1 + x0] ?? 0) +
      (solid[y0 * W1 + x0] ?? 0);
    return n === (x1 - x0) * (y1 - y0);
  };
  for (let y = 0; y < h; y++) {
    rowB.fill(0);
    rowF.fill(0);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mask[i] ?? 0;
      const row = m < 16 ? rowB : m >= 250 && deep(x, y) ? rowF : undefined;
      if (row) {
        row[0] = (row[0] ?? 0) + 1;
        for (let k = 0; k < 3; k++) row[k + 1] = (row[k + 1] ?? 0) + (rgba[i * 4 + k] ?? 0);
      }
      const at = (y + 1) * W1 + x + 1;
      const up = y * W1 + x + 1;
      bgN[at] = (bgN[up] ?? 0) + (rowB[0] ?? 0);
      fgN[at] = (fgN[up] ?? 0) + (rowF[0] ?? 0);
      for (let k = 0; k < 3; k++) {
        const b = bgC[k] as Float64Array;
        const f = fgC[k] as Float64Array;
        b[at] = (b[up] ?? 0) + (rowB[k + 1] ?? 0);
        f[at] = (f[up] ?? 0) + (rowF[k + 1] ?? 0);
      }
    }
  }
  const rect = (t: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    (t[y1 * W1 + x1] ?? 0) - (t[y0 * W1 + x1] ?? 0) - (t[y1 * W1 + x0] ?? 0) + (t[y0 * W1 + x0] ?? 0);
  /** 가까운 둘레부터 넓혀 가며 볼 반지름 */
  const radii = [...new Set([2, 3, 5, rad].map((v) => Math.min(v, rad)))].sort((a, b) => a - b);
  /** 둘레 평균색 (n 칸 이상 있는 가장 좁은 둘레). 없으면 false */
  const near = (cnt: Float64Array, col: Float64Array[], x: number, y: number, out: number[]) => {
    for (const q of radii) {
      const x0 = Math.max(0, x - q);
      const y0 = Math.max(0, y - q);
      const x1 = Math.min(w, x + q + 1);
      const y1 = Math.min(h, y + q + 1);
      const n = rect(cnt, x0, y0, x1, y1);
      if (n < 2 && q < rad) continue;
      if (n < 1) return false;
      for (let k = 0; k < 3; k++) out[k] = rect(col[k] as Float64Array, x0, y0, x1, y1) / n;
      return true;
    }
    return false;
  };
  /** 고친 색이 원래 색과 몸 평균색 범위를 넘어도 되는 여유 */
  const SLACK = 24;
  /** 바탕과 몸 색 거리가 이만큼은 돼야 색으로 알파를 잰다 (흰 벽 앞 흰 인형처럼 비슷하면 색으로 못 가른다) */
  const CONTRAST = 48;
  const B = [0, 0, 0];
  const F = [0, 0, 0];
  const X = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    const m = mask[i] ?? 0;
    if (m < 16) continue;
    const x = i % w;
    const y = (i - x) / w;
    // 꽉 남긴 칸은 경계 바로 안쪽(둘레 2칸에 덜 남긴 칸)만 본다: 모델이 꽉 남긴 경계 칸에도 바탕색이 번져 있다
    const full = m >= 250;
    if (full && deep(x, y)) continue;
    // 둘레에 바탕이 없거나(안쪽 반투명) 몸이 없으면 그대로
    if (!near(bgN, bgC, x, y, B) || !near(fgN, fgC, x, y, F)) continue;
    let a = m / 255;
    const d = [0, 1, 2].map((k) => (F[k] ?? 0) - (B[k] ?? 0));
    const dd = (d[0] ?? 0) ** 2 + (d[1] ?? 0) ** 2 + (d[2] ?? 0) ** 2;
    if (!full && dd >= CONTRAST * CONTRAST) {
      // 색이 바탕에서 몸 쪽으로 얼마나 갔는지 (0 = 바탕색, 1 = 몸색). 마스크보다 낮을 때만 내린다 (조금 여유)
      let t = 0;
      for (let k = 0; k < 3; k++) t += ((rgba[i * 4 + k] ?? 0) - (B[k] ?? 0)) * (d[k] ?? 0);
      const byColor = Math.max(0, Math.min(1, t / dd)) + 16 / 255;
      if (byColor < a) {
        a = Math.max(byColor, 1 / 255);
        alpha[i] = Math.round(a * 255);
      }
    }
    for (let k = 0; k < 3; k++) {
      const c = rgba[i * 4 + k] ?? 0;
      const b = B[k] ?? 0;
      const f = F[k] ?? 0;
      const solved = (c - (1 - a) * b) / a;
      const lo = Math.min(c, f) - SLACK;
      const hi = Math.max(c, f) + SLACK;
      // 옅은 칸일수록 풀이 오차(바탕색을 조금만 잘못 잡아도 1/a 배)가 커서 둘레 몸색 쪽으로 당긴다
      X[k] = f + (Math.max(lo, Math.min(hi, solved)) - f) * a;
    }
    // 몸색에서 바탕색 쪽으로 벗어난 만큼은 뺀다 (붉은 바탕 앞 흰 인형의 붉은 가장자리). 다른 쪽 차이(그늘, 무늬)는 둔다
    if (dd >= 24 * 24) {
      let t = 0;
      for (let k = 0; k < 3; k++) t += ((X[k] ?? 0) - (F[k] ?? 0)) * -(d[k] ?? 0);
      if (t > 0) for (let k = 0; k < 3; k++) X[k] = (X[k] ?? 0) + (t / dd) * (d[k] ?? 0);
    }
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = X[k] ?? 0;
  }
  return alpha;
}

/**
 * 이미 투명한 곳은 남기지 않는다: 마스크를 사진의 알파 이하로 (칸마다 작은 쪽). 오려 둔 PNG 를 넣으면 투명한 칸이
 * 모델에 검게 보여 가장자리에 검은 테두리가 생겼다
 */
export function clampToAlpha(mask: Uint8ClampedArray, rgba: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = Math.min(mask[i] ?? 0, rgba[i * 4 + 3] ?? 255);
  return out;
}

/**
 * 이 값 이하는 모델이 바탕에 남긴 얼룩으로 보고 0 으로. 펫이 사진에서 작으면 바탕에 1~30 쯤의 옅은 값이 넓게 남아
 * 어두운 화면에서 펫 둘레에 회색 네모(안개)가 보였다 (2026-10-10). 다듬기 화면은 128 아래를 지운 곳으로 보여서 보이지도 않았다
 */
export const FAINT_ALPHA = 32;

/** 옅은 값(floor 이하)은 0, 그 위는 0~255 로 다시 편다 (털 끝처럼 부드러운 가장자리는 그대로 부드럽게) */
export function dropFaint(mask: Uint8ClampedArray, floor = FAINT_ALPHA): Uint8ClampedArray {
  // 옅은 값만 0 으로. 나머지는 그대로 둔다 (다시 펴면 128 이 110 이 되는 식으로 몸이 전부 조금 더 비쳤다)
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    out[i] = v <= floor ? 0 : v;
  }
  return out;
}

/** w x h 사진을 늘이지 않고 size 정사각 가운데에 놓을 자리 (모델 입력, 남는 곳은 여백) */
export function letterbox(w: number, h: number, size: number) {
  const k = size / Math.max(w, h, 1);
  const width = Math.max(1, Math.min(size, Math.round(w * k)));
  const height = Math.max(1, Math.min(size, Math.round(h * k)));
  return { x: Math.floor((size - width) / 2), y: Math.floor((size - height) / 2), width, height };
}

/**
 * 남긴 곳 가운데 반쯤 투명한(lo~hi) 칸의 비율. 바탕과 몸 색이 비슷한 사진(흰 벽 앞 흰 고양이)은 몸이 반투명 유령처럼
 * 남는다. 이 비율이 크면 복원 붓을 권한다
 */
export function halfKeptShare(mask: ArrayLike<number>, lo = 40, hi = 200): number {
  let kept = 0;
  let half = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ?? 0;
    if (v <= 16) continue;
    kept++;
    if (v >= lo && v <= hi) half++;
  }
  return kept ? half / kept : 0;
}

/**
 * 펫이 사진에서 작으면 그 둘레만 다시 오려 볼 자리 (원본 사진 좌표, 여백 포함). 크면 undefined.
 * 작은 펫은 1024 사진 안에서 몇십 칸이라 모델이 팔을 놓치고 바탕을 남겼고, 저장 그림도 그만큼 흐릿했다.
 * 자리의 가로 세로는 minSide 이상으로 둘레 사진을 넓혀 잡는다: 작게 자른 칸을 모델 입력(1024)까지 7배로 흐리게 키우면
 * 흰 아랫몸을 바탕으로 봤고, 흰 여백을 붙여 덜 키우면 자른 네모 전체를 물건으로 봤다 (2026-10-10).
 * 넓혀 보니 사진 거의 전체면 처음과 같아서 undefined
 */
export function refineBox(
  box: { x: number; y: number; width: number; height: number } | undefined,
  w: number,
  h: number,
  small = 0.5,
  margin = 0.2,
  minSide = 0,
) {
  if (!box) return undefined;
  const side = Math.max(box.width, box.height);
  if (side >= Math.max(w, h) * small) return undefined;
  const p = Math.round(side * margin);
  const grow = (at: number, len: number, max: number) => {
    let a = Math.max(0, at - p);
    let b = Math.min(max, at + len + p);
    const need = Math.min(max, Math.ceil(minSide)) - (b - a);
    if (need > 0) {
      a -= Math.floor(need / 2);
      b += Math.ceil(need / 2);
      if (a < 0) [a, b] = [0, b - a];
      if (b > max) [a, b] = [a - (b - max), max];
    }
    return [Math.max(0, a), Math.min(max, b)] as const;
  };
  const [x, x1] = grow(box.x, box.width, w);
  const [y, y1] = grow(box.y, box.height, h);
  if (x1 - x >= w * 0.9 && y1 - y >= h * 0.9) return undefined;
  return { x, y, width: x1 - x, height: y1 - y };
}

/** 마스크에서 이어진 한 덩어리 (꽉 남긴 칸, 8방향). 네모는 끝 칸 포함, edges 는 닿은 사진 가장자리 (1 왼 2 위 4 오른 8 아래) */
export interface MaskBlob {
  id: number;
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  edges: number;
}

/** threshold 를 넘는 칸을 이어진 덩어리로 나눈다. labels 는 칸마다 덩어리 id (0 = 없음) */
export function maskBlobs(mask: ArrayLike<number>, w: number, h: number, threshold = 128) {
  const labels = new Int32Array(w * h);
  const list: MaskBlob[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (labels[start] || (mask[start] ?? 0) <= threshold) continue;
    const id = list.length + 1;
    const b: MaskBlob = { id, area: 0, x0: w, y0: h, x1: -1, y1: -1, cx: 0, cy: 0, edges: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const i = stack[--top] ?? 0;
      const x = i % w;
      const y = (i - x) / w;
      b.area++;
      b.cx += x;
      b.cy += y;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (labels[j] || (mask[j] ?? 0) <= threshold) continue;
          labels[j] = id;
          stack[top++] = j;
        }
      }
    }
    b.cx /= b.area;
    b.cy /= b.area;
    b.edges =
      (b.x0 === 0 ? 1 : 0) | (b.y0 === 0 ? 2 : 0) | (b.x1 === w - 1 ? 4 : 0) | (b.y1 === h - 1 ? 8 : 0);
    list.push(b);
  }
  return { labels, list };
}

/** 따로 남은 덩어리로 칠 크기 (펫 덩어리의 이만큼, 사진의 이만큼 이상) */
const OTHER_OF_MAIN = 0.1;
const OTHER_OF_PHOTO = 0.0005;

/**
 * 바탕 띠로 보이는 덩어리: 사진 양쪽 끝(왼오른 또는 위아래)에 다 닿았거나, 같은 줄에 늘어선 덩어리들이 사진 너비(높이)의
 * 60% 넘게 덮는 납작한 띠 (나무 줄, 바닥, 벽 띠). 띠는 128 에서 여러 조각으로 끊기기도 해서 같은 줄 조각을 같이 본다
 */
function bandLike(b: MaskBlob, list: MaskBlob[], w: number, h: number) {
  if ((b.edges & 5) === 5 || (b.edges & 10) === 10) return true;
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  let rowW = 0;
  let colH = 0;
  for (const o of list) {
    if (o.area < 16) continue;
    const oh = o.y1 - o.y0 + 1;
    const ow = o.x1 - o.x0 + 1;
    const yOver = Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0) + 1;
    const xOver = Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0) + 1;
    if (yOver >= Math.min(bh, oh) * 0.5) rowW += ow;
    if (xOver >= Math.min(bw, ow) * 0.5) colH += oh;
  }
  return (rowW >= w * 0.6 && rowW >= bh * 4) || (colH >= h * 0.6 && colH >= bw * 4);
}

/**
 * 펫으로 보이는 덩어리 고르기. 크고 가운데에 가까운 덩어리를 펫으로 보고(바탕 띠는 거의 빼고), 펫만큼 큰 덩어리가
 * 또 있으면(펫 둘, 끊긴 몸) 같이 둔다. box 는 그 덩어리들을 감싸는 네모 (contentBox 처럼 여유 4%). others 는 펫 말고
 * 따로 남은 큰 덩어리 수 (바깥 사진에서 나무 줄이 펫보다 크게 남아 펫 대신 그 둘레를 보고 반투명 안내가 떴다, 2026-10-10)
 */
export function pickPet(mask: ArrayLike<number>, w: number, h: number, threshold = 128) {
  const { labels, list } = maskBlobs(mask, w, h, threshold);
  if (!list.length) return undefined;
  const band = new Set(list.filter((b) => b.area >= 16 && bandLike(b, list, w, h)));
  const score = (b: MaskBlob) => {
    const d = Math.hypot((b.cx - w / 2) / (w / 2), (b.cy - h / 2) / (h / 2)) / Math.SQRT2;
    return b.area * (1 - 0.7 * Math.min(1, d)) * (band.has(b) ? 0.1 : 1);
  };
  const main = list.reduce((a, b) => (score(b) > score(a) ? b : a));
  const pets = list.filter((b) => b === main || (!band.has(b) && b.area >= main.area * 0.25));
  const big = Math.max(main.area * OTHER_OF_MAIN, w * h * OTHER_OF_PHOTO, 16);
  const others = list.filter((b) => b.area >= big && !pets.includes(b)).length;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (const b of pets) {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  const p = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04) + 2;
  const bx = Math.max(0, x0 - p);
  const by = Math.max(0, y0 - p);
  const box = { x: bx, y: by, width: Math.min(w, x1 + 1 + p) - bx, height: Math.min(h, y1 + 1 + p) - by };
  return { main, pets, others, box, labels };
}

/** pickPet 이 고른 펫 덩어리 칸만 남긴 마스크 (나머지는 0) */
export function petOnly(mask: ArrayLike<number>, pick: { pets: MaskBlob[]; labels: Int32Array }) {
  const ids = new Set(pick.pets.map((b) => b.id));
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) if (ids.has(pick.labels[i] ?? 0)) out[i] = mask[i] ?? 0;
  return out;
}

/** 다시 오린 것을 쓰려면 처음 펫 모습(알파 합)을 이만큼은 지켜야 한다 */
export const REFINE_KEEP = 0.95;

/** first(너비 fw)의 box 칸을 w2 x h2 로 늘여 칸마다 값(선형 보간)을 넘긴다 */
function eachMapped(
  first: ArrayLike<number>,
  fw: number,
  box: { x: number; y: number; width: number; height: number },
  w2: number,
  h2: number,
  visit: (i: number, f: number) => void,
) {
  const fh = Math.floor(first.length / fw);
  const at = (x: number, y: number) => first[Math.min(fh - 1, y) * fw + Math.min(fw - 1, x)] ?? 0;
  for (let y = 0; y < h2; y++) {
    const fy = Math.max(0, box.y + ((y + 0.5) * box.height) / h2 - 0.5);
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w2; x++) {
      const fx = Math.max(0, box.x + ((x + 0.5) * box.width) / w2 - 0.5);
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      visit(
        y * w2 + x,
        (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
          (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty,
      );
    }
  }
}

/** 처음 마스크에서 "확실히 펫"으로 볼 값 (keptMass, keepSure) */
export const SURE_ALPHA = 230;

/**
 * 다시 오린 마스크(second, 크기 w2 x h2)가 처음 마스크(first, 너비 fw)의 box 칸 안 펫 모습을 얼마나 지켰는지.
 * 처음 것에서 확실히 남긴 칸(sure 이상)들의 알파 합에 대한 다시 오린 알파 합 (1 = 그대로). 넓이(128 넘는 칸 수)로 견주면
 * 흰 아랫몸이 196 에서 4 로 거의 사라져도 몸 윤곽이 남아 놓쳤다 (2026-10-10). 128 로 재면 작은 펫 둘레 회색 안개(130~200)를
 * 지운 좋은 결과까지 몸을 잃은 것으로 봤다. first 는 펫 덩어리만 (petOnly: 다른 덩어리를 덜 남긴 것은 잃은 게 아니다)
 */
export function keptMass(
  first: ArrayLike<number>,
  fw: number,
  box: { x: number; y: number; width: number; height: number },
  second: ArrayLike<number>,
  w2: number,
  h2: number,
  sure = SURE_ALPHA,
): number {
  let a = 0;
  let b = 0;
  eachMapped(first, fw, box, w2, h2, (i, f) => {
    if (f < sure) return;
    a += f;
    b += second[i] ?? 0;
  });
  return a ? b / a : 1;
}

/**
 * 다시 오린 마스크에서 처음 마스크가 확실히 남긴(sure 이상) 몸이 뭉텅이로 빠졌으면 그 뭉텅이만 되살린다 (칸마다 큰 쪽).
 * 다시 오린 것이 대체로 나아도 흰 아랫몸 한 군데를 덜 남기는 일이 있었다 (밝은 바탕 흰 인형, 2026-10-10).
 * 작은 조각(확실한 넓이의 minShare 아래)은 되살리지 않는다: 처음 것의 둘레 안개 가운데 진한 조각이라 다시 오린 쪽이 맞다.
 * first 는 펫 덩어리만 (petOnly)
 */
export function keepSure(
  first: ArrayLike<number>,
  fw: number,
  box: { x: number; y: number; width: number; height: number },
  second: Uint8ClampedArray,
  w2: number,
  h2: number,
  sure = SURE_ALPHA,
  minShare = 0.03,
): Uint8ClampedArray {
  const f = new Uint8ClampedArray(w2 * h2);
  eachMapped(first, fw, box, w2, h2, (i, v) => {
    f[i] = v;
  });
  let sureN = 0;
  const lost = new Uint8ClampedArray(w2 * h2);
  for (let i = 0; i < f.length; i++) {
    if ((f[i] ?? 0) < sure) continue;
    sureN++;
    if ((second[i] ?? 0) < (f[i] ?? 0) * 0.8) lost[i] = 255;
  }
  const out = new Uint8ClampedArray(second);
  const { labels, list } = maskBlobs(lost, w2, h2, 0);
  const back = new Set(list.filter((b) => b.area >= sureN * minShare).map((b) => b.id));
  for (let i = 0; i < out.length; i++) {
    const v = out[i] ?? 0;
    const fv = f[i] ?? 0;
    // 두 번 다 몸으로 본 곳(다시 오린 것도 128 넘음)은 확실한 쪽 값으로: 흰 아랫몸이 210 쯤으로 조금 비치던 것
    if (fv >= sure && (v > 128 || back.has(labels[i] ?? 0))) out[i] = Math.max(v, fv);
  }
  return out;
}

/** 칸마다 가장 가까운 꽉 남긴(core 이상) 칸까지 거리 (모따기 거리, 1 과 1.41) */
function distanceTo(mask: ArrayLike<number>, w: number, h: number, core: number): Float32Array {
  const d = new Float32Array(w * h).fill(1e9);
  for (let i = 0; i < w * h; i++) if ((mask[i] ?? 0) >= core) d[i] = 0;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i] ?? 0;
      if (x > 0) v = Math.min(v, (d[i - 1] ?? 0) + 1);
      if (y > 0) {
        v = Math.min(v, (d[i - w] ?? 0) + 1);
        if (x > 0) v = Math.min(v, (d[i - w - 1] ?? 0) + D);
        if (x < w - 1) v = Math.min(v, (d[i - w + 1] ?? 0) + D);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i] ?? 0;
      if (x < w - 1) v = Math.min(v, (d[i + 1] ?? 0) + 1);
      if (y < h - 1) {
        v = Math.min(v, (d[i + w] ?? 0) + 1);
        if (x < w - 1) v = Math.min(v, (d[i + w + 1] ?? 0) + D);
        if (x > 0) v = Math.min(v, (d[i + w - 1] ?? 0) + D);
      }
      d[i] = v;
    }
  return d;
}

/** 꽉 남긴 칸으로 칠 값 (trimHalo) */
export const CORE_ALPHA = 200;

/**
 * 몸에서 떨어진 반투명 안개를 걷는다. 작은 펫을 처음 오린 마스크는 펫 둘레 네모에 60~150 쯤의 값이 남아 어두운 화면에서
 * 회색 네모가 보였다 (2026-10-10, 옅은 값 지우기 32 로는 안 지워진다). 꽉 남긴 칸(CORE_ALPHA 이상)에서 band 칸 안의
 * 반투명은 털 끝으로 두고, 그 밖은 band 칸에 걸쳐 0 으로 줄인다. band 는 몸 크기의 2% (적어도 2칸).
 * 남긴 곳 절반 넘게 반투명이면(흰 벽 앞 흰 고양이 같은 반쯤 비친 몸) 몸일 수 있어 손대지 않는다
 */
export function trimHalo(mask: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  let core = 0;
  let kept = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ?? 0;
    if (v > FAINT_ALPHA) kept++;
    if (v < CORE_ALPHA) continue;
    core++;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!core || core < kept * 0.5) return mask;
  const band = Math.max(2, Math.round(Math.max(x1 - x0, y1 - y0) * 0.02));
  const d = distanceTo(mask, w, h, CORE_ALPHA);
  // 안개는 몸 둘레를 네모로 감싼다. 한쪽에만 붙은 반투명(64px 사진의 흐린 아랫몸)은 몸일 수 있어 둔다:
  // 몸 네모 바깥 위, 아래, 왼, 오른 가운데 세 쪽 이상에 먼 반투명이 있을 때만 걷는다
  const side = [0, 0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ?? 0;
    if (v <= FAINT_ALPHA || v >= CORE_ALPHA || (d[i] ?? 0) <= band * 2) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (y < y0) side[0] = (side[0] ?? 0) + 1;
    if (y > y1) side[1] = (side[1] ?? 0) + 1;
    if (x < x0) side[2] = (side[2] ?? 0) + 1;
    if (x > x1) side[3] = (side[3] ?? 0) + 1;
  }
  const enough = Math.max(4, Math.max(x1 - x0, y1 - y0) * 0.5);
  if (side.filter((n) => n >= enough).length < 3) return mask;
  const out = new Uint8ClampedArray(mask);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ?? 0;
    if (!v || v >= CORE_ALPHA) continue;
    const k = 1 - ((d[i] ?? 0) - band) / band;
    if (k < 1) out[i] = k > 0 ? v * k : 0;
  }
  return out;
}

/** 속을 채울 알파: 이 아래는 그대로, SOLID_FULL 부터 다 채운다 (solidify) */
export const SOLID_FROM = 155;
export const SOLID_FULL = 185;

/**
 * 몸 속을 꽉 채운다. 흰 바탕의 흰 펫, 반짝이는 피규어 그림은 배경 지우기가 몸 속을 190~245 로 남겨 어두운 화면에서
 * 몸이 살짝 비쳤다 (Gemini 흰 고양이 몸 193~218, 2026-10-11). 남긴 곳(128 이상) 가장자리에서 몸 크기의 2%(band, 적어도
 * 2칸)보다 안쪽이고 알파가 SOLID_FROM 넘는 칸을 255 쪽으로 올린다. 가장자리 털 끝은 그대로 두고, band~2*band 사이와
 * SOLID_FROM~SOLID_FULL 사이는 조금씩 올려 꽉 찬 곳과 둘레 사이에 선이 생기지 않게 한다.
 * 더 옅은 속(흰 벽 앞 흰 고양이의 90~130 아랫몸)은 몸인지 바탕인지 몰라 그대로 둔다 (다듬기 안내가 복원 붓을 권한다)
 */
export function solidify(mask: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const box = contentBox(mask, w, h, 127, 0);
  if (!box) return mask;
  const band = Math.max(2, Math.round(Math.max(box.width, box.height) * 0.02));
  const outside = new Uint8ClampedArray(w * h);
  let soft = false;
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ?? 0;
    if (v < 128) outside[i] = 255;
    else if (v < 255 && v > SOLID_FROM) soft = true;
  }
  if (!soft) return mask;
  const d = distanceTo(outside, w, h, 255);
  const out = new Uint8ClampedArray(mask);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ?? 0;
    if (v <= SOLID_FROM || v === 255) continue;
    const kd = Math.min(1, Math.max(0, ((d[i] ?? 0) - band) / band));
    const ka = Math.min(1, (v - SOLID_FROM) / (SOLID_FULL - SOLID_FROM));
    out[i] = v + (255 - v) * kd * ka;
  }
  return out;
}

/**
 * 반쯤 투명한(lo~hi) 칸이 뭉친 가장 큰 덩어리의 넓이 (칸 수). 가장자리 둘레의 얇은 반투명 띠는 r 칸 깎아 빼고 잰다.
 * 남긴 곳 전체 비율(halfKeptShare)로는 팔 하나만 비친 사진(회색 벽 앞 흰 팔)을 놓쳤다 (2026-10-10)
 */
export function halfPatch(mask: ArrayLike<number>, w: number, h: number, lo = 40, hi = 200, r = 2): number {
  const W1 = w + 1;
  const sum = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const v = mask[y * w + x] ?? 0;
      if (v >= lo && v <= hi) row++;
      sum[(y + 1) * W1 + x + 1] = (sum[y * W1 + x + 1] ?? 0) + row;
    }
  }
  const inner = new Uint8Array(w * h);
  const full = (2 * r + 1) ** 2;
  for (let y = r; y < h - r; y++)
    for (let x = r; x < w - r; x++) {
      const x0 = x - r;
      const y0 = y - r;
      const x1 = x + r + 1;
      const y1 = y + r + 1;
      const n =
        (sum[y1 * W1 + x1] ?? 0) -
        (sum[y0 * W1 + x1] ?? 0) -
        (sum[y1 * W1 + x0] ?? 0) +
        (sum[y0 * W1 + x0] ?? 0);
      if (n === full) inner[y * w + x] = 255;
    }
  let best = 0;
  for (const b of maskBlobs(inner, w, h, 0).list) best = Math.max(best, b.area);
  return best;
}

/**
 * 꽉 남긴 칸이 사진 가장자리에 닿은 길이 비율 (가장 많이 닿은 변). 펫이 사진 끝에서 잘렸을 수 있다
 */
export function edgeTouch(mask: ArrayLike<number>, w: number, h: number, threshold = 128): number {
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  for (let x = 0; x < w; x++) {
    if ((mask[x] ?? 0) > threshold) top++;
    if ((mask[(h - 1) * w + x] ?? 0) > threshold) bottom++;
  }
  for (let y = 0; y < h; y++) {
    if ((mask[y * w] ?? 0) > threshold) left++;
    if ((mask[y * w + w - 1] ?? 0) > threshold) right++;
  }
  return Math.max(top / w, bottom / w, left / h, right / h);
}

/**
 * 몸 안쪽이 비었는지: 남긴 곳(32 넘음)을 반지름 r 로 닫고(늘였다 줄이고) 안쪽 구멍까지 메우면 새로 차는 넓이가 꽉 남긴
 * 넓이의 몇 배인지.
 * 테두리 선만 남고 몸 아래쪽이 다 지워진 그림(선이 굵고 색이 단순한 애니 그림, 2026-10-11)은 0.11, 보통 사진은 0.02~0.05.
 * 테두리가 끊겨 있어 "막힌 구멍"으로는 못 잡는다. 사진 밖은 비었다고 보고 잰다 (가장자리에 닿은 다리 사이를 메우지 않게)
 */
export function hollowGain(mask: ArrayLike<number>, w: number, h: number, r: number): number {
  const rad = Math.max(1, Math.round(r));
  const pw = w + 2 * (rad + 1);
  const ph = h + 2 * (rad + 1);
  const o = rad + 1;
  const kept = new Uint8ClampedArray(pw * ph);
  let solid = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = mask[y * w + x] ?? 0;
      if (v > FAINT_ALPHA) kept[(y + o) * pw + x + o] = 255;
      if (v > 128) solid++;
    }
  if (!solid) return 0;
  const toKept = distanceTo(kept, pw, ph, 255);
  const outside = new Uint8ClampedArray(pw * ph);
  for (let i = 0; i < outside.length; i++) if ((toKept[i] ?? 0) > rad) outside[i] = 255;
  const toOutside = distanceTo(outside, pw, ph, 255);
  // 닫은 모습 바깥 가운데 사진 밖과 이어지지 않은 곳(테두리 선 안쪽)도 메운다
  const open = new Uint8ClampedArray(pw * ph);
  for (let i = 0; i < open.length; i++) if ((toOutside[i] ?? 0) <= rad) open[i] = 255;
  const { labels, list } = maskBlobs(open, pw, ph, 0);
  const inner = new Set(list.filter((b) => !b.edges).map((b) => b.id));
  let gain = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y + o) * pw + x + o;
      const closed = (toOutside[i] ?? 0) > rad || inner.has(labels[i] ?? 0);
      if (closed && (mask[y * w + x] ?? 0) <= 128) gain++;
    }
  return gain / solid;
}

/** 몸 안쪽이 빈 것으로 볼 hollowGain (반지름은 펫 크기의 4%) */
export const HOLLOW_GAIN = 0.08;

/** 남긴 곳의 이만큼이 반투명이면 복원 붓을 권한다 (흰 벽 앞 흰 고양이 55%, 64px 사진 28%, 보통 인형 사진 2%) */
export const HALF_KEPT_WARN = 0.22;
/** 반투명 뭉치 하나가 펫 덩어리의 이만큼이면 복원 붓을 권한다 (회색 벽 앞 흰 팔 하나 1.8%, 보통 사진 0.1% 아래) */
export const HALF_PATCH = 0.01;
/** 꽉 남긴 칸이 사진 한 변의 이만큼 넘게 닿으면 잘렸을 수 있다고 알린다 */
export const CUT_EDGE = 0.05;

/**
 * 그림용 모델 결과의 속 빔 기준. 오목한 몸이나 캐릭터 둘 사이 틈을 닫으면 멀쩡한 그림도 0.1 쯤 나와(만화 햄스터 0.13) 사진용 기준
 * (0.08)이 거짓 경고를 냈다 (2026-10-28). 몸 속을 정말 지운 그림은 0.46 이상이라 그림용은 0.3 으로 둔다 (직접 그린 고양이, 곰, 새 속을 지운 시험 0.48~0.84)
 */
export const HOLLOW_GAIN_DRAWING = 0.3;

/**
 * 다듬기 화면 안내: 거의 다 지웠는지(펫 덩어리가 없거나 아주 작다), 거의 안 지웠는지, 펫이 반쯤 비치는지(펫 둘레만 잰다,
 * 따로 남은 바탕 띠는 빼고), 펫 말고 따로 남은 덩어리 수, 사진 끝에 닿았는지.
 * 거의 다 지웠다는 안내를 남긴 넓이 2% 로 정하면 사진 속 작은 펫을 잘 오려도 떴다 (2026-10-10)
 */
export function maskHints(mask: ArrayLike<number>, w: number, h: number, opts: { hollowAt?: number } = {}) {
  const n = w * h;
  const pick = pickPet(mask, w, h);
  const none = { empty: true, full: false, half: false, hollow: false, others: 0, cut: false };
  if (!pick || pick.main.area < Math.max(64, n * 0.0005)) return none;
  const { box } = pick;
  const inBox = new Uint8ClampedArray(n);
  let kept = 0;
  let half = 0;
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = y * w + x;
      const v = mask[i] ?? 0;
      inBox[i] = v;
      if (v <= 16) continue;
      kept++;
      if (v >= 40 && v <= 200) half++;
    }
  const patch = halfPatch(inBox, w, h, 40, 200, Math.max(1, Math.round(Math.max(w, h) / 256)));
  const all = contentBox(mask, w, h, FAINT_ALPHA, 0);
  return {
    empty: false,
    full: keptRatio(mask) > 0.97,
    half: (kept ? half / kept : 0) > HALF_KEPT_WARN || patch >= pick.main.area * HALF_PATCH,
    // 끊긴 테두리 선은 펫 덩어리 네모 밖에 있을 수 있어 남긴 곳 전체로 잰다
    hollow:
      hollowGain(mask, w, h, Math.max(all?.width ?? 0, all?.height ?? 0) * 0.04) >
      (opts.hollowAt ?? HOLLOW_GAIN),
    others: pick.others,
    cut: edgeTouch(mask, w, h) >= CUT_EDGE,
  };
}
