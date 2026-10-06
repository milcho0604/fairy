import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { t } from '../shared/i18n/index.ts';

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

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

let verified = false;

export function modelReady(): boolean {
  return existsSync(modelPath());
}

/** 모델 파일을 준비한다. 없으면 받고(진행률 0~1 을 알림), 받은 것은 해시를 맞춘다. */
export async function ensureModel(
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const file = modelPath();
  if (existsSync(file)) {
    if (verified) return file;
    if ((await sha256(file)) === BG_MODEL.sha256) {
      verified = true;
      return file;
    }
    rmSync(file, { force: true }); // 깨진 파일은 지우고 다시 받는다
  }
  mkdirSync(join(app.getPath('userData'), 'models'), { recursive: true });
  const part = `${file}.part`;
  const res = await fetch(BG_MODEL.url, { signal });
  if (!res.ok || !res.body) throw new Error(t('main.model.downloadFailed', { status: res.status }));
  const total = Number(res.headers.get('content-length')) || BG_MODEL.bytes;
  let got = 0;
  let last = 0;
  const counted = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on(
    'data',
    (chunk: Buffer) => {
      got += chunk.length;
      const ratio = got / total;
      if (ratio - last >= 0.01) {
        last = ratio;
        onProgress(Math.min(1, ratio));
      }
    },
  );
  await pipeline(counted, createWriteStream(part));
  if ((await sha256(part)) !== BG_MODEL.sha256) {
    rmSync(part, { force: true });
    throw new Error(t('main.model.badHash'));
  }
  renameSync(part, file);
  verified = true;
  onProgress(1);
  return file;
}

/** 해시를 맞춘 모델 파일의 file:// 주소. 아직 안 맞췄으면 undefined (깨진 파일을 열지 않게). */
export function verifiedModelUrl(): string | undefined {
  return verified ? pathToFileURL(modelPath()).href : undefined;
}
