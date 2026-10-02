import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dragRect, fitWithin, isClick, toPixels } from './capture.ts';

const screen = { width: 1512, height: 982 };

test('거꾸로 끌어도 같은 사각형', () => {
  assert.deepEqual(dragRect({ x: 300, y: 200 }, { x: 100, y: 50 }, screen), {
    x: 100,
    y: 50,
    width: 200,
    height: 150,
  });
});

test('모니터 밖으로 끌면 모니터 경계에서 자른다', () => {
  assert.deepEqual(dragRect({ x: 1400, y: 900 }, { x: 1700, y: 1200 }, screen), {
    x: 1400,
    y: 900,
    width: 112,
    height: 82,
  });
  assert.deepEqual(dragRect({ x: 50, y: 50 }, { x: -300, y: -10 }, screen), {
    x: 0,
    y: 0,
    width: 50,
    height: 50,
  });
});

test('조금만 움직였으면 클릭', () => {
  assert.equal(isClick({ x: 0, y: 0, width: 7, height: 300 }), true);
  assert.equal(isClick({ x: 0, y: 0, width: 8, height: 8 }), false);
});

test('배율 2 화면은 픽셀이 두 배', () => {
  const px = toPixels({ x: 100, y: 50, width: 200, height: 150 }, screen, { width: 3024, height: 1964 });
  assert.deepEqual(px, { x: 200, y: 100, width: 400, height: 300 });
});

test('캡처 그림 밖으로는 안 나간다', () => {
  const px = toPixels({ x: 1500, y: 970, width: 12, height: 12 }, screen, { width: 3024, height: 1964 });
  assert.deepEqual(px, { x: 3000, y: 1940, width: 24, height: 24 });
  assert.ok(px.x + px.width <= 3024 && px.y + px.height <= 1964);
});

test('긴 변 기준으로 줄인다', () => {
  assert.deepEqual(fitWithin({ width: 4000, height: 1000 }, 2000), { width: 2000, height: 500 });
  assert.equal(fitWithin({ width: 800, height: 600 }, 2000), undefined);
});
