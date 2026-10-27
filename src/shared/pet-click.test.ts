import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PET_DOUBLE_CLICK_DELAY_MS, type PetClickScheduler, PetClickSequence } from './pet-click.ts';

function fakeScheduler() {
  let now = 0;
  const tasks: { at: number; callback: () => void; cancelled: boolean }[] = [];
  const scheduler: PetClickScheduler = {
    now: () => now,
    schedule(callback, delayMs) {
      const task = { at: now + delayMs, callback, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
  };

  return {
    scheduler,
    advance(ms: number) {
      const end = now + ms;
      while (true) {
        const task = tasks
          .filter((candidate) => !candidate.cancelled && candidate.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!task) break;
        task.cancelled = true;
        now = task.at;
        task.callback();
      }
      now = end;
    },
  };
}

test('500ms 안에 두 번째 클릭이 오면 단일 동작 없이 더블클릭 한 번만 실행한다', () => {
  const timers = fakeScheduler();
  const actions: string[] = [];
  const clicks = new PetClickSequence(
    () => actions.push('single'),
    () => actions.push('double'),
    timers.scheduler,
  );

  assert.equal(PET_DOUBLE_CLICK_DELAY_MS, 500);
  clicks.click();
  timers.advance(300); // 기존 280ms 경계에서는 첫 동작이 이미 실행되던 구간
  clicks.click();
  timers.advance(PET_DOUBLE_CLICK_DELAY_MS);

  assert.deepEqual(actions, ['double']);
});

test('두 번째 누름이 기한 안에 시작되면 기한 뒤에 떼도 더블클릭이다', () => {
  const timers = fakeScheduler();
  const actions: string[] = [];
  const clicks = new PetClickSequence(
    () => actions.push('single'),
    () => actions.push('double'),
    timers.scheduler,
  );

  clicks.click();
  timers.advance(300);
  clicks.press();
  timers.advance(300); // 두 번째 버튼을 누른 채로 첫 클릭의 기한을 지난다
  assert.deepEqual(actions, []);
  clicks.click();

  assert.deepEqual(actions, ['double']);
});

test('더블클릭 시간이 지나면 단일 클릭 두 번으로 확정한다', () => {
  const timers = fakeScheduler();
  const actions: string[] = [];
  const clicks = new PetClickSequence(
    () => actions.push('single'),
    () => actions.push('double'),
    timers.scheduler,
  );

  clicks.click();
  timers.advance(PET_DOUBLE_CLICK_DELAY_MS);
  clicks.click();
  timers.advance(PET_DOUBLE_CLICK_DELAY_MS);

  assert.deepEqual(actions, ['single', 'single']);
});

test('두 번째 누름이 클릭으로 끝나지 않으면 첫 클릭의 남은 시간 뒤 단일 동작을 실행한다', () => {
  const timers = fakeScheduler();
  const actions: string[] = [];
  const clicks = new PetClickSequence(
    () => actions.push('single'),
    () => actions.push('double'),
    timers.scheduler,
  );

  clicks.click();
  timers.advance(300);
  clicks.press();
  timers.advance(100);
  clicks.cancelPress();
  timers.advance(99);
  assert.deepEqual(actions, []);
  timers.advance(1);

  assert.deepEqual(actions, ['single']);
});

test('대기 중 취소하면 단일 동작을 실행하지 않는다', () => {
  const timers = fakeScheduler();
  const actions: string[] = [];
  const clicks = new PetClickSequence(
    () => actions.push('single'),
    () => actions.push('double'),
    timers.scheduler,
  );

  clicks.click();
  timers.advance(300);
  clicks.press();
  timers.advance(300);
  clicks.cancel();
  timers.advance(PET_DOUBLE_CLICK_DELAY_MS);

  assert.deepEqual(actions, []);
});
