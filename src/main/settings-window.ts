import { join } from 'node:path';
import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron';
import { SETTINGS, type SettingsSnapshot } from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';
import { settings } from './settings.ts';

export interface SettingsWindowOptions {
  scale: () => number;
  setScale: (scale: number) => void;
  openMaker: () => void;
}

/** 설정 창 (P1-12). 열 때 만들고 닫으면 없앤다 (L6). */
export function createSettingsWindow({ scale, setScale, openMaker }: SettingsWindowOptions) {
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
  settings.onChange((next) => {
    if (win && !win.isDestroyed()) win.webContents.send(SETTINGS.changed, next);
  });

  function open() {
    if (process.platform === 'darwin') app.focus({ steal: true });
    if (win && !win.isDestroyed()) {
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
    if (devUrl) win.loadURL(`${devUrl}/settings.html`);
    else win.loadFile(join(import.meta.dirname, '../renderer/settings.html'));
  }

  return {
    open,
    get window() {
      return win;
    },
  };
}
