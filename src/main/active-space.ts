import type { BrowserWindow } from 'electron';

/**
 * setVisibleOnAllWorkspaces 에 늘 같이 넘긴다. 빼면 Electron(맥)이 부를 때마다 앱 종류를 바꾼다:
 * visibleOnFullScreen 이 false 면 Dock 아이콘 있는 보통 앱(Foreground)으로, true 면 Dock 없는 앱(UIElement)으로.
 * 펫 앱은 Dock 없이 떠 있어야 하는데(LSUIElement, app.dock.hide) 펫 창을 만들 때 보통 앱으로 바뀌어 있었다
 * (2026-10-12 시험 인스턴스 lsappinfo 실측: type="Foreground"). 보통 앱은 앞으로 올 때 맥이 그 앱 창이 있는
 * 데스크톱(Space)으로 화면을 넘긴다. 펫을 눌러 다른 데스크톱으로 끌려가던 까닭 가운데 하나다.
 */
export const KEEP_APP_TYPE = { skipTransformProcessType: true } as const;

type SpaceWindow = Pick<BrowserWindow, 'isVisibleOnAllWorkspaces' | 'setVisibleOnAllWorkspaces'>;

/**
 * 맥: 창을 지금 보고 있는 데스크톱(Space)에서 띄운다. 맥은 창을 처음 뜬 데스크톱에 묶어 두고, 그 창을 다시 보이거나
 * 앱을 앞으로 가져오면 화면을 그 데스크톱으로 넘긴다. 펫은 모든 데스크톱에 따라오는데 펫을 눌러 연 패널, 채팅, 설정은
 * 그렇지 않아 원래 데스크톱으로 끌려갔다 (2026-10-12 사용자 보고).
 * 잠깐 모든 데스크톱에 보이게 한 채 띄우고(run) 다시 끈다. 끄는 순간 보고 있던 데스크톱에 남는다.
 * 이미 모든 데스크톱에 보이는 창(펫, 같이 보기)과 맥이 아닌 곳은 그대로 run 만 한다.
 */
export function onActiveSpace(
  win: SpaceWindow,
  run: () => void,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin' || win.isVisibleOnAllWorkspaces()) {
    run();
    return;
  }
  win.setVisibleOnAllWorkspaces(true, KEEP_APP_TYPE);
  try {
    run();
  } finally {
    win.setVisibleOnAllWorkspaces(false, KEEP_APP_TYPE);
  }
}
