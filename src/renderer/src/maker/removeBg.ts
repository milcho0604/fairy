// 배경 제거 (P1-07 에서 고른 IS-Net). 사진은 이 창 안에서만 다루고 밖으로 보내지 않는다.

import * as ort from 'onnxruntime-web/webgpu';
import { t } from '../../../shared/i18n/index.ts';
import type { MakerInfo } from '../../../shared/ipc.ts';
import { outputToMask } from '../../../shared/mask.ts';
import { ShownError } from './shown-error.ts';

// 엔진 파일(.wasm) 위치는 지정하지 않는다. 1.30 의 GPU 묶음은 asyncify 판을 쓰는데, 다른 판(jsep)을 가리키면
// 'reading Xe' 오류로 멈췄다 (2026-10-02). 빌드 도구가 묶음 옆에 맞는 파일을 내보내고 묶음이 스스로 찾는다.

let session: ort.InferenceSession | undefined;
export let backend = '';

/** 모델을 연다. GPU(WebGPU)가 되면 GPU, 아니면 CPU(wasm). */
export async function openModel(bytes: ArrayBuffer): Promise<void> {
  if (session) return;
  try {
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['webgpu'] });
    backend = 'GPU';
  } catch {
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    backend = 'CPU';
  }
}

/** 사진(작업 크기 w x h 캔버스)에서 마스크(w x h, 0~255)를 만든다. rembg 와 같은 전처리. */
export async function predictMask(photo: HTMLCanvasElement, info: MakerInfo): Promise<Uint8ClampedArray> {
  if (!session) throw new ShownError(t('maker.err.modelNotOpen'));
  const size = info.size;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new ShownError(t('maker.err.canvas'));
  g.imageSmoothingQuality = 'high';
  g.drawImage(photo, 0, 0, size, size);
  const d = g.getImageData(0, 0, size, size).data;
  let max = 1e-6;
  for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0);
  const n = size * size;
  const input = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) {
    for (let ch = 0; ch < 3; ch++) {
      input[ch * n + p] = ((d[p * 4 + ch] ?? 0) / max - (info.mean[ch] ?? 0)) / (info.std[ch] ?? 1);
    }
  }
  const out = await session.run({
    [session.inputNames[0] ?? 'input']: new ort.Tensor('float32', input, [1, 3, size, size]),
  });
  const raw = out[session.outputNames[0] ?? 'output']?.data as Float32Array;
  const small = outputToMask(raw.subarray(0, n));
  // 정사각 마스크를 사진 크기로 늘린다 (캔버스가 부드럽게 보간).
  const m = document.createElement('canvas');
  m.width = size;
  m.height = size;
  const mg = m.getContext('2d');
  const md = mg?.createImageData(size, size);
  if (!mg || !md) throw new ShownError(t('maker.err.canvas'));
  for (let i = 0; i < n; i++) {
    md.data[i * 4 + 3] = small[i] ?? 0;
  }
  mg.putImageData(md, 0, 0);
  const r = document.createElement('canvas');
  r.width = photo.width;
  r.height = photo.height;
  const rg = r.getContext('2d', { willReadFrequently: true });
  if (!rg) throw new ShownError(t('maker.err.canvas'));
  rg.imageSmoothingQuality = 'high';
  rg.drawImage(m, 0, 0, photo.width, photo.height);
  const rd = rg.getImageData(0, 0, photo.width, photo.height).data;
  const mask = new Uint8ClampedArray(photo.width * photo.height);
  for (let i = 0; i < mask.length; i++) mask[i] = rd[i * 4 + 3] ?? 0;
  return mask;
}
