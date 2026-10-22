// 이름 옆 펫 얼굴 (shared/face.ts). 내 펫 화면이 지금 모습으로 그려 보낸 얼굴을 기억했다가
// 얼굴을 쓰는 창(채팅, 패널, 빠른 입력, 시작 안내, 설정)에 준다. 펫을 바꾸면 펫 화면이 다시 그려 보내고,
// 여기서 열린 창 모두에 바로 알린다.
import { ipcMain, nativeImage, type WebContents, webContents } from 'electron';
import { isFaceUrl } from '../shared/face.ts';
import { FACE } from '../shared/ipc.ts';

/**
 * petContents: 내 펫 화면 (친구 펫 화면이 보낸 것은 받지 않는다).
 * onChange: 얼굴이 바뀔 때 (윈도우 알림 영역 아이콘을 지금 펫으로 바꾸는 데 쓴다)
 */
export function createPetFace(petContents: () => WebContents | undefined, onChange?: (url: string) => void) {
  let current: string | null = null;
  ipcMain.on(FACE.set, (e, url: unknown) => {
    if (e.sender !== petContents() || !isFaceUrl(url) || url === current) return;
    current = url;
    // BrowserWindow 목록으로는 큰 창의 view(본문, 채팅)가 빠진다: 모든 화면에 보내고 듣지 않는 화면은 무시한다
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed() && wc !== e.sender) wc.send(FACE.changed, url);
    }
    onChange?.(url);
  });
  ipcMain.handle(FACE.get, () => current);
  return {
    get current() {
      return current;
    },
  };
}

/** 알림 영역(윈도우) 아이콘 크기. 원래 resources/tray.png 와 같은 32px (작은 화면에서는 운영체제가 줄인다) */
const TRAY_PX = 32;

/** 얼굴 그림을 윈도우 알림 영역 아이콘으로. 맥 메뉴 막대는 흑백 템플릿 아이콘이라 쓰지 않는다 */
export function trayImageOf(url: string): Electron.NativeImage | undefined {
  const img = nativeImage.createFromDataURL(url);
  if (img.isEmpty()) return undefined;
  return img.resize({ width: TRAY_PX, height: TRAY_PX, quality: 'best' });
}
