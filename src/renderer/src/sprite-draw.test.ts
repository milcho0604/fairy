// 가져온 페어리의 2D 그림 세트: 상태마다 어느 그림을 그리는지 (기본 페어리 손그림과 같은 표), 바닥선과 배율 재기
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUTE_POSES, type CutePose } from './cute2d.ts';
import { type DrawState, drawPet } from './draw.ts';
import { type AlphaBox, alphaBox, spriteGeom } from './sprite-geom.ts';

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

/** 자세마다 다른 가짜 그림 (어느 것을 그렸는지 이름으로 안다) */
const pics = Object.fromEntries(CUTE_POSES.map((p) => [p, { name: p }])) as unknown as Record<
  CutePose,
  CanvasImageSource
>;
/** 400x300 그림: 서기는 가운데 200, 바닥 280. 앉기는 바닥 270, 잠은 낮게 눕고 바닥 290 */
const box = (left: number, top: number, right: number, bottom: number): AlphaBox => ({
  left,
  top,
  right,
  bottom,
});
const boxes: Partial<Record<CutePose, AlphaBox>> = Object.fromEntries(
  CUTE_POSES.map((p) => [p, box(150, 80, 250, 280)]),
);
boxes.sit = box(150, 120, 250, 270);
boxes.sleep = box(110, 200, 290, 290);
const geom = spriteGeom(boxes, { w: 400, h: 300 });
assert.ok(geom);
const photo = { width: 100, height: 100 } as unknown as CanvasImageSource & { width: number; height: number };

/** 그린 그림 이름, 좌우 뒤집기, 그림을 놓은 바닥선 */
function drawn(s: Partial<DrawState>) {
  const ctx = fakeCtx();
  drawPet(ctx, { mood: 'idle', elapsed: 0, blink: -1, photo, sprites: { pics, geom }, ...s } as DrawState);
  const i = ctx.calls.findIndex((c) => c.op === 'drawImage');
  assert.ok(i >= 0, '그림을 그렸다');
  const img = ctx.calls[i]?.args[0] as { name?: string };
  const before = ctx.calls.slice(0, i);
  const scale = before.filter((c) => c.op === 'scale').at(-1)?.args as number[];
  const t = before.filter((c) => c.op === 'translate').at(-1)?.args as number[];
  return { pose: img.name, flip: (scale[0] ?? 1) < 0, ground: -(t[1] ?? 0), cx: -(t[0] ?? 0) };
}
const walk = (dir: -1 | 1, steps: number) =>
  ({ type: 'walk', dir, phase: (steps / 2) % 1, steps }) as DrawState['activity'];

test('사진보다 그림 세트가 먼저: 서기, 깜빡임, 커서 쪽 보기', () => {
  assert.equal(drawn({}).pose, 'idle');
  assert.equal(drawn({ blink: 0.5 }).pose, 'blink');
  assert.equal(drawn({ gaze: { x: -0.8, y: 0 } }).pose, 'look-l');
  assert.equal(drawn({ gaze: { x: 0.8, y: 0 } }).pose, 'look-r');
});

test('걷기: 걸음마다 여섯 장을 넘기고 왼쪽으로 가면 뒤집는다', () => {
  const seen = new Set<string | undefined>();
  for (let k = 0; k < 6; k++) {
    const r = drawn({ activity: walk(1, (k + 0.5) / 3) });
    seen.add(r.pose);
    assert.equal(r.flip, false);
  }
  assert.deepEqual([...seen].sort(), ['walk-0', 'walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5']);
  assert.equal(drawn({ activity: walk(-1, 0.1) }).flip, true);
  // 집 문으로 들어갈 때는 등
  assert.equal(
    drawn({ activity: { ...walk(1, 0.1), facing: 'away' } as DrawState['activity'] }).pose,
    'back',
  );
});

test('앉기, 토라짐(세기별), 말하기 번갈기, 잠, 들림, 신남', () => {
  assert.equal(drawn({ activity: { type: 'sit' } }).pose, 'sit');
  assert.equal(drawn({ mood: 'sulky', pout: 1 }).pose, 'sulky');
  assert.equal(drawn({ mood: 'sulky', pout: 3 }).pose, 'back');
  assert.equal(drawn({ mood: 'talking', elapsed: 0 }).pose, 'talk-0');
  assert.equal(drawn({ mood: 'talking', elapsed: 200 }).pose, 'talk-1');
  assert.equal(drawn({ mood: 'sleeping' }).pose, 'sleep');
  assert.equal(drawn({ mood: 'grabbed' }).pose, 'grab');
  assert.equal(drawn({ mood: 'excited' }).pose, 'happy');
  assert.equal(drawn({ hungry: true }).pose, 'hungry');
});

test('바닥선 맞춤: 자세마다 잰 상자 아래를 바닥에, 가운데는 서기 가운데', () => {
  assert.equal(drawn({}).ground, 280);
  assert.equal(drawn({ activity: { type: 'sit' } }).ground, 270);
  assert.equal(drawn({ mood: 'sleeping' }).ground, 290);
  assert.equal(drawn({ mood: 'sleeping' }).cx, 200);
});

test('자리 재기: 불투명한 상자, 서기 키로 배율, 키 큰 자세와 넓은 자세도 캔버스 안', () => {
  const w = 6;
  const h = 5;
  const data = new Uint8ClampedArray(w * h * 4);
  const on = (x: number, y: number, a = 255) => {
    data[(y * w + x) * 4 + 3] = a;
  };
  on(2, 1);
  on(4, 3);
  on(0, 4, 10); // 흐린 가장자리는 뺀다
  assert.deepEqual(alphaBox(data, w, h), { left: 2, top: 1, right: 5, bottom: 4 });
  assert.equal(alphaBox(new Uint8ClampedArray(w * h * 4), w, h), undefined);

  // 서기 키 200 이면 캔버스에서 125
  assert.ok(geom);
  assert.ok(Math.abs((280 - 80) * geom.scale - 125) < 1e-9);
  // 아주 키 큰 들림 그림이 있으면 그것이 캔버스(140) 안에 들게 줄인다
  const tall = spriteGeom({ idle: box(150, 80, 250, 280), grab: box(150, 0, 250, 300) }, { w: 400, h: 300 });
  assert.ok(tall && 300 * tall.scale <= 140 + 1e-9);
  // 아주 넓은 잠 그림도 뒤집어 그려도 캔버스 폭 안
  const wide = spriteGeom({ idle: box(180, 80, 220, 280), sleep: box(0, 250, 400, 290) }, { w: 400, h: 300 });
  assert.ok(wide && 400 * wide.scale <= 156 + 1e-9);
  assert.equal(spriteGeom({ sit: box(0, 0, 1, 1) }, { w: 1, h: 1 }), undefined);
});
