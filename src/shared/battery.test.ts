import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calmOn,
  capFps,
  followTickMs,
  idleWaitFactor,
  isSaverMode,
  lowPowerOf,
  motionChoiceFromOld,
  perchPollMs,
  reducedMotionOf,
  SAVER,
  saverOn,
  walkTickMs,
} from './battery.ts';

const plugged = { onBattery: false, lowPower: false };
const battery = { onBattery: true, lowPower: false };
const low = { onBattery: false, lowPower: true };

test('자동은 배터리나 저전력일 때만, 항상은 늘, 끄기는 안 한다', () => {
  assert.equal(saverOn('auto', plugged), false);
  assert.equal(saverOn('auto', battery), true);
  assert.equal(saverOn('auto', low), true);
  assert.equal(saverOn('always', plugged), true);
  assert.equal(saverOn('off', battery), false);
  assert.equal(saverOn('off', low), false);
});

test('움직임 줄이기(걷기 멈춤)는 배터리 절약과 따로다', () => {
  const calm = { onBattery: false, lowPower: false, reducedMotion: true };
  assert.equal(saverOn('off', calm), false);
  assert.equal(saverOn('auto', calm), false);
  assert.equal(saverOn('always', plugged), true);
  assert.equal(calmOn(calm), true);
  assert.equal(calmOn(plugged), false);
  assert.equal(calmOn(battery), false);
  assert.equal(calmOn({ ...low, reducedMotion: false }), false);
});

test('설정 값 검사', () => {
  assert.ok(isSaverMode('auto'));
  assert.ok(isSaverMode('always'));
  assert.ok(isSaverMode('off'));
  assert.equal(isSaverMode('on'), false);
  assert.equal(isSaverMode(undefined), false);
});

test('속도 제한과 열 상태로 저전력을 본다', () => {
  assert.equal(lowPowerOf(100, 'nominal'), false);
  assert.equal(lowPowerOf(undefined, undefined), false);
  assert.equal(lowPowerOf(0, 'unknown'), false);
  assert.equal(lowPowerOf(60, 'nominal'), true);
  assert.equal(lowPowerOf(100, 'serious'), true);
  assert.equal(lowPowerOf(100, 'critical'), true);
  assert.equal(lowPowerOf(100, 'fair'), false);
});

test('그리기 상한: 30 이 15 로, 걷기 12 와 멈춤 0 은 그대로', () => {
  assert.equal(capFps(30, true), SAVER.fpsCap);
  assert.equal(capFps(60, true), SAVER.fpsCap);
  assert.equal(capFps(12, true), 12);
  assert.equal(capFps(0, true), 0);
  assert.equal(capFps(30, false), 30);
});

test('창 위 앉기 확인 1초에서 3초, 걷기 창 옮기기 20Hz 에서 12Hz, 행동 간격 늘림', () => {
  assert.equal(perchPollMs(false), 1000);
  assert.equal(perchPollMs(true), 3000);
  assert.equal(walkTickMs(false, false), 50);
  assert.equal(walkTickMs(false, true), 16);
  assert.equal(walkTickMs(true, false), 83);
  // 따라 달리기는 빨라서 예전 그대로
  assert.equal(followTickMs(false, false), 33);
  assert.equal(followTickMs(false, true), 16);
  assert.equal(followTickMs(true, true), 66);
  // 절약이 부스트보다 먼저 (부스트는 배터리면 원래 쉰다, 항상 절약이면 절약)
  assert.equal(walkTickMs(true, true), SAVER.walkTickMs);
  assert.equal(idleWaitFactor(false), 1);
  assert.ok(idleWaitFactor(true) > 1);
});

test('움직임 줄이기 고르기: 운영체제 따름, 항상, 줄이지 않기', () => {
  assert.equal(reducedMotionOf('system', true), true);
  assert.equal(reducedMotionOf('system', false), false);
  assert.equal(reducedMotionOf('always', false), true);
  assert.equal(reducedMotionOf('off', true), false);
});

test('옛 설정: 값이 없으면 배터리 절약 항상을 이어받고, 있으면 그대로', () => {
  assert.equal(motionChoiceFromOld(undefined, 'always'), 'always');
  assert.equal(motionChoiceFromOld(undefined, 'auto'), 'system');
  assert.equal(motionChoiceFromOld(undefined, undefined), 'system');
  assert.equal(motionChoiceFromOld('off', 'always'), 'off');
  assert.equal(motionChoiceFromOld('bogus', 'off'), 'system');
});
