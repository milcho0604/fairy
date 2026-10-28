import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { CUTE_POSES } from '../renderer/src/cute2d.ts';
import { validateSubmission } from './gallery.ts';
import {
  cleanSprites,
  decodePet,
  encodePet,
  IMAGE_MAX_BYTES,
  SHARE_FORMAT,
  SHARE_MAX_BYTES,
  type SharedPet,
  THUMB_MAX_BYTES,
} from './pet-share.ts';
import {
  cleanSpriteFiles,
  fillSprites,
  type PetSprites,
  SPRITE_BASE_NAMES,
  SPRITE_EXTRA_NAMES,
  SPRITE_MAX_BYTES,
  SPRITE_NAMES,
  SPRITES_MAX_BYTES,
  spriteFiles,
  walkCount,
} from './pet-sprites.ts';

/** PNG 조각 하나 (CRC 는 앱이 보지 않아 0) */
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

/** w x h PNG data URL. animated 면 APNG(acTL 조각), pad 만큼 덧붙인 글 조각으로 크기를 키운다 */
function png(w: number, h: number, o: { animated?: boolean; pad?: number; seed?: number } = {}): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h, o.seed ?? 0);
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(o.animated ? [chunk('acTL', Buffer.alloc(8))] : []),
    ...(o.pad ? [chunk('tEXt', Buffer.alloc(o.pad, 0x61))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ];
  return `data:image/png;base64,${Buffer.concat(parts).toString('base64')}`;
}

const MAIN = png(8, 8);
/** 이름마다 서로 다른 8x8 그림 (seed 로 바이트가 다르다) */
const fullSet = (): PetSprites =>
  Object.fromEntries(SPRITE_NAMES.map((n, i) => [n, png(8, 8, { seed: i + 1 })])) as PetSprites;

const pet = (o: Partial<SharedPet> = {}): SharedPet => ({
  name: '우사기',
  kind: 'bunny',
  image: MAIN,
  poses: {},
  ...o,
});
const decoded = (p: SharedPet) => {
  const r = decodePet(encodePet(p));
  assert.ok(!('error' in r), JSON.stringify(r));
  return r as SharedPet;
};

test('그림 이름은 기본 페어리 손그림 자세(CUTE_POSES)와 같다', () => {
  assert.deepEqual([...SPRITE_BASE_NAMES], [...CUTE_POSES]);
  // 그림 세트만 갖는 추가 자세가 그 뒤에 붙는다
  assert.deepEqual([...SPRITE_NAMES], [...SPRITE_BASE_NAMES, ...SPRITE_EXTRA_NAMES]);
});

test('형식 왕복: 그림 세트가 이름 그대로 오가고, 판은 2 그대로다', () => {
  const sprites = fullSet();
  const text = encodePet(pet({ sprites }));
  const raw = JSON.parse(text);
  assert.equal(raw.version, 2);
  assert.deepEqual(Object.keys(raw.images.sprites), [...SPRITE_NAMES]);
  assert.deepEqual(decoded(pet({ sprites })).sprites, sprites);
  // 일부만 있어도 (서기는 꼭)
  const some = { idle: png(8, 8), 'walk-0': png(8, 8, { seed: 3 }) };
  assert.deepEqual(decoded(pet({ sprites: some })).sprites, some);
});

test('본 그림이 없거나 서기가 없으면 세트를 쓰지도 읽지도 않는다', () => {
  const sprites = fullSet();
  assert.equal(JSON.parse(encodePet(pet({ image: undefined, sprites }))).images.sprites, undefined);
  const { idle: _idle, ...noIdle } = sprites;
  assert.equal(JSON.parse(encodePet(pet({ sprites: noIdle }))).images.sprites, undefined);
  // 손으로 고친 파일: 본 그림 없이 세트만
  const raw = JSON.parse(encodePet(pet()));
  delete raw.images.main;
  raw.images.sprites = sprites;
  const r = decodePet(JSON.stringify(raw));
  assert.ok(!('error' in r));
  assert.equal((r as SharedPet).sprites, undefined);
});

test('받는 그림: PNG 만, 아는 이름만, 서기와 같은 크기만 (틀린 장은 그 장만 버린다)', () => {
  const idle = png(16, 16);
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
  const gif = `data:image/gif;base64,${Buffer.from('GIF89a\x08\x00\x08\x00\x00\x00\x00;', 'latin1').toString('base64')}`;
  const got = cleanSprites({
    idle,
    sit: png(16, 16, { seed: 2 }),
    sleep: svg,
    happy: gif,
    hungry: png(16, 8),
    grab: png(16, 16, { animated: true }),
    dragon: png(16, 16),
    'walk-0': 'not a picture',
  });
  assert.deepEqual(got, { idle, sit: png(16, 16, { seed: 2 }) });
  // 서기가 SVG 면 세트가 아니다
  assert.equal(cleanSprites({ idle: svg, sit: png(16, 16) }), undefined);
  assert.equal(cleanSprites('x'), undefined);
  assert.equal(cleanSprites([idle]), undefined);
});

test('상한: 한 장 512KB, 한 변 1024px, 세트 합 4MB', () => {
  assert.equal(cleanSprites({ idle: png(8, 8, { pad: SPRITE_MAX_BYTES }) }), undefined);
  assert.ok(cleanSprites({ idle: png(1024, 4) }));
  assert.equal(cleanSprites({ idle: png(1025, 4) }), undefined);
  // 장마다 상한 안이어도 합이 넘으면 세트를 버린다
  const big = SPRITE_MAX_BYTES - 4096;
  const many = Object.fromEntries(
    SPRITE_NAMES.slice(0, Math.ceil(SPRITES_MAX_BYTES / big) + 1).map((n, i) => [
      n,
      png(8, 8, { pad: big, seed: i }),
    ]),
  );
  assert.equal(cleanSprites(many), undefined);
});

test('파일 상한은 가장 큰 파일(그림 넷, 깊이 그림, 작은 그림, 그림 세트)이 들어가는 크기다', () => {
  const b64 = (n: number) => Math.ceil(n / 3) * 4;
  const worst = 4 * b64(IMAGE_MAX_BYTES) + b64(1024 * 1024) + b64(THUMB_MAX_BYTES) + b64(SPRITES_MAX_BYTES);
  assert.ok(worst < SHARE_MAX_BYTES, `${worst} < ${SHARE_MAX_BYTES}`);
  // 옛 앱 상한(48MB) 안의 파일은 옛 앱도 그대로 읽는다 (보통 그림 세트는 1MB 안팎)
  assert.ok(SHARE_MAX_BYTES - worst < 8 * 1024 * 1024, '상한을 쓸데없이 크게 올리지 않았다');
});

test('옛 형식 호환: 세트 없는 판 2, 판 1 파일은 그대로 읽고, 옛 앱이 읽는 칸(main, poses)은 세트가 있어도 그대로다', () => {
  const plain = pet({ poses: { happy: png(8, 8, { seed: 9 }) } });
  const withSet = pet({ poses: plain.poses, sprites: fullSet() });
  const a = JSON.parse(encodePet(plain, { created: '2026-10-13', appVersion: '0.4.2' }));
  const b = JSON.parse(encodePet(withSet, { created: '2026-10-13', appVersion: '0.4.2' }));
  // 옛 앱은 images.sprites 만 모른다: 지우면 세트 없는 파일과 같다
  delete b.images.sprites;
  assert.deepEqual(b, a);
  assert.equal(decoded(plain).sprites, undefined);
  const v1 = decodePet(
    JSON.stringify({ format: SHARE_FORMAT, version: 1, name: '콩', image: MAIN, poses: {} }),
  );
  assert.ok(!('error' in v1));
  assert.equal((v1 as SharedPet).sprites, undefined);
});

test('갤러리는 앱이 버리는 그림 세트 장을 받지 않는다', () => {
  const thumb = png(8, 8, { seed: 7 });
  const ok = encodePet(pet({ thumbnail: thumb, sprites: { idle: png(8, 8) } }), {
    author: '페어리',
  });
  assert.deepEqual(validateSubmission('usagi', ok, ok.length).problems, []);
  const raw = JSON.parse(ok);
  raw.images.sprites.sit = png(4, 4);
  raw.images.sprites.dragon = png(8, 8);
  const text = JSON.stringify(raw);
  const problems = validateSubmission('usagi', text, text.length).problems.join('\n');
  assert.match(problems, /images\.sprites\.sit is broken/);
  assert.match(problems, /unknown field images\.sprites\.dragon/);
});

test('JSON 스키마에 그림 세트 칸이 있고 이름이 같다', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../../docs/schema/jjpet-v2.schema.json', import.meta.url), 'utf8'),
  );
  const sprites = schema.properties.images.properties.sprites;
  assert.deepEqual(Object.keys(sprites.properties), [...SPRITE_NAMES]);
  assert.equal(sprites.additionalProperties, false);
});

test('저장한 세트 검사: 아는 이름과 파일 이름 규칙만, 서기가 없으면 없음', () => {
  assert.deepEqual(
    cleanSpriteFiles({ idle: 'sprite-1-a.png', sit: '../etc/passwd', dragon: 'sprite-2.png', walk: 1 }),
    { idle: 'sprite-1-a.png' },
  );
  assert.equal(cleanSpriteFiles({ sit: 'sprite-1.png' }), undefined);
  assert.equal(cleanSpriteFiles({ idle: 'pet-1.png' }), undefined);
  assert.deepEqual(spriteFiles({ idle: 'sprite-1.png', sit: 'sprite-2.png' }), [
    'sprite-1.png',
    'sprite-2.png',
  ]);
  assert.deepEqual(spriteFiles(undefined), []);
});

test('빠진 자세 채우기: 가까운 그림, 걷기는 있는 장 수로 한 주기, 끝은 서기', () => {
  assert.equal(fillSprites({ sit: 's' }), undefined);
  const full = fillSprites({
    idle: 'i',
    doze: 'd',
    happy: 'h',
    sulky: 'u',
    'talk-0': 't0',
    'walk-0': 'w0',
    'walk-1': 'w1',
    'walk-2': 'w2',
  });
  assert.ok(full);
  assert.equal(full.sleep, 'd');
  assert.equal(full.grab, 'h');
  assert.equal(full.wave, 'h');
  assert.equal(full.back, 'u');
  assert.equal(full['talk-1'], 't0');
  assert.equal(full.blink, 'i');
  assert.equal(full['look-l'], 'i');
  assert.equal(full.sit, 'i');
  assert.deepEqual(
    ['walk-0', 'walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6', 'walk-7'].map(
      (k) => full[k as 'walk-0'],
    ),
    ['w0', 'w1', 'w2', 'w0', 'w1', 'w2', 'w0', 'w1'],
  );
  // 걷기가 없으면 서기로 선다
  assert.equal(fillSprites({ idle: 'i' })?.['walk-3'], 'i');
  assert.equal(Object.keys(fillSprites({ idle: 'i' }) ?? {}).length, SPRITE_NAMES.length);
});

test('걷기 여덟 장 한 주기와 walkCount (이어진 장 수, 최대 여덟)', () => {
  const eight = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`walk-${i}`, `w${i}`]));
  const full = fillSprites({ idle: 'i', ...eight });
  assert.ok(full);
  for (let i = 0; i < 8; i++) assert.equal(full[`walk-${i}` as 'walk-0'], `w${i}`);
  assert.equal(walkCount({ idle: 1, 'walk-0': 1, 'walk-1': 1 }), 2);
  assert.equal(walkCount({ idle: 1, 'walk-1': 1 }), 0, '걷기는 walk-0 부터 이어져야 센다');
  assert.equal(walkCount({ ...eight }), 8);
  assert.equal(walkCount({ idle: 1 }), 0);
});

test('시선: 위, 아래, 대각선은 없으면 같은 쪽 옆 시선이나 위 시선, 끝은 서기', () => {
  const some = fillSprites({ idle: 'i', 'look-l': 'L', 'look-r': 'R' });
  assert.equal(some?.['look-ul'], 'L');
  assert.equal(some?.['look-ur'], 'R');
  assert.equal(some?.['look-u'], 'i');
  assert.equal(some?.['look-d'], 'i');
  const up = fillSprites({ idle: 'i', 'look-u': 'U' });
  assert.equal(up?.['look-ul'], 'U');
  assert.equal(up?.['look-ur'], 'U');
  const own = fillSprites({ idle: 'i', 'look-l': 'L', 'look-ul': 'UL' });
  assert.equal(own?.['look-ul'], 'UL');
});
