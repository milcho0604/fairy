import { powerMonitor } from 'electron';
import { settings } from './settings.ts';

/**
 * 부스트 모드 (설정, 기본 끔): 사양 좋은 컴퓨터용으로 움직임과 커서 보기를 더 촘촘히 하고 무료 AI 를 30분 데워 둔다.
 * 노트북이 배터리로 돌 때는 쉰다 (전원을 꽂으면 다시 켜진다). 무엇을 바꾸는지와 켬, 끔 측정은 docs/roadmap.md
 */
export function boostOn(): boolean {
  return settings.get().boost && !powerMonitor.isOnBatteryPower();
}

/** 지금 켜짐이 바뀌면(설정을 바꾸거나 전원을 꽂고 뺄 때) 알린다 */
export function onBoostChange(fn: (on: boolean) => void): () => void {
  let last = boostOn();
  const check = () => {
    const now = boostOn();
    if (now === last) return;
    last = now;
    fn(now);
  };
  const stopSettings = settings.onChange(check);
  powerMonitor.on('on-ac', check);
  powerMonitor.on('on-battery', check);
  return () => {
    stopSettings();
    powerMonitor.off('on-ac', check);
    powerMonitor.off('on-battery', check);
  };
}
