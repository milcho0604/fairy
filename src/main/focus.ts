import { app, type BrowserWindow, type Display, screen } from 'electron';
import { onActiveSpace } from './active-space.ts';

/**
 * 창을 앞으로 부르기. 펫 앱은 Dock 없이 떠 있어서 창만 앞으로 부르면 키보드가 다른 앱에 남는다.
 * 사용자가 부른 창(패널, 채팅, 설정)이니 앱을 앞으로 가져온다.
 * JJ_NO_FOCUS=1 (점검용 시험 인스턴스)이면 앞으로 가져오지 않고 보이기만 한다. 쓰는 사람의 입력을 뺏지 않게.
 */
const noFocus = !!process.env.JJ_NO_FOCUS;

export function stealFocus(): void {
  if (!noFocus && process.platform === 'darwin') app.focus({ steal: true });
}

/**
 * 앱을 앞으로 가져오는 것(stealFocus)은 창을 지금 데스크톱에 띄운 뒤에 한다. 먼저 하면 맥이 이 앱 창이 있는 다른
 * 데스크톱(Space)으로 화면을 넘긴다 (2026-10-12: 다른 데스크톱에서 펫을 누르면 원래 데스크톱으로 돌아감, active-space.ts)
 */
export function showWindow(win: BrowserWindow | undefined): void {
  if (!win || win.isDestroyed()) return;
  if (noFocus) win.showInactive();
  else
    onActiveSpace(win, () => {
      win.show();
      stealFocus();
    });
}

export function focusWindow(win: BrowserWindow | undefined): void {
  if (!win || win.isDestroyed()) return;
  if (noFocus) {
    win.showInactive();
    return;
  }
  onActiveSpace(win, () => {
    win.show();
    win.focus();
    stealFocus();
  });
}

/**
 * 시험 인스턴스(JJ_NO_FOCUS=1)는 창을 숨기고(투명, 마우스 통과), 맥북 내장 화면만 있는 것처럼 본다. 창을 연 뒤 옮기면 그 사이 쓰는 사람의
 * 작업 모니터에 잠깐 떠서, 처음부터 내장 화면에 열리게 화면 목록, 주 화면, 커서 위치를 내장 화면으로 바꾼다.
 * 걷기, 숨바꼭질, 던지기도 내장 화면 안에서만 움직인다. 내장 화면이 없으면 그대로 둔다.
 */
export function confineTestDisplay(): void {
  if (!noFocus) return;
  const internal = screen.getAllDisplays().find((d) => d.internal);
  if (!internal) return;
  const allDisplays = screen.getAllDisplays.bind(screen);
  const realCursor = screen.getCursorScreenPoint.bind(screen);
  const only = (): Display => allDisplays().find((d) => d.id === internal.id) ?? internal;
  Object.assign(screen, {
    getAllDisplays: () => allDisplays().filter((d) => d.id === internal.id),
    getPrimaryDisplay: only,
    getDisplayNearestPoint: only,
    getDisplayMatching: only,
    // 진짜 커서가 내장 화면 위면 그대로 준다(맥북 화면에서 펫을 끌 수 있게). 다른 화면에 있으면 내장 화면 가운데로
    getCursorScreenPoint: () => {
      const p = realCursor();
      const b = only().bounds;
      if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) return p;
      const a = only().workArea;
      return { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    },
  });
  // 위치를 주지 않은 창(설정, 만들기, 시작 안내)은 운영체제가 주 화면 가운데에 놓는다. 만들어지는 순간 옮긴다
  app.on('browser-window-created', (_e, win) => {
    // 숨김 (사용자 요청 2026-10-06): 시험 창은 보이지도 않고 마우스도 가져가지 않는다. 화면은 CDP 로 찍고
    // 입력도 CDP 로 넣으니 시험에는 지장이 없다. 눈으로 봐야 하면 JJ_SHOW=1
    if (!process.env.JJ_SHOW) {
      win.setOpacity(0);
      win.setIgnoreMouseEvents(true);
      // 펫 창은 펫 위에서 마우스를 받으려고 이 값을 바꾼다. 시험 중에는 늘 통과시킨다
      win.setIgnoreMouseEvents = () => {};
    }
    const a = only().workArea;
    const b = win.getBounds();
    const inside =
      b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
    if (inside) return;
    win.setPosition(
      Math.round(a.x + Math.max(0, (a.width - b.width) / 2)),
      Math.round(a.y + Math.max(0, (a.height - b.height) / 2)),
    );
  });
}
