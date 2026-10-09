// 사진 펫 만들기(P1-08)의 마스크 계산. 화면 없이 시험할 수 있게 배열만 다룬다.
// 마스크는 한 칸에 0~255 (0 = 지움, 255 = 남김).

/** 모델 출력(정사각 size x size)을 최소 최대로 펴서 0~255 마스크로. rembg 와 같은 후처리. */
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
 * 색 C = a*F + (1-a)*B 를 풀어 F 만 남긴다. 털 가닥(반투명)은 그대로 두고 색만 고친다. rgba 를 바로 고친다
 */
export function defringe(rgba: Uint8ClampedArray, mask: ArrayLike<number>, w: number, h: number, r?: number) {
  const rad = r ?? Math.max(4, Math.round(Math.max(w, h) / 130));
  const n = w * h;
  // 바탕 칸의 개수와 색 합을 적분 그림(합 표)으로: 어느 네모 안의 합이든 네 번 읽기로 구한다
  const W1 = w + 1;
  const cnt = new Float64Array(W1 * (h + 1));
  const sum = [
    new Float64Array(W1 * (h + 1)),
    new Float64Array(W1 * (h + 1)),
    new Float64Array(W1 * (h + 1)),
  ];
  for (let y = 0; y < h; y++) {
    let rc = 0;
    let r0 = 0;
    let r1 = 0;
    let r2 = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if ((mask[i] ?? 0) < 16) {
        rc++;
        r0 += rgba[i * 4] ?? 0;
        r1 += rgba[i * 4 + 1] ?? 0;
        r2 += rgba[i * 4 + 2] ?? 0;
      }
      const at = (y + 1) * W1 + x + 1;
      const up = y * W1 + x + 1;
      cnt[at] = (cnt[up] ?? 0) + rc;
      (sum[0] as Float64Array)[at] = ((sum[0] as Float64Array)[up] ?? 0) + r0;
      (sum[1] as Float64Array)[at] = ((sum[1] as Float64Array)[up] ?? 0) + r1;
      (sum[2] as Float64Array)[at] = ((sum[2] as Float64Array)[up] ?? 0) + r2;
    }
  }
  const rect = (t: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    (t[y1 * W1 + x1] ?? 0) - (t[y0 * W1 + x1] ?? 0) - (t[y1 * W1 + x0] ?? 0) + (t[y0 * W1 + x0] ?? 0);
  for (let i = 0; i < n; i++) {
    const m = mask[i] ?? 0;
    if (m < 16 || m >= 255) continue;
    const x = i % w;
    const y = (i - x) / w;
    const x0 = Math.max(0, x - rad);
    const y0 = Math.max(0, y - rad);
    const x1 = Math.min(w, x + rad + 1);
    const y1 = Math.min(h, y + rad + 1);
    const c = rect(cnt, x0, y0, x1, y1);
    // 둘레에 바탕이 없으면(안쪽 반투명) 그대로
    if (c < 1) continue;
    const a = m / 255;
    for (let k = 0; k < 3; k++) {
      const b = rect(sum[k] as Float64Array, x0, y0, x1, y1) / c;
      rgba[i * 4 + k] = ((rgba[i * 4 + k] ?? 0) - (1 - a) * b) / a;
    }
  }
}
