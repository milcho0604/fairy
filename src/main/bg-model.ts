import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { ensureVerified, isVerified } from './download.ts';

/**
 * 배경 제거 모델 IS-Net 일반 (P1-07 에서 고름, `docs/tests/bg-removal.md`).
 * 앱에 넣지 않고 처음 펫을 만들 때 원래 배포처에서 받는다. 받은 뒤 SHA-256 을 맞춰 본다.
 * 라이선스 위험이 있어 판매, 공개 배포 전에 다시 정한다 (진행표 D7).
 */
export const BG_MODEL = {
  file: 'isnet-general-use.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  bytes: 178_648_008,
  size: 1024,
  mean: [0.5, 0.5, 0.5],
  std: [1, 1, 1],
} as const;

function modelPath(): string {
  return join(app.getPath('userData'), 'models', BG_MODEL.file);
}

export function modelReady(): boolean {
  return existsSync(modelPath());
}

/** 모델 파일을 준비한다. 없으면 받고(진행률 0~1 을 알림), 받은 것은 해시를 맞춘다. */
export function ensureModel(onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<string> {
  return ensureVerified(
    { path: modelPath(), url: BG_MODEL.url, sha256: BG_MODEL.sha256, bytes: BG_MODEL.bytes },
    onProgress,
    signal,
  );
}

/** 해시를 맞춘 모델 파일의 file:// 주소. 아직 안 맞췄으면 undefined (깨진 파일을 열지 않게). */
export function verifiedModelUrl(): string | undefined {
  return isVerified(modelPath()) ? pathToFileURL(modelPath()).href : undefined;
}
