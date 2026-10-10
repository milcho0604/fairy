import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  powerMonitor,
} from 'electron';
import type { Catalog } from '../shared/ai/catalog.ts';
import { type BetaReport, reportText, type StatStore } from '../shared/beta-stats.ts';
import { t } from '../shared/i18n/index.ts';
import { type MakerTarget, SETTINGS, type SettingsSection, type SettingsSnapshot } from '../shared/ipc.ts';
import type { Gait } from '../shared/pet3d/blueprint.ts';
import { isGait, isPetKind, type Settings } from '../shared/settings.ts';
import { localModelReady } from './ai/local.ts';
import { focusWindow, showWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import { mcpScriptPath } from './mcp-launch.ts';
import { library } from './pet-library.ts';
import { settings } from './settings.ts';
import { removeModel, storedModels } from './storage.ts';
import { rememberBounds, savedBounds } from './window-bounds.ts';

export interface SettingsWindowOptions {
  scale: () => number;
  setScale: (scale: number) => void;
  openMaker: (target: MakerTarget) => void;
  /** 지금 사진 펫의 몸을 고른 걸음새에 맞게 다시 만든다 (maker.ts remake) */
  remakeBody: (gait: Gait) => Promise<{ ok: true } | { ok: false; error: string; noAi?: boolean }>;
  cancelRemake: () => void;
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
    catalog: () => Catalog;
  };
}

/** 설정 창 (P1-12). 열 때 만들고 닫으면 없앤다 (L6). */
export function createSettingsWindow({
  scale,
  setScale,
  openMaker,
  remakeBody,
  cancelRemake,
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
            // 설치판에서는 asar 밖에 풀어 둔 사본 (mcp-launch.ts)
            script: mcpScriptPath(),
          },
          myMcpServers: v2.mcpServers(),
          calendarLast: v2.calendarLast(),
          models: { catalog: v2.catalog(), localReady: localReady() },
          library: library.view(),
          current: library.current(),
          storage: storedModels(v2.catalog()),
          onBattery: powerMonitor.isOnBatteryPower(),
        }
      : undefined,
  );
  const localReady = () => Object.fromEntries(v2.catalog().local.map((m) => [m.id, localModelReady(m)]));
  ipcMain.handle(SETTINGS.choosePet, (e, choice: unknown) => {
    if (!fromSettings(e) || typeof choice !== 'object' || choice === null) return library.view();
    const c = choice as Record<string, unknown>;
    if (isPetKind(c.kind)) library.toDefault(c.kind);
    else if (typeof c.id === 'string') library.restore(c.id);
    return library.view();
  });
  ipcMain.handle(SETTINGS.removeSavedPet, (e, id: unknown) => {
    if (fromSettings(e) && typeof id === 'string') library.remove(id);
    return library.view();
  });
  ipcMain.handle(SETTINGS.deleteModel, (e, id: unknown) => {
    const ok = fromSettings(e) && typeof id === 'string' && removeModel(v2.catalog(), id);
    return { ok, storage: storedModels(v2.catalog()), localReady: localReady() };
  });
  ipcMain.handle(SETTINGS.remakeBody, (e, gait: unknown) =>
    fromSettings(e) && isGait(gait) ? remakeBody(gait) : { ok: false, error: t('main.maker.reopen') },
  );
  ipcMain.on(SETTINGS.cancelRemake, (e) => {
    if (fromSettings(e)) cancelRemake();
  });
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
    // 기록 읽기나 클립보드 쓰기가 실패하면 false: 화면이 "복사하지 못했어"를 띄운다
    try {
      clipboard.writeText(reportText(stats.report(Date.now()), { version: app.getVersion(), os: osLabel() }));
      return true;
    } catch {
      return false;
    }
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
    // exit 대신 quit: will-quit 정리(실행 표시 지우기, AI 끝내기, 저장 파일 닫기, 단축키 풀기)가 돌게 한다 (버그잡이 7차)
    app.relaunch();
    app.quit();
  });
  ipcMain.on(SETTINGS.openOnboarding, (e) => {
    if (fromSettings(e)) openOnboarding();
  });
  settings.onChange((next) => {
    if (win && !win.isDestroyed()) win.webContents.send(SETTINGS.changed, next);
  });
  // 전원을 꽂고 빼면 부스트가 쉬는지 표시를 바꾼다
  const sendPower = () => {
    if (win && !win.isDestroyed()) win.webContents.send(SETTINGS.power, powerMonitor.isOnBatteryPower());
  };
  powerMonitor.on('on-ac', sendPower);
  powerMonitor.on('on-battery', sendPower);

  /** section 을 주면 그 칸을 바로 보여 준다 (메뉴 막대 "의견 보내기" → 베타 기록). */
  function open(section?: SettingsSection) {
    stealFocus();
    if (win && !win.isDestroyed()) {
      // 화면 프로세스가 죽었으면(메모리 부족, 강제 종료) 빈 창만 남는다. 같은 창에 다시 읽는다
      if (win.webContents.isCrashed()) load(win, section);
      else if (section) win.webContents.send(SETTINGS.focus, section);
      focusWindow(win);
      return;
    }
    // 닫을 때 크기와 자리를 기억해 다음에 그대로 연다. 처음이면 화면 가운데 (window-bounds.ts)
    const min = { width: 360, height: 420 };
    const saved = savedBounds('settings', min);
    win = new BrowserWindow({
      width: 440,
      height: 620,
      ...saved,
      minWidth: min.width,
      minHeight: min.height,
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
    rememberBounds(win, 'settings', true);
    win.once('ready-to-show', () => showWindow(win));
    win.on('closed', () => {
      win = undefined;
      // 몸 다시 만들기는 결과를 볼 창이 없으면 멈춘다 (펫 만들기 창과 같다)
      cancelRemake();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    load(win, section);
  }

  function load(w: BrowserWindow, section?: SettingsSection) {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) w.loadURL(`${devUrl}/settings.html${section ? `#${section}` : ''}`);
    else w.loadFile(join(import.meta.dirname, '../renderer/settings.html'), { hash: section });
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
