import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { ensureVerified, isVerified, verifyExisting } from './download.ts';
import { type ModelFile, pickModelFile } from './model-pick.ts';

/**
 * 깊이 모델 Depth Anything V2 Small (6단계 2.5D). 사진을 볼 AI 가 없는 사람이 사진 펫을 입체 판으로 만들 때 쓴다.
 * Small 만 Apache-2.0 이다 (Base, Large 는 비상업). 2026-10-28 부터 fp16 판(49.6MB)을 처음 쓸 때 받고 해시를 맞춘다:
 * 8비트 판(27MB)은 WebGPU 에서 CPU 로 떨어져 1.8초 걸렸고 fp16 은 0.06초다(깊이 차이 RMS 0.015). 입출력은 같다.
 * 고정한 판(커밋)에서 받아 파일이 바뀌어도 해시가 어긋나지 않는다.
 */
export const DEPTH_MODEL = {
  file: 'depth-anything-v2-small-fp16.onnx',
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_fp16.onnx',
  sha256: '2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04',
  bytes: 49_642_442,
  /** 입력 한 변 (14 의 배수) */
  size: 518,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
} as const;

/** 예전 판 (8비트, 27MB). 이미 받은 사람은 그대로 쓴다 */
export const DEPTH_MODEL_OLD: ModelFile = {
  file: 'depth-anything-v2-small-q8.onnx',
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx',
  sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d',
  bytes: 27_258_801,
};

const pathOf = (file: string) => join(app.getPath('userData'), 'models', file);

function inUse(): ModelFile {
  return pickModelFile(DEPTH_MODEL, DEPTH_MODEL_OLD, (f) => existsSync(pathOf(f)));
}

/** 저장 공간 화면이 두 판의 경로를 다 알 수 있게 */
export const depthModelPaths = () => ({
  current: pathOf(DEPTH_MODEL.file),
  old: pathOf(DEPTH_MODEL_OLD.file),
});

export function depthReady(): boolean {
  return existsSync(pathOf(DEPTH_MODEL.file)) || existsSync(pathOf(DEPTH_MODEL_OLD.file));
}

/** 없으면 받고(진행률 0~1), 있으면 해시를 맞춘다. 옛 판이 멀쩡하면 그것을 쓴다 */
export async function ensureDepthModel(
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (
    inUse() === DEPTH_MODEL_OLD &&
    (await verifyExisting(pathOf(DEPTH_MODEL_OLD.file), DEPTH_MODEL_OLD.sha256))
  )
    return pathOf(DEPTH_MODEL_OLD.file);
  return ensureVerified(
    {
      path: pathOf(DEPTH_MODEL.file),
      url: DEPTH_MODEL.url,
      sha256: DEPTH_MODEL.sha256,
      bytes: DEPTH_MODEL.bytes,
    },
    onProgress,
    signal,
  );
}

/** 해시를 맞춘 파일의 file:// 주소. 아직이면 undefined */
export function verifiedDepthUrl(): string | undefined {
  const path = pathOf(inUse().file);
  if (isVerified(path)) return pathToFileURL(path).href;
  const now = pathOf(DEPTH_MODEL.file);
  return isVerified(now) ? pathToFileURL(now).href : undefined;
}
