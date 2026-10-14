// 작은 zip 읽개 (Codex 펫 파일 .codex-pet.zip 을 푸는 데만 쓴다, codex-pet.ts). 남이 준 파일이라 믿지 않는다:
// 디스크에 풀지 않고 메모리에서만, 항목 수와 풀었을 때 크기 상한을 먼저 보고, 이상한 경로(.., 절대 경로, 역슬래시)가
// 하나라도 있으면 통째로 버린다. 저장(0)과 deflate(8)만, 암호와 ZIP64 는 받지 않는다. 푼 뒤 크기와 CRC 도 맞춰 본다.

import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipLimits {
  /** 항목(폴더 포함) 수 상한 */
  entries: number;
  /** 한 항목을 풀었을 때 상한 */
  entryBytes: number;
  /** 모든 항목을 풀었을 때 합 상한 (머리에 적힌 크기로 먼저 본다) */
  totalBytes: number;
}

export interface ZipEntry {
  name: string;
  /** 풀었을 때 크기 (가운데 목록에 적힌 값) */
  size: number;
  /** 풀어서 내용을 준다. 상한을 넘거나 깨졌으면 던진다 */
  read(): Buffer;
}

export class ZipError extends Error {
  readonly kind: 'notZip' | 'unsafe' | 'tooBig';
  constructor(kind: 'notZip' | 'unsafe' | 'tooBig', message: string) {
    super(message);
    this.kind = kind;
  }
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** 항목 이름이 안전한지: 상대 경로, 역슬래시, 널, 드라이브, .. 조각이 없는 것 */
export function safeZipName(name: string): boolean {
  if (!name || name.length > 512 || name.includes('\\') || name.includes('\0')) return false;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((part) => part !== '..' && part !== '.');
}

/** 가운데 목록을 읽어 항목들을 준다. 이상한 경로나 상한 넘침이 있으면 던진다 (ZipError) */
export function zipEntries(buf: Buffer, limits: ZipLimits): ZipEntry[] {
  // 끝 기록(EOCD)은 맨 끝 22바이트에 주석(65535 까지)이 붙을 수 있다: 뒤에서부터 찾는다
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  if (end < 0) throw new ZipError('notZip', 'zip: 끝 기록이 없다');
  const count = buf.readUInt16LE(end + 10);
  const dirSize = buf.readUInt32LE(end + 12);
  const dirAt = buf.readUInt32LE(end + 16);
  if (count === 0xffff || dirAt === 0xffffffff) throw new ZipError('notZip', 'zip: ZIP64 는 받지 않는다');
  if (count > limits.entries) throw new ZipError('tooBig', 'zip: 항목이 너무 많다');
  if (dirAt + dirSize > end) throw new ZipError('notZip', 'zip: 가운데 목록이 깨졌다');
  const out: ZipEntry[] = [];
  let total = 0;
  let at = dirAt;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || buf.readUInt32LE(at) !== CENTRAL)
      throw new ZipError('notZip', 'zip: 목록 항목이 깨졌다');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (!safeZipName(name)) throw new ZipError('unsafe', `zip: 이상한 경로 ${JSON.stringify(name)}`);
    if (flags & 0x1) throw new ZipError('notZip', 'zip: 암호 걸린 항목');
    if (packed === 0xffffffff || size === 0xffffffff || localAt === 0xffffffff)
      throw new ZipError('notZip', 'zip: ZIP64 는 받지 않는다');
    if (size > limits.entryBytes) throw new ZipError('tooBig', 'zip: 항목이 너무 크다');
    total += size;
    if (total > limits.totalBytes) throw new ZipError('tooBig', 'zip: 풀면 너무 크다');
    if (name.endsWith('/')) continue;
    const read = (): Buffer => {
      if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== LOCAL)
        throw new ZipError('notZip', 'zip: 항목 머리가 깨졌다');
      const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
      if (start + packed > buf.length) throw new ZipError('notZip', 'zip: 항목이 중간에 끊겼다');
      const raw = buf.subarray(start, start + packed);
      let data: Buffer;
      if (method === 0) data = raw;
      else if (method === 8) {
        try {
          // 적힌 크기보다 하나 더까지만 푼다: 머리에 작게 적고 크게 풀리는 폭탄을 그 자리에서 끊는다
          data = inflateRawSync(raw, { maxOutputLength: size + 1 });
        } catch {
          throw new ZipError('tooBig', 'zip: 풀기 실패 (깨졌거나 적힌 크기보다 크다)');
        }
      } else throw new ZipError('notZip', `zip: 모르는 압축 방식 ${method}`);
      if (data.length !== size || crc32(data) !== crc)
        throw new ZipError('notZip', 'zip: 크기나 CRC 가 다르다');
      return data;
    };
    out.push({ name, size, read });
  }
  return out;
}
