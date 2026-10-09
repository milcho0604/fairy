import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpuTitle, gb, gpuName, macMemoryUse, meter, uptimeParts, VM_INFO64_COUNT } from './system-stats.ts';

test('메뉴 막대 글자는 늘 두 자리 이상', () => {
  assert.equal(cpuTitle(3.4), ' 3%');
  assert.equal(cpuTitle(42.6), '43%');
  assert.equal(cpuTitle(100), '100%');
  assert.equal(cpuTitle(140), '100%');
});

test('맥 쪽 수로 쓰는 메모리를 낸다 (캐시는 빼고)', () => {
  const total = 16 * 1024 ** 3;
  // vm_statistics64 의 32비트 칸: 1 active, 2 inactive, 3 wired, 22 purgeable, 23 speculative, 32 compressor
  const w = new Uint32Array(VM_INFO64_COUNT);
  w[0] = 12345;
  w[1] = 300000;
  w[2] = 280000;
  w[3] = 100000;
  w[22] = 20000;
  w[23] = 5000;
  w[32] = 50000;
  const m = macMemoryUse(w, 16384, total);
  assert.ok(m);
  assert.equal(m.used, (300000 - 20000 + 100000 + 50000) * 16384);
  assert.equal(m.total, total);
  // 칸이 모자라거나 쪽 크기를 모르면 비운다
  assert.equal(macMemoryUse(w.subarray(0, 10), 16384, total), undefined);
  assert.equal(macMemoryUse(w, 0, total), undefined);
  // 전체를 넘지 않는다
  assert.equal(macMemoryUse(w, 16384, 1024)?.used, 1024);
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
