import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageSize, sizeOk } from './image-head.ts';

/** 논리 화면 lw x lh, 장면 하나 fw x fh (left, top) 인 GIF. 그림 데이터는 비어 있다 (머리만 본다) */
function gif(
  lw: number,
  lh: number,
  frames: { w: number; h: number; left?: number; top?: number }[],
): Uint8Array {
  const out: number[] = [...Buffer.from('GIF89a')];
  const u16 = (n: number) => [n & 0xff, n >> 8];
  out.push(...u16(lw), ...u16(lh), 0x80, 0, 0, 0, 0, 0, 255, 255, 255);
  // 그래픽 제어 확장 (건너뛰어야 한다)
  out.push(0x21, 0xf9, 4, 0, 0, 0, 0, 0);
  for (const f of frames)
    out.push(0x2c, ...u16(f.left ?? 0), ...u16(f.top ?? 0), ...u16(f.w), ...u16(f.h), 0, 2, 1, 0x2c, 0);
  out.push(0x3b);
  return Uint8Array.from(out);
}

test('GIF 크기는 논리 화면만이 아니라 장면 크기까지 본다 (버그잡이 4)', () => {
  assert.deepEqual(imageSize(gif(100, 80, [{ w: 100, h: 80 }])), { w: 100, h: 80 });
  // 논리 화면 0x0, 64x64 에 장면 12000x12000: 브라우저는 12000x12000 으로 푼다
  assert.deepEqual(imageSize(gif(0, 0, [{ w: 12000, h: 12000 }])), { w: 12000, h: 12000 });
  assert.equal(sizeOk(gif(0, 0, [{ w: 12000, h: 12000 }])), false);
  assert.equal(sizeOk(gif(64, 64, [{ w: 12000, h: 12000 }])), false);
  // 둘째 장면이 자리를 옮겨 커지는 것도
  assert.equal(
    sizeOk(
      gif(64, 64, [
        { w: 64, h: 64 },
        { w: 10, h: 10, left: 5000, top: 0 },
      ]),
    ),
    false,
  );
  assert.equal(
    sizeOk(
      gif(256, 256, [
        { w: 256, h: 256 },
        { w: 128, h: 128, left: 64, top: 64 },
      ]),
    ),
    true,
  );
  // 장면 없는 머리말만 (예전처럼)
  assert.equal(sizeOk(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00\x00', 'latin1')), true);
});
