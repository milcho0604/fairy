import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pattern, Vec3 } from './blueprint.ts';
import { hash3, PATTERN_GLSL, patternMask, patternUniforms } from './pattern.ts';

const unit: Vec3 = [1, 1, 1];

test('해시는 늘 같고 0~1 안에 고르게', () => {
  assert.equal(hash3(1, 2, 3), hash3(1, 2, 3));
  assert.notEqual(hash3(1, 2, 3), hash3(1, 2, 4));
  let sum = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const v = hash3(i, i * 7, 512);
    assert.ok(v >= 0 && v <= 1);
    sum += v;
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.05, String(sum / n));
});

test('두 색 나누기: side 쪽이 amount 만큼 무늬 색', () => {
  const belly: Pattern = { type: 'split', color: '#ffffff', side: 'bottom', amount: 0.4 };
  assert.equal(patternMask(belly, [0, -0.9, 0], unit, unit), 1);
  assert.equal(patternMask(belly, [0, 0.9, 0], unit, unit), 0);
  // 경계는 아래에서 40% 자리 (y = -0.2)
  assert.ok(patternMask(belly, [0, -0.3, 0], unit, unit) > 0.5);
  assert.ok(patternMask(belly, [0, -0.1, 0], unit, unit) < 0.5);
  const cap: Pattern = { type: 'split', color: '#4a8fd6', side: 'top', amount: 0.55 };
  assert.equal(patternMask(cap, [0, 0.9, 0.2], unit, unit), 1);
  assert.equal(patternMask(cap, [0, -0.5, 0.2], unit, unit), 0);
  const front: Pattern = { type: 'split', color: '#ffffff', side: 'front' };
  assert.equal(patternMask(front, [0, 0, 0.95], unit, unit), 1);
  assert.equal(patternMask(front, [0, 0, -0.95], unit, unit), 0);
  // 모양 상자가 1 이 아니어도 (캡슐) 비율로 본다
  assert.equal(patternMask(front, [0, 0, 1.9], [1, 2, 2], unit), 1);
});

test('점박이와 줄무늬는 덮는 비율이 amount 를 따라 늘고, 부품이 커도 점 크기가 같다', () => {
  const cover = (pat: Pattern, scale: Vec3) => {
    let on = 0;
    let n = 0;
    for (let x = -1; x <= 1; x += 0.05)
      for (let y = -1; y <= 1; y += 0.05) {
        on += patternMask(pat, [x, y, 1], unit, scale);
        n++;
      }
    return on / n;
  };
  const few = cover({ type: 'spots', color: '#000000', amount: 0.2 }, [0.4, 0.4, 0.4]);
  const many = cover({ type: 'spots', color: '#000000', amount: 0.8 }, [0.4, 0.4, 0.4]);
  assert.ok(few > 0.02 && few < many && many < 0.9, `${few} ${many}`);
  const thin = cover({ type: 'stripes', color: '#000000', amount: 0.25, dir: 'x' }, [0.4, 0.4, 0.4]);
  const thick = cover({ type: 'stripes', color: '#000000', amount: 0.7, dir: 'x' }, [0.4, 0.4, 0.4]);
  assert.ok(thin > 0.1 && thin < thick && thick < 0.9, `${thin} ${thick}`);
  // 같은 세상 자리는 부품 크기와 상관없이 같은 값 (p * scale 이 같으면)
  const a = patternMask({ type: 'spots', color: '#000000' }, [0.5, 0.2, 0.3], unit, [0.4, 0.4, 0.4]);
  const b = patternMask({ type: 'spots', color: '#000000' }, [0.25, 0.1, 0.15], unit, [0.8, 0.8, 0.8]);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('셰이더 uniform 과 GLSL 은 같은 상수를 쓴다', () => {
  const u = patternUniforms({ type: 'stripes', color: '#000000', dir: 'x', amount: 0.3 }, unit, [2, 2, 2]);
  assert.equal(u.uPatType.value, 1);
  assert.equal(u.uPatDir.value, 0);
  assert.equal(u.uPatAmount.value, 0.3);
  assert.deepEqual(u.uPatPartScale.value, [2, 2, 2]);
  for (const name of Object.keys(u))
    assert.ok(PATTERN_GLSL.includes(`uniform`) && PATTERN_GLSL.includes(name), name);
  assert.match(PATTERN_GLSL, /73856093u/);
  assert.match(PATTERN_GLSL, /0\.09 \* uPatScale/);
});
