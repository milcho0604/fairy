import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DrawState, drawPet } from './draw.ts';

/** 그리기 호출만 적어 두는 가짜 캔버스. 사진을 그릴 때의 회전과 가로 배율을 본다 */
function fakeCtx() {
  const calls: { op: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'calls') return calls;
        if (key === 'measureText') return () => ({ width: 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        return (...args: unknown[]) => {
          calls.push({ op: String(key), args });
        };
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D & { calls: typeof calls };
  return ctx;
}

const photo = { width: 320, height: 212 } as unknown as CanvasImageSource & { width: number; height: number };

/** 사진을 그린 drawImage 바로 앞의 rotate 와 scale */
function photoDraw(s: DrawState) {
  const ctx = fakeCtx();
  drawPet(ctx, s);
  const i = ctx.calls.findIndex((c) => c.op === 'drawImage' && c.args[0] === photo);
  assert.ok(i >= 0, '사진을 그렸다');
  const before = ctx.calls.slice(0, i);
  const rot = before.filter((c) => c.op === 'rotate').at(-1)?.args[0] as number;
  const scale = before.filter((c) => c.op === 'scale').at(-1)?.args as number[];
  const translate = before.filter((c) => c.op === 'translate').at(-1)?.args as number[];
  return { rot, sx: scale[0] ?? Number.NaN, sy: scale[1] ?? Number.NaN, y: translate[1] };
}

const walk = (dir: -1 | 1, phase: number) =>
  ({ type: 'walk', dir, phase, steps: phase * 2, since: 0 }) as unknown as DrawState['activity'];

test('걷기 그림을 넘길 때는 기울이거나 눌리지 않고, 가는 방향대로 뒤집는다', () => {
  for (const phase of [0, 0.13, 0.25, 0.4]) {
    const right = photoDraw({
      mood: 'idle',
      elapsed: 0,
      blink: -1,
      photo,
      photoWalk: 1,
      activity: walk(1, phase),
    });
    assert.equal(right.rot, 0, `오른쪽 phase ${phase}: 기울기 없음`);
    assert.ok(
      Math.abs(right.sx - 1) < 1e-9 && Math.abs(right.sy - 1) < 1e-9,
      `오른쪽 phase ${phase}: 배율 1`,
    );
    const left = photoDraw({
      mood: 'idle',
      elapsed: 0,
      blink: -1,
      photo,
      photoWalk: -1,
      activity: walk(-1, phase),
    });
    assert.ok(Math.abs(left.sx + 1) < 1e-9, `왼쪽 phase ${phase}: 좌우 뒤집힘`);
    assert.equal(left.y, right.y, '발 높이는 같다 (들썩임은 그림 속에 있다)');
  }
});

test('걷기 그림이 없으면 예전처럼 사진 한 장이 걸음마다 까딱인다 (대조군)', () => {
  const tilts = [0.13, 0.25, 0.4].map(
    (phase) => photoDraw({ mood: 'idle', elapsed: 0, blink: -1, photo, activity: walk(1, phase) }).rot,
  );
  assert.ok(
    tilts.some((t) => Math.abs(t) > 1e-3),
    `까딱임 ${tilts.join(', ')}`,
  );
});
