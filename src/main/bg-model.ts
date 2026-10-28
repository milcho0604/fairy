import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { ensureVerified, isVerified, verifyExisting } from './download.ts';
import { type ModelFile, pickModelFile } from './model-pick.ts';

/**
 * 배경 제거 모델 IS-Net 일반 (P1-07 에서 고름, `docs/tests/bg-removal.md`). 2026-10-28 부터 fp16 판(84MB)을 받는다:
 * 같은 가중치를 반 정밀도로 줄인 것이라 입출력은 그대로(float32)고 마스크 차이는 면적 0.1% 이내, WebGPU 에서 227 → 142ms.
 * 앱에 넣지 않고 처음 펫을 만들 때 받는다. 받은 뒤 SHA-256 을 맞춰 본다. 고정한 판(커밋)에서 받는다.
 * 라이선스 위험이 있어 판매, 공개 배포 전에 다시 정한다 (진행표 D7. fp16 판의 받는 곳 카드는 AGPL 로 적혀 있다).
 */
export const BG_MODEL = {
  file: 'isnet-general-use-fp16.onnx',
  url: 'https://huggingface.co/onnx-community/ISNet-ONNX/resolve/3fe6e3db3e32c69aadde61fe388ddb1a0574440c/onnx/model_fp16.onnx',
  sha256: 'dffe20331551dcc5d7601563e472448424821f2df41f5bad395848826c5b5be5',
  bytes: 88_116_798,
  size: 1024,
  mean: [0.5, 0.5, 0.5],
  std: [1, 1, 1],
} as const;

/** 예전 판 (fp32, 170MB). 이미 받은 사람은 지우지도 다시 받지도 않고 그대로 쓴다 */
export const BG_MODEL_OLD: ModelFile = {
  file: 'isnet-general-use.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  bytes: 178_648_008,
};

const pathOf = (file: string) => join(app.getPath('userData'), 'models', file);

/** 지금 쓸 파일 이름 (옛 판이 있으면 옛 판) */
function inUse(): ModelFile {
  return pickModelFile(BG_MODEL, BG_MODEL_OLD, (f) => existsSync(pathOf(f)));
}

/** 지금 쓰는(옛 판이 있으면 옛 판) 파일의 크기. 안내에 나오는 받을 크기를 실제 파일 기준으로 */
export const bgModelBytes = (): number => inUse().bytes;

/** 저장 공간 화면이 두 판의 경로를 다 알 수 있게 */
export const bgModelPaths = () => ({ current: pathOf(BG_MODEL.file), old: pathOf(BG_MODEL_OLD.file) });

export function modelReady(): boolean {
  return existsSync(pathOf(BG_MODEL.file)) || existsSync(pathOf(BG_MODEL_OLD.file));
}

/** 모델 파일을 준비한다. 없으면 받고(진행률 0~1 을 알림), 받은 것은 해시를 맞춘다. 옛 판이 멀쩡하면 그것을 쓴다 */
export async function ensureModel(
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  // 옛 판이 깨졌으면 verifyExisting 이 지워서 아래에서 새 판(84MB)을 받는다
  if (inUse() === BG_MODEL_OLD && (await verifyExisting(pathOf(BG_MODEL_OLD.file), BG_MODEL_OLD.sha256)))
    return pathOf(BG_MODEL_OLD.file);
  return ensureVerified(
    { path: pathOf(BG_MODEL.file), url: BG_MODEL.url, sha256: BG_MODEL.sha256, bytes: BG_MODEL.bytes },
    onProgress,
    signal,
  );
}

/** 해시를 맞춘 모델 파일의 file:// 주소. 아직 안 맞췄으면 undefined (깨진 파일을 열지 않게). */
export function verifiedModelUrl(): string | undefined {
  const f = inUse();
  const path = pathOf(f.file);
  if (isVerified(path)) return pathToFileURL(path).href;
  // 옛 판이 있어도 안 맞췄으면 새 판이 맞춰졌는지도 본다
  const now = pathOf(BG_MODEL.file);
  return isVerified(now) ? pathToFileURL(now).href : undefined;
}
