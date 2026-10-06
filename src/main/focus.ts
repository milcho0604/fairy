import { app, type BrowserWindow, type Display, screen } from 'electron';

/**
 * 창을 앞으로 부르기. 펫 앱은 Dock 없이 떠 있어서 창만 앞으로 부르면 키보드가 다른 앱에 남는다.
 * 사용자가 부른 창(패널, 채팅, 설정)이니 앱을 앞으로 가져온다.
 * JJ_NO_FOCUS=1 (점검용 시험 인스턴스)이면 앞으로 가져오지 않고 보이기만 한다. 쓰는 사람의 입력을 뺏지 않게.
 */
const noFocus = !!process.env.JJ_NO_FOCUS;

export function stealFocus(): void {
  if (!noFocus && process.platform === 'darwin') app.focus({ steal: true });
}

export function showWindow(win: BrowserWindow | undefined): void {
  if (!win || win.isDestroyed()) return;
  if (noFocus) win.showInactive();
  else win.show();
}

export function focusWindow(win: BrowserWindow | undefined): void {
  if (!win || win.isDestroyed()) return;
  if (noFocus) {
    win.showInactive();
    return;
  }
  win.show();
  win.focus();
}

/**
 * 시험 인스턴스(JJ_NO_FOCUS=1)는 맥북 내장 화면만 있는 것처럼 본다. 창을 연 뒤 옮기면 그 사이 쓰는 사람의
 * 작업 모니터에 잠깐 떠서, 처음부터 내장 화면에 열리게 화면 목록, 주 화면, 커서 위치를 내장 화면으로 바꾼다.
 * 걷기, 숨바꼭질, 던지기도 내장 화면 안에서만 움직인다. 내장 화면이 없으면 그대로 둔다.
 */
export function confineTestDisplay(): void {
  if (!noFocus) return;
  const internal = screen.getAllDisplays().find((d) => d.internal);
  if (!internal) return;
  const allDisplays = screen.getAllDisplays.bind(screen);
  const only = (): Display => allDisplays().find((d) => d.id === internal.id) ?? internal;
  Object.assign(screen, {
    getAllDisplays: () => allDisplays().filter((d) => d.id === internal.id),
    getPrimaryDisplay: only,
    getDisplayNearestPoint: only,
    getDisplayMatching: only,
    getCursorScreenPoint: () => {
      const a = only().workArea;
      return { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    },
  });
  // 위치를 주지 않은 창(설정, 만들기, 시작 안내)은 운영체제가 주 화면 가운데에 놓는다. 만들어지는 순간 옮긴다
  app.on('browser-window-created', (_e, win) => {
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
