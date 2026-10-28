import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { ensureVerified, isVerified, verifyExisting } from './download.ts';

/**
 * 그림용 배경 제거 모델 IS-Net anime (rembg 배포본, SkyTNT anime-segmentation). 만화, 일러스트처럼 사진 모델이
 * 카드 배경과 글자를 남기는 그림을 지운다 (사진에 쓰면 통째로 비는 일이 많아 사진 모델이 조각을 많이 남길 때만 쓴다).
 * 앱에 넣지 않고 처음 필요할 때 받고 SHA-256 을 맞춘다. 사진 모델과 같은 엔진(wasm)을 쓴다.
 * 라이선스 위험은 사진 모델과 같다: 코드는 Apache-2.0 이지만 학습 데이터 약관을 확인하지 못했다 (진행표 D7).
 */
export const ANIME_MODEL = {
  file: 'isnet-anime.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx',
  sha256: 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99',
  bytes: 176_069_933,
  size: 1024,
  mean: [0.485, 0.456, 0.406],
  std: [1, 1, 1],
} as const;

const modelPath = () => join(app.getPath('userData'), 'models', ANIME_MODEL.file);

export const animeModelPath = modelPath;

export function animeReady(): boolean {
  return existsSync(modelPath());
}

/** 없으면 받고(진행률 0~1), 있으면 해시를 맞춘다 */
export function ensureAnimeModel(onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<string> {
  return ensureVerified(
    { path: modelPath(), url: ANIME_MODEL.url, sha256: ANIME_MODEL.sha256, bytes: ANIME_MODEL.bytes },
    onProgress,
    signal,
  );
}

/**
 * 받지 않고 파일이 있고 해시가 맞는지만 본다. 깨진 파일은 지워져 false (verifyExisting). 자동 다시 지우기는 이것만 쓰고
 * 받는 ensureAnimeModel 은 사용자가 단추를 눌렀을 때만 부른다
 */
export async function animeVerified(): Promise<boolean> {
  return existsSync(modelPath()) && (await verifyExisting(modelPath(), ANIME_MODEL.sha256));
}

/** 해시를 맞춘 파일의 file:// 주소. 아직이면 undefined */
export function verifiedAnimeUrl(): string | undefined {
  return isVerified(modelPath()) ? pathToFileURL(modelPath()).href : undefined;
}
