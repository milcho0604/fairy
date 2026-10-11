import type { Tray } from 'electron';
import type { CalEvent } from '../shared/event-store.ts';
import type { FocusState } from '../shared/focus.ts';
import { joinTrayTitle, TRAY_EVENT_AHEAD_MS, trayTitleText, trayTitleWait } from '../shared/tray-title.ts';

/**
 * 맥 메뉴 막대 아이콘 옆 글자. 컴퓨터 상태(CPU %, system-monitor.ts)와 다음 일정, 집중 남은 시간(설정 trayTitle)이
 * 같은 자리를 나눠 쓴다. 따로 setTitle 하면 서로 지우니 여기서 합쳐 한 번에 쓴다. 맥이 아니면 아무것도 안 한다
 */
const parts = { info: '', cpu: '' };
let shown = '';

export function setTrayTitlePart(tray: Tray, part: keyof typeof parts, text: string): void {
  parts[part] = text;
  if (process.platform !== 'darwin' || tray.isDestroyed()) return;
  const next = joinTrayTitle(parts.info, parts.cpu);
  if (next === shown) return;
  shown = next;
  tray.setTitle(next, { fontType: 'monospacedDigit' });
}

export interface TrayTitleSource {
  on: () => boolean;
  focus: () => FocusState;
  events: (from: number, to: number) => readonly CalEvent[];
}

/** 켜져 있으면 글자를 맞추고 바뀔 때쯤 다시 본다. refresh 는 설정, 일정, 집중이 바뀌었을 때 바로 */
export function watchTrayTitle(tray: Tray, src: TrayTitleSource) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    timer = undefined;
    if (process.platform !== 'darwin' || tray.isDestroyed()) return;
    if (!src.on()) {
      setTrayTitlePart(tray, 'info', '');
      return;
    }
    const now = Date.now();
    const focus = src.focus();
    setTrayTitlePart(tray, 'info', trayTitleText(now, focus, src.events(now, now + TRAY_EVENT_AHEAD_MS)));
    timer = setTimeout(refresh, trayTitleWait(now, focus));
    timer.unref?.();
  };
  refresh();
  return { refresh, dispose: () => clearTimeout(timer) };
}
