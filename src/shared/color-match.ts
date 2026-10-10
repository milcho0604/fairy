// 털 다듬기(klein) 뒤 색 되돌리기. klein 은 털을 풍성하게 하면서 털색을 조금 바꿨다 (흰 고양이가 회색, 분홍빛으로,
// 2026-10-10 실제 비교). 다듬기 전 그림(Kontext)의 털색 분포에 맞춘다: 펫 부분(바탕과 다른 칸)의 채널별 평균과 퍼짐을
// 앞 그림과 같게 (Reinhard 색 옮기기를 RGB 로). 바탕은 건드리지 않는다. 화면 없이 시험할 수 있게 배열만 다룬다

export interface Rgba {
  w: number;
  h: number;
  /** RGBA, 길이 w*h*4 */
  data: Uint8ClampedArray;
}

/** 네 귀퉁이 평균을 바탕색으로 본다 (그림 모델에 밝은 단색 바탕을 시켰다) */
function cornerColor(img: Rgba): [number, number, number] {
  const s = Math.max(2, Math.round(Math.min(img.w, img.h) / 40));
  const sum = [0, 0, 0];
  let n = 0;
  for (const [x0, y0] of [
    [0, 0],
    [img.w - s, 0],
    [0, img.h - s],
    [img.w - s, img.h - s],
  ] as const)
    for (let y = y0; y < y0 + s; y++)
      for (let x = x0; x < x0 + s; x++) {
        const i = (y * img.w + x) * 4;
        for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (img.data[i + k] ?? 0);
        n++;
      }
  return [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n];
}

/** 펫 칸 무게 (바탕색과 멀수록 1). 바탕과 거의 같은 칸은 0 */
function weightOf(d: Uint8ClampedArray, i: number, bg: [number, number, number]): number {
  const dist =
    Math.abs((d[i] ?? 0) - bg[0]) + Math.abs((d[i + 1] ?? 0) - bg[1]) + Math.abs((d[i + 2] ?? 0) - bg[2]);
  return Math.max(0, Math.min(1, (dist - 12) / 36));
}

interface Stats {
  mean: [number, number, number];
  std: [number, number, number];
  weight: number;
}

function statsOf(img: Rgba, bg: [number, number, number]): Stats {
  const s1 = [0, 0, 0];
  const s2 = [0, 0, 0];
  let wsum = 0;
  for (let i = 0; i < img.w * img.h * 4; i += 4) {
    const w = weightOf(img.data, i, bg);
    if (w <= 0) continue;
    wsum += w;
    for (let k = 0; k < 3; k++) {
      const v = img.data[i + k] ?? 0;
      s1[k] = (s1[k] ?? 0) + w * v;
      s2[k] = (s2[k] ?? 0) + w * v * v;
    }
  }
  const mean = [0, 1, 2].map((k) => (wsum ? (s1[k] ?? 0) / wsum : 0)) as [number, number, number];
  const std = [0, 1, 2].map((k) =>
    wsum ? Math.sqrt(Math.max(0, (s2[k] ?? 0) / wsum - (mean[k] ?? 0) ** 2)) : 0,
  ) as [number, number, number];
  return { mean, std, weight: wsum };
}

/**
 * 두 그림의 펫 평균색 거리 (채널 차 합, 0~765). 털 다듬기가 색을 크게 바꿨는지 본다
 * (2026-10-10 실제 klein 결과: 갈색 푸들이 하얘지면 403, 푸들 다리가 옅은 황갈색이 되면 95, 가슴에 흰 점이 생기면 77,
 *  흰 고양이가 조금 회색, 분홍빛이 되면 16~42)
 */
export function colorShift(a: Rgba, b: Rgba): number {
  const sa = statsOf(a, cornerColor(a));
  const sb = statsOf(b, cornerColor(b));
  return [0, 1, 2].reduce((sum, k) => sum + Math.abs((sa.mean[k] ?? 0) - (sb.mean[k] ?? 0)), 0);
}

/** 털 다듬기 결과를 버릴 색 거리 (이보다 크면 앞 그림을 쓴다) */
export const MAX_FUR_SHIFT = 85;

/**
 * target 의 펫 색을 ref 의 펫 색 분포에 맞춘다 (target 을 바로 고친다). 펫이 너무 작게 잡히면(바탕만 있는 그림) 그대로.
 * 퍼짐 배율은 0.6~1.6 으로 묶는다 (털 결 대비가 무너지지 않게). 바탕 칸은 무게만큼만 바뀐다
 */
export function matchColors(target: Rgba, ref: Rgba): boolean {
  const tbg = cornerColor(target);
  const rbg = cornerColor(ref);
  const t = statsOf(target, tbg);
  const r = statsOf(ref, rbg);
  const minWeight = 0.02;
  if (t.weight < target.w * target.h * minWeight || r.weight < ref.w * ref.h * minWeight) return false;
  const scale = [0, 1, 2].map((k) => {
    const ts = t.std[k] ?? 0;
    return ts < 1 ? 1 : Math.max(0.6, Math.min(1.6, (r.std[k] ?? 0) / ts));
  });
  const d = target.data;
  for (let i = 0; i < target.w * target.h * 4; i += 4) {
    const w = weightOf(d, i, tbg);
    if (w <= 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = d[i + k] ?? 0;
      const moved = (v - (t.mean[k] ?? 0)) * (scale[k] ?? 1) + (r.mean[k] ?? 0);
      d[i + k] = v + w * (moved - v);
    }
  }
  return true;
}
