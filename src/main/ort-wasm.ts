// 사진 AI 엔진 wasm 을 처음 쓸 때 받는다. 무엇을 어디서 받는지는 src/shared/ort-wasm.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { DownloadError, failReason } from '../shared/download-error.ts';
import { ORT_WASM } from '../shared/ort-wasm.ts';
import { ensureVerified, isVerified } from './download.ts';

export { ORT_WASM };

export function ortWasmPath(): string {
  return join(app.getPath('userData'), 'models', ORT_WASM.file);
}

export function ortWasmReady(): boolean {
  return existsSync(ortWasmPath());
}

/** 다음 주소로 넘어가도 소용없는 실패 (멈춤, 저장 공간, 권한, 이미 받는 중) */
const STOP = new Set(['cancelled', 'disk-full', 'no-permission', 'busy']);

/**
 * 없으면 받고(진행률 0~1), 있으면 해시를 맞춘다. 시험용 JJ_ORT_WASM_URL 이 있으면 그 주소를 먼저 쓴다
 * (해시는 똑같이 맞추니 다른 파일은 못 들어온다)
 */
export async function ensureOrtWasm(
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const urls = [process.env.JJ_ORT_WASM_URL, ...ORT_WASM.urls].filter((u): u is string => !!u);
  let last: unknown = new DownloadError('failed');
  for (const url of urls) {
    try {
      return await ensureVerified(
        { path: ortWasmPath(), url, sha256: ORT_WASM.sha256, bytes: ORT_WASM.bytes },
        onProgress,
        signal,
      );
    } catch (err) {
      if (STOP.has(failReason(err, signal?.aborted))) throw err;
      last = err;
    }
  }
  throw last;
}

/** 해시를 맞춘 wasm 의 file:// 주소. 아직이면 undefined */
export function verifiedOrtWasmUrl(): string | undefined {
  return isVerified(ortWasmPath()) ? pathToFileURL(ortWasmPath()).href : undefined;
}
