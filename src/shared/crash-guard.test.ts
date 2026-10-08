import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CRASH_MAX_RELOADS, CRASH_WINDOW_MS, CrashGuard } from './crash-guard.ts';

test('1분 안에 세 번까지는 다시 불러오고 네 번째에 멈춘다', () => {
  const g = new CrashGuard();
  assert.equal(CRASH_MAX_RELOADS, 3);
  assert.deepEqual(
    [0, 1000, 2000, 3000].map((t) => g.crashed(t)),
    ['reload', 'reload', 'reload', 'stop'],
  );
  assert.equal(g.stopped, true);
});

test('한 번 멈추면 시간이 지나도 저절로 다시 살리지 않는다', () => {
  const g = new CrashGuard();
  for (const t of [0, 1, 2, 3]) g.crashed(t);
  assert.equal(g.crashed(10 * CRASH_WINDOW_MS), 'stop');
});

test('띄엄띄엄 죽으면 계속 다시 불러온다', () => {
  const g = new CrashGuard();
  for (let i = 0; i < 10; i++) assert.equal(g.crashed(i * CRASH_WINDOW_MS), 'reload');
});

test('창 경계: 정확히 1분 지난 것은 세지 않는다', () => {
  const g = new CrashGuard();
  g.crashed(0);
  g.crashed(1);
  g.crashed(2);
  // 0 은 빠지고 1, 2, 60000 셋만 남는다
  assert.equal(g.crashed(CRASH_WINDOW_MS), 'reload');
  // 1 도 빠지고 2, 60000, 60001 셋
  assert.equal(g.crashed(CRASH_WINDOW_MS + 1), 'reload');
  // 2 가 빠져도 1분 안에 넷이 되면 멈춘다
  assert.equal(g.crashed(CRASH_WINDOW_MS + 2), 'reload');
  assert.equal(g.crashed(CRASH_WINDOW_MS + 3), 'stop');
});

test('사용자가 새로고침하면 다시 센다', () => {
  const g = new CrashGuard();
  for (const t of [0, 1, 2, 3]) g.crashed(t);
  g.reset();
  assert.equal(g.stopped, false);
  assert.equal(g.crashed(4), 'reload');
});
