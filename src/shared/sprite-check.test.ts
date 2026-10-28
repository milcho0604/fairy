import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSprites } from './pet-share.ts';
import { SPRITE_MAX_BYTES, SPRITE_NAMES, SPRITES_MAX_BYTES } from './pet-sprites.ts';
import {
  checkSpriteSet,
  describeSpriteIssue,
  type SpriteFileInfo,
  spriteInfoOf,
  spriteInfosOfFairy,
} from './sprite-check.ts';

const png = (w = 320, h = 320, bytes = 40_000): SpriteFileInfo => ({ kind: 'png', w, h, bytes });
const codes = (r: ReturnType<typeof checkSpriteSet>) =>
  r.issues.map((i) => `${i.level}:${i.code}${i.name ? `:${i.name}` : ''}`);

test('온전한 세트: 문제 없음, 걷기 여덟 장, 모든 자세가 있어 채울 것도 없다', () => {
  const r = checkSpriteSet(Object.fromEntries(SPRITE_NAMES.map((n) => [n, png()])));
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  assert.equal(r.frames, SPRITE_NAMES.length);
  assert.equal(r.walks, 8);
  assert.deepEqual(r.filled, {});
});

test('서기가 없으면 세트 전체를 버린다 (error), 장 수 0', () => {
  const r = checkSpriteSet({ 'walk-0': png() });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['error:noIdle']);
  assert.equal(r.frames, 0);
});

test('틀린 장은 까닭과 함께 그 장만 버린다 (PNG 아님, 큰 파일, 큰 크기, 서기와 다른 크기)', () => {
  const r = checkSpriteSet({
    idle: png(),
    sit: { kind: 'webp', w: 320, h: 320, bytes: 1000 },
    sleep: png(320, 320, SPRITE_MAX_BYTES + 1),
    happy: png(2000, 2000),
    hungry: png(256, 256),
    wave: png(),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r).sort(), [
    'error:badSize:happy',
    'error:notPng:sit',
    'error:sizeMismatch:hungry',
    'error:tooBig:sleep',
    'warn:noWalk',
  ]);
  // 살아남은 장은 서기와 손 흔들기
  assert.equal(r.frames, 2);
});

test('합이 6MB 를 넘으면 세트 전체 문제, 읽히는 장 0', () => {
  const files = Object.fromEntries(
    SPRITE_NAMES.slice(0, 12).map((n) => [n, png(320, 320, Math.ceil(SPRITES_MAX_BYTES / 10))]),
  );
  const r = checkSpriteSet(files);
  assert.ok(codes(r).includes('error:totalTooBig'));
  assert.equal(r.frames, 0);
});

test('걷기: 없음, 적음(끊겨 보임), 빈 곳 뒤 장은 쓰이지 않음', () => {
  assert.deepEqual(codes(checkSpriteSet({ idle: png() })), ['warn:noWalk', 'info:stillSet']);
  const few = checkSpriteSet({ idle: png(), 'walk-0': png(), 'walk-1': png() });
  assert.deepEqual(codes(few), ['info:walkShort']);
  assert.equal(few.walks, 2);
  const gap = checkSpriteSet({ idle: png(), 'walk-0': png(), 'walk-2': png(), 'walk-3': png() });
  assert.deepEqual(codes(gap), ['warn:walkGap:walk-2', 'warn:walkGap:walk-3', 'info:walkShort']);
  assert.equal(gap.walks, 1);
  // walk-0 이 없으면 뒤 장은 하나도 안 쓰인다
  assert.ok(codes(checkSpriteSet({ idle: png(), 'walk-1': png() })).includes('warn:walkGap:walk-1'));
  // 네 장이면 부드러운 것으로 본다
  const four = checkSpriteSet({
    idle: png(),
    'walk-0': png(),
    'walk-1': png(),
    'walk-2': png(),
    'walk-3': png(),
  });
  assert.deepEqual(codes(four), []);
});

test('모르는 이름은 건너뛰고 알려 준다 (warn)', () => {
  const r = checkSpriteSet({
    idle: png(),
    dragon: png(),
    'walk-0': png(),
    'walk-1': png(),
    'walk-2': png(),
    'walk-3': png(),
  });
  assert.deepEqual(codes(r), ['warn:unknownName:dragon']);
  assert.equal(r.ok, true);
});

test('채워지는 자세: 없는 자세와 채우는 그림을 알려 준다 (시선 대각선은 옆 시선, 걷기는 한 주기)', () => {
  const r = checkSpriteSet({
    idle: png(),
    'look-l': png(),
    doze: png(),
    'walk-0': png(),
    'walk-1': png(),
    'walk-2': png(),
    'walk-3': png(),
  });
  assert.equal(r.filled.sleep, 'doze');
  assert.equal(r.filled['look-ul'], 'look-l');
  assert.equal(r.filled['look-u'], 'idle');
  assert.equal(r.filled['walk-4'], 'walk-0');
  assert.equal(r.filled['walk-7'], 'walk-3');
  assert.equal(r.filled['look-l'], undefined);
});

test('설명 글: ko, en 둘 다 모든 코드를 말하고 값이 들어간다', () => {
  const r = checkSpriteSet({
    idle: png(),
    dragon: png(),
    sit: { kind: 'webp', w: 320, h: 320, bytes: 1 },
    sleep: png(320, 320, SPRITE_MAX_BYTES + 1),
    happy: png(2000, 2000),
    hungry: png(256, 256),
    'walk-0': png(),
    'walk-2': png(),
  });
  for (const lang of ['ko', 'en'] as const) {
    const text = r.issues.map((i) => describeSpriteIssue(i, lang));
    assert.ok(
      text.every((s) => s.length > 10 && !s.includes('undefined')),
      text.join('\n'),
    );
  }
  assert.ok(describeSpriteIssue({ level: 'error', code: 'noIdle' }, 'en').includes('idle'));
  assert.ok(describeSpriteIssue({ level: 'error', code: 'noIdle' }, 'ko').includes('서기'));
});

/** 가로세로만 맞는 PNG 머리 (서명 + IHDR) */
function pngHead(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}
const url = (b: Uint8Array) => `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;

test('spriteInfoOf: 머리말에서 형식과 크기를 읽는다', () => {
  assert.deepEqual(spriteInfoOf(pngHead(320, 300)), { bytes: 33, kind: 'png', w: 320, h: 300 });
  assert.deepEqual(spriteInfoOf(new Uint8Array([1, 2, 3])), { bytes: 3 });
});

test('spriteInfosOfFairy: .fairy 글의 images.sprites 를 검사에 넣을 수 있다', () => {
  const text = JSON.stringify({
    format: 'jjakkung-pet',
    version: 2,
    images: { sprites: { idle: url(pngHead(320, 320)), 'walk-0': url(pngHead(320, 320)), sit: 'oops' } },
  });
  const infos = spriteInfosOfFairy(text);
  assert.ok(!('error' in infos));
  assert.equal(infos.idle?.w, 320);
  assert.equal(infos.sit?.kind, undefined);
  const r = checkSpriteSet(infos);
  assert.ok(codes(r).includes('error:notPng:sit'));
  assert.deepEqual(spriteInfosOfFairy(JSON.stringify({ images: {} })), {});
  assert.deepEqual(spriteInfosOfFairy('not json'), { error: 'not JSON' });
  assert.deepEqual(spriteInfosOfFairy(JSON.stringify({ images: { sprites: [] } })), {
    error: 'images.sprites is not an object',
  });
});

/** 머리말만 있는 PNG: 서명, IHDR, (APNG 면 acTL), IDAT, IEND */
function pngBytes(w: number, h: number, apng: boolean): Uint8Array {
  const chunk = (type: string, len: number) => {
    const b = new Uint8Array(12 + len);
    new DataView(b.buffer).setUint32(0, len);
    b.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    return b;
  };
  const ihdr = chunk('IHDR', 13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(8, w);
  dv.setUint32(12, h);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr];
  if (apng) parts.push(chunk('acTL', 8));
  parts.push(chunk('IDAT', 4), chunk('IEND', 0));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const labeled = (label: string, b: Uint8Array) =>
  `data:image/${label};base64,${btoa(String.fromCharCode(...b))}`;

test('spriteInfosOfFairy: 움직이는 PNG(APNG)와 png 가 아닌 이름표는 앱처럼 버린다고 알린다', () => {
  const sprites = {
    idle: labeled('png', pngBytes(32, 32, false)),
    'walk-0': labeled('png', pngBytes(32, 32, true)),
    sit: labeled('webp', pngBytes(32, 32, false)),
    sleep: labeled('png', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])),
    happy: 'data:image/jpeg;base64,AAAA',
    wave: labeled('png', pngBytes(32, 32, false)),
  };
  const infos = spriteInfosOfFairy(JSON.stringify({ images: { sprites } }));
  assert.ok(!('error' in infos));
  const r = checkSpriteSet(infos);
  assert.deepEqual(codes(r).sort(), [
    'error:animated:walk-0',
    'error:notPng:happy',
    'error:notPng:sit',
    'error:notPng:sleep',
    'warn:noWalk',
  ]);
});

test('앱과 같은 판정: 검사기가 통과시킨 장이 cleanSprites 가 남기는 장과 같다', () => {
  const sprites: Record<string, string> = {
    idle: labeled('png', pngBytes(32, 32, false)),
    blink: labeled('png', pngBytes(32, 32, true)),
    'look-l': labeled('webp', pngBytes(32, 32, false)),
    'look-r': labeled('png', pngBytes(16, 16, false)),
    sit: labeled('png', pngBytes(32, 32, false)),
    'walk-0': labeled('png', pngBytes(32, 32, false)),
    'walk-1': labeled('png', pngBytes(32, 32, false)),
  };
  const infos = spriteInfosOfFairy(JSON.stringify({ images: { sprites } }));
  assert.ok(!('error' in infos));
  const r = checkSpriteSet(infos);
  const ok = Object.keys(sprites).filter((n) => !r.issues.some((i) => i.level === 'error' && i.name === n));
  assert.deepEqual(Object.keys(cleanSprites(sprites) ?? {}).sort(), ok.sort());
});
