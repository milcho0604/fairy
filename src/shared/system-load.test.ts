import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BusyTracker, cpuPercent, macPressure, ratioPressure, sumCpuTimes } from './system-load.ts';

test('누적 시간 차이로 사용률을 낸다', () => {
  assert.equal(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 400 }), 75);
  assert.equal(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 0 }), 0);
});

test('코어 여러 개를 합친다', () => {
  const core = (idle: number, user: number) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  assert.deepEqual(sumCpuTimes([core(10, 30), core(20, 40)]), { idle: 30, total: 100 });
});

test('메모리 압박 단계', () => {
  assert.equal(macPressure(1), 'normal');
  assert.equal(macPressure(2), 'warn');
  assert.equal(macPressure(4), 'critical');
  assert.equal(ratioPressure(20, 100), 'normal');
  assert.equal(ratioPressure(10, 100), 'warn');
  assert.equal(ratioPressure(4, 100), 'critical');
});

const hot = { cpu: 95, memory: 'normal' } as const;
const mid = { cpu: 78, memory: 'normal' } as const;
const calm = { cpu: 20, memory: 'normal' } as const;

test('CPU 가 한 번 튀는 것으로는 바빠지지 않는다', () => {
  const t = new BusyTracker();
  assert.equal(t.feed(hot), false);
  assert.equal(t.feed(calm), false);
  assert.equal(t.feed(hot), false);
});

test('CPU 가 10초(표본 2개) 연달아 높으면 바쁨', () => {
  const t = new BusyTracker();
  t.feed(hot);
  assert.equal(t.feed(hot), true);
});

test('메모리 경고는 바로 바쁨', () => {
  const t = new BusyTracker();
  assert.equal(t.feed({ cpu: 5, memory: 'warn' }), true);
});

test('바쁨은 15초(표본 3개) 연달아 한가해야 풀린다, 중간값에서는 유지', () => {
  const t = new BusyTracker();
  t.feed(hot);
  t.feed(hot);
  assert.equal(t.feed(mid), true); // 70~85 는 들어가지도 나오지도 않는다
  assert.equal(t.feed(calm), true);
  assert.equal(t.feed(calm), true);
  assert.equal(t.feed(mid), true); // 한가 연속이 끊긴다
  t.feed(calm);
  t.feed(calm);
  assert.equal(t.feed(calm), false);
});

test('메모리가 빠듯하면 CPU 가 낮아도 풀리지 않는다', () => {
  const t = new BusyTracker();
  t.feed({ cpu: 5, memory: 'critical' });
  for (let i = 0; i < 5; i++) assert.equal(t.feed({ cpu: 5, memory: 'warn' }), true);
  t.feed(calm);
  t.feed(calm);
  assert.equal(t.feed(calm), false);
});
