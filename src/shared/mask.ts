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
export function contentBox(mask: Uint8ClampedArray, w: number, h: number, threshold = 16, pad = 0.04) {
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
export function keptRatio(mask: Uint8ClampedArray, threshold = 128): number {
  let n = 0;
  for (const v of mask) if (v > threshold) n++;
  return mask.length ? n / mask.length : 0;
}

/**
 * 가장자리 바탕색 빼기 (털 끝 흰 테두리 없애기). 반쯤 남긴 칸의 색에는 뒤 바탕색이 섞여 있어서, 어두운 곳에 놓으면
 * 밝은 테두리가 보였다 (AI 일러스트의 밝은 바탕, 2026-10-09). 둘레 r 칸 안의 지운 칸(바탕) 평균을 그 자리 바탕색 B 로 보고
 * 색 C = a*F + (1-a)*B 를 풀어 F 를 구한다. 털 가닥(반투명)은 그대로 두고 색만 고친다. rgba 를 바로 고친다.
 * 마스크는 진짜 알파가 아니다 (모델의 흐린 경계, 붓 가장자리): 이미 털색인 칸을 그대로 풀면 a 로 나누며 검게 됐다.
 * 그래서 고친 색은 원래 색 C 와 둘레 몸 평균색 사이(조금 여유)로만 둔다. 둘레에 몸이 없으면 손대지 않는다
 */
export function defringe(rgba: Uint8ClampedArray, mask: ArrayLike<number>, w: number, h: number, r?: number) {
  const rad = r ?? Math.max(4, Math.round(Math.max(w, h) / 130));
  const W1 = w + 1;
  const size = W1 * (h + 1);
  // 바탕 칸(지움)과 몸 칸(꽉 남김)의 개수와 색 합을 적분 그림(합 표)으로: 어느 네모 안의 합이든 네 번 읽기로 구한다
  const bgN = new Float64Array(size);
  const fgN = new Float64Array(size);
  const bgC = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
  const fgC = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
  const rowB = [0, 0, 0, 0];
  const rowF = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    rowB.fill(0);
    rowF.fill(0);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mask[i] ?? 0;
      const row = m < 16 ? rowB : m >= 250 ? rowF : undefined;
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
  /** 고친 색이 원래 색과 몸 평균색 범위를 넘어도 되는 여유 */
  const SLACK = 24;
  for (let i = 0; i < w * h; i++) {
    const m = mask[i] ?? 0;
    if (m < 16 || m >= 250) continue;
    const x = i % w;
    const y = (i - x) / w;
    const x0 = Math.max(0, x - rad);
    const y0 = Math.max(0, y - rad);
    const x1 = Math.min(w, x + rad + 1);
    const y1 = Math.min(h, y + rad + 1);
    const nb = rect(bgN, x0, y0, x1, y1);
    const nf = rect(fgN, x0, y0, x1, y1);
    // 둘레에 바탕이 없거나(안쪽 반투명) 몸이 없으면 그대로
    if (nb < 1 || nf < 1) continue;
    const a = m / 255;
    for (let k = 0; k < 3; k++) {
      const c = rgba[i * 4 + k] ?? 0;
      const b = rect(bgC[k] as Float64Array, x0, y0, x1, y1) / nb;
      const f = rect(fgC[k] as Float64Array, x0, y0, x1, y1) / nf;
      const solved = (c - (1 - a) * b) / a;
      const lo = Math.min(c, f) - SLACK;
      const hi = Math.max(c, f) + SLACK;
      rgba[i * 4 + k] = Math.max(lo, Math.min(hi, solved));
    }
  }
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
 * 작은 펫은 1024 사진 안에서 몇십 칸이라 모델이 팔을 놓치고 바탕을 남겼고, 저장 그림도 그만큼 흐릿했다
 */
export function refineBox(
  box: { x: number; y: number; width: number; height: number } | undefined,
  w: number,
  h: number,
  small = 0.5,
  margin = 0.2,
) {
  if (!box) return undefined;
  const side = Math.max(box.width, box.height);
  if (side >= Math.max(w, h) * small) return undefined;
  const p = Math.round(side * margin);
  const x = Math.max(0, box.x - p);
  const y = Math.max(0, box.y - p);
  return {
    x,
    y,
    width: Math.min(w, box.x + box.width + p) - x,
    height: Math.min(h, box.y + box.height + p) - y,
  };
}
