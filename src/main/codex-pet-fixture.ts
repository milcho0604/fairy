// 시험용 Codex 펫 파일 만들기 (codex-pet.test.ts, scripts/dev/codex-pet-fixture.mjs). 남의 펫을 쓰지 않고
// 단순한 도형(동그란 몸, 눈, 발, 손)으로 1536x1872 그림을 그려 zip 으로 묶는다. 앱 코드는 이 파일을 부르지 않는다.
// PNG 는 거르개 없이(0) 쓰고 읽는다: 시험 그림만 다루면 돼서

import { crc32, deflateRawSync, deflateSync, inflateSync } from 'node:zlib';
import { CODEX_ATLAS, CODEX_ROWS } from '../shared/codex-pet.ts';

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

const pngChunk = (type: string, body: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, body])));
  return Buffer.concat([len, tb, body, crc]);
};

/** RGBA 를 PNG 로 (8비트, 거르개 0) */
export function encodePng(img: Rgba): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++)
    Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** encodePng 가 쓴 PNG 를 다시 RGBA 로 (거르개 0 만) */
export function decodePng(png: Buffer): Rgba {
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error('fixture png: 거르개 0 만 읽는다');
    data.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, data };
}

export function blank(width: number, height: number): Rgba {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function crop(img: Rgba, x: number, y: number, w: number, h: number): Rgba {
  const out = blank(w, h);
  for (let row = 0; row < h; row++)
    out.data.set(
      img.data.subarray(((y + row) * img.width + x) * 4, ((y + row) * img.width + x + w) * 4),
      row * w * 4,
    );
  return out;
}

type Color = readonly [number, number, number];

function fillCircle(img: Rgba, cx: number, cy: number, r: number, c: Color) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(img.height - 1, cy + r); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(img.width - 1, cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r)
        img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4);
}

function fillRect(img: Rgba, x0: number, y0: number, w: number, h: number, c: Color) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++)
    for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++)
      img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4);
}

/** 줄마다 몸 색 (어느 줄 그림이 어느 자세로 갔는지 눈으로 가르게) */
const ROW_COLORS: readonly Color[] = [
  [120, 190, 250], // idle 하늘
  [110, 210, 140], // running-right 초록
  [90, 170, 120], // running-left 진초록
  [250, 200, 80], // waving 노랑
  [250, 140, 190], // jumping 분홍
  [160, 160, 170], // failed 회색
  [250, 160, 90], // waiting 주황
  [170, 140, 240], // running 보라
  [100, 200, 200], // review 청록
];
const INK: Color = [40, 40, 60];

/** 칸 하나에 도형 펫 한 장 (x0, y0 은 칸 왼쪽 위) */
function drawFrame(img: Rgba, x0: number, y0: number, row: number, frame: number) {
  const color = ROW_COLORS[row] ?? ROW_COLORS[0] ?? INK;
  const state = CODEX_ROWS[row]?.state;
  const bob = state === 'jumping' ? -([0, 14, 30, 14, 0][frame % 5] ?? 0) : (frame % 2) * 3;
  const cx = x0 + 96 + (state === 'running-right' ? (frame % 4) * 2 : 0);
  const cy = y0 + 118 + bob;
  // 발 (달리기는 앞뒤로 엇갈린다)
  const step = state === 'running-right' || state === 'running-left' ? ((frame % 4) - 1.5) * 10 : 0;
  fillRect(img, Math.round(cx - 30 + step), cy + 52, 22, 16, INK);
  fillRect(img, Math.round(cx + 8 - step), cy + 52, 22, 16, INK);
  fillCircle(img, cx, cy, 58, color);
  // 눈 (실패는 감은 눈, 서기 셋째 장은 깜빡임)
  const shut = state === 'failed' || (state === 'idle' && frame === 2);
  for (const dx of [-20, 20]) {
    const ex = cx + dx + (state === 'running-right' ? 8 : state === 'running-left' ? -8 : 0);
    if (shut) fillRect(img, ex - 8, cy - 12, 16, 4, INK);
    else fillCircle(img, ex, cy - 12, 6, INK);
  }
  // 손 흔들기: 오른손을 들었다 내린다
  if (state === 'waving') fillRect(img, cx + 50, cy - 40 - ([0, 20, 30, 10][frame % 4] ?? 0), 14, 40, color);
}

export interface SheetOptions {
  /** 그릴 줄 (기본 전부) */
  rows?: readonly number[];
  /** 줄마다 그릴 장 수를 줄인다 ([줄] = 장 수) */
  frames?: Partial<Record<number, number>>;
  /** 비워 둘 칸 ([줄, 칸]) */
  blanks?: readonly (readonly [number, number])[];
  width?: number;
  height?: number;
}

/** 도형 펫 그림 한 장 (1536x1872, 칸 192x208) */
export function drawSheet(o: SheetOptions = {}): Rgba {
  const img = blank(o.width ?? CODEX_ATLAS.width, o.height ?? CODEX_ATLAS.height);
  const rows = o.rows ?? CODEX_ROWS.map((_, i) => i);
  for (const r of rows) {
    const n = o.frames?.[r] ?? CODEX_ROWS[r]?.frames ?? 0;
    for (let c = 0; c < n; c++) {
      if (o.blanks?.some(([br, bc]) => br === r && bc === c)) continue;
      const x0 = c * CODEX_ATLAS.cellW;
      const y0 = r * CODEX_ATLAS.cellH;
      if (x0 + CODEX_ATLAS.cellW <= img.width && y0 + CODEX_ATLAS.cellH <= img.height)
        drawFrame(img, x0, y0, r, c);
    }
  }
  return img;
}

export interface ZipItem {
  name: string;
  data: Buffer;
  /** 저장(0)으로 넣기 (기본 deflate) */
  store?: boolean;
  /** 가운데 목록에 적을 크기 (거짓 크기 시험) */
  claimSize?: number;
}

/** 아주 단순한 zip 쓰개 (가운데 목록 + 끝 기록) */
export function makeZip(items: readonly ZipItem[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const it of items) {
    const name = Buffer.from(it.name, 'utf8');
    const body = it.store ? it.data : deflateRawSync(it.data);
    const method = it.store ? 0 : 8;
    const crc = crc32(it.data);
    const size = it.claimSize ?? it.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** pet.json 글 (hatch-pet 설명의 모양) */
export function petJson(o: { id?: string; displayName?: string; description?: string; sheet?: string } = {}) {
  return Buffer.from(
    JSON.stringify({
      id: o.id ?? 'dot',
      displayName: o.displayName ?? '도트',
      description: o.description ?? '동그란 시험용 펫',
      spritesheetPath: o.sheet ?? 'spritesheet.png',
    }),
  );
}
