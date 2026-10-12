import assert from 'node:assert/strict';
import { test } from 'node:test';
import { singleFlight } from './single-flight.ts';

test('저장 답이 오기 전 두 번째 누름은 버리고, 끝난 뒤에는 다시 받는다', async () => {
  let calls = 0;
  let open: (() => void) | undefined;
  const save = singleFlight(async () => {
    calls++;
    await new Promise<void>((r) => {
      open = r;
    });
    return true;
  });
  const first = save();
  const second = save();
  assert.equal(await second, undefined);
  open?.();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  const third = save();
  open?.();
  assert.equal(await third, true);
  assert.equal(calls, 2);
});

test('던져도 다음 누름을 막지 않는다', async () => {
  const save = singleFlight(async (fail: boolean) => {
    if (fail) throw new Error('x');
    return 1;
  });
  await assert.rejects(save(true));
  assert.equal(await save(false), 1);
});

test('저장이 바로 끝나도 holdMs 안의 두 번째 누름(더블클릭)은 버린다', async () => {
  let calls = 0;
  const save = singleFlight(async () => {
    calls++;
    return true;
  }, 40);
  assert.equal(await save(), true);
  assert.equal(await save(), undefined);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(await save(), true);
  assert.equal(calls, 2);
});
