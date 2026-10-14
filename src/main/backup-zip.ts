import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { crc32, deflateRaw, inflateRaw } from 'node:zlib';
import {
  BACKUP_HEADER,
  BACKUP_LIMITS,
  type BackupEntry,
  type BackupHeader,
  entryNameOk,
  makeHeader,
  parseBackupHeader,
} from '../shared/backup-file.ts';

// 개인 백업 파일(.fairybackup) 쓰기와 읽기. 속은 보통 zip 이라 운영체제 압축 풀기로도 열린다.
// 라이브러리 없이 필요한 만큼만 한다: 방식은 저장(0)과 deflate(8)만 쓰고, zip64, 암호, 여러 디스크는 쓰지도 받지도 않는다.
// 읽을 때는 믿지 않는 입력으로 보고 항목 수, 크기, 경로, 머리 파일 판, crc32 와 sha256 을 모두 맞춰 본 뒤에야 쓴다.

const deflate = promisify(deflateRaw);
const inflate = promisify(inflateRaw);

/** 읽기를 거절한 까닭 (화면 글은 backup.ts 가 고른다) */
export type BackupReadReason = 'notBackup' | 'newer' | 'tooBig' | 'damaged' | 'unsafe';

export class BackupReadError extends Error {
  readonly reason: BackupReadReason;
  constructor(reason: BackupReadReason, detail = '') {
    super(`backup ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'BackupReadError';
    this.reason = reason;
  }
}

/** 백업에 넣을 것: zip 안 이름과 디스크의 파일 */
export interface ZipSource {
  name: string;
  path: string;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
/** 이름이 UTF-8 이라는 표시 */
const FLAG_UTF8 = 0x0800;
/** 이미 눌린 그림은 다시 누르지 않는다 (시간만 든다) */
const STORED_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** zip 의 날짜 칸 (MS-DOS 모양, 그 컴퓨터 시각) */
function dosTime(at: number): { time: number; date: number } {
  const d = new Date(at);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Written {
  name: Buffer;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

/**
 * 백업 파일을 쓴다. 옆 임시 파일에 다 쓰고 맨 끝에 이름을 바꾼다: 디스크가 차거나 중간에 꺼져도 반쪽 백업 파일이
 * 그 이름으로 남지 않는다. 합이 상한을 넘으면 쓰지 않고 tooBig (나중에 못 읽을 파일을 만들지 않게)
 */
export async function writeBackupZip(
  target: string,
  sources: readonly ZipSource[],
  meta: { app: string; at: number },
): Promise<BackupHeader> {
  if (sources.length + 1 > BACKUP_LIMITS.entries) throw new BackupReadError('tooBig', 'entries');
  const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(4).toString('hex')}.part`);
  const { time, date } = dosTime(meta.at);
  const written: Written[] = [];
  const entries: BackupEntry[] = [];
  let offset = 0;
  let total = 0;
  let fh: FileHandle | undefined;
  const put = async (buf: Buffer) => {
    let off = 0;
    while (off < buf.length) {
      const r = await (fh as FileHandle).write(buf, off, buf.length - off, offset + off);
      off += r.bytesWritten;
    }
    offset += buf.length;
  };
  const addEntry = async (name: string, data: Buffer) => {
    const store = STORED_EXT.test(name) || data.length === 0;
    let body = store ? data : await deflate(data);
    let method = store ? 0 : 8;
    // 눌러도 커지면 그대로 둔다
    if (method === 8 && body.length >= data.length) {
      body = data;
      method = 0;
    }
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(SIG_LOCAL, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(FLAG_UTF8, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    written.push({ name: nameBuf, method, crc, csize: body.length, usize: data.length, offset });
    await put(head);
    await put(nameBuf);
    await put(body);
  };
  try {
    fh = await open(tmp, 'wx');
    for (const s of sources) {
      // 한 장씩 읽어 넣는다. 읽기 전에 크기를 보아 상한을 넘는 파일을 메모리에 올리지 않는다
      if (total + (await stat(s.path)).size > BACKUP_LIMITS.totalBytes)
        throw new BackupReadError('tooBig', 'total');
      const data = await readFile(s.path);
      total += data.length;
      if (total > BACKUP_LIMITS.totalBytes) throw new BackupReadError('tooBig', 'total');
      entries.push({
        path: s.name,
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
      await addEntry(s.name, data);
    }
    const header = makeHeader(meta.app, meta.at, entries);
    await addEntry(BACKUP_HEADER, Buffer.from(JSON.stringify(header, null, 1), 'utf8'));
    const cdStart = offset;
    for (const w of written) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(SIG_CENTRAL, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(FLAG_UTF8, 8);
      c.writeUInt16LE(w.method, 10);
      c.writeUInt16LE(time, 12);
      c.writeUInt16LE(date, 14);
      c.writeUInt32LE(w.crc, 16);
      c.writeUInt32LE(w.csize, 20);
      c.writeUInt32LE(w.usize, 24);
      c.writeUInt16LE(w.name.length, 28);
      c.writeUInt32LE(w.offset, 42);
      await put(c);
      await put(w.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(written.length, 8);
    end.writeUInt16LE(written.length, 10);
    end.writeUInt32LE(offset - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    await put(end);
    await fh.sync();
    await fh.close();
    fh = undefined;
    await rename(tmp, target);
    return header;
  } catch (err) {
    await fh?.close().catch(() => undefined);
    await rm(tmp, { force: true });
    throw err;
  }
}

interface CentralEntry {
  name: string;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

async function readAt(fh: FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const r = await fh.read(buf, got, len - got, pos + got);
    if (r.bytesRead === 0) throw new BackupReadError('damaged', 'short');
    got += r.bytesRead;
  }
  return buf;
}

/**
 * 백업 파일을 검사하며 outDir(비어 있는 새 폴더)에 푼다. 머리 파일을 돌려준다.
 * topLevel 은 맨 위에 둘 수 있는 파일 이름 (저장 파일과 작은 설정 파일들). 그 밖의 맨 위 항목이나 pets/ 밖 경로는 unsafe.
 * 모든 항목을 다 맞춰 본 뒤 성공한다. 실패하면 푼 것이 남을 수 있어 부르는 쪽이 outDir 를 지운다
 */
export async function extractBackupZip(
  file: string,
  outDir: string,
  topLevel: readonly string[],
): Promise<BackupHeader> {
  let fh: FileHandle;
  try {
    // 파이프나 장치 파일에서 멈추지 않게 막지 않고 연다 (safe-file.ts readPlainCapped 와 같은 까닭)
    fh = await open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch {
    throw new BackupReadError('notBackup', 'open');
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new BackupReadError('notBackup', 'not a file');
    if (st.size > BACKUP_LIMITS.fileBytes) throw new BackupReadError('tooBig', 'file');
    if (st.size < 22) throw new BackupReadError('notBackup', 'small');
    const central = await readCentral(fh, st.size, topLevel);
    const root = resolve(outDir);
    // 머리 파일부터: 판이 높으면 다른 것은 보지 않는다
    const headEntry = central.find((e) => e.name === BACKUP_HEADER);
    if (!headEntry) throw new BackupReadError('notBackup', 'no header');
    if (headEntry.usize > BACKUP_LIMITS.headerBytes) throw new BackupReadError('tooBig', 'header');
    let raw: unknown;
    try {
      raw = JSON.parse((await entryData(fh, headEntry, st.size)).toString('utf8'));
    } catch (err) {
      if (err instanceof BackupReadError) throw err;
      throw new BackupReadError('notBackup', 'header json');
    }
    const parsed = parseBackupHeader(raw);
    if (!parsed.ok) throw new BackupReadError(parsed.reason === 'newer' ? 'newer' : 'notBackup', 'header');
    const header = parsed.header;
    // 머리 파일 목록과 zip 항목이 똑같아야 한다 (빠진 것, 더 들어간 것, 크기 다른 것은 깨진 것으로)
    const files = central.filter((e) => e.name !== BACKUP_HEADER);
    const listed = new Map(header.entries.map((e) => [e.path, e]));
    if (listed.size !== header.entries.length || listed.size !== files.length)
      throw new BackupReadError('damaged', 'list');
    for (const e of header.entries)
      if (!entryNameOk(e.path, topLevel)) throw new BackupReadError('unsafe', 'listed path');
    for (const e of files) {
      const want = listed.get(e.name);
      if (!want || want.size !== e.usize) throw new BackupReadError('damaged', 'list');
    }
    for (const e of files) {
      const data = await entryData(fh, e, st.size);
      const want = listed.get(e.name) as BackupEntry;
      if (createHash('sha256').update(data).digest('hex') !== want.sha256)
        throw new BackupReadError('damaged', 'sha256');
      const out = resolve(root, ...e.name.split('/'));
      if (!out.startsWith(root + sep)) throw new BackupReadError('unsafe', 'escape');
      await mkdir(dirname(out), { recursive: true });
      // wx: 이미 있는 것(같은 이름 두 번, 링크)을 덮거나 따라가지 않는다
      const w = await open(out, 'wx');
      try {
        await w.writeFile(data);
      } finally {
        await w.close();
      }
    }
    return header;
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** 끝 레코드와 가운데 목록을 읽고 항목마다 이름, 크기, 방식을 검사한다 */
async function readCentral(
  fh: FileHandle,
  size: number,
  topLevel: readonly string[],
): Promise<CentralEntry[]> {
  // 끝 레코드는 맨 끝 22바이트 + 설명글(최대 65535) 안에 있다
  const tailLen = Math.min(size, 22 + 0xffff);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let at = -1;
  for (let i = tailLen - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === SIG_END) {
      at = i;
      break;
    }
  if (at < 0) throw new BackupReadError('notBackup', 'no end');
  const disk = tail.readUInt16LE(at + 4);
  const cdDisk = tail.readUInt16LE(at + 6);
  const onDisk = tail.readUInt16LE(at + 8);
  const count = tail.readUInt16LE(at + 10);
  const cdSize = tail.readUInt32LE(at + 12);
  const cdOffset = tail.readUInt32LE(at + 16);
  const endPos = size - tailLen + at;
  // 여러 디스크, zip64 표시(0xffff, 0xffffffff)는 우리가 만드는 모양이 아니다
  if (disk !== 0 || cdDisk !== 0 || onDisk !== count || count === 0xffff || cdOffset === 0xffffffff)
    throw new BackupReadError('notBackup', 'zip64 or multi disk');
  if (count > BACKUP_LIMITS.entries) throw new BackupReadError('tooBig', 'entries');
  if (cdOffset + cdSize > endPos) throw new BackupReadError('damaged', 'central range');
  const cd = await readAt(fh, cdOffset, cdSize);
  const out: CentralEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL)
      throw new BackupReadError('damaged', 'central');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28);
    const elen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    if (p + 46 + nlen > cd.length) throw new BackupReadError('damaged', 'central name');
    const name = cd.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    // 암호(1), 데이터 뒤 크기 기록(8) 같은 것은 우리가 만들지 않는다
    if (flags & 0x0001) throw new BackupReadError('notBackup', 'encrypted');
    if (method !== 0 && method !== 8) throw new BackupReadError('notBackup', 'method');
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff)
      throw new BackupReadError('notBackup', 'zip64');
    // 폴더 항목(끝이 /)은 받지 않는다: 우리 백업에는 없다
    if (name.endsWith('/')) throw new BackupReadError('unsafe', 'directory entry');
    // 절대 경로, .., 역슬래시, pets/ 밖 경로, 모르는 맨 위 파일은 풀지 않는다
    if (!entryNameOk(name, topLevel)) throw new BackupReadError('unsafe', 'path');
    // 같은 이름 두 번 (대소문자만 다른 것도: 맥, 윈도우에서는 같은 파일이다)
    const key = name.toLowerCase();
    if (seen.has(key)) throw new BackupReadError('unsafe', 'duplicate');
    seen.add(key);
    total += usize;
    if (total > BACKUP_LIMITS.totalBytes) throw new BackupReadError('tooBig', 'total');
    out.push({ name, method, crc, csize, usize, offset });
  }
  return out;
}

/** 항목 하나를 읽어 풀고 크기와 crc32 를 맞춘다. 맞지 않거나 못 풀면 damaged */
async function entryData(fh: FileHandle, e: CentralEntry, size: number): Promise<Buffer> {
  const head = await readAt(fh, e.offset, 30);
  if (head.readUInt32LE(0) !== SIG_LOCAL) throw new BackupReadError('damaged', 'local');
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (start + e.csize > size) throw new BackupReadError('damaged', 'range');
  const body = await readAt(fh, start, e.csize);
  let data: Buffer;
  if (e.method === 0) data = body;
  else
    try {
      // 적힌 크기보다 크게 풀리면 멈춘다 (zip 폭탄)
      data = await inflate(body, { maxOutputLength: Math.max(1, e.usize) });
    } catch {
      throw new BackupReadError('damaged', 'inflate');
    }
  if (data.length !== e.usize || crc32(data) >>> 0 !== e.crc) throw new BackupReadError('damaged', 'crc');
  return data;
}
