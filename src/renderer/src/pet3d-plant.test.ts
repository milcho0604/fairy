import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LegId } from './pet3d-gait.ts';
import { FootPlanter, type PlantFrame, type Spot, toLocal, toStage } from './pet3d-plant.ts';
import { DUTY, type GaitKind } from './pet3d-stance.ts';

const L = 0.33;
const REST: Record<LegId, Spot> = {
  fl: { x: -0.085, z: 0.2 },
  fr: { x: 0.085, z: 0.2 },
  hl: { x: -0.1, z: -0.22 },
  hr: { x: 0.1, z: -0.22 },
};
const LEGS: LegId[] = ['fl', 'fr', 'hl', 'hr'];
/** pet3d.ts STANCE_TURN_RATE 와 같다 */
const TURN_RATE = 2.5;

interface Step {
  /** 이 틀의 몸 빠르기 (몸 단위/초, 부호가 쪽) */
  v: number;
  /** 바라는 몸 방향 */
  heading: number;
  walking: boolean;
  hold?: number;
}

/**
 * 펫 화면처럼 돌린다: 방향은 짧게 따라가고(90ms), 거의 다 돌았으면 걸음 박자로, 아니면 발을 한두 개씩 옮긴다.
 * 디딘 발마다 세상 자리가 그대로인지, 발이 다리 길이 안에 있는지, 동시에 든 발 수를 잰다
 */
function run(
  steps: (t: number) => Step,
  ms: number,
  fps: number,
  start = 0.6,
  watch?: (t: number, out: Record<LegId, { x: number; z: number; planted: boolean }>) => void,
): {
  drift: number;
  reach: number;
  maxUp: number;
  end: Record<LegId, { x: number; z: number; planted: boolean }>;
  endHeading: number;
} {
  const p = new FootPlanter();
  let heading = start;
  let drift = 0;
  let reach = 0;
  let maxUp = 0;
  const held = new Map<LegId, { x: number; z: number }>();
  const dt = 1000 / fps;
  let last: Record<LegId, { x: number; z: number; planted: boolean }> | undefined;
  for (let t = 0; t <= ms; t += dt) {
    const s = steps(t);
    // pet3d.ts 처럼: 짧게 따라가되 초당 TURN_RATE 라디안까지만 돈다
    const d = (s.heading - heading) * (1 - Math.exp(-dt / 90));
    const m = (TURN_RATE * dt) / 1000;
    heading += Math.max(-m, Math.min(m, d));
    const speed = Math.abs(s.v);
    const kind: GaitKind = speed > 0.75 ? 'trot' : 'walk';
    const gait =
      s.walking && Math.abs(s.heading - heading) < 0.1
        ? { kind, duty: DUTY[kind], cycle: L * 1.05 * (kind === 'trot' ? 1.4 : 1), lift: 0.2 * L }
        : undefined;
    const f: PlantFrame = {
      now: t,
      heading,
      aim: s.heading,
      move: (s.v * dt) / 1000,
      ...(gait ? { gait } : {}),
      rest: REST,
      hold: s.hold ?? 1,
      L,
    };
    const out = p.update(f);
    let up = 0;
    for (const id of LEGS) {
      const o = out[id];
      const st = toStage(o, heading);
      const world = { x: st.x + p.travelled, z: st.z };
      const h = held.get(id);
      if (o.planted && h) drift = Math.max(drift, Math.hypot(world.x - h.x, world.z - h.z));
      if (o.planted) held.set(id, h && last?.[id]?.planted ? h : world);
      else {
        held.delete(id);
        up++;
      }
      // 디딘 발이 다리가 닿는 곳에 있는지 (든 발은 몸보다 앞서 나갈 수 있다)
      if (o.planted) reach = Math.max(reach, Math.hypot(o.x - REST[id].x, o.z - REST[id].z));
    }
    maxUp = Math.max(maxUp, up);
    watch?.(t, out);
    last = { fl: { ...out.fl }, fr: { ...out.fr }, hl: { ...out.hl }, hr: { ...out.hr } };
  }
  const none = { x: 0, z: 0, planted: false };
  const end = { fl: last?.fl ?? none, fr: last?.fr ?? none, hl: last?.hl ?? none, hr: last?.hr ?? none };
  return { drift, reach, maxUp, end, endHeading: heading };
}

/** 창이 움직이는 곡선 (처음과 끝이 느리다, behavior.ts walkOffset 처럼) */
const easeV = (t: number, ms: number, dist: number) => {
  if (t < 0 || t > ms) return 0;
  const k = t / ms;
  // 거리 dist 를 ms 동안 ease-in-out 으로: 빠르기는 k<.5 에서 4k, 그 뒤 4(1-k) (평균 1)
  return ((dist * 1000) / ms) * (k < 0.5 ? 4 * k : 4 * (1 - k));
};

const settled = (end: Record<LegId, { x: number; z: number; planted: boolean }>, heading: number) => {
  let worst = 0;
  for (const id of LEGS) {
    assert.ok(end[id].planted, `${id} planted at end`);
    worst = Math.max(worst, Math.hypot(end[id].x - REST[id].x, end[id].z - REST[id].z));
  }
  return { worst, heading };
};

for (const fps of [60, 24, 12]) {
  test(`발 딛기 (${fps}fps): 서 있다 돌아서 걷고 멈추면 디딘 발은 미끄러지지 않고, 끝에 한 발씩 모아 선다`, () => {
    const walkMs = 3000;
    const r = run(
      (t) => {
        const w = t >= 200 && t < 200 + walkMs;
        return {
          v: easeV(t - 200, walkMs, 1.0),
          heading: w || t < 200 ? (t < 200 ? 0.6 : 1.38) : 0.6,
          walking: w,
        };
      },
      200 + walkMs + 1200,
      fps,
    );
    assert.ok(r.drift < 1e-9, `drift ${r.drift}`);
    assert.ok(r.reach < 0.65 * L, `reach ${r.reach / L} L`);
    assert.ok(r.maxUp <= 2, `up ${r.maxUp}`);
    const s = settled(r.end, r.endHeading);
    assert.ok(s.worst < 0.08 * L, `settle ${s.worst / L} L`);
  });
}

test('발 딛기: 빠르기를 바꾸고 속보로 달리다 걷고, 걷다가 거꾸로 돌아서도 디딘 발은 그대로다', () => {
  const r = run(
    (t) => {
      if (t < 1500) return { v: 0.45, heading: 1.38, walking: true };
      if (t < 3000) return { v: 1.1, heading: 1.38, walking: true };
      if (t < 4000) return { v: 0.3, heading: 1.38, walking: true };
      if (t < 6000) return { v: -0.45, heading: -1.38, walking: true };
      return { v: 0, heading: -0.6, walking: false };
    },
    7500,
    24,
    1.38,
  );
  assert.ok(r.drift < 1e-9, `drift ${r.drift}`);
  assert.ok(r.reach < 0.85 * L, `reach ${r.reach / L} L`);
  assert.ok(settled(r.end, r.endHeading).worst < 0.08 * L);
});

test('발 딛기: 집 문으로 들어가며 등을 돌려도(크게 돌기) 발이 몸을 따라 돌지 않는다', () => {
  const r = run(
    (t) => ({
      v: t < 1800 ? 0.25 : 0,
      heading: t < 1800 ? Math.PI - 0.55 : 0.2,
      walking: t < 1800,
    }),
    3500,
    15,
    0.2,
  );
  assert.ok(r.drift < 1e-9, `drift ${r.drift}`);
  assert.ok(r.reach < 0.85 * L, `reach ${r.reach / L} L`);
  assert.ok(settled(r.end, r.endHeading).worst < 0.08 * L);
});

test('발 딛기: 제자리에서 돌면(삐쳐서 돌아앉기 전 서 있을 때) 발을 옮겨 딛는다', () => {
  const r = run((t) => ({ v: 0, heading: t < 100 ? 0 : 1.15, walking: false }), 1500, 30, 0);
  assert.ok(r.drift < 1e-9);
  assert.ok(settled(r.end, r.endHeading).worst < 0.08 * L);
});

test('발 딛기: 앉으면(붙여 두지 않음) 바랄 자리 그대로, 일어서며 다시 붙인다', () => {
  const p = new FootPlanter();
  const out = p.update({ now: 0, heading: 0.3, move: 0, rest: REST, hold: 0, L });
  for (const id of LEGS) {
    assert.equal(out[id].x, REST[id].x);
    assert.equal(out[id].z, REST[id].z);
  }
  // 오래 그리지 않았으면 처음처럼 바랄 자리에 둔다
  const later = p.update({ now: 5000, heading: 1.2, move: 0.4, rest: REST, hold: 1, L });
  for (const id of LEGS) assert.ok(Math.abs(later[id].x - REST[id].x) < 1e-9);
});

test('무대와 root 기준 바꾸기는 서로 되돌린다', () => {
  const p = { x: 0.13, z: -0.21 };
  const q = toLocal(toStage(p, 1.1), 1.1);
  assert.ok(Math.abs(q.x - p.x) < 1e-12 && Math.abs(q.z - p.z) < 1e-12);
});

test('발 딛기: 가장 드물게 그려도(걷기 12fps) 빠르게 달리면 디딘 발이 다리가 닿는 곳 안에 있다', () => {
  const r = run(
    (t) => ({ v: t < 3000 ? 1.1 : 0, heading: t < 3000 ? 1.38 : 0.6, walking: t < 3000 }),
    4500,
    12,
    1.38,
  );
  assert.ok(r.drift < 1e-9, `drift ${r.drift}`);
  assert.ok(r.reach < 0.6 * L, `reach ${r.reach / L} L`);
});

for (const fps of [60, 30, 24]) {
  test(`발 딛기 (${fps}fps): 따라 걷다 멈추며 3/4 로 돌아서도 발이 옆으로 벌어지거나 엇갈린 채 서 있지 않는다`, () => {
    // 같은 빠르기로 걷다(따라가기) 끝 320ms 동안 걷는 방향(1.38)에서 선 자세 방향(0.6)으로 돌며 멈춘다 (pet3d.ts)
    const walkMs = 4000;
    const turnMs = 320;
    let spread = 0;
    let cross = Number.POSITIVE_INFINITY;
    let worstLate = 0;
    const r = run(
      (t) => {
        const w = t >= 0 && t < walkMs;
        const k = w ? Math.min(1, (walkMs - t) / turnMs) : 0;
        return { v: w ? 0.4 : 0, heading: 0.6 + (1.38 - 0.6) * k * k * (3 - 2 * k), walking: w };
      },
      walkMs + 1500,
      fps,
      1.38,
      (t, out) => {
        if (t < walkMs) return;
        // 멈춘 뒤: 쉬는 자리보다 바깥으로 간 만큼, 왼발과 오른발의 옆 사이 (다리 길이 배)
        for (const id of LEGS) spread = Math.max(spread, (Math.abs(out[id].x) - Math.abs(REST[id].x)) / L);
        cross = Math.min(cross, (out.fr.x - out.fl.x) / L, (out.hr.x - out.hl.x) / L);
        if (t >= walkMs + 400)
          for (const id of LEGS)
            worstLate = Math.max(worstLate, Math.hypot(out[id].x - REST[id].x, out[id].z - REST[id].z) / L);
      },
    );
    assert.ok(r.drift < 1e-9, `drift ${r.drift}`);
    assert.ok(spread < 0.1, `spread ${spread} L`);
    assert.ok(cross > 0, `cross ${cross} L`);
    assert.ok(worstLate < 0.08, `0.4초 뒤 ${worstLate} L`);
    assert.ok(settled(r.end, r.endHeading).worst < 0.08 * L);
  });
}

/** 옆으로 걷는 한 틀 (pet3d.ts 처럼 다 돈 뒤면 걸음 박자로) */
const walkFrame = (now: number, dt: number, v: number, rest = REST, l = L, hold = 1): PlantFrame => {
  const kind: GaitKind = Math.abs(v) > 0.75 ? 'trot' : 'walk';
  const gait =
    v !== 0
      ? { kind, duty: DUTY[kind], cycle: l * 1.05 * (kind === 'trot' ? 1.4 : 1), lift: 0.2 * l }
      : undefined;
  return {
    now,
    heading: 1.38,
    aim: 1.38,
    move: (v * dt) / 1000,
    ...(gait ? { gait } : {}),
    rest,
    hold,
    L: l,
  };
};
const offL = (out: Record<LegId, { x: number; z: number }>, rest: Record<LegId, Spot>, l: number) =>
  Math.max(...LEGS.map((id) => Math.hypot(out[id].x - rest[id].x, out[id].z - rest[id].z) / l));

test('발 딛기: 걷다가 다른 몸으로 바뀌면(펫이나 모습을 바꿨다) 새 몸의 첫 틀은 새 몸 바랄 자리에서 시작한다', () => {
  const p = new FootPlanter();
  let t = 0;
  for (; t < 1500; t += 33) p.update(walkFrame(t, 33, 0.45));
  // 밀크에서 초코로: 다리 길이와 발 자리가 다른 몸 (pet3d.ts resetRoot 뒤 첫 틀, 틀 사이는 그대로 짧다)
  const L2 = 0.296;
  const REST2: Record<LegId, Spot> = {
    fl: { x: -0.07, z: 0.17 },
    fr: { x: 0.07, z: 0.17 },
    hl: { x: -0.085, z: -0.19 },
    hr: { x: 0.085, z: -0.19 },
  };
  const out = p.update({ ...walkFrame(t, 33, 0, REST2, L2), heading: 0.6, aim: 0.6 });
  assert.ok(offL(out, REST2, L2) < 1e-9, `첫 틀 ${offL(out, REST2, L2)} L`);
  for (const id of LEGS) assert.ok(out[id].planted, `${id} planted`);
});
