import { join, sep } from 'node:path';
import { app, BrowserWindow, clipboard, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron';
import { type BetaReport, reportText, type StatStore } from '../shared/beta-stats.ts';
import { t } from '../shared/i18n/index.ts';
import { type MakerTarget, SETTINGS, type SettingsSection, type SettingsSnapshot } from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import { settings } from './settings.ts';

export interface SettingsWindowOptions {
  scale: () => number;
  setScale: (scale: number) => void;
  openMaker: (target: MakerTarget) => void;
  stats: StatStore;
  checkUpdate: () => Promise<string>;
  openOnboarding: () => void;
  v2: {
    exportData: (win?: BrowserWindow) => Promise<string>;
    importData: (win?: BrowserWindow) => Promise<string>;
    exportPet: (win?: BrowserWindow) => Promise<string>;
    importPet: (win?: BrowserWindow) => Promise<{ ok: boolean; message: string }>;
    importFriend: (win?: BrowserWindow) => Promise<{ ok: boolean; message: string }>;
    syncCalendar: () => Promise<string>;
    calendarLast: () => string;
    mcpServers: () => string[];
    refreshMcp: () => Promise<string[]>;
  };
}

/** 설정 창 (P1-12). 열 때 만들고 닫으면 없앤다 (L6). */
export function createSettingsWindow({
  scale,
  setScale,
  openMaker,
  stats,
  checkUpdate,
  openOnboarding,
  v2,
}: SettingsWindowOptions) {
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
          mcp: {
            exec: process.execPath,
            // 설치판에서는 asar 밖에 풀어 둔 사본을 쓴다 (electron-builder asarUnpack)
            script: join(app.getAppPath(), 'out', 'main', 'mcp-server.js').replace(
              `app.asar${sep}`,
              `app.asar.unpacked${sep}`,
            ),
          },
          myMcpServers: v2.mcpServers(),
          calendarLast: v2.calendarLast(),
        }
      : undefined,
  );
  ipcMain.handle(SETTINGS.set, (e, patch: Partial<Settings>) =>
    fromSettings(e) ? settings.set(patch) : settings.get(),
  );
  ipcMain.on(SETTINGS.setScale, (e, next: number) => {
    if (fromSettings(e) && typeof next === 'number') setScale(next);
  });
  ipcMain.on(SETTINGS.openMaker, (e, target: unknown) => {
    const ok = target === 'happy' || target === 'sleepy' || target === 'hungry';
    if (fromSettings(e)) openMaker(ok ? target : 'main');
  });
  ipcMain.handle(SETTINGS.stats, (e): BetaReport | undefined =>
    fromSettings(e) ? stats.report(Date.now()) : undefined,
  );
  ipcMain.handle(SETTINGS.copyStats, (e) => {
    if (!fromSettings(e)) return false;
    clipboard.writeText(reportText(stats.report(Date.now()), { version: app.getVersion(), os: osLabel() }));
    return true;
  });
  ipcMain.handle(SETTINGS.checkUpdate, (e) => (fromSettings(e) ? checkUpdate() : ''));
  ipcMain.handle(SETTINGS.exportData, (e) => (fromSettings(e) ? v2.exportData(win) : ''));
  ipcMain.handle(SETTINGS.importData, (e) => (fromSettings(e) ? v2.importData(win) : ''));
  ipcMain.handle(SETTINGS.exportPet, (e) => (fromSettings(e) ? v2.exportPet(win) : ''));
  ipcMain.handle(SETTINGS.importPet, (e) =>
    fromSettings(e) ? v2.importPet(win) : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.importFriend, (e) =>
    fromSettings(e) ? v2.importFriend(win) : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.syncCalendar, (e) => (fromSettings(e) ? v2.syncCalendar() : ''));
  ipcMain.handle(SETTINGS.refreshMcp, (e) => (fromSettings(e) ? v2.refreshMcp() : []));
  ipcMain.on(SETTINGS.relaunch, (e) => {
    if (!fromSettings(e)) return;
    app.relaunch();
    app.exit(0);
  });
  ipcMain.on(SETTINGS.openOnboarding, (e) => {
    if (fromSettings(e)) openOnboarding();
  });
  settings.onChange((next) => {
    if (win && !win.isDestroyed()) win.webContents.send(SETTINGS.changed, next);
  });

  /** section 을 주면 그 칸을 바로 보여 준다 (메뉴 막대 "의견 보내기" → 베타 기록). */
  function open(section?: SettingsSection) {
    stealFocus();
    if (win && !win.isDestroyed()) {
      if (section) win.webContents.send(SETTINGS.focus, section);
      focusWindow(win);
      return;
    }
    win = new BrowserWindow({
      width: 440,
      height: 620,
      minWidth: 360,
      minHeight: 420,
      title: t('common.title.settings'),
      show: false,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=settings', langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.once('ready-to-show', () => showWindow(win));
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
    process.platform === 'darwin'
      ? t('settings.os.mac')
      : process.platform === 'win32'
        ? t('settings.os.win')
        : process.platform;
  return `${name} ${process.getSystemVersion()} ${process.arch}`;
}
