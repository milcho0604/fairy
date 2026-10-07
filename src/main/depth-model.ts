import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { ensureVerified, isVerified } from './download.ts';

/**
 * 깊이 모델 Depth Anything V2 Small (6단계 2.5D). 사진을 볼 AI 가 없는 사람이 사진 펫을 입체 판으로 만들 때 쓴다.
 * Small 만 Apache-2.0 이다 (Base, Large 는 비상업). 8비트 양자화판 27MB 를 처음 쓸 때 받고 해시를 맞춘다.
 * 고정한 판(커밋)에서 받아 파일이 바뀌어도 해시가 어긋나지 않는다.
 */
export const DEPTH_MODEL = {
  file: 'depth-anything-v2-small-q8.onnx',
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model_quantized.onnx',
  sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d',
  bytes: 27_258_801,
  /** 입력 한 변 (14 의 배수) */
  size: 518,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
} as const;

function depthPath(): string {
  return join(app.getPath('userData'), 'models', DEPTH_MODEL.file);
}

export function depthReady(): boolean {
  return existsSync(depthPath());
}

/** 없으면 받고(진행률 0~1), 있으면 해시를 맞춘다 */
export function ensureDepthModel(onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<string> {
  return ensureVerified(
    { path: depthPath(), url: DEPTH_MODEL.url, sha256: DEPTH_MODEL.sha256, bytes: DEPTH_MODEL.bytes },
    onProgress,
    signal,
  );
}

/** 해시를 맞춘 파일의 file:// 주소. 아직이면 undefined */
export function verifiedDepthUrl(): string | undefined {
  return isVerified(depthPath()) ? pathToFileURL(depthPath()).href : undefined;
}
