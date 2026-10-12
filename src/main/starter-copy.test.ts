import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { imageSize } from '../shared/image-head.ts';
import {
  STARTER_IDS,
  STARTER_MAX_BYTES,
  STARTER_WALK_FRAMES,
  type StarterId,
  starterOf,
  starterWalkResource,
} from '../shared/starter-pets.ts';
import { copyStarter, readStarter, readStarterWalk } from './starter-copy.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-starter-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** 가로세로만 맞는 PNG 머리말 (IHDR) */
function png(w: number, h: number, pad = 0): Buffer {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

const resources = join(import.meta.dirname, '..', '..', 'resources', 'pets');

test('앱에 든 밀크, 초코 그림: PNG, 긴 변 512 이하, 상한 안', () => {
  for (const id of STARTER_IDS) {
    const bytes = readStarter(resources, id);
    assert.ok(bytes, id);
    assert.ok(bytes.length <= STARTER_MAX_BYTES);
    const size = imageSize(bytes);
    assert.ok(size && Math.max(size.w, size.h) <= 512 && Math.min(size.w, size.h) > 100, id);
  }
});

test('복사: pets/ 에 pet-<id>-<시각>.png 로, 같은 이름이 있으면 덮지 않고 시각을 늘린다', () => {
  const src = join(root, 'src1');
  const dest = join(root, 'pets1');
  mkdirSync(src);
  writeFileSync(join(src, 'milk.png'), png(300, 500));
  const a = copyStarter(src, dest, 'milk', 1000);
  assert.equal(a, 'pet-milk-1000.png');
  writeFileSync(join(dest, 'pet-milk-1001.png'), 'OTHER');
  const b = copyStarter(src, dest, 'milk', 1000);
  assert.equal(b, 'pet-milk-1002.png');
  assert.equal(readFileSync(join(dest, 'pet-milk-1001.png'), 'utf8'), 'OTHER');
  assert.deepEqual(readFileSync(join(dest, b)), png(300, 500));
  assert.equal(starterOf(b), 'milk');
  // 임시 파일이 남지 않는다
  assert.ok(readdirSync(dest).every((f) => f.endsWith('.png')));
});

test('복사 거절: 없는 그림, PNG 아님, 너무 큼, 터무니없는 가로세로, 링크, 폴더, 모르는 id', () => {
  const src = join(root, 'src2');
  const dest = join(root, 'pets2');
  mkdirSync(src);
  assert.equal(copyStarter(src, dest, 'choco'), undefined);
  writeFileSync(join(src, 'choco.png'), Buffer.from('GIF89a not a png at all'));
  assert.equal(copyStarter(src, dest, 'choco'), undefined);
  writeFileSync(join(src, 'choco.png'), png(300, 500, STARTER_MAX_BYTES));
  assert.equal(copyStarter(src, dest, 'choco'), undefined);
  writeFileSync(join(src, 'choco.png'), png(30000, 30000));
  assert.equal(copyStarter(src, dest, 'choco'), undefined);
  rmSync(join(src, 'choco.png'));
  const outside = join(root, 'outside.png');
  writeFileSync(outside, png(10, 10));
  symlinkSync(outside, join(src, 'choco.png'));
  assert.equal(copyStarter(src, dest, 'choco'), undefined);
  mkdirSync(join(src, 'milk.png'));
  assert.equal(copyStarter(src, dest, 'milk'), undefined);
  assert.equal(readStarter(src, '../outside' as StarterId), undefined);
  // 거절하면 pets/ 에 아무것도 쓰지 않는다 (폴더도 만들지 않는다)
  assert.equal(existsSync(dest), false);
});

test('앱에 든 걷기 그림: 정한 장수가 다 있고 webp, 같은 크기', () => {
  for (const id of STARTER_IDS) {
    const frames = readStarterWalk(resources, id);
    assert.equal(frames.length, STARTER_WALK_FRAMES[id] ?? 0, id);
    const sizes = frames.map((b) => JSON.stringify(imageSize(b)));
    assert.equal(new Set(sizes).size, frames.length > 0 ? 1 : 0, id);
  }
});

test('걷기 그림이 한 장이라도 없거나 webp 가 아니면 빈 배열 (사진 한 장으로 걷는다)', () => {
  const dir = join(root, 'walk');
  mkdirSync(dir, { recursive: true });
  const n = STARTER_WALK_FRAMES.milk ?? 0;
  assert.ok(n > 1);
  for (let i = 0; i < n; i++) {
    const src = readFileSync(join(resources, starterWalkResource('milk', i)));
    writeFileSync(join(dir, starterWalkResource('milk', i)), src);
  }
  assert.equal(readStarterWalk(dir, 'milk').length, n);
  writeFileSync(join(dir, starterWalkResource('milk', 1)), png(320, 184));
  assert.deepEqual(readStarterWalk(dir, 'milk'), []);
  rmSync(join(dir, starterWalkResource('milk', 1)));
  assert.deepEqual(readStarterWalk(dir, 'milk'), []);
  assert.deepEqual(readStarterWalk(dir, 'nope' as StarterId), []);
});
