import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cpuTitle,
  gb,
  gpuName,
  meter,
  parseVmStat,
  RUNNER_FAST_MS,
  RUNNER_FRAMES,
  RUNNER_SLOW_MS,
  runnerAlpha,
  runnerFrameMs,
  uptimeParts,
} from './system-stats.ts';

test('CPU 가 바쁠수록 빨리 달린다', () => {
  assert.equal(runnerFrameMs(0), RUNNER_SLOW_MS);
  assert.equal(runnerFrameMs(100), RUNNER_FAST_MS);
  let prev = Infinity;
  for (let c = 0; c <= 100; c += 10) {
    const ms = runnerFrameMs(c);
    assert.ok(ms <= prev, `${c}% 에서 느려지면 안 된다`);
    prev = ms;
  }
  // 이상한 값은 끝으로 자른다
  assert.equal(runnerFrameMs(-5), RUNNER_SLOW_MS);
  assert.equal(runnerFrameMs(250), RUNNER_FAST_MS);
  assert.equal(runnerFrameMs(Number.NaN), RUNNER_SLOW_MS);
});

test('메뉴 막대 글자는 늘 두 자리 이상', () => {
  assert.equal(cpuTitle(3.4), ' 3%');
  assert.equal(cpuTitle(42.6), '43%');
  assert.equal(cpuTitle(100), '100%');
  assert.equal(cpuTitle(140), '100%');
});

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               12345.
Pages active:                            300000.
Pages inactive:                          280000.
Pages speculative:                         5000.
Pages throttled:                              0.
Pages wired down:                        100000.
Pages purgeable:                          20000.
"Translation faults":                 123456789.
Pages occupied by compressor:             50000.
`;

test('vm_stat 으로 쓰는 메모리를 낸다 (캐시는 빼고)', () => {
  const total = 16 * 1024 ** 3;
  const m = parseVmStat(VM_STAT, total);
  assert.ok(m);
  assert.equal(m.used, (300000 - 20000 + 100000 + 50000) * 16384);
  assert.equal(m.total, total);
  assert.equal(parseVmStat('엉뚱한 글', total), undefined);
  // 전체를 넘지 않는다
  assert.equal(parseVmStat(VM_STAT, 1024)?.used, 1024);
});

test('그래픽 이름만 뽑는다', () => {
  assert.equal(gpuName('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'), 'Apple M2');
  assert.equal(
    gpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    'NVIDIA GeForce RTX 3060',
  );
  assert.equal(gpuName('Mesa Intel(R) UHD Graphics'), 'Mesa Intel(R) UHD Graphics');
  assert.equal(gpuName(undefined), undefined);
  assert.equal(gpuName('   '), undefined);
});

test('켜진 시간, GB, 막대', () => {
  assert.deepEqual(uptimeParts(90061), { d: 1, h: 1, m: 1 });
  assert.equal(gb(8 * 1024 ** 3), '8.0GB');
  assert.equal(meter(0.42), '▮▮▮▮▯▯▯▯▯▯');
  assert.equal(meter(2), '▮'.repeat(10));
});

test('달리기 그림은 장마다 다르고 비어 있지 않다', () => {
  const frames = Array.from({ length: RUNNER_FRAMES }, (_, i) => runnerAlpha(i, 36));
  for (const f of frames) {
    assert.equal(f.length, 36 * 36);
    const ink = f.reduce((a, v) => a + v, 0) / 255;
    // 몸이 그림의 대략 1/5 ~ 1/2 을 채운다
    assert.ok(ink > 36 * 36 * 0.15 && ink < 36 * 36 * 0.5, `채운 양 ${ink}`);
    // 가장자리는 부드럽게 (중간값이 있다)
    assert.ok(f.some((v) => v > 0 && v < 255));
  }
  assert.notDeepEqual(frames[0], frames[1]);
  // 한 바퀴 돌면 처음 그림
  assert.deepEqual(runnerAlpha(RUNNER_FRAMES, 36), frames[0]);
});
