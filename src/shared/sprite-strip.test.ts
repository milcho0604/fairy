import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPRITE_NAMES } from './pet-sprites.ts';
import {
  assembleSprites,
  cellEdges,
  chromaKey,
  colorDist,
  dropSpecks,
  FOOT_PAD,
  keyHex,
  measureKey,
  onKey,
  opaqueBox,
  pickKeyColor,
  processStrip,
  type Rgb,
  type Rgba,
  resize,
  rowOf,
  rowsToMake,
  SPRITE_ROWS,
  SPRITE_SIDE,
  type SpriteRow,
  STRIP_H,
  STRIP_W,
  setFrames,
  stopsQueue,
  stripPrompt,
} from './sprite-strip.ts';

const GREEN: Rgb = [0, 255, 0];
const ORANGE: Rgb = [230, 120, 40];

function blank(w: number, h: number, fill: Rgb, a = 255): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([fill[0], fill[1], fill[2], a], i);
  return { width: w, height: h, data };
}
function rect(img: Rgba, x0: number, y0: number, w: number, h: number, c: Rgb, a = 255) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) img.data.set([c[0], c[1], c[2], a], (y * img.width + x) * 4);
}
const px = (img: Rgba, x: number, y: number) => [
  ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4),
];

const ROW: SpriteRow = rowOf('walk') as SpriteRow;

/** 초록 배경에 칸마다 주황 상자 하나 (네 칸, 칸 256). 칸마다 높이를 바꿀 수 있다 */
function strip(o: { bg?: Rgb; heights?: number[]; xs?: number[]; skip?: number } = {}): Rgba {
  const img = blank(STRIP_W, STRIP_H, o.bg ?? GREEN);
  for (let i = 0; i < 4; i++) {
    if (i === o.skip) continue;
    const h = o.heights?.[i] ?? 160;
    rect(img, o.xs?.[i] ?? i * 256 + 68, 220 - h, 120, h, ORANGE);
  }
  return img;
}

test('동작 다섯 줄이 자세 이름을 겹치지 않게 나눠 갖고, 모두 아는 이름이다', () => {
  const names = SPRITE_ROWS.flatMap((r) => r.names);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.ok(SPRITE_NAMES.includes(n));
  for (const r of SPRITE_ROWS) assert.equal(r.frames.length, r.names.length);
  // 서기가 첫 줄 첫 칸이라 무료 횟수가 한 번만 남아도 세트(서기 꼭)가 된다
  assert.equal(SPRITE_ROWS[0]?.names[0], 'idle');
});

test('배경색은 캐릭터 색에서 먼 것을 고른다 (초록 캐릭터면 초록을 피한다)', () => {
  const orange = blank(10, 10, ORANGE);
  assert.deepEqual(pickKeyColor(orange), [0, 255, 0]);
  const green = blank(10, 10, [20, 230, 30]);
  assert.notDeepEqual(pickKeyColor(green), [0, 255, 0]);
  // 투명한 곳은 세지 않는다
  const clear = blank(10, 10, [0, 255, 0], 0);
  assert.deepEqual(pickKeyColor(clear), [0, 255, 0]);
});

test('배경색은 요청한 색이 아니라 띠 가장자리에서 잰다. 단색이 아니면 undefined', () => {
  const s = strip({ bg: [22, 226, 26] });
  assert.deepEqual(measureKey(s, GREEN), [22, 226, 26]);
  assert.equal(measureKey(blank(64, 64, [250, 250, 250]), GREEN), undefined);
});

test('크로마키: 배경은 완전 투명에 색 0, 캐릭터는 그대로, 섞인 테두리는 배경색을 덜어낸다', () => {
  // 배경, 반쯤 섞인 테두리(주황 50% + 초록 50%), 주황, 주황
  const img = blank(4, 1, GREEN);
  img.data.set([115, 188, 20, 255], 4);
  img.data.set([...ORANGE, 255], 8);
  img.data.set([...ORANGE, 255], 12);
  const k = chromaKey(img, GREEN);
  assert.deepEqual(px(k, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(k, 3, 0), [...ORANGE, 255]);
  const [r, g, b, a] = px(k, 1, 0) as number[];
  assert.ok((a ?? 0) > 0 && (a ?? 255) < 255, `알파 ${a}`);
  // 덜어낸 색이 원래 주황에 가깝다 (반반 섞인 색 그대로 두면 r 이 115 로 어둡다)
  assert.ok(Math.abs((r ?? 0) - ORANGE[0]) < 30 && Math.abs((g ?? 0) - ORANGE[1]) < 30, `rgb ${r},${g},${b}`);
});

test('크로마키: 완전 투명 화소에는 어떤 색도 남지 않는다', () => {
  const s = chromaKey(strip({ bg: [10, 240, 12] }), [10, 240, 12]);
  for (let i = 0; i < s.data.length; i += 4)
    if (s.data[i + 3] === 0) assert.deepEqual([s.data[i], s.data[i + 1], s.data[i + 2]], [0, 0, 0]);
});

test('크로마키: 다리 사이처럼 순수한 배경이 없는 좁은 틈도 배경에서 이어지면 지운다', () => {
  // 배경 | 주황 | 섞인 틈 두 칸 | 주황 | 배경. 틈은 위쪽 배경과 이어져 있다
  const img = blank(6, 3, GREEN);
  rect(img, 1, 1, 1, 2, ORANGE);
  rect(img, 4, 1, 1, 2, ORANGE);
  rect(img, 2, 1, 2, 2, [80, 200, 40]);
  const k = chromaKey(img, GREEN);
  assert.ok((px(k, 2, 2)[3] ?? 255) < 200, `틈 알파 ${px(k, 2, 2)[3]}`);
  // 같은 색이라도 배경과 이어지지 않은 넓은 곳은 불투명 (안쪽 초록 무늬. 너무 비슷하면 검사 key 가 잡는다)
  const inner = blank(9, 9, ORANGE);
  rect(inner, 2, 2, 5, 5, [80, 200, 40]);
  assert.equal(px(chromaKey(inner, GREEN), 4, 4)[3], 255);
  // 겹친 두 다리 사이 한 줄 틈 (배경과 안 이어짐): 섞인 화소로 보고 배경색을 덜어낸다
  const legs = blank(7, 5, ORANGE);
  rect(legs, 3, 0, 1, 5, [116, 189, 50]);
  const [lr, lg, , la] = px(chromaKey(legs, GREEN), 3, 2) as number[];
  assert.ok((la ?? 255) < 255 && (lg ?? 255) <= (lr ?? 0), `틈 ${lr},${lg},${la}`);
});

test('크로마키: 테두리의 초록 번짐(불투명이지만 초록이 가장 센 화소)을 깎는다', () => {
  const img = blank(5, 1, GREEN);
  img.data.set([150, 235, 150, 255], 4); // 테두리, 초록 번짐 (배경과 거리가 멀어 불투명)
  img.data.set([...ORANGE, 255], 8);
  img.data.set([...ORANGE, 255], 12);
  const k = chromaKey(img, GREEN);
  const [r, g, , a] = px(k, 1, 0) as number[];
  assert.equal(a, 255);
  assert.ok((g ?? 0) <= (r ?? 0), `번짐이 남음 ${r},${g}`);
  // 안쪽 화소(투명한 곳과 닿지 않음)의 초록은 그대로 둔다 (초록 눈)
  const eye = blank(5, 5, [150, 235, 150]);
  rect(eye, 0, 0, 5, 1, GREEN);
  assert.equal(px(chromaKey(eye, GREEN), 2, 3)[1], 235);
});

test('떨어진 작은 점은 지우고 큰 덩어리는 모두 남긴다', () => {
  const img = blank(100, 40, [0, 0, 0], 0);
  rect(img, 2, 2, 30, 30, ORANGE);
  rect(img, 60, 2, 30, 30, ORANGE);
  rect(img, 45, 35, 2, 2, ORANGE);
  const out = dropSpecks(img);
  assert.equal(px(out, 45, 35)[3], 0);
  assert.equal(px(out, 10, 10)[3], 255);
  assert.equal(px(out, 70, 10)[3], 255);
});

test('칸 경계는 빈 세로줄 구간 가운데, 붙어 있으면 똑같이 나눈다', () => {
  const k = chromaKey(strip({ xs: [40, 300, 560, 820] }), GREEN);
  const { edges, even } = cellEdges(k, 4);
  assert.equal(even, false);
  assert.equal(edges.length, 5);
  assert.equal(edges[0], 0);
  assert.equal(edges[4], STRIP_W);
  // 첫 칸 상자(40~160) 와 둘째(300~420) 사이
  assert.ok((edges[1] ?? 0) > 160 && (edges[1] ?? 0) < 300);
  // 하나로 이어진 띠: 빈 구간이 없다
  const joined = blank(STRIP_W, STRIP_H, GREEN);
  rect(joined, 10, 50, 1000, 150, ORANGE);
  assert.deepEqual(cellEdges(chromaKey(joined, GREEN), 4), { edges: [0, 256, 512, 768, 1024], even: true });
});

test('깨끗한 띠는 문제 없이 네 칸, 칸마다 캐릭터 하나', () => {
  const r = processStrip(strip({ bg: [20, 235, 25] }), ROW, GREEN);
  assert.deepEqual(r.issues, []);
  assert.equal(r.frames.length, 4);
  assert.deepEqual(
    r.frames.map((f) => f.name),
    ['walk-0', 'walk-1', 'walk-2', 'walk-3'],
  );
  for (const f of r.frames) assert.equal((f.box?.right ?? 0) - (f.box?.left ?? 0), 120);
});

test('검사: 빈 칸', () => {
  const r = processStrip(strip({ skip: 2 }), ROW, GREEN);
  assert.ok(r.issues.includes('empty'));
  assert.deepEqual(r.frames[2]?.issues, ['empty']);
});

test('검사: 띠 위나 아래로 잘림', () => {
  const s = strip();
  rect(s, 256 + 68, 0, 120, 220, ORANGE); // 둘째 칸이 위 가장자리에 닿는다
  const r = processStrip(s, ROW, GREEN);
  assert.ok(r.frames[1]?.issues.includes('clipped'));
  assert.ok(!r.frames[0]?.issues.includes('clipped'));
});

test('검사: 캐릭터끼리 붙어 똑같이 나누면 경계에 닿은 칸이 잘림', () => {
  const s = blank(STRIP_W, STRIP_H, GREEN);
  rect(s, 60, 40, 900, 160, ORANGE);
  const r = processStrip(s, ROW, GREEN);
  assert.ok(r.issues.includes('clipped'));
});

test('검사: 배경색이 남음 (캐릭터에 배경색과 비슷한 큰 부분)', () => {
  const s = strip();
  rect(s, 256 + 90, 100, 60, 40, [60, 210, 60]); // 둘째 칸 몸 한가운데 초록빛
  const r = processStrip(s, ROW, GREEN);
  assert.ok(r.frames[1]?.issues.includes('key'), JSON.stringify(r.frames[1]?.issues));
});

test('검사: 배경을 단색으로 안 칠했으면 배경색 남음', () => {
  const s = strip({ bg: [240, 240, 240] });
  const r = processStrip(s, ROW, GREEN);
  assert.ok(r.issues.includes('key'));
});

test('검사: 칸끼리 크기가 튀면 튄 칸을 잡는다 (1.3 배 넘게)', () => {
  const r = processStrip(strip({ heights: [160, 160, 90, 160] }), ROW, GREEN);
  assert.deepEqual(r.frames[2]?.issues, ['jump']);
  assert.deepEqual(r.frames[0]?.issues, []);
  // 조금 다른 것(걸음마다 다리 높이)은 괜찮다
  assert.deepEqual(processStrip(strip({ heights: [160, 150, 140, 155] }), ROW, GREEN).issues, []);
});

test('합치기: 모두 같은 크기, 상자 아래가 바닥선, 가운데 정렬, 한 배율', () => {
  const a = blank(256, 256, [0, 0, 0], 0);
  rect(a, 10, 20, 100, 200, ORANGE);
  const b = blank(256, 256, [0, 0, 0], 0);
  rect(b, 100, 120, 100, 100, ORANGE);
  const out = assembleSprites([
    { name: 'idle', img: a },
    { name: 'sit', img: b },
  ]);
  assert.equal(out.length, 2);
  for (const f of out) {
    assert.equal(f.img.width, SPRITE_SIDE);
    assert.equal(f.img.height, SPRITE_SIDE);
    const box = opaqueBox(f.img);
    assert.equal(box?.bottom, SPRITE_SIDE - FOOT_PAD);
    const mid = ((box?.left ?? 0) + (box?.right ?? 0)) / 2;
    assert.ok(Math.abs(mid - SPRITE_SIDE / 2) <= 1);
  }
  // 앉기는 서기의 절반 키 그대로 (따로 맞추지 않는다)
  const h = (f: Rgba) => (opaqueBox(f)?.bottom ?? 0) - (opaqueBox(f)?.top ?? 0);
  const ratio = h(out[1]?.img as Rgba) / h(out[0]?.img as Rgba);
  assert.ok(Math.abs(ratio - 0.5) < 0.02, `비 ${ratio}`);
  // 빈 칸은 빠진다
  assert.equal(assembleSprites([{ name: 'idle', img: blank(4, 4, [0, 0, 0], 0) }]).length, 0);
});

test('크기 바꾸기는 투명한 곳 색을 테두리로 섞지 않는다', () => {
  const img = blank(4, 4, [0, 255, 0], 0); // 투명하지만 색이 초록인 화소
  rect(img, 0, 0, 2, 4, ORANGE);
  const s = resize(img, 2, 2);
  const [r, g] = px(s, 0, 0) as number[];
  assert.ok((g ?? 0) < (r ?? 0));
  assert.equal(px(s, 1, 1)[3] !== undefined, true);
});

test('기준 그림은 배경색 위에 놓아 불투명하게 보낸다', () => {
  const img = blank(2, 1, [0, 0, 0], 0);
  img.data.set([...ORANGE, 255], 4);
  const k = onKey(img, GREEN);
  assert.deepEqual(px(k, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(px(k, 1, 0), [...ORANGE, 255]);
});

test('요청문: 칸 수, 칸마다 모습, 배경색, 모습 고정이 들어간다', () => {
  const p = stripPrompt(ROW, GREEN);
  assert.match(p, /exactly 4/);
  assert.match(p, /#00FF00/);
  assert.match(p, /identity locked/);
  for (const f of ROW.frames) assert.ok(p.includes(f));
  assert.equal(keyHex([255, 0, 255]), '#FF00FF');
  assert.ok(colorDist(0, 0, 0, [255, 255, 255]) > 0.99);
});

test('멈추는 실패: 무료 횟수, 거절, 토큰, 그만두기. 바쁨과 시간 초과는 다음 동작으로', () => {
  for (const k of ['quota', 'refused', 'auth', 'limit', 'cancelled']) assert.ok(stopsQueue(k), k);
  for (const k of ['busy', 'timeout', 'bad', 'network', 'runtime']) assert.ok(!stopsQueue(k), k);
});

test('다시 만들 동작은 된 것을 빼고 순서대로 (실패한 동작만 다시)', () => {
  const ok = { s: 'ok' as const, frames: [] };
  assert.deepEqual(rowsToMake({}), ['stand', 'walk', 'rest', 'feel', 'talk']);
  assert.deepEqual(rowsToMake({ stand: ok, walk: { s: 'bad', issues: ['key'] }, rest: ok }), [
    'walk',
    'feel',
    'talk',
  ]);
});

test('서기 줄이 없으면 지금 페어리 그림을 받은 칸 키에 맞춰 서기로 넣는다', () => {
  const cell = blank(256, 256, [0, 0, 0], 0);
  rect(cell, 50, 100, 150, 100, ORANGE);
  const own = blank(512, 512, [0, 0, 0], 0);
  rect(own, 100, 50, 300, 400, ORANGE);
  const walk = { s: 'ok' as const, frames: [{ name: 'walk-0' as const, img: cell, issues: [] }] };
  const f = setFrames({ walk }, own);
  assert.deepEqual(
    f.map((x) => x.name),
    ['idle', 'walk-0'],
  );
  assert.equal(f[0]?.img.height, 100);
  // 서기 줄이 있으면 그대로
  const stand = { s: 'ok' as const, frames: [{ name: 'idle' as const, img: cell, issues: [] }] };
  assert.deepEqual(
    setFrames({ stand, walk }, own).map((x) => x.name),
    ['idle', 'walk-0'],
  );
  assert.deepEqual(setFrames({}, own), []);
});

test('크로마키: 밝은 털 테두리의 알파는 가까운 캐릭터 색 쪽으로 잰다 (거리만 쓰면 덜 지워져 초록 테두리)', () => {
  const CREAM: Rgb = [252, 222, 180];
  // 배경, 크림 50% + 초록 50%, 크림, 크림
  const img = blank(4, 1, GREEN);
  img.data.set([126, 239, 90, 255], 4);
  img.data.set([...CREAM, 255], 8);
  img.data.set([...CREAM, 255], 12);
  const a = px(chromaKey(img, GREEN), 1, 0)[3] ?? 0;
  assert.ok(Math.abs(a - 128) < 26, `알파 ${a}`);
});
