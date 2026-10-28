// 다듬기 화면의 두 옵트인 도구의 계산 (화면 없이 배열만 다뤄 시험한다, mask-refine.test.ts).
// - paperCut(종이 색 지우개): 종이 색을 재서 옅은 선과 칠을 살린다. 신경망 모델이 놓치는 옅은 수채, 연필 그림용.
// - furRefine(털 다듬기): 사진 색을 길잡이로(guided filter) 마스크 가장자리만 다듬는다. 털 끝이 자연스러워진다.
// 둘 다 기본값이 아니다: 줄 공책, 틀이 있는 종이에서는 종이 지우개가 줄을 남기고, 털 다듬기는 흰 털 둘레에 옅은 번짐을 낸다
// (사진 10장, 그림 6장 측정, docs/tests/bg-removal.md). 그래서 단추를 눌렀을 때만 돌고 되돌리기로 취소한다.
import { maskBlobs, pickPet } from './mask.ts';

/** 사각 창의 최소 또는 최대 (가로 한 번, 세로 한 번) */
function boxExtreme(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  wantMax: boolean,
): Uint8ClampedArray {
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  const pick = wantMax ? Math.max : Math.min;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = wantMax ? 0 : 255;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, src[y * w + k] ?? 0);
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = wantMax ? 0 : 255;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x] ?? 0);
      out[y * w + x] = v;
    }
  return out;
}

/** 창 안 평균 (적분 그림) */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x] ?? 0;
      sum[(y + 1) * W1 + x + 1] = (sum[y * W1 + x + 1] ?? 0) + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const total =
        (sum[y1 * W1 + x1] ?? 0) -
        (sum[y0 * W1 + x1] ?? 0) -
        (sum[y1 * W1 + x0] ?? 0) +
        (sum[y0 * W1 + x0] ?? 0);
      out[y * w + x] = total / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** 바탕 색 재기에서 가장자리 띠 두께 (짧은 변의 3%) 와 그 띠 색이 이만큼 넘게 흩어져 있으면 종이로 보지 않는다 (사진 배경) */
const RING = 0.03;
const PAPER_SPREAD = 25;

/** 종이와 이만큼(RGB 거리) 다르면 그림 시작, 이만큼 다르면 완전히 그림 */
const DIST_FROM = 20;
const DIST_FULL = 75;

/** 종이 색(가운데 값)과 그 색이 흩어진 정도(10~90% 값 차의 큰 쪽). 없으면 undefined */
export function paperTone(
  rgba: ArrayLike<number>,
  current: ArrayLike<number>,
  w: number,
  h: number,
): { paper: number[]; spread: number } | undefined {
  const n = w * h;
  // 종이 색은 지금 마스크에서 먼 바깥(둘레 2% 밖)에서 잰다. 다시 오려 사진 가장자리까지 몸이 닿은 그림도 맞게. 바깥이 너무 좁으면(2% 미만)
  // 사진 가장자리 띠로 잰다
  const cur = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) cur[i] = (current[i] ?? 0) > 40 ? 255 : 0;
  const nearMask = boxExtreme(cur, w, h, Math.max(2, Math.round(Math.min(w, h) * 0.02)), true);
  const ring = Math.max(3, Math.round(Math.min(w, h) * RING));
  const sample = (useRing: boolean) => {
    const out: number[][] = [[], [], []];
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2) {
        const edge = x < ring || y < ring || x >= w - ring || y >= h - ring;
        if (useRing ? !edge : nearMask[y * w + x]) continue;
        for (let c = 0; c < 3; c++) (out[c] as number[]).push(rgba[(y * w + x) * 4 + c] ?? 0);
      }
    return out;
  };
  let chans = sample(false);
  if (((chans[0] as number[]).length * 4) / n < 0.02) chans = sample(true);
  if ((chans[0] as number[]).length === 0) return undefined;
  const paper = chans.map((a) => {
    a.sort((p, q) => p - q);
    return a[a.length >> 1] ?? 0;
  });
  const spread = chans.reduce(
    (m, a) => Math.max(m, (a[Math.floor(a.length * 0.9)] ?? 0) - (a[Math.floor(a.length * 0.1)] ?? 0)),
    0,
  );
  return { paper, spread };
}

/**
 * 종이 색 지우개. rgba 사진과 지금 마스크(w x h)로 새 마스크를 만든다. 종이 색은 사진 가장자리 띠의 가운데 값이다.
 * 1) 종이와 색이 다른 칸을 그림으로(옅은 선도 살린다) 2) 끊긴 선을 둘레 1% 로 이어 3) 펫 덩어리만 고르고
 * 4) 안쪽 구멍(눈 흰자, 흰 몸)을 메우고 5) 지금 마스크 둘레(짧은 변의 5%) 안으로만 쓴다: 사진 전체가 종이인 틀 그림에서
 * 종이째 남는 것을 막는다. 종이 색이 고르지 않으면(사진 배경) undefined
 */
export function paperCut(
  rgba: ArrayLike<number>,
  current: ArrayLike<number>,
  w: number,
  h: number,
): Uint8ClampedArray | undefined {
  const n = w * h;
  const tone = paperTone(rgba, current, w, h);
  if (!tone || tone.spread > PAPER_SPREAD) return undefined;
  const { paper } = tone;
  const cur = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) cur[i] = (current[i] ?? 0) > 40 ? 255 : 0;
  const ink = new Float32Array(n);
  const bin = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const dist = Math.hypot(
      (rgba[i * 4] ?? 0) - (paper[0] ?? 0),
      (rgba[i * 4 + 1] ?? 0) - (paper[1] ?? 0),
      (rgba[i * 4 + 2] ?? 0) - (paper[2] ?? 0),
    );
    const v = Math.max(0, Math.min(1, (dist - DIST_FROM) / (DIST_FULL - DIST_FROM)));
    ink[i] = v;
    bin[i] = v > 0.5 ? 255 : 0;
  }
  const r = Math.max(2, Math.round(Math.max(w, h) / 150));
  const closed = boxExtreme(boxExtreme(bin, w, h, r, true), w, h, r, false);
  const pick = pickPet(closed, w, h);
  if (!pick) return new Uint8ClampedArray(n);
  const keep = new Uint8ClampedArray(n);
  const { labels } = maskBlobs(closed, w, h);
  const ids = new Set(pick.pets.map((b) => b.id));
  for (let i = 0; i < n; i++) keep[i] = ids.has(labels[i] ?? 0) ? 255 : 0;
  // 안쪽 구멍 메우기: 가장자리에서 닿는 바깥을 채워 나머지를 안쪽으로
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    const i = y * w + x;
    if (!outside[i] && (keep[i] ?? 0) < 128) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (stack.length > 0) {
    const i = stack.pop() ?? 0;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  const core = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) core[i] = outside[i] ? 0 : 255;
  const near = boxExtreme(core, w, h, 2, true);
  // 지금 마스크 둘레 안으로만
  const gate = boxExtreme(cur, w, h, Math.max(2, Math.round(Math.min(w, h) * 0.05)), true);
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    if (!gate[i]) continue;
    out[i] = core[i] ? 255 : near[i] ? Math.round((ink[i] ?? 0) * 255) : 0;
  }
  return out;
}

/**
 * 털 다듬기. 마스크가 바뀌는 둘레(반투명이 있는 곳 둘레 3r)만 사진 밝기를 길잡이로 다시 계산한다(guided filter).
 * 몸 속(꽉 남김)과 먼 바탕(0)은 그대로라 모양이 변하지 않고 털 끝만 사진 가장자리에 붙는다.
 */
export function furRefine(
  rgba: ArrayLike<number>,
  mask: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8ClampedArray {
  const n = w * h;
  const r = Math.max(2, Math.round(Math.max(w, h) / 220));
  const eps = 2e-4;
  const guide = new Float32Array(n);
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    guide[i] =
      (0.299 * (rgba[i * 4] ?? 0) + 0.587 * (rgba[i * 4 + 1] ?? 0) + 0.114 * (rgba[i * 4 + 2] ?? 0)) / 255;
    p[i] = (mask[i] ?? 0) / 255;
  }
  const mI = boxMean(guide, w, h, r);
  const mp = boxMean(p, w, h, r);
  const ip = guide.map((v, i) => v * (p[i] ?? 0));
  const ii = guide.map((v) => v * v);
  const cIp = boxMean(ip, w, h, r);
  const cII = boxMean(ii, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = (cII[i] ?? 0) - (mI[i] ?? 0) ** 2;
    const cov = (cIp[i] ?? 0) - (mI[i] ?? 0) * (mp[i] ?? 0);
    a[i] = cov / (varI + eps);
    b[i] = (mp[i] ?? 0) - (a[i] ?? 0) * (mI[i] ?? 0);
  }
  const ma = boxMean(a, w, h, r);
  const mb = boxMean(b, w, h, r);
  const band = r * 3;
  const hi = boxExtreme(mask, w, h, band, true);
  const lo = boxExtreme(mask, w, h, band, false);
  const out = Uint8ClampedArray.from(mask);
  for (let i = 0; i < n; i++)
    if ((hi[i] ?? 0) - (lo[i] ?? 0) > 40)
      out[i] = Math.max(0, Math.min(1, (ma[i] ?? 0) * (guide[i] ?? 0) + (mb[i] ?? 0))) * 255;
  return out;
}
