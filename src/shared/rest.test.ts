import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REST, RestCoach } from './rest.ts';

const MIN = 60_000;

/** 1분마다 tick. idle 은 그 시점 입력 없는 초 */
function run(
  coach: RestCoach,
  from: number,
  minutes: number,
  idle = 0,
  level: 'normal' | 'chatty' | 'quiet' = 'normal',
) {
  const events: [number, string][] = [];
  for (let m = 1; m <= minutes; m++) {
    const e = coach.tick(from + m * MIN, idle, level);
    if (e) events.push([m, e]);
  }
  return events;
}

test('보통은 2시간, 수다쟁이는 1시간 일하면 권한다. 조용히는 안 한다', () => {
  assert.deepEqual(run(new RestCoach(), 0, 130), [[121, 'suggest']]);
  assert.deepEqual(run(new RestCoach(), 0, 70, 0, 'chatty'), [[61, 'suggest']]);
  assert.deepEqual(run(new RestCoach(), 0, 300, 0, 'quiet'), []);
});

test('5분 넘게 쉬면 처음부터 다시 센다', () => {
  const c = new RestCoach();
  run(c, 0, 100);
  c.tick(101 * MIN, REST.idleResetSec, 'normal');
  assert.deepEqual(run(c, 101 * MIN, 100), []);
});

test('받아들이고 3분 넘게 비웠다 오면 쉰 것. 그동안은 또 권하지 않는다', () => {
  const c = new RestCoach();
  c.tick(0, 0, 'normal');
  c.accept(0);
  assert.equal(c.tick(MIN, 10, 'normal'), undefined);
  assert.equal(c.tick(5 * MIN, REST.breakSec + 5, 'normal'), undefined);
  assert.equal(c.tick(6 * MIN, 3, 'normal'), 'rested');
  assert.equal(c.tick(7 * MIN, 3, 'normal'), undefined);
});

test('받아들이고 30분 안에 안 쉬면 보상 없음', () => {
  const c = new RestCoach();
  c.tick(0, 0, 'normal');
  c.accept(0);
  for (let m = 1; m <= 40; m++) assert.notEqual(c.tick(m * MIN, 5, 'normal'), 'rested');
  assert.equal(c.tick(41 * MIN, REST.breakSec + 1, 'normal'), undefined);
  assert.equal(c.tick(42 * MIN, 1, 'normal'), undefined);
});
