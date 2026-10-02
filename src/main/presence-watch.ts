import { createRequire } from 'node:module';
import { windowsStateMeansHide } from '../shared/presence.ts';

const POLL_MS = 3000;

/**
 * 윈도우에서 전체 화면 앱, 발표 모드를 감지한다 (P1-10). 맥은 펫 창이 다른 앱 전체 화면 공간에
 * 끼지 않게 해 두어(visibleOnFullScreen: false) 운영체제가 알아서 가린다.
 * 2026-10-02 기준 윈도우 실기기에서 확인 전 (D1 대기).
 */
export function watchPresentation(
  onChange: (hide: boolean) => void,
  log: (tag: string, ...rest: unknown[]) => void,
) {
  if (process.platform !== 'win32') return () => {};
  let query: (() => number) | undefined;
  try {
    // koffi 는 윈도우에서만 쓴다. 다른 운영체제에서는 불러오지도 않는다.
    const require = createRequire(import.meta.url);
    const koffi = require('koffi');
    const shell32 = koffi.load('shell32.dll');
    const fn = shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int *state)');
    query = () => {
      const out = [0];
      return fn(out) === 0 ? (out[0] ?? 5) : 5;
    };
  } catch (err) {
    log('presence', '발표 모드 감지를 못 씀', err instanceof Error ? err.message : String(err));
    return () => {};
  }
  let last = false;
  const timer = setInterval(() => {
    const hide = windowsStateMeansHide(query?.() ?? 5);
    if (hide !== last) {
      last = hide;
      log('presence', hide ? '전체 화면, 발표 감지' : '끝');
      onChange(hide);
    }
  }, POLL_MS);
  return () => clearInterval(timer);
}
