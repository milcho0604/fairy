import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RUNNER_BANDS,
  RUNNER_COUNTS,
  RUNNER_FAST_MS,
  RUNNER_REST_MS,
  RUNNER_STATES,
  RUNNER_TOTAL,
  type RunnerState,
  runnerAlpha,
  runnerFrameMs,
  runnerIndex,
  runnerKindOf,
  runnerState,
} from './menu-runner.ts';
import { DEFAULT_BLUEPRINTS } from './pet3d/defaults.ts';
import { PET_KIND_IDS, type PetKind } from './settings.ts';

test('장 수: 앉기 4, 걷기 8, 달리기와 질주 6. 번호는 한 줄로 겹치지 않고 돈다', () => {
  assert.deepEqual(RUNNER_COUNTS, { rest: 4, walk: 8, run: 6, sprint: 6 });
  assert.equal(RUNNER_TOTAL, 24);
  const seen = new Set<number>();
  for (const s of RUNNER_STATES) for (let f = 0; f < RUNNER_COUNTS[s]; f++) seen.add(runnerIndex(s, f));
  assert.equal(seen.size, RUNNER_TOTAL);
  assert.equal(Math.min(...seen), 0);
  assert.equal(Math.max(...seen), RUNNER_TOTAL - 1);
  // 한 바퀴 돌면 처음 장, 음수도 안으로
  assert.equal(runnerIndex('walk', 8), runnerIndex('walk', 0));
  assert.equal(runnerIndex('run', -1), runnerIndex('run', 5));
});

test('상태 구간: 5% 아래 앉기, 35% 부터 달리기, 75% 부터 질주. 내려올 때는 몇 % 더 내려와야 바뀐다', () => {
  const at = (cpu: number, prev?: RunnerState) => runnerState(cpu, prev);
  assert.equal(at(0), 'rest');
  assert.equal(at(4.9), 'rest');
  assert.equal(at(5), 'walk');
  assert.equal(at(34.9), 'walk');
  assert.equal(at(35), 'run');
  assert.equal(at(74.9), 'run');
  assert.equal(at(75), 'sprint');
  assert.equal(at(100), 'sprint');
  // 갑자기 바빠지면 한 번에 질주
  assert.equal(at(100, 'rest'), 'sprint');
  // 경계에서 오락가락하지 않는다
  assert.equal(at(4, 'walk'), 'walk');
  assert.equal(at(RUNNER_BANDS.walk.down - 0.1, 'walk'), 'rest');
  assert.equal(at(32, 'run'), 'run');
  assert.equal(at(RUNNER_BANDS.run.down - 0.1, 'run'), 'walk');
  assert.equal(at(72, 'sprint'), 'sprint');
  assert.equal(at(RUNNER_BANDS.sprint.down - 0.1, 'sprint'), 'run');
  assert.equal(at(4, 'rest'), 'rest');
  // 이상한 값은 0
  assert.equal(at(Number.NaN, 'sprint'), 'rest');
  assert.equal(at(-5), 'rest');
});

test('한 장 시간: 쉬면 1.5초, 바쁠수록 짧고 0.2초(초당 5장)보다 짧지 않다', () => {
  assert.equal(runnerFrameMs(0), RUNNER_REST_MS);
  assert.ok(RUNNER_REST_MS >= 1000, '쉴 때 장 바꾸기가 1초에 한 번보다 잦다');
  assert.equal(runnerFrameMs(100), RUNNER_FAST_MS);
  assert.equal(RUNNER_FAST_MS, 200);
  let prev = Number.POSITIVE_INFINITY;
  for (let c = 0; c <= 100; c += 0.5) {
    const ms = runnerFrameMs(c);
    assert.ok(ms <= prev, `${c}% 에서 느려졌다`);
    assert.ok(ms >= RUNNER_FAST_MS, `${c}% 에서 ${ms}ms`);
    prev = ms;
  }
  // 경계에 머문 상태(내려오는 중)도 상한을 지킨다
  for (const s of RUNNER_STATES)
    for (let c = -10; c <= 120; c += 5) assert.ok(runnerFrameMs(c, s) >= RUNNER_FAST_MS);
  assert.equal(runnerFrameMs(250), RUNNER_FAST_MS);
  assert.equal(runnerFrameMs(Number.NaN), RUNNER_REST_MS);
  // 걷기 첫 장은 쉬기보다 빠르고, 질주 한 바퀴는 1.5초 안
  assert.ok(runnerFrameMs(5) < RUNNER_REST_MS);
  assert.ok(runnerFrameMs(100) * RUNNER_COUNTS.sprint <= 1500);
});

const basic = { petImage: undefined, petModel: undefined, petGaits: {} };

test('기본 펫은 그 종류로 달린다', () => {
  for (const kind of PET_KIND_IDS) assert.equal(runnerKindOf({ ...basic, petKind: kind }), kind);
});

test('사진 펫은 설계도로 가장 가까운 종류: 기본 설계도를 사진 펫처럼 주면 제 종류로 돌아온다', () => {
  for (const kind of PET_KIND_IDS) {
    const bp = DEFAULT_BLUEPRINTS[kind];
    assert.ok(bp, kind);
    const s = { petImage: 'pet-1.png', petModel: 'model-1.json', petKind: 'kong' as PetKind, petGaits: {} };
    assert.equal(runnerKindOf(s, bp), kind, `${kind} 설계도`);
  }
});

test('사진 펫: 설계도가 없으면 콩이, 고른 걸음새가 설계도보다 먼저, gait 가 없으면 다리 수로', () => {
  const photo = { petImage: 'pet-1.png', petModel: 'model-1.json', petKind: 'cat' as PetKind, petGaits: {} };
  assert.equal(runnerKindOf({ ...photo, petModel: undefined }, null), 'kong');
  assert.equal(runnerKindOf(photo, undefined), 'kong');
  const cat = DEFAULT_BLUEPRINTS.cat;
  const chick = DEFAULT_BLUEPRINTS.chick;
  assert.ok(cat && chick);
  // 냥이 몸이어도 두 발을 고르면 두 발 친구로 (부리가 없으니 콩이)
  assert.equal(runnerKindOf({ ...photo, petGaits: { 'model-1.json': 'biped' } }, cat), 'kong');
  // 삐약이 몸에 네 발을 고르면 네 발 친구 (귀가 없고 고양이 입도 아니니 멍멍이)
  assert.equal(runnerKindOf({ ...photo, petGaits: { 'model-1.json': 'quadruped' } }, chick), 'dog');
  // 다른 몸의 고른 값은 쓰지 않는다
  assert.equal(runnerKindOf({ ...photo, petGaits: { 'model-2.json': 'biped' } }, cat), 'cat');
  // gait 칸이 없는 옛 설계도: 펫 화면(pet3d-gait.ts gaitOf)처럼 다리가 한쪽에 둘 이상(앞뒤)이면 네 발, 아니면 두 발
  const { gait: _g, ...oldCat } = cat;
  assert.equal(runnerKindOf(photo, oldCat), 'kong');
  const hind = oldCat.parts
    .filter((p) => p.slot === 'legL')
    .map((p) => ({ ...p, at: [p.at[0], p.at[1], -0.2] as [number, number, number] }));
  assert.equal(runnerKindOf(photo, { ...oldCat, parts: [...oldCat.parts, ...hind] }), 'cat');
  // 기본 펫이면 설계도를 줘도 종류 그대로
  assert.equal(runnerKindOf({ ...basic, petKind: 'bunny' }, cat), 'bunny');
});

/** 칠한 양(픽셀 수) */
const ink = (a: Uint8Array) => a.reduce((n, v) => n + v, 0) / 255;
const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + Math.abs(v - (b[i] ?? 0)), 0) / 255;

test('그림: 종류 5 x 상태 4 x 장 전부가 비지 않고 잘리지 않으며 가장자리가 부드럽다 (44x36, 16x16)', () => {
  for (const kind of PET_KIND_IDS) {
    for (const state of RUNNER_STATES) {
      for (let f = 0; f < RUNNER_COUNTS[state]; f++) {
        for (const [w, h] of [
          [44, 36],
          [16, 16],
        ] as const) {
          const a = runnerAlpha(kind, state, f, w, h);
          assert.equal(a.length, w * h);
          const fill = ink(a) / (w * h);
          assert.ok(fill > 0.12 && fill < 0.5, `${kind} ${state} ${f} ${w}px 채운 양 ${fill.toFixed(2)}`);
          assert.ok(
            a.some((v) => v > 0 && v < 255),
            `${kind} ${state} ${f} 가장자리가 계단`,
          );
          // 맨 위 줄과 왼쪽, 오른쪽 끝 줄에 걸치면 귀나 꼬리가 잘린 것
          let edge = 0;
          for (let x = 0; x < w; x++) edge = Math.max(edge, a[x] ?? 0);
          for (let y = 0; y < h; y++) edge = Math.max(edge, a[y * w] ?? 0, a[y * w + w - 1] ?? 0);
          assert.ok(edge < 128, `${kind} ${state} ${f} ${w}px 가장자리에 걸림 ${edge}`);
        }
      }
    }
  }
});

test('그림: 이어지는 장마다 움직이고, 한 바퀴 돌면 처음 장, 질주는 달리기에 땀이 더해진다', () => {
  for (const kind of PET_KIND_IDS) {
    for (const state of RUNNER_STATES) {
      const n = RUNNER_COUNTS[state];
      const frames = Array.from({ length: n }, (_, f) => runnerAlpha(kind, state, f, 44, 36));
      for (let f = 0; f < n; f++) {
        const d = diff(frames[f] as Uint8Array, frames[(f + 1) % n] as Uint8Array);
        // 걷기와 달리기는 몇 픽셀 이상 움직이고, 앉기도 꼬리나 눈이 바뀐다
        assert.ok(
          d > (state === 'rest' ? 3 : 8),
          `${kind} ${state} ${f}->${(f + 1) % n} 차이 ${d.toFixed(1)}`,
        );
      }
      assert.deepEqual(runnerAlpha(kind, state, n, 44, 36), frames[0]);
    }
    for (let f = 0; f < RUNNER_COUNTS.run; f++) {
      const run = runnerAlpha(kind, 'run', f, 44, 36);
      const sprint = runnerAlpha(kind, 'sprint', f, 44, 36);
      assert.ok(ink(sprint) > ink(run) + 1, `${kind} ${f} 땀방울이 안 보인다`);
    }
  }
});

test('그림: 종류마다 모습이 다르다 (같은 상태, 같은 장)', () => {
  for (const state of RUNNER_STATES) {
    const all = PET_KIND_IDS.map((k) => runnerAlpha(k, state, 1, 44, 36));
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        assert.ok(
          diff(all[i] as Uint8Array, all[j] as Uint8Array) > 40,
          `${state}: ${PET_KIND_IDS[i]} 와 ${PET_KIND_IDS[j]} 가 거의 같다`,
        );
  }
});

test('그림: 종류 하나의 모든 장(맥 크기)을 그리는 데 오래 걸리지 않는다', () => {
  const t0 = performance.now();
  for (const state of RUNNER_STATES)
    for (let f = 0; f < RUNNER_COUNTS[state]; f++) runnerAlpha('cat', state, f, 44, 36);
  const ms = performance.now() - t0;
  // 이 맥에서 약 30ms. 느린 컴퓨터를 생각해 넉넉히
  assert.ok(ms < 500, `${ms.toFixed(0)}ms`);
});
