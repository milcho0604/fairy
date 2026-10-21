import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createIdleWatch } from './idle-watch.ts';

test('기한 안에 소식이 없으면 한 번 알린다', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let n = 0;
    const w = createIdleWatch(2000, () => n++);
    assert.equal(w.active(), false);
    w.poke();
    assert.equal(w.active(), true);
    mock.timers.tick(1999);
    assert.equal(n, 0);
    mock.timers.tick(1);
    assert.equal(n, 1);
    assert.equal(w.active(), false);
    mock.timers.tick(10_000);
    assert.equal(n, 1);
  } finally {
    mock.timers.reset();
  }
});

test('소식이 계속 오면 알리지 않고, 끊긴 때부터 다시 센다', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let n = 0;
    const w = createIdleWatch(2000, () => n++);
    w.poke();
    for (let i = 0; i < 10; i++) {
      mock.timers.tick(1500);
      w.poke();
    }
    assert.equal(n, 0);
    mock.timers.tick(1999);
    assert.equal(n, 0);
    mock.timers.tick(1);
    assert.equal(n, 1);
  } finally {
    mock.timers.reset();
  }
});

test('멈추면 기한이 지나도 알리지 않는다', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let n = 0;
    const w = createIdleWatch(2000, () => n++);
    w.poke();
    w.stop();
    assert.equal(w.active(), false);
    mock.timers.tick(5000);
    assert.equal(n, 0);
    w.stop();
  } finally {
    mock.timers.reset();
  }
});
