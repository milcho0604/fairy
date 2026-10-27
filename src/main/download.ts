import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DownloadError, failReason, statusReason } from '../shared/download-error.ts';
import {
  createStallWatch,
  partComplete,
  partPath,
  partRemovable,
  rangeFrom,
  rangeVerdict,
  STALL_MS,
} from './download-resume.ts';
import { mainFetch } from './net-fetch.ts';

/** 받을 파일. 받은 뒤 SHA-256 을 맞춰 보고, 안 맞으면 버린다 */
export interface VerifiedFile {
  /** 저장할 절대 경로 */
  path: string;
  url: string;
  sha256: string;
  /** 서버가 크기를 안 알려 줄 때 진행률 계산용 */
  bytes: number;
  /**
   * 멈추거나 끊겨도 .part 를 남겨 다음에 그 뒤부터 받는다 (몇 GB 짜리 그림 모델). 해시가 틀리거나
   * 목록 크기를 넘으면 그래도 버린다
   */
  resume?: boolean;
  /** 멈춤으로 볼 시간 (시험용. 기본 STALL_MS) */
  stallMs?: number;
}

export async function sha256Of(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

const verified = new Set<string>();

/** 이미 받아서 해시까지 맞춘 파일인지 (이번 실행에서) */
export const isVerified = (path: string) => verified.has(path);
/** 지운 파일은 다음에 다시 맞춰 본다 */
export const forgetVerified = (path: string) => void verified.delete(path);

/** 지금 받는 중인 파일 (저장 공간에서 지우지 못하게) */
const receiving = new Set<string>();
/** 지금 해시를 맞춰 보는 파일과 그 수 (몇 GB 라 수십 초 걸린다. 그동안도 지우지 못하게) */
const checking = new Map<string, number>();
export const isReceiving = (path: string) => receiving.has(path) || (checking.get(path) ?? 0) > 0;

/**
 * 있는 파일의 해시를 맞춰 본다(실행마다 한 번). 맞추는 동안은 받는 중처럼 표시해 저장 공간에서 지우지 못하게 한다.
 * 안 맞으면 지우고 false (버그잡이 6차: 맞추는 중에 지울 수 있었다)
 */
export async function verifyExisting(path: string, sha256: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  if (verified.has(path)) return true;
  checking.set(path, (checking.get(path) ?? 0) + 1);
  try {
    if ((await sha256Of(path)) === sha256) {
      verified.add(path);
      return true;
    }
  } finally {
    const n = (checking.get(path) ?? 1) - 1;
    if (n > 0) checking.set(path, n);
    else checking.delete(path);
  }
  rmSync(path, { force: true }); // 깨진 파일은 지운다 (다시 받게)
  return false;
}

/**
 * 파일을 준비한다. 있으면 해시를 맞춰 보고(실행마다 한 번), 없거나 깨졌으면 받는다.
 * 받는 동안은 .part 에 쓰고 해시가 맞을 때만 제자리로 옮긴다. 진행률은 0~1.
 */
export async function ensureVerified(
  f: VerifiedFile,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  // 있으면 해시를 맞춰 본다. 깨졌으면 verifyExisting 이 지우고 아래에서 다시 받는다
  if (await verifyExisting(f.path, f.sha256)) return f.path;
  if (receiving.has(f.path)) throw new DownloadError('busy');
  receiving.add(f.path);
  try {
    return await receive(f, onProgress, signal);
  } finally {
    receiving.delete(f.path);
  }
}

const partSize = (part: string) => {
  try {
    return statSync(part).size;
  } catch {
    return 0;
  }
};

async function receive(
  f: VerifiedFile,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
  /** Range 없이 처음부터 (이어 받기가 한 번 어긋나 다시 하는 중) */
  fresh = false,
): Promise<string> {
  mkdirSync(dirname(f.path), { recursive: true });
  // 이어 받는 파일은 .part 를 고정한 해시에 묶는다 (판이 바뀌면 옛 반쪽을 이어 쓰지 않게). 옛 이름은 치운다
  const part = f.resume ? partPath(f.path, f.sha256) : `${f.path}.part`;
  if (f.resume) rmSync(`${f.path}.part`, { force: true });
  const have = f.resume && !fresh ? partSize(part) : 0;
  // 끝까지 받아 두고 해시를 맞추기 전에 멈췄으면(몇 GB 해시는 수십 초) 다시 받지 말고 해시만 본다
  if (partComplete(have, f.bytes)) {
    if ((await sha256Of(part)) === f.sha256) return settle(f, part, onProgress);
    rmSync(part, { force: true });
  }
  const from = rangeFrom(have, f.bytes);
  if (from === 0) rmSync(part, { force: true });
  // 멈춤 감시: 서버 답을 기다리는 동안과 받는 동안 STALL_MS 넘게 바이트가 없으면 끊고 "연결이 끊겼어"로 (버그잡이 4)
  const stallAc = new AbortController();
  let counted: Readable | undefined;
  const stall = createStallWatch(f.stallMs ?? STALL_MS, () => {
    stallAc.abort();
    counted?.destroy(new DownloadError('network'));
  });
  const both = signal ? AbortSignal.any([signal, stallAc.signal]) : stallAc.signal;
  try {
    return await receiveBody();
  } catch (err) {
    // 멈춤으로 끊은 것은 사용자가 그만둔 것이 아니라 연결 문제다 (다시 하면 된다)
    if (stall.stalled && !signal?.aborted) throw new DownloadError('network');
    throw err;
  } finally {
    stall.stop();
  }

  async function receiveBody(): Promise<string> {
    // 앱의 다른 곳(일정, 목록, 업데이트)처럼 Electron net 으로 받는다. Node fetch 는 연결 시간 초과가 잦았다
    const res = await mainFetch(f.url, {
      signal: both,
      ...(from > 0 ? { headers: { Range: `bytes=${from}-` } } : {}),
    });
    stall.kick();
    // 받다 만 것이 서버 파일과 안 맞으면(416) 버리고 처음부터 한 번
    if (from > 0 && res.status === 416) {
      void res.body?.cancel().catch(() => {});
      rmSync(part, { force: true });
      if (fresh) throw new DownloadError('server', res.status);
      stall.stop(); // 다시 받기는 제 감시를 둔다
      return receive(f, onProgress, signal, true);
    }
    if (!res.ok || !res.body)
      throw new DownloadError(res.ok ? 'server' : statusReason(res.status), res.status);
    const verdict = rangeVerdict(res.status, res.headers.get('content-range'), from);
    // 206 인데 부탁한 자리가 아니면 받지 않고 Range 없이 한 번 더 (그래도 어긋나면 서버 탓)
    if (verdict === 'retry') {
      void res.body.cancel().catch(() => {});
      rmSync(part, { force: true });
      if (fresh) throw new DownloadError('server', res.status);
      stall.stop(); // 다시 받기는 제 감시를 둔다
      return receive(f, onProgress, signal, true);
    }
    const resumed = verdict === 'resume';
    const length = Number(res.headers.get('content-length'));
    const total = resumed ? from + (length || f.bytes - from) : length || f.bytes;
    let got = resumed ? from : 0;
    let last = got / total;
    // 목록에 적힌 크기보다 한참 크면 끝까지 받지 않고 멈춘다 (해시는 어차피 틀린다)
    const limit = f.bytes * 1.05;
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    counted = body;
    body.on('data', (chunk: Buffer) => {
      stall.kick();
      got += chunk.length;
      if (got > limit) body.destroy(new DownloadError('hash'));
      const ratio = got / total;
      if (ratio - last >= 0.01) {
        last = ratio;
        onProgress(Math.min(1, ratio));
      }
    });
    try {
      await pipeline(body, createWriteStream(part, { flags: resumed ? 'a' : 'w' }));
    } catch (err) {
      // 이어 받는 파일은 끊기거나 멈춰도 남긴다. 넘쳐서 멈춘 것(hash)과 이어 받지 않는 파일은 버린다
      if (partRemovable(!!f.resume, failReason(err))) rmSync(part, { force: true });
      throw err;
    }
    // 다 받았다: 해시 맞추기(몇 GB 면 수십 초)는 멈춤으로 보지 않는다
    stall.stop();
    if ((await sha256Of(part)) !== f.sha256) {
      rmSync(part, { force: true });
      throw new DownloadError('hash');
    }
    return settle(f, part, onProgress);
  }
}

/** 해시를 맞춘 .part 를 제자리로 */
function settle(f: VerifiedFile, part: string, onProgress: (ratio: number) => void): string {
  renameSync(part, f.path);
  verified.add(f.path);
  onProgress(1);
  return f.path;
}
