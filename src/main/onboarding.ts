import { join } from 'node:path';
import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
  systemPreferences,
} from 'electron';
import { t } from '../shared/i18n/index.ts';
import { ONBOARD, type OnboardAi, type OnboardSnapshot } from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import { settings } from './settings.ts';

const MAC_SCREEN_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/**
 * 첫 실행 안내 (v1): 펫 정하기, 같이 보기 권한, 알아 두면 좋은 것 세 화면.
 * 처음 켤 때 한 번 뜨고, 다 보거나 닫으면 다시 안 뜬다 (설정 onboarded).
 */
export function createOnboarding(o: {
  openMaker: () => void;
  /** AI 안내 한 줄에 쓴다: 설치된 AI 가 없으면 무료 AI 와 받을 모델 크기를 알린다 */
  ai: () => Promise<OnboardAi>;
  /** 처음 안내를 마쳤다(끝까지 보거나 건너뛰거나 닫음). 설정에서 다시 본 것은 부르지 않는다 */
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
          screen:
            process.platform === 'darwin'
              ? (systemPreferences.getMediaAccessStatus('screen') as OnboardSnapshot['screen'])
              : 'granted',
        }
      : undefined,
  );
  ipcMain.handle(ONBOARD.set, (e, patch: Partial<Settings>) =>
    ours(e) ? settings.set(patch) : settings.get(),
  );
  ipcMain.handle(ONBOARD.ai, (e) => (ours(e) ? o.ai() : undefined));
  ipcMain.on(ONBOARD.openMaker, (e) => {
    if (ours(e)) o.openMaker();
  });
  ipcMain.on(ONBOARD.openScreenSettings, (e) => {
    if (ours(e) && process.platform === 'darwin') void shell.openExternal(MAC_SCREEN_SETTINGS);
  });
  /** 처음 마칠 때만 onFirstDone 을 부른다 */
  function markDone() {
    if (settings.get().onboarded) return;
    settings.set({ onboarded: true });
    o.onFirstDone();
  }
  ipcMain.on(ONBOARD.finish, (e) => {
    if (!ours(e)) return;
    markDone();
    o.log('onboard', '끝');
    win?.close();
  });

  function open() {
    stealFocus();
    if (win && !win.isDestroyed()) {
      focusWindow(win);
      return;
    }
    win = new BrowserWindow({
      width: 480,
      height: 560,
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
    // 닫기 단추로 닫아도 다시 띄우지 않는다 (설정에서 다시 볼 수 있다).
    win.on('closed', () => {
      markDone();
      win = undefined;
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
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
