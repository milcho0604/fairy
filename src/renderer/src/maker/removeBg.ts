// 배경 제거 (P1-07 에서 고른 IS-Net). 사진은 이 창 안에서만 다루고 밖으로 보내지 않는다.

import * as ort from 'onnxruntime-web/jspi';
import { t } from '../../../shared/i18n/index.ts';
import type { MakerInfo } from '../../../shared/ipc.ts';
import { dropFaint, letterbox, outputToMask } from '../../../shared/mask.ts';
import { ShownError } from './shown-error.ts';

// 엔진 파일(.wasm) 위치는 지정하지 않는다. 묶음마다 맞는 판이 따로라 다른 판(jsep)을 가리키면 'reading Xe' 오류로
// 멈췄다 (2026-10-02). 빌드 도구가 묶음 옆에 맞는 파일을 내보내고 묶음이 스스로 찾는다.
// GPU 묶음은 JSPI 판을 쓴다: asyncify 판(27MB)과 같은 WebGPU, wasm 을 Electron 44 의 JSPI 로 돌려 17MB 다 (앱 10MB 줄임).
// 같은 사진에 같은 결과, CPU 는 조금 더 빨랐다 (2026-10-10 IS-Net 1024 실측)

let session: ort.InferenceSession | undefined;
export let backend = '';

/** 모델이 열려 있는지. 열려 있으면 178MB 파일을 다시 읽지 않는다 (사진마다 다시 읽었다) */
export const modelOpen = () => !!session;

/** 여는 중인 모델 (그만두고 곧바로 새 사진을 고르면 두 번 열지 않게 같은 것을 기다린다) */
let opening: Promise<void> | undefined;

/** 모델을 연다. GPU(WebGPU)가 되면 GPU, 아니면 CPU(wasm). */
export function openModel(bytes: ArrayBuffer): Promise<void> {
  if (session) return Promise.resolve();
  opening ??= create(bytes).finally(() => {
    opening = undefined;
  });
  return opening;
}

/** GPU 로 연 모델 파일. 첫 GPU 지우기가 성공할 때까지만 들고 있다가(실패하면 CPU 로 다시 연다) 버린다 */
let gpuBytes: Uint8Array | undefined;

async function create(bytes: ArrayBuffer): Promise<void> {
  try {
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['webgpu'] });
    backend = 'GPU';
    gpuBytes = new Uint8Array(bytes);
  } catch {
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    backend = 'CPU';
  }
}

/** 돌리기. GPU 가 열리고도 돌리다 실패하면(드라이버, WebGPU 문제) CPU 로 다시 열어 한 번 더 */
async function run(s: ort.InferenceSession, feeds: Record<string, ort.Tensor>) {
  try {
    const out = await s.run(feeds);
    gpuBytes = undefined;
    return out;
  } catch (err) {
    if (!gpuBytes) throw err;
    const bytes = gpuBytes;
    gpuBytes = undefined;
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    backend = 'CPU';
    return session.run(feeds);
  }
}

/** 앞서 돌던 지우기. 그만두기로 버린 지우기가 아직 돌 때 새 사진이 같은 모델을 겹쳐 돌리지 않게 줄 세운다 */
let running: Promise<unknown> = Promise.resolve();

/**
 * 사진(작업 크기 w x h 캔버스)에서 마스크(w x h, 0~255)를 만든다. rembg 와 같은 전처리.
 * 정사각이 아닌 사진은 늘이지 않고 흰 여백을 붙여 정사각으로 넣는다 (가로로 긴 사진은 펫이 홀쭉하게 눌려 팔이 지워졌다).
 * 모델이 남긴 아주 옅은 값(바탕 얼룩)은 0 으로 (mask.ts dropFaint)
 */
export function predictMask(photo: HTMLCanvasElement, info: MakerInfo): Promise<Uint8ClampedArray> {
  const next = running.then(
    () => runMask(photo, info),
    () => runMask(photo, info),
  );
  running = next.catch(() => undefined);
  return next;
}

async function runMask(photo: HTMLCanvasElement, info: MakerInfo): Promise<Uint8ClampedArray> {
  if (!session) throw new ShownError(t('maker.err.modelNotOpen'));
  const size = info.size;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new ShownError(t('maker.err.canvas'));
  g.imageSmoothingQuality = 'high';
  // 투명한 칸(오려 둔 PNG)은 흰 바탕으로 본다. 그대로면 모델에 검게 보여 검은 테두리가 남았다
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const at = letterbox(photo.width, photo.height, size);
  g.drawImage(photo, at.x, at.y, at.width, at.height);
  const d = g.getImageData(0, 0, size, size).data;
  // 밝기 펴기(rembg 의 im / max)는 사진 자리에서만 잰다. 흰 여백까지 재면 늘 255 라 어두운 사진이 펴지지 않았다.
  // 여백은 사진에서 가장 밝은 값(1)으로 넣는다
  let max = 1e-6;
  for (let y = at.y; y < at.y + at.height; y++)
    for (let x = at.x; x < at.x + at.width; x++) {
      const i = (y * size + x) * 4;
      max = Math.max(max, d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0);
    }
  const n = size * size;
  const input = new Float32Array(3 * n);
  for (let p = 0; p < n; p++) {
    const px = p % size;
    const py = (p - px) / size;
    const pad = px < at.x || py < at.y || px >= at.x + at.width || py >= at.y + at.height;
    for (let ch = 0; ch < 3; ch++) {
      const v = pad ? 1 : (d[p * 4 + ch] ?? 0) / max;
      input[ch * n + p] = (v - (info.mean[ch] ?? 0)) / (info.std[ch] ?? 1);
    }
  }
  const out = await run(session, {
    [session.inputNames[0] ?? 'input']: new ort.Tensor('float32', input, [1, 3, size, size]),
  });
  const raw = out[session.outputNames[0] ?? 'output']?.data as Float32Array;
  const small = outputToMask(raw.subarray(0, n));
  // 정사각 마스크에서 사진이 놓였던 곳만 사진 크기로 늘린다 (캔버스가 부드럽게 보간).
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
  rg.drawImage(m, at.x, at.y, at.width, at.height, 0, 0, photo.width, photo.height);
  const rd = rg.getImageData(0, 0, photo.width, photo.height).data;
  const mask = new Uint8ClampedArray(photo.width * photo.height);
  for (let i = 0; i < mask.length; i++) mask[i] = rd[i * 4 + 3] ?? 0;
  return dropFaint(mask);
}
