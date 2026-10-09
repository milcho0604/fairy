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

test('연속 작업 분(기운의 피로)은 권유를 띄워도 이어 세고, 5분 넘게 쉬거나 권유대로 쉬면 0', () => {
  const c = new RestCoach();
  run(c, 0, 130);
  // 첫 틱은 기준만 잡아 130 틱이면 129분
  assert.equal(c.workedMin, 9); // 권유(121번째 틱)에서 0 으로
  assert.equal(c.streakMin, 129);
  c.tick(131 * MIN, REST.idleResetSec, 'normal');
  assert.equal(c.streakMin, 0);
  const d = new RestCoach();
  run(d, 0, 100);
  d.accept(100 * MIN);
  d.tick(104 * MIN, REST.breakSec + 5, 'normal');
  assert.equal(d.tick(105 * MIN, 3, 'normal'), 'rested');
  assert.equal(d.streakMin, 0);
});

test('시계를 뒤로 돌려도 일한 시간이 줄지 않는다', () => {
  const c = new RestCoach();
  run(c, 0, 60);
  c.tick(10 * MIN, 0, 'normal');
  assert.equal(c.streakMin, 59);
  c.tick(11 * MIN, 0, 'normal');
  assert.equal(c.streakMin, 60);
});
