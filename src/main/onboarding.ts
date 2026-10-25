import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  screen,
  shell,
  systemPreferences,
} from 'electron';
import { getLang, t } from '../shared/i18n/index.ts';
import { ONBOARD, type OnboardAi, type OnboardSnapshot } from '../shared/ipc.ts';
import { ownsLoginItem } from '../shared/login-item.ts';
import type { Settings } from '../shared/settings.ts';
import { isStarterId } from '../shared/starter-pets.ts';
import { devRendererUrl } from './dev-url.ts';
import { focusWindow, showWindow } from './focus.ts';
import { langArg } from './lang.ts';
import { library } from './pet-library.ts';
import { settings } from './settings.ts';

const MAC_SCREEN_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * 첫 실행 안내: 펫 정하기, 일하는 시간, 같이 보기 권한, 알아 두면 좋은 것.
 * 닫으면 나중에 보던 쪽부터 이어 보고, 시작/건너뛰기를 눌렀을 때만 완료한다.
 */
export function createOnboarding(o: {
  openMaker: () => void;
  /** AI 안내 한 줄에 쓴다: 설치된 AI 가 없으면 무료 AI 와 받을 모델 크기를 알린다 */
  ai: () => Promise<OnboardAi>;
  /** 처음 안내를 명시적으로 마쳤다(시작/건너뛰기). 설정에서 다시 본 것은 부르지 않는다 */
  onFirstDone: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  let win: BrowserWindow | undefined;
  const ours = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.handle(ONBOARD.get, (e): OnboardSnapshot | undefined =>
    ours(e)
      ? {
          settings: settings.get(),
          platform: process.platform,
          canLaunchAtLogin: ownsLoginItem(app.isPackaged, process.env.JJ_USER_DATA),
          screen:
            process.platform === 'darwin'
              ? (systemPreferences.getMediaAccessStatus('screen') as OnboardSnapshot['screen'])
              : 'granted',
          starters: library.starters(),
          photo: library.current()?.thumb ?? null,
        }
      : undefined,
  );
  // 밀크, 초코: 그림을 pets/ 에 복사해 사진 펫으로 (지금 사진 펫은 보관함으로, 설정 창 펫 고르기와 같은 길)
  ipcMain.handle(ONBOARD.pickStarter, (e, id: unknown) => {
    if (ours(e) && isStarterId(id)) library.fromStarter(id);
    return settings.get();
  });
  ipcMain.handle(ONBOARD.set, (e, patch: Partial<Settings>) => {
    if (!ours(e)) return settings.get();
    const allowed = { ...patch };
    if (!ownsLoginItem(app.isPackaged, process.env.JJ_USER_DATA)) delete allowed.launchAtLogin;
    return settings.set(allowed);
  });
  ipcMain.handle(ONBOARD.ai, (e) => (ours(e) ? o.ai() : undefined));
  ipcMain.on(ONBOARD.openMaker, (e) => {
    if (ours(e)) o.openMaker();
  });
  ipcMain.on(ONBOARD.openScreenSettings, (e) => {
    if (ours(e) && process.platform === 'darwin') void shell.openExternal(MAC_SCREEN_SETTINGS);
  });
  /** 처음 마칠 때만 onFirstDone 을 부른다 */
  function markDone() {
    const first = !settings.get().onboarded;
    settings.set({ onboarded: true, onboardPage: 0 });
    if (first) o.onFirstDone();
  }
  ipcMain.on(ONBOARD.finish, (e) => {
    if (!ours(e)) return;
    markDone();
    o.log('onboard', '끝');
    win?.close();
  });

  function open() {
    if (win && !win.isDestroyed()) {
      focusWindow(win);
      return;
    }
    const area = screen.getPrimaryDisplay().workArea;
    win = new BrowserWindow({
      width: Math.min(480, area.width),
      // 첫 쪽과 마지막 단축키 안내까지 들어갈 높이. 영어는 줄바꿈이 더 많다.
      // 작은 화면에서는 본문만 스크롤하고 아래의 다음/시작 단추는 화면 안에 남긴다.
      height: Math.min(getLang() === 'en' ? 664 : 580, area.height),
      resizable: false,
      title: t('main.onboardingTitle'),
      show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=onboarding', langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.once('ready-to-show', () => showWindow(win));
    // OS 닫기와 앱 종료는 나중에 이어 보기다. 완료와 첫 여정은 시작/건너뛰기로만 처리한다.
    win.on('closed', () => {
      win = undefined;
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = devRendererUrl();
    if (devUrl) win.loadURL(`${devUrl}/onboarding.html`);
    else win.loadFile(join(import.meta.dirname, '../renderer/onboarding.html'));
  }

  return {
    open,
    get window() {
      return win;
    },
  };
}
