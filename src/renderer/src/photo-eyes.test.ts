import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { STARTER_EYES, STARTER_IDS } from '../../shared/starter-pets.ts';
import { lidCurve, lidLine, lidSource, photoEyeOpen } from './photo-eyes.ts';

const idle = { mood: 'idle' as const, blink: -1 };

test('사진 눈: 잠은 감고, 졸음은 반쯤, 깜빡임 가운데는 감고, 기본은 뜬다', () => {
  assert.equal(photoEyeOpen(idle), 1);
  assert.equal(photoEyeOpen({ ...idle, mood: 'sleeping' }), 0);
  // 엎드려 자기 (앉기 다 내려감)도 잠이면 감는다
  assert.equal(photoEyeOpen({ ...idle, mood: 'sleeping', activity: { type: 'sit' } }), 0);
  // 자는 동안에는 깜빡임이 와도 감은 그대로
  assert.equal(photoEyeOpen({ ...idle, mood: 'sleeping', blink: 0 }), 0);
  const doze = photoEyeOpen({ ...idle, mood: 'dozing' });
  assert.ok(doze > 0 && doze < 0.5);
  assert.equal(photoEyeOpen({ ...idle, blink: 0.5 }), 0);
  assert.equal(photoEyeOpen({ ...idle, blink: 0 }), 1);
  assert.equal(photoEyeOpen({ ...idle, blink: 0.25 }), 0.5);
});

test('사진 눈: 하품 가운데, 감는 몸짓, 졸린 기운, 흥은 입체 얼굴과 같이', () => {
  assert.equal(photoEyeOpen({ ...idle, activity: { type: 'yawn', t: 0.5 } }), 0);
  assert.equal(photoEyeOpen({ ...idle, activity: { type: 'yawn', t: 0.05 } }), 1);
  assert.equal(photoEyeOpen({ ...idle, moveEyes: 'closed' }), 0);
  assert.equal(photoEyeOpen({ ...idle, moveEyes: 'half' }), 0.5);
  // 놀란 눈은 졸려도 뜬다
  assert.equal(photoEyeOpen({ ...idle, moveEyes: 'wide', energy: { stage: 'sleepy', worn: false } }), 1);
  assert.equal(photoEyeOpen({ ...idle, energy: { stage: 'sleepy', worn: false } }), 0.55);
  assert.equal(photoEyeOpen({ ...idle, energy: { stage: 'tired', worn: true } }), 1);
  assert.equal(photoEyeOpen({ ...idle, mood: 'sulky', sulk: 1 }), 1);
  assert.equal(photoEyeOpen({ ...idle, mood: 'sulky', sulk: 2 }), 0.6);
  // 신남, 잡힘, 생각 중은 사진 그대로 (몸짓으로 보인다)
  for (const mood of ['excited', 'grabbed', 'thinking', 'talking', 'busy'] as const)
    assert.equal(photoEyeOpen({ ...idle, mood }), 1);
});

/** 2차 곡선 가운데 높이 */
const midY = (c: { y0: number; y1: number; cy: number }) => (c.y0 + c.y1) / 4 + c.cy / 2;

test('눈꺼풀 선: 다 감으면 눈 가운데 아래로 처진 선, 뜰수록 위로 올라간다', () => {
  const e = { cx: 100, cy: 50, rx: 10, ry: 8 };
  const shut = lidCurve(e, 0, -1);
  assert.equal(shut.y0, shut.y1);
  assert.ok(midY(shut) > e.cy && midY(shut) < e.cy + e.ry);
  assert.ok(midY(lidCurve(e, 0.5, -1)) < midY(shut));
  assert.ok(midY(lidCurve(e, 1, -1)) < e.cy - e.ry * 0.5);
  assert.ok(shut.x0 < e.cx - e.rx * 0.9 && shut.x1 > e.cx + e.rx * 0.9);
});

test('반쯤 감은 눈은 졸려 보이게: 바깥 눈꼬리가 처지고 가운데가 둥글게 내려온다 (째려보는 일자 눈꺼풀이 아니게)', () => {
  const e = { cx: 100, cy: 50, rx: 10, ry: 8 };
  for (const open of [0.35, 0.5, 0.55]) {
    // 그림 왼쪽 눈(바깥이 왼쪽)과 오른쪽 눈(바깥이 오른쪽)
    const l = lidCurve(e, open, -1);
    const r = lidCurve(e, open, 1);
    assert.ok(l.y0 - l.y1 > e.ry * 0.2, `왼쪽 눈 바깥 처짐 ${open}`);
    assert.ok(r.y1 - r.y0 > e.ry * 0.2, `오른쪽 눈 바깥 처짐 ${open}`);
    // 가운데는 안쪽 눈꼬리보다 아래 (위로 볼록한 눈썹 모양이 아니다)
    assert.ok(midY(l) > l.y1, `가운데가 내려온다 ${open}`);
  }
});

test('감은 눈 선 굵기: 기본 크기(160pt, 사진 높이 124pt, 레티나 2배)에서 3 픽셀 넘게', () => {
  for (const [w, h] of [
    [303, 512],
    [340, 512],
  ] as const) {
    const k = Math.min(140 / w, 124 / h) * 2;
    assert.ok(lidLine(w, h) * k >= 3, `${w}x${h} ${lidLine(w, h) * k}`);
  }
});

/** 8비트 RGBA, 겹침 없는 PNG 만 푼다 (앱에 든 밀크, 초코 그림) */
function readPng(file: string): { w: number; h: number; px: Uint8Array } {
  const b = readFileSync(file);
  let at = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at);
    const type = b.toString('latin1', at + 4, at + 8);
    const body = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      assert.equal(body[8], 8);
      assert.equal(body[9], 6);
      assert.equal(body[12], 0);
    }
    if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] ?? 0;
      const a = x >= 4 ? (px[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (px[(y - 1) * stride + x] ?? 0) : 0;
      const ul = y > 0 && x >= 4 ? (px[(y - 1) * stride + x - 4] ?? 0) : 0;
      let p = v;
      if (f === 1) p = v + a;
      else if (f === 2) p = v + up;
      else if (f === 3) p = v + ((a + up) >> 1);
      else if (f === 4) {
        const q = a + up - ul;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - up);
        const pc = Math.abs(q - ul);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
      }
      px[y * stride + x] = p & 255;
    }
  }
  return { w, h, px };
}

/** 상자 안 불투명 픽셀 중 거의 검은(눈동자) 몫. 초코 곱슬 털 그늘(짙은 갈색)은 넣지 않는다 */
function darkShare(
  img: { w: number; h: number; px: Uint8Array },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  let dark = 0;
  let all = 0;
  for (let y = Math.round(y0); y < Math.round(y1); y++)
    for (let x = Math.round(x0); x < Math.round(x1); x++) {
      const i = (y * img.w + x) * 4;
      if ((img.px[i + 3] ?? 0) < 200) continue;
      all++;
      if ((img.px[i] ?? 0) + (img.px[i + 1] ?? 0) + (img.px[i + 2] ?? 0) < 45) dark++;
    }
  return all ? dark / all : 0;
}

test('밀크, 초코 눈 자리: 그림의 눈동자 위에 있고, 덮개로 가져올 털은 불투명하고 눈동자가 없다', () => {
  for (const id of STARTER_IDS) {
    const img = readPng(fileURLToPath(new URL(`../../../resources/pets/${id}.png`, import.meta.url)));
    const look = STARTER_EYES[id];
    assert.equal(look.eyes.length, 2);
    const [l, r] = look.eyes;
    assert.ok(l && r && l.x < 0.5 && r.x > 0.5, id);
    for (const e of look.eyes) {
      const eye = { cx: e.x * img.w, cy: e.y * img.h, rx: e.rx * img.w, ry: e.ry * img.h };
      // 눈 가운데 반은 눈동자가 크게 차지한다
      const { cx, cy, rx, ry } = eye;
      assert.ok(darkShare(img, cx - rx / 2, cy - ry / 2, cx + rx / 2, cy + ry / 2) > 0.2, `${id} 눈 가운데`);
      // 덮개가 보이는 타원(반지름 1.4 배) 안으로 들어올 털: 다 불투명하고(구멍이 나지 않게) 눈동자가 없다
      // (초코 곱슬 털 그늘이 몇 % 거의 검다)
      const from = lidSource(eye);
      const dy = from.y + from.h / 2 - cy;
      let hole = 0;
      let dark = 0;
      let all = 0;
      for (let y = Math.round(cy - ry * 1.4); y < cy + ry * 1.4; y++)
        for (let x = Math.round(cx - rx * 1.4); x < cx + rx * 1.4; x++) {
          if (Math.hypot((x - cx) / rx, (y - cy) / ry) > 1.4) continue;
          const i = (Math.round(y + dy) * img.w + x) * 4;
          all++;
          if ((img.px[i + 3] ?? 0) < 200) hole++;
          else if ((img.px[i] ?? 0) + (img.px[i + 1] ?? 0) + (img.px[i + 2] ?? 0) < 45) dark++;
        }
      assert.equal(hole, 0, `${id} 덮개 구멍`);
      assert.ok(dark / all < 0.06, `${id} 덮을 털 ${dark / all}`);
    }
  }
});

test('덮개 털은 눈 위 테두리보다 위에서만 가져온다 (밀크 감은 눈 아래 눈 테두리 잔상, 2026-10-12)', () => {
  const e = { cx: 100, cy: 140, rx: 18, ry: 16 };
  const from = lidSource(e);
  // 눈 맨 위(cy - ry)에 닿으면 눈 테두리가 덮개에 같이 실려 감은 눈 선 아래로 비친다
  assert.ok(from.y + from.h <= e.cy - e.ry, `${from.y + from.h} > ${e.cy - e.ry}`);
});

test('덮개 털에 눈 둘레 털과 다른 색 점이 없다 (밀크 이마의 분홍 귀 뿌리 빛이 감은 눈 위에 점으로 실렸다, 2026-10-12)', () => {
  for (const id of STARTER_IDS) {
    const img = readPng(fileURLToPath(new URL(`../../../resources/pets/${id}.png`, import.meta.url)));
    for (const e of STARTER_EYES[id].eyes) {
      const eye = { cx: e.x * img.w, cy: e.y * img.h, rx: e.rx * img.w, ry: e.ry * img.h };
      const { cx, cy, rx, ry } = eye;
      const at = (x: number, y: number) => (Math.round(y) * img.w + Math.round(x)) * 4;
      // 눈 둘레(반지름 1.1~1.6 배) 털의 붉은 기(R-B) 가운데값
      const ring: number[] = [];
      for (let y = cy - ry * 1.6; y < cy + ry * 1.6; y++)
        for (let x = cx - rx * 1.6; x < cx + rx * 1.6; x++) {
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          if (d < 1.1 || d > 1.6) continue;
          const i = at(x, y);
          if ((img.px[i + 3] ?? 0) >= 200) ring.push((img.px[i] ?? 0) - (img.px[i + 2] ?? 0));
        }
      ring.sort((a, b) => a - b);
      const mid = ring[Math.floor(ring.length / 2)] ?? 0;
      // 덮개가 보이는 곳(가장자리 옅은 곳 빼고)으로 올 털에서 둘레보다 25 넘게 붉은 점
      const from = lidSource(eye);
      const dy = from.y + from.h / 2 - cy;
      let tint = 0;
      for (let y = cy - ry * 1.6; y < cy + ry * 1.6; y++)
        for (let x = cx - rx * 1.6; x < cx + rx * 1.6; x++) {
          const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
          if (d > from.w / rx / 2 - 0.1) continue;
          const i = at(x, y + dy);
          if ((img.px[i] ?? 0) - (img.px[i + 2] ?? 0) - mid > 25) tint++;
        }
      assert.equal(tint, 0, `${id} 눈(${Math.round(cx)}) 덮개 색 점`);
    }
  }
});

/** 밝기 (0~255) */
const luma = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

test('초코 감은 눈은 어두운 털 위에서도 보인다: 선은 둘레 털보다 확실히 어둡고, 선 아래 테두리와 눈꺼풀은 털보다 밝다', () => {
  const img = readPng(fileURLToPath(new URL('../../../resources/pets/choco.png', import.meta.url)));
  const look = STARTER_EYES.choco;
  assert.ok(look.edge && look.lid, '초코는 눈꺼풀 빛과 선 아래 테두리가 있다');
  for (const e of look.eyes) {
    const cx = e.x * img.w;
    const cy = e.y * img.h;
    const rx = e.rx * img.w;
    const ry = e.ry * img.h;
    const ring: number[] = [];
    for (let y = cy - ry * 1.4; y < cy + ry * 1.4; y++)
      for (let x = cx - rx * 1.4; x < cx + rx * 1.4; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d < 1.05 || d > 1.4) continue;
        const i = (Math.round(y) * img.w + Math.round(x)) * 4;
        ring.push(0.299 * (img.px[i] ?? 0) + 0.587 * (img.px[i + 1] ?? 0) + 0.114 * (img.px[i + 2] ?? 0));
      }
    ring.sort((a, b) => a - b);
    const fur = ring[Math.floor(ring.length / 2)] ?? 0;
    assert.ok(fur - luma(look.ink) > 45, `선 ${luma(look.ink)} 털 ${fur}`);
    assert.ok(luma(look.edge) - fur > 60, `테두리 ${luma(look.edge)} 털 ${fur}`);
    assert.ok(luma(look.lid.color) > fur, `눈꺼풀 ${luma(look.lid.color)} 털 ${fur}`);
  }
});
