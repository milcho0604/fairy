// 2.5D 깊이 (6단계). 사진을 볼 AI 가 없어도 이 창 안에서 깊이 모델(Depth Anything V2 Small)로
// 픽셀마다 가까운 정도를 재고, 펫 화면이 그 값으로 사진을 입체 판으로 만든다. 사진은 밖으로 나가지 않는다.

import * as ort from 'onnxruntime-web/webgpu';
import { t } from '../../../shared/i18n/index.ts';
import type { MakerInfo } from '../../../shared/ipc.ts';
import { ShownError } from './shown-error.ts';

/** 저장할 깊이 그림 긴 변. 펫 화면의 그물 칸(96)보다 넉넉하게 */
const OUT_SIDE = 256;

let session: ort.InferenceSession | undefined;

export async function openDepth(bytes: ArrayBuffer): Promise<void> {
  if (session) return;
  try {
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['webgpu'] });
  } catch {
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
  }
}

/**
 * 배경을 지운 펫 그림에서 회색 깊이 그림(PNG data URL)을 만든다. 같은 비율, 긴 변 256.
 * 가까울수록 밝고 투명한 곳은 검다. 값은 펫 안에서만 펼친다(배경이 범위를 먹지 않게).
 */
export async function predictDepth(img: HTMLImageElement, cfg: MakerInfo['depth']): Promise<string> {
  if (!session) throw new ShownError(t('maker.err.modelNotOpen'));
  const size = cfg.size;
  const c = canvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new ShownError(t('maker.err.canvas'));
  // 투명한 곳은 회색 벽으로 둔다 (모델이 먼 배경으로 본다)
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  g.drawImage(img, 0, 0, size, size);
  const d = g.getImageData(0, 0, size, size).data;
  const n = size * size;
  const input = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) {
    for (let ch = 0; ch < 3; ch++) {
      input[ch * n + p] = ((d[p * 4 + ch] ?? 0) / 255 - (cfg.mean[ch] ?? 0)) / (cfg.std[ch] ?? 1);
    }
  }
  const out = await session.run({
    [session.inputNames[0] ?? 'pixel_values']: new ort.Tensor('float32', input, [1, 3, size, size]),
  });
  const raw = out[session.outputNames[0] ?? 'predicted_depth']?.data as Float32Array;

  // 펫 모양(알파)을 같은 크기로 읽어 펫 안의 값만으로 범위를 정한다 (아래위 2% 는 버린다)
  g.clearRect(0, 0, size, size);
  g.drawImage(img, 0, 0, size, size);
  const alpha = g.getImageData(0, 0, size, size).data;
  const inside: number[] = [];
  for (let p = 0; p < n; p++) if ((alpha[p * 4 + 3] ?? 0) > 128) inside.push(raw[p] ?? 0);
  if (inside.length < 16) throw new ShownError(t('maker.err.allErased'));
  inside.sort((a, b) => a - b);
  const lo = inside[Math.floor(inside.length * 0.02)] ?? 0;
  const hi = inside[Math.floor(inside.length * 0.98)] ?? 1;
  const span = Math.max(1e-6, hi - lo);
  const gray = g.createImageData(size, size);
  for (let p = 0; p < n; p++) {
    const a = (alpha[p * 4 + 3] ?? 0) / 255;
    const v = Math.round(Math.min(1, Math.max(0, ((raw[p] ?? 0) - lo) / span)) * 255 * a);
    gray.data[p * 4] = v;
    gray.data[p * 4 + 1] = v;
    gray.data[p * 4 + 2] = v;
    gray.data[p * 4 + 3] = 255;
  }
  g.putImageData(gray, 0, 0);
  // 원래 비율로 줄인다
  const k = OUT_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  const o = canvas(
    Math.max(1, Math.round(img.naturalWidth * k)),
    Math.max(1, Math.round(img.naturalHeight * k)),
  );
  const og = o.getContext('2d');
  if (!og) throw new ShownError(t('maker.err.canvas'));
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
