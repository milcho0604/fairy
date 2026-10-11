import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MOVE_SPECS, MOVES } from '../../shared/moves.ts';
import {
  HELD_LIFT,
  HELD_SQUEEZE,
  hopScale,
  LAND_MS,
  landPose,
  type MovePose,
  moveFps,
  movePeak,
  movePose,
  REST_POSE,
  SIT_MS,
  sitDown,
} from './move-pose.ts';

// 하품, 기지개는 draw.ts, pet3d.ts 가 예전부터 직접 그린다
const POSED = MOVES.filter((m) => m !== 'yawn' && m !== 'stretch');
const NUMS = ['lift', 'turn', 'twist', 'dx', 'look', 'tilt', 'pitch', 'tail', 'tailOut', 'arms'] as const;

function near(a: MovePose, b: MovePose, eps: number): string | undefined {
  for (const k of NUMS) if (Math.abs(a[k] - b[k]) > eps) return `${k} ${a[k]} vs ${b[k]}`;
  for (const k of ['sx', 'sy'] as const) if (Math.abs(a[k] - b[k]) > eps) return `${k} ${a[k]}`;
  for (const i of [0, 1] as const) {
    if (Math.abs(a.ears[i] - b.ears[i]) > eps) return `ears ${a.ears[i]}`;
    if (Math.abs(a.legs[i] - b.legs[i]) > eps) return `legs ${a.legs[i]}`;
  }
  return undefined;
}

test('처음과 끝은 쉬는 자세 (몸짓 앞뒤로 튀지 않는다)', () => {
  for (const m of POSED)
    for (const dir of [-1, 1] as const)
      for (const t of [0, 1]) {
        const p = movePose(m, t, dir);
        assert.equal(near(p, REST_POSE, 0.02), undefined, `${m} t=${t} dir=${dir}`);
        assert.ok((p.mark?.k ?? 0) < 0.05, `${m} t=${t} 표시가 남았다`);
      }
});

test('그리는 빠르기(20, 30fps)로 그려도 한 틀 사이 큰 점프가 없다', () => {
  for (const m of POSED) {
    const step = 1000 / moveFps(m) / MOVE_SPECS[m].ms;
    let prev = movePose(m, 0, 1);
    for (let t = step; t <= 1 + 1e-9; t += step) {
      const p = movePose(m, t, 1);
      assert.ok(Math.abs(p.lift - prev.lift) <= 6, `${m} t=${t.toFixed(2)} lift ${prev.lift}→${p.lift}`);
      for (const k of ['turn', 'twist', 'look', 'tilt', 'pitch'] as const)
        assert.ok(Math.abs(p[k] - prev[k]) <= 0.45, `${m} t=${t.toFixed(2)} ${k} ${prev[k]}→${p[k]}`);
      prev = p;
    }
  }
});

test('캔버스 안에서 움직인다 (높이, 기울기, 발 범위)', () => {
  for (const m of POSED)
    for (let t = 0; t <= 1; t += 0.01) {
      const p = movePose(m, t, 1);
      assert.ok(p.lift >= -0.01 && p.lift <= 24, `${m} lift ${p.lift}`);
      assert.ok(Math.abs(p.turn) <= 1.65, `${m} turn`);
      assert.ok(Math.abs(p.dx) <= 12, `${m} dx`);
      assert.ok(p.sx > 0.8 && p.sx < 1.2 && p.sy > 0.8 && p.sy < 1.2, `${m} squash`);
      for (const v of p.legs) assert.ok(v >= 0 && v <= 1, `${m} legs`);
      assert.ok(p.tailOut >= 0 && p.tailOut <= 1);
    }
});

test('좌우가 있는 몸짓은 방향을 뒤집으면 거울', () => {
  for (const m of ['tilt', 'scan', 'roll'] as const)
    for (const t of [0.2, 0.5, 0.7]) {
      const r = movePose(m, t, 1);
      const l = movePose(m, t, -1);
      assert.ok(Math.abs(r.tilt + l.tilt) < 1e-9 && Math.abs(r.look + l.look) < 1e-9, m);
      assert.ok(Math.abs(r.turn + l.turn) < 1e-9, m);
    }
  const e = movePose('ears', 0.15, -1);
  assert.ok(e.ears[0] > e.ears[1], '왼쪽부터 파닥');
});

test('움직임 줄이기면 낮게 뛰고 덜 흔든다', () => {
  const hop = Math.max(...[0.4, 0.5, 0.6].map((t) => movePose('hop', t, 1, true).lift));
  assert.ok(hop <= 5);
  assert.ok(
    Math.abs(movePose('shake', 0.2, 1, true).twist) <= Math.abs(movePose('shake', 0.2, 1).twist) * 0.31,
  );
});

test('몸짓마다 알아볼 표시: 갸웃 물음표, 깰 때 느낌표, 꼬리 흔들기 꼬리', () => {
  assert.equal(movePose('tilt', 0.5).mark?.kind, '?');
  assert.ok(Math.abs(movePose('tilt', 0.5).tilt) > 0.3);
  assert.equal(movePose('nod', 0.7).mark?.kind, '!');
  assert.equal(movePose('nod', 0.5).eyes, 'closed');
  assert.ok(movePose('wag', 0.5).tailOut > 0.9);
  assert.ok(movePose('hop', 0.5).lift > 20);
  assert.ok(Math.abs(movePose('roll', 0.5).turn) > 1.2);
  assert.ok(movePose('sniff', 0.5).pitch > 0.2);
});

test('앉기: 처음에 앉고 끝에 일어난다', () => {
  assert.equal(sitDown(0, 10_000), 0);
  assert.equal(sitDown(5_000, 10_000), 1);
  assert.equal(sitDown(10_000, 10_000), 0);
  assert.ok(sitDown(SIT_MS / 2, 10_000) > 0.3 && sitDown(SIT_MS / 2, 10_000) < 0.7);
});

test('놓이면 들린 모습에서 이어 떨어지고, 닿을 때 납작했다가 쉬는 몸으로 끝난다', () => {
  const a = landPose(0);
  assert.equal(a.lift, HELD_LIFT);
  assert.ok(Math.abs(a.sx - (1 - HELD_SQUEEZE.x)) < 1e-9 && Math.abs(a.sy - (1 + HELD_SQUEEZE.y)) < 1e-9);
  const end = landPose(LAND_MS);
  assert.equal(end.lift, 0);
  assert.ok(Math.abs(end.sx - 1) < 1e-3 && Math.abs(end.sy - 1) < 1e-3);
  let flattest = 1;
  let prev = a;
  for (let ms = 5; ms <= LAND_MS; ms += 5) {
    const p = landPose(ms);
    flattest = Math.min(flattest, p.sy);
    // 틀 사이에 툭 튀지 않는다
    assert.ok(Math.abs(p.lift - prev.lift) < 1.5 && Math.abs(p.sy - prev.sy) < 0.03, `${ms}`);
    prev = p;
  }
  assert.ok(flattest < 0.93);
  // 움직임 줄이기면 찌그러지지 않는다
  for (let ms = 0; ms <= LAND_MS; ms += 10) assert.ok(landPose(ms, true).sy >= 1);
});

test('뛰는 높이를 줄일 때 꼭대기를 자르지 않고 곡선째 낮춘다', () => {
  const peak = movePeak('hop');
  assert.ok(peak.lift > 20 && peak.t > 0.3 && peak.t < 0.7);
  assert.equal(hopScale(peak.lift, 100), 1);
  assert.equal(hopScale(peak.lift, peak.lift / 2), 0.5);
  assert.equal(hopScale(0, 5), 1);
  // 줄인 곡선은 꼭대기에서만 room 에 닿는다 (판판한 구간이 없다)
  const k = hopScale(peak.lift, 12);
  let atTop = 0;
  for (let i = 0; i <= 64; i++) if (movePose('hop', i / 64).lift * k > 11.9) atTop++;
  assert.ok(atTop <= 3, `${atTop}`);
});
