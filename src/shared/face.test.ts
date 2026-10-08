import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACE_MAX_CHARS, isFaceUrl } from './face.ts';

test('얼굴 그림은 PNG data URL 만, 상한 안에서만 받는다', () => {
  assert.equal(isFaceUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(isFaceUrl('data:image/png;base64,'), false);
  assert.equal(isFaceUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.equal(isFaceUrl('data:image/png;base64,abc"><script>'), false);
  assert.equal(isFaceUrl('https://example.com/face.png'), false);
  assert.equal(isFaceUrl(null), false);
  assert.equal(isFaceUrl(42), false);
  const big = `data:image/png;base64,${'A'.repeat(FACE_MAX_CHARS)}`;
  assert.equal(isFaceUrl(big), false);
});
