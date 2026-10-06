import { join } from 'node:path';
import { app, BrowserWindow, clipboard, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron';
import { type BetaReport, reportText, type StatStore } from '../shared/beta-stats.ts';
import { SETTINGS, type SettingsSection, type SettingsSnapshot } from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';
import { settings } from './settings.ts';

export interface SettingsWindowOptions {
  scale: () => number;
  setScale: (scale: number) => void;
  openMaker: () => void;
  stats: StatStore;
}

/** 설정 창 (P1-12). 열 때 만들고 닫으면 없앤다 (L6). */
export function createSettingsWindow({ scale, setScale, openMaker, stats }: SettingsWindowOptions) {
  let win: BrowserWindow | undefined;
  const fromSettings = (e: IpcMainEvent | IpcMainInvokeEvent) => !!win && e.sender === win.webContents;

  ipcMain.handle(SETTINGS.get, (e): SettingsSnapshot | undefined =>
    fromSettings(e)
      ? {
          settings: settings.get(),
          scale: scale(),
          packaged: app.isPackaged,
          platform: process.platform,
          version: app.getVersion(),
        }
      : undefined,
  );
  ipcMain.handle(SETTINGS.set, (e, patch: Partial<Settings>) =>
    fromSettings(e) ? settings.set(patch) : settings.get(),
  );
  ipcMain.on(SETTINGS.setScale, (e, next: number) => {
    if (fromSettings(e) && typeof next === 'number') setScale(next);
  });
  ipcMain.on(SETTINGS.openMaker, (e) => {
    if (fromSettings(e)) openMaker();
  });
  ipcMain.handle(SETTINGS.stats, (e): BetaReport | undefined =>
    fromSettings(e) ? stats.report(Date.now()) : undefined,
  );
  ipcMain.handle(SETTINGS.copyStats, (e) => {
    if (!fromSettings(e)) return false;
    clipboard.writeText(reportText(stats.report(Date.now()), { version: app.getVersion(), os: osLabel() }));
    return true;
  });
  settings.onChange((next) => {
    if (win && !win.isDestroyed()) win.webContents.send(SETTINGS.changed, next);
  });

  /** section 을 주면 그 칸을 바로 보여 준다 (메뉴 막대 "의견 보내기" → 베타 기록). */
  function open(section?: SettingsSection) {
    if (process.platform === 'darwin') app.focus({ steal: true });
    if (win && !win.isDestroyed()) {
      if (section) win.webContents.send(SETTINGS.focus, section);
      win.show();
      win.focus();
      return;
    }
    win = new BrowserWindow({
      width: 440,
      height: 620,
      minWidth: 360,
      minHeight: 420,
      title: '짝꿍 설정',
      show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=settings'],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
      win = undefined;
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) win.loadURL(`${devUrl}/settings.html${section ? `#${section}` : ''}`);
    else win.loadFile(join(import.meta.dirname, '../renderer/settings.html'), { hash: section });
  }

  return {
    open,
    get window() {
      return win;
    },
  };
}

/** 복사 글에 넣을 운영체제 (판과 칩까지만) */
function osLabel(): string {
  const name =
    process.platform === 'darwin' ? '맥' : process.platform === 'win32' ? '윈도우' : process.platform;
  return `${name} ${process.getSystemVersion()} ${process.arch}`;
}
