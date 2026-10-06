import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { net } from 'electron';
import { t } from '../shared/i18n/index.ts';

/** 받을 파일. 받은 뒤 SHA-256 을 맞춰 보고, 안 맞으면 버린다 */
export interface VerifiedFile {
  /** 저장할 절대 경로 */
  path: string;
  url: string;
  sha256: string;
  /** 서버가 크기를 안 알려 줄 때 진행률 계산용 */
  bytes: number;
}

export async function sha256Of(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

const verified = new Set<string>();

/** 이미 받아서 해시까지 맞춘 파일인지 (이번 실행에서) */
export const isVerified = (path: string) => verified.has(path);
export const markVerified = (path: string) => void verified.add(path);

/**
 * 파일을 준비한다. 있으면 해시를 맞춰 보고(실행마다 한 번), 없거나 깨졌으면 받는다.
 * 받는 동안은 .part 에 쓰고 해시가 맞을 때만 제자리로 옮긴다. 진행률은 0~1.
 */
export async function ensureVerified(
  f: VerifiedFile,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (existsSync(f.path)) {
    if (verified.has(f.path)) return f.path;
    if ((await sha256Of(f.path)) === f.sha256) {
      verified.add(f.path);
      return f.path;
    }
    rmSync(f.path, { force: true }); // 깨진 파일은 지우고 다시 받는다
  }
  mkdirSync(dirname(f.path), { recursive: true });
  const part = `${f.path}.part`;
  // 앱의 다른 곳(일정, 목록, 업데이트)처럼 Electron net 으로 받는다. Node fetch 는 연결 시간 초과가 잦았다
  const res = await net.fetch(f.url, { signal });
  if (!res.ok || !res.body) throw new Error(t('main.model.downloadFailed', { status: res.status }));
  const total = Number(res.headers.get('content-length')) || f.bytes;
  let got = 0;
  let last = 0;
  // 목록에 적힌 크기보다 한참 크면 끝까지 받지 않고 멈춘다 (해시는 어차피 틀린다)
  const limit = f.bytes * 1.05;
  const counted = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream).on(
    'data',
    (chunk: Buffer) => {
      got += chunk.length;
      if (got > limit) counted.destroy(new Error(t('main.model.badHash')));
      const ratio = got / total;
      if (ratio - last >= 0.01) {
        last = ratio;
        onProgress(Math.min(1, ratio));
      }
    },
  );
  try {
    await pipeline(counted, createWriteStream(part));
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
  if ((await sha256Of(part)) !== f.sha256) {
    rmSync(part, { force: true });
    throw new Error(t('main.model.badHash'));
  }
  renameSync(part, f.path);
  verified.add(f.path);
  onProgress(1);
  return f.path;
}
