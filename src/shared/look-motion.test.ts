import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canMagnify,
  FOUND_MS,
  lensSide,
  lookDir,
  magnifierFps,
  magnifierPose,
  sameDir,
  targetOf,
} from './look-motion.ts';
import type { PetMood } from './pet-mood.ts';

const pet = { x: 1000, y: 700, width: 160, height: 160 };
// 머리 자리 (1080, 772)

test('lookDir: 멀어도 그쪽을 본다 (커서 바라보기와 달리 반경이 없다)', () => {
  assert.deepEqual(lookDir(pet, { x: 0, y: 0 }), { x: -1, y: -1 });
  assert.deepEqual(lookDir(pet, { x: 5000, y: 772 }), { x: 1, y: 0 });
  assert.deepEqual(lookDir(pet, { x: 1080, y: 3000 }), { x: 0, y: 1 });
});

test('lookDir: 펫 위나 머리 앞이면 앞을 본다, 0 을 -0 으로 남기지 않는다', () => {
  const d = lookDir(pet, { x: 1079, y: 771 });
  assert.deepEqual(d, { x: 0, y: 0 });
  assert.ok(Object.is(d.x, 0) && Object.is(d.y, 0));
});

test('lookDir: 가로 0.25, 세로 0.5 칸으로 끊는다', () => {
  // dx = 96 → 96 / 192 = 0.5, dy = -72 → -72 / 192 = -0.375 → -0.5
  assert.deepEqual(lookDir(pet, { x: 1176, y: 700 }), { x: 0.5, y: -0.5 });
  for (let x = 0; x < 3000; x += 37) {
    const d = lookDir(pet, { x, y: 500 });
    assert.ok(Number.isInteger(d.x * 4));
    assert.ok(d.x >= -1 && d.x <= 1);
  }
});

test('lookDir: 크기 0 인 펫에서도 숫자가 나온다', () => {
  const d = lookDir({ x: 10, y: 10, width: 0, height: 0 }, { x: 100, y: 0 });
  assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
});

test('sameDir', () => {
  assert.ok(sameDir(undefined, undefined));
  assert.ok(!sameDir({ x: 0, y: 0 }, undefined));
  assert.ok(sameDir({ x: 0.5, y: 1 }, { x: 0.5, y: 1 }));
  assert.ok(!sameDir({ x: 0.5, y: 1 }, { x: 0.25, y: 1 }));
});

test('targetOf: 고른 영역 가운데를 화면 좌표로, 그냥 누르면 모니터 가운데', () => {
  const display = { x: -1440, y: 0, width: 1440, height: 900 };
  assert.deepEqual(targetOf(display, { x: 100, y: 200, width: 40, height: 20 }, false), { x: -1320, y: 210 });
  assert.deepEqual(targetOf(display, { x: 5, y: 5, width: 1, height: 1 }, true), { x: -720, y: 450 });
});

test('canMagnify: 잠, 조는 중, 바쁨, 잡힘, 숨김에서는 돋보기를 들지 않는다', () => {
  const yes: PetMood[] = ['idle', 'sulky', 'excited', 'talking', 'thinking'];
  const no: PetMood[] = ['sleeping', 'dozing', 'busy', 'grabbed', 'hidden'];
  for (const m of yes) assert.ok(canMagnify(m), m);
  for (const m of no) assert.ok(!canMagnify(m), m);
});

test('lensSide: 보는 쪽 눈 앞, 가운데면 오른쪽', () => {
  assert.equal(lensSide({ x: -0.25, y: 0 }), -1);
  assert.equal(lensSide({ x: 0, y: 0 }), 1);
  assert.equal(lensSide({ x: 1, y: -1 }), 1);
});

test('magnifierPose: 고르는 중은 들어 올린 뒤 계속 들고 있다', () => {
  const dir = { x: 0.5, y: 0 };
  const first = magnifierPose('aim', 0, dir);
  assert.equal(first?.alpha, 0);
  const later = magnifierPose('aim', 10_000, dir);
  assert.ok(later);
  assert.equal(later.alpha, 1);
  assert.ok(Math.abs(later.scale - 1) < 1e-9);
  assert.equal(later.sparkle, -1);
  assert.equal(later.hop, 0);
  // 오른쪽을 보면 렌즈도 오른쪽으로, 손잡이는 오른쪽 아래
  assert.ok(later.dx > 0);
  assert.ok(later.angle > 0 && later.angle < Math.PI / 2);
  // 왼쪽을 보면 손잡이는 왼쪽 아래
  const left = magnifierPose('aim', 10_000, { x: -1, y: 0 });
  assert.ok(left && left.angle > Math.PI / 2 && left.angle < Math.PI);
});

test('magnifierPose: 찾았다는 반짝이고 뛴 뒤 내리며 사라지고, 시간이 지나면 남지 않는다', () => {
  const dir = { x: -1, y: -1 };
  const pop = magnifierPose('found', 100, dir);
  assert.ok(pop && pop.sparkle > 0 && pop.hop > 0);
  const mid = magnifierPose('found', 1500, dir);
  assert.ok(mid && mid.sparkle === -1 && mid.alpha === 1 && mid.hop === 0);
  const fading = magnifierPose('found', FOUND_MS - 100, dir);
  assert.ok(fading && fading.alpha > 0 && fading.alpha < 1);
  assert.equal(magnifierPose('found', FOUND_MS, dir), undefined);
  assert.equal(magnifierPose('found', FOUND_MS * 5, dir), undefined);
  assert.equal(magnifierPose('aim', -1, dir), undefined);
});

test('magnifierPose: 그림 훑기는 좌우로 천천히 오간다', () => {
  const dir = { x: 0, y: 0.5 };
  const xs = [0, 600, 1200, 1800].map((ms) => magnifierPose('study', ms + 2400, dir)?.dx ?? Number.NaN);
  assert.ok(Math.max(...xs) > 5 && Math.min(...xs) < -5);
});

test('magnifierPose: 움직임 줄이기면 흔들림, 뜀, 톡 커짐이 없다', () => {
  const dir = { x: 0.5, y: 0.5 };
  const a = magnifierPose('aim', 400, dir, true);
  const b = magnifierPose('aim', 1200, dir, true);
  assert.deepEqual(a, b);
  const f = magnifierPose('found', 120, dir, true);
  assert.ok(f && f.hop === 0 && f.scale === 1);
  assert.equal(magnifierPose('study', 900, dir, true)?.dx, 0);
});

test('magnifierFps: 단계마다 빠르기, 끝나면 0 (타이머가 남지 않는다)', () => {
  assert.equal(magnifierFps('aim', 5000), 20);
  assert.equal(magnifierFps('study', 5000), 12);
  assert.equal(magnifierFps('found', 100), 30);
  assert.equal(magnifierFps('found', FOUND_MS), 0);
  // 움직임 줄이기: 들어 올린 뒤에는 다시 그리지 않는다
  assert.equal(magnifierFps('aim', 5000, true), 0);
  assert.equal(magnifierFps('aim', 10, true), 30);
});
