// 작은 tar 읽개 (npm 묶음을 푸는 데만 쓴다, llama-bins.ts). 일반 파일과 긴 이름(pax path, GNU L)만 다루고
// 링크, 장치 같은 것은 type 으로 넘겨 부르는 쪽이 버리게 한다. 머리 검사합이 틀리면 멈춘다.

export interface TarEntry {
  name: string;
  /** '0' 일반 파일, '5' 폴더, 그 밖은 tar 의 typeflag 그대로 */
  type: string;
  data: Buffer;
}

const BLOCK = 512;

function field(h: Buffer, from: number, to: number): string {
  const s = h.subarray(from, to);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? s.length : end).toString('utf8');
}

function octal(h: Buffer, from: number, to: number): number {
  const s = field(h, from, to).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error('tar: 숫자 칸이 깨졌다');
  return s ? Number.parseInt(s, 8) : 0;
}

/** 머리 검사합: 검사합 칸(148~156)을 빈칸으로 보고 모든 바이트를 더한다 */
function checksumOk(h: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (h[i] ?? 0);
  return sum === octal(h, 148, 156);
}

/** pax 머리의 path (형식: "길이 key=value\n" 이 이어진다) */
function paxPath(data: Buffer): string | undefined {
  let i = 0;
  let path: string | undefined;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp < 0) break;
    const len = Number.parseInt(data.subarray(i, sp).toString('utf8'), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const rec = data.subarray(sp + 1, i + len - 1).toString('utf8');
    const eq = rec.indexOf('=');
    if (eq > 0 && rec.slice(0, eq) === 'path') path = rec.slice(eq + 1);
    i += len;
  }
  return path;
}

export function* tarEntries(buf: Buffer): Generator<TarEntry> {
  let off = 0;
  let longName: string | undefined;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) return; // 끝 표시
    if (!checksumOk(h)) throw new Error('tar: 머리 검사합이 틀렸다');
    const size = octal(h, 124, 136);
    const flag = h[156] ?? 0;
    const type = flag === 0 ? '0' : String.fromCharCode(flag);
    const prefix = field(h, 257, 263).startsWith('ustar') ? field(h, 345, 500) : '';
    const base = field(h, 0, 100);
    const start = off + BLOCK;
    if (start + size > buf.length) throw new Error('tar: 파일이 중간에 끊겼다');
    const data = buf.subarray(start, start + size);
    off = start + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') {
      longName = paxPath(data) ?? longName;
      continue;
    }
    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'g') continue;
    const name = longName ?? (prefix ? `${prefix}/${base}` : base);
    longName = undefined;
    yield { name, type, data };
  }
}
