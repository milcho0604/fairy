import { app, type BrowserWindow } from 'electron';

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
