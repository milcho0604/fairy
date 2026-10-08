import { type Display, screen } from 'electron';
import { displaySignature, settleDisplayChanges } from '../shared/display-change.ts';

/** 맥이 몰아 보내는 빈 알림은 쉬고 몰아 온 알림이 잦아든 뒤 이 시간 안에 한 번만 본다 */
const SETTLE_MS = 250;

/**
 * 모니터가 끼워지거나 빠지거나, 해상도, 작업 영역(독, 메뉴 막대)이 실제로 바뀌었을 때만 부른다.
 * 맥이 값 변화 없이 보내는 display-metrics-changed 묶음(약 90ms 간격 16번, 22번)은 거른다 (display-change.ts)
 */
export function onDisplaysChanged(fn: (displays: Display[]) => void): () => void {
  const watch = settleDisplayChanges({
    read: () => screen.getAllDisplays(),
    key: displaySignature,
    onChange: fn,
    ms: SETTLE_MS,
  });
  screen.on('display-added', watch.notify);
  screen.on('display-removed', watch.notify);
  screen.on('display-metrics-changed', watch.notify);
  return () => {
    watch.stop();
    screen.off('display-added', watch.notify);
    screen.off('display-removed', watch.notify);
    screen.off('display-metrics-changed', watch.notify);
  };
}
