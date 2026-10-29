import { powerMonitor, systemPreferences } from 'electron';
import { calmOn, lowPowerOf, type PowerFacts, reducedMotionOf, saverOn } from '../shared/battery.ts';
import { settings } from './settings.ts';

/**
 * 배터리 절약 (설정 편의, shared/battery.ts). 전원 꽂고 빼기, CPU 속도 제한(맥 저전력 모드), 열 상태를 듣고
 * 지금 아낄지 알려 준다. 앱이 준비된 뒤(watchPower) 듣기 시작한다. 그 전에는 배터리만 본다
 */
let speedLimit: number | undefined;
let thermal: string | undefined;
const listeners = new Set<(on: boolean) => void>();
let last: boolean | undefined;
let watching = false;

/** 개발용: 배터리인 척 (메인 디버거 __jj.debugBattery). 시험 컴퓨터에는 배터리가 없다 */
let fakeBattery: boolean | undefined;

/** 개발용: 운영체제 동작 줄이기를 켠(끈) 척 (__jj.debugReducedMotion) */
let fakeReduced: boolean | undefined;

/** 운영체제 "동작 줄이기" (맥 손쉬운 사용, 윈도 애니메이션 끔). 못 읽으면 꺼진 것으로 */
function osReducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion;
  } catch {
    return false;
  }
}

/** 설정(운영체제 따름, 항상, 줄이지 않기)까지 합친 지금 줄일지 */
function reducedMotionNow(): boolean {
  return reducedMotionOf(settings.get().reduceMotion, fakeReduced ?? osReducedMotion());
}

export function powerFacts(): PowerFacts {
  return {
    onBattery: fakeBattery ?? powerMonitor.isOnBatteryPower(),
    lowPower: lowPowerOf(speedLimit, thermal),
    reducedMotion: reducedMotionNow(),
  };
}

/** 화면을 가로지르는 움직임(돌아다니기, 손님 걷기, 집 문 걷기)을 줄일지. 절약 판정(saverNow)과 같은 사실에서 정한다 */
export function motionCalm(): boolean {
  return calmOn(powerFacts());
}

export function debugReducedMotion(on: boolean | undefined): void {
  fakeReduced = on;
  check();
}

export function debugBattery(on: boolean | undefined): void {
  fakeBattery = on;
  check();
}

export function saverNow(): boolean {
  return saverOn(settings.get().batterySaver, powerFacts());
}

function check() {
  const now = saverNow();
  if (now === last) return;
  last = now;
  for (const l of listeners) l(now);
}

/** 바뀔 때 알린다 (설정, 전원, 저전력) */
export function onSaverChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function watchPower(log: (tag: string, ...rest: unknown[]) => void): () => void {
  if (watching) return () => {};
  watching = true;
  last = saverNow();
  try {
    thermal = powerMonitor.getCurrentThermalState?.();
  } catch {
    thermal = undefined;
  }
  const onSpeed = (d: { limit: number }) => {
    speedLimit = d.limit;
    check();
  };
  const onThermal = (d: { state: string }) => {
    thermal = d.state;
    check();
  };
  const stopSettings = settings.onChange((next, prev) => {
    if (next.batterySaver !== prev.batterySaver || next.reduceMotion !== prev.reduceMotion) check();
  });
  powerMonitor.on('on-ac', check);
  powerMonitor.on('on-battery', check);
  powerMonitor.on('speed-limit-change', onSpeed);
  powerMonitor.on('thermal-state-change', onThermal);
  onSaverChange((on) => log('power', on ? '배터리 절약 켬' : '배터리 절약 끔', JSON.stringify(powerFacts())));
  return () => {
    stopSettings();
    powerMonitor.off('on-ac', check);
    powerMonitor.off('on-battery', check);
    powerMonitor.off('speed-limit-change', onSpeed);
    powerMonitor.off('thermal-state-change', onThermal);
  };
}
