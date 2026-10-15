import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  powerMonitor,
  shell,
} from 'electron';
import type { Catalog } from '../shared/ai/catalog.ts';
import { type BetaReport, reportText, type StatStore } from '../shared/beta-stats.ts';
import { issueUrl } from '../shared/feedback.ts';
import type { GalleryList } from '../shared/gallery.ts';
import { t } from '../shared/i18n/index.ts';
import {
  type CalSync,
  type CoinState,
  type MakerTarget,
  type RestoreOffer,
  type RestoreState,
  SETTINGS,
  type SettingsSection,
  type SettingsSnapshot,
  type UpdateStatus,
} from '../shared/ipc.ts';
import type { Gait } from '../shared/pet3d/blueprint.ts';
import { isGait, type Settings } from '../shared/settings.ts';
import { isSettingsTab, type SettingsTab } from '../shared/settings-tabs.ts';
import { type CoinResetResult, type CoinResetScope, isCoinResetScope } from '../shared/shop.ts';
import { parsePetChoice } from '../shared/starter-pets.ts';
import { PUBLIC_REPO } from '../shared/update-policy.ts';
import { isImportFileName } from '../shared/url-scheme.ts';
import { localModelReady } from './ai/local.ts';
import { aiHistoryBytes, clearAiHistory } from './ai-history.ts';
import { devRendererUrl } from './dev-url.ts';
import { createDiagnostics } from './diagnostics.ts';
import { rememberExport, wasExported } from './exported.ts';
import { focusWindow, showWindow } from './focus.ts';
import { langArg } from './lang.ts';
import { mcpScriptPath } from './mcp-launch.ts';
import { openLink } from './open-link.ts';
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
  /** 코인 초기화 (index.ts 가 장부, 집 창, 패널, 펫 한마디까지 맞춘다) */
  coins: {
    state: () => CoinState;
    reset: (scope: CoinResetScope, expect: number) => CoinResetResult;
  };
  checkUpdate: () => Promise<UpdateStatus>;
  openOnboarding: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
  /** 진단 기록 폴더 (userData/logs) */
  logDir: string;
  /** 진단 기록에서 글자 그대로 가릴 사용자 글 (할 일, 일정, 메모 제목, 캘린더 주소) */
  privateWords: () => string[];
  v2: {
    exportData: (win?: BrowserWindow) => Promise<{ ok: boolean; path: string; message: string }>;
    importData: (
      win: BrowserWindow | undefined,
      kind: 'file' | 'folder',
    ) => Promise<{ ok: boolean; message: string; offer?: RestoreOffer }>;
    /** 백업 복원 확인 칸 (backup.ts) */
    restore: {
      state: () => RestoreState;
      undo: () => Promise<{ ok: boolean; message: string; offer?: RestoreOffer }>;
      confirm: (id: string) => Promise<{ ok: boolean; message: string }>;
      cancel: (id: string) => void;
    };
    exportPet: (win?: BrowserWindow) => Promise<string>;
    importPet: (win?: BrowserWindow) => Promise<{ ok: boolean; message: string }>;
    importFriend: (win?: BrowserWindow) => Promise<{ ok: boolean; message: string }>;
    importPetDrop: (name: string, bytes: Buffer) => Promise<{ ok: boolean; message: string }>;
    syncCalendar: () => Promise<CalSync>;
    calendarLast: () => CalSync;
    mcpServers: () => string[];
    refreshMcp: () => Promise<string[]>;
    catalog: () => Catalog;
    /** AI 기록을 지운 뒤: 채팅이 지운 세션을 이어 가지 않게 */
    forgetAiSessions: () => void;
  };
  /** 펫 갤러리 (main/gallery.ts + backup.ts adoptPet). 값은 메인에서 다시 검사한다 */
  gallery: {
    list: () => Promise<GalleryList>;
    adopt: (id: unknown, asFriend: boolean) => Promise<{ ok: boolean; message: string }>;
    share: (meta: unknown, win?: BrowserWindow) => Promise<{ ok: boolean; message: string }>;
  };
}

/** AI 기록 지우기가 보는 폴더 (짝꿍 데이터 폴더, 홈, CLAUDE_CONFIG_DIR) */
const historyDirs = () => ({
  userData: app.getPath('userData'),
  home: app.getPath('home'),
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || undefined,
});

/** 설정 창 (P1-12). 열 때 만들고 닫으면 없앤다 (L6). */
export function createSettingsWindow({
  scale,
  setScale,
  openMaker,
  remakeBody,
  cancelRemake,
  stats,
  coins,
  checkUpdate,
  openOnboarding,
  log,
  logDir,
  privateWords,
  v2,
  gallery,
}: SettingsWindowOptions) {
  let win: BrowserWindow | undefined;
  // 마지막으로 본 탭. 창은 닫으면 없어져서 메인이 앱이 켜져 있는 동안만 기억한다 (설정 파일에는 남기지 않는다)
  let lastTab: SettingsTab | undefined;
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
          starters: library.starters(),
          storage: storedModels(v2.catalog()),
          aiHistoryBytes: aiHistoryBytes(historyDirs()),
          onBattery: powerMonitor.isOnBatteryPower(),
        }
      : undefined,
  );
  const localReady = () => Object.fromEntries(v2.catalog().local.map((m) => [m.id, localModelReady(m)]));
  ipcMain.handle(SETTINGS.choosePet, (e, choice: unknown) => {
    const c = fromSettings(e) ? parsePetChoice(choice) : undefined;
    if (!c) return library.view();
    if ('kind' in c) library.toDefault(c.kind);
    else if ('starter' in c) library.fromStarter(c.starter);
    else if ('friend' in c) library.fromFriend(c.friend);
    else library.restore(c.id);
    return library.view();
  });
  ipcMain.handle(SETTINGS.removeSavedPet, (e, id: unknown) => {
    if (fromSettings(e) && typeof id === 'string') library.remove(id);
    return library.view();
  });
  ipcMain.handle(SETTINGS.deleteModel, async (e, id: unknown) => {
    const ok = fromSettings(e) && typeof id === 'string' && (await removeModel(v2.catalog(), id, log));
    return { ok, storage: storedModels(v2.catalog()), localReady: localReady() };
  });
  ipcMain.handle(SETTINGS.clearAiHistory, (e) => {
    if (!fromSettings(e)) return { ok: false, bytes: aiHistoryBytes(historyDirs()) };
    const n = clearAiHistory(historyDirs());
    // 지운 세션은 이어 갈 수 없다: 채팅은 다음 질문부터 새 대화로
    v2.forgetAiSessions();
    log('settings', 'AI 기록 지움', n);
    const bytes = aiHistoryBytes(historyDirs());
    return { ok: bytes === 0, bytes };
  });
  // 코인 초기화 (설정 > 데이터). 값은 여기서 다시 검사한다: 범위가 아니거나 잔액이 수가 아니면 하지 않는다
  ipcMain.handle(SETTINGS.coinState, (e): CoinState | undefined =>
    fromSettings(e) ? coins.state() : undefined,
  );
  ipcMain.handle(SETTINGS.resetCoins, (e, scope: unknown, expect: unknown) => {
    if (
      !fromSettings(e) ||
      !isCoinResetScope(scope) ||
      typeof expect !== 'number' ||
      !Number.isFinite(expect)
    )
      return { result: { ok: false, changed: true }, state: coins.state() };
    return { result: coins.reset(scope, expect), state: coins.state() };
  });
  ipcMain.handle(SETTINGS.remakeBody, (e, gait: unknown) =>
    fromSettings(e) && isGait(gait) ? remakeBody(gait) : { ok: false, error: t('main.maker.reopen') },
  );
  ipcMain.on(SETTINGS.cancelRemake, (e) => {
    if (fromSettings(e)) cancelRemake();
  });
  ipcMain.on(SETTINGS.tab, (e, tab: unknown) => {
    if (fromSettings(e) && isSettingsTab(tab)) lastTab = tab;
  });
  ipcMain.handle(SETTINGS.set, (e, patch: Partial<Settings>) =>
    fromSettings(e) ? settings.set(patch) : settings.get(),
  );
  ipcMain.on(SETTINGS.setScale, (e, next: number) => {
    if (fromSettings(e) && typeof next === 'number') setScale(next);
  });
  ipcMain.on(SETTINGS.openMaker, (e, target: unknown) => {
    const ok = target === 'happy' || target === 'sleepy' || target === 'hungry' || target === 'sprites';
    if (fromSettings(e)) openMaker(ok ? target : 'main');
  });
  ipcMain.handle(SETTINGS.stats, (e): BetaReport | undefined =>
    fromSettings(e) ? stats.report(Date.now()) : undefined,
  );
  ipcMain.handle(SETTINGS.copyStats, (e) => {
    if (!fromSettings(e)) return false;
    // 기록 읽기나 클립보드 쓰기가 실패하면 false: 화면이 "복사하지 못했어"를 띄운다
    try {
      clipboard.writeText(statsText());
      return true;
    } catch {
      return false;
    }
  });
  // 의견 보내기에 진단 기록 붙이기: 가린 글을 미리 보이고, 복사와 저장은 그 글 그대로 (diagnostics.ts)
  const statsText = () => reportText(stats.report(Date.now()), { version: app.getVersion(), os: osLabel() });
  const diagnostics = createDiagnostics({ logDir, statsText, secrets: privateWords, log });
  ipcMain.handle(SETTINGS.diagnostics, (e) => {
    if (!fromSettings(e)) return undefined;
    try {
      return diagnostics.preview();
    } catch (err) {
      log('feedback', '미리 보기 실패', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  });
  ipcMain.handle(SETTINGS.copyDiagnostics, (e) => fromSettings(e) && diagnostics.copy());
  ipcMain.handle(SETTINGS.saveDiagnostics, (e) =>
    fromSettings(e) ? diagnostics.save(win) : { ok: false, message: '' },
  );
  ipcMain.on(SETTINGS.reportIssue, (e) => {
    if (fromSettings(e)) openLink(issueUrl(PUBLIC_REPO, { version: app.getVersion(), os: osLabel() }), log);
  });
  // 오픈소스 고지: 설치판은 자원 폴더, 개발 실행은 build/ (npm run notices 로 만든다)
  ipcMain.handle(SETTINGS.openNotices, async (e) => {
    if (!fromSettings(e)) return false;
    const file = app.isPackaged
      ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.txt')
      : join(app.getAppPath(), 'build', 'THIRD_PARTY_NOTICES.txt');
    if (!existsSync(file)) return false;
    return (await shell.openPath(file)) === '';
  });
  ipcMain.handle(SETTINGS.checkUpdate, (e) => (fromSettings(e) ? checkUpdate() : { text: '', tone: 'info' }));
  ipcMain.handle(SETTINGS.exportData, async (e) => {
    if (!fromSettings(e)) return { ok: true, path: '', message: '' };
    const r = await v2.exportData(win);
    rememberExport(r.path);
    return r;
  });
  // 방금 내보낸 것을 파일 관리자에서 보인다 (내보낸 경로만)
  ipcMain.on(SETTINGS.reveal, (e, path: unknown) => {
    if (fromSettings(e) && wasExported(path)) shell.showItemInFolder(path);
  });
  ipcMain.handle(SETTINGS.importData, (e, kind: unknown) =>
    fromSettings(e) ? v2.importData(win, kind === 'folder' ? 'folder' : 'file') : { ok: true, message: '' },
  );
  ipcMain.handle(SETTINGS.restoreState, (e): RestoreState => (fromSettings(e) ? v2.restore.state() : {}));
  ipcMain.handle(SETTINGS.restoreUndo, (e) =>
    fromSettings(e) ? v2.restore.undo() : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.restoreConfirm, (e, id: unknown) =>
    fromSettings(e) && typeof id === 'string' ? v2.restore.confirm(id) : { ok: false, message: '' },
  );
  ipcMain.on(SETTINGS.restoreCancel, (e, id: unknown) => {
    if (fromSettings(e) && typeof id === 'string') v2.restore.cancel(id);
  });
  ipcMain.handle(SETTINGS.exportPet, async (e) => {
    if (!fromSettings(e)) return '';
    const path = await v2.exportPet(win);
    rememberExport(path);
    return path;
  });
  ipcMain.handle(SETTINGS.importPet, (e) =>
    fromSettings(e) ? v2.importPet(win) : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.importFriend, (e) =>
    fromSettings(e) ? v2.importFriend(win) : { ok: false, message: '' },
  );
  // 끌어 놓은 파일: 이름은 확장자만 보고(읽개 고르기), 바이트는 메인이 상한과 형식을 다시 본다
  ipcMain.handle(SETTINGS.importPetDrop, (e, name: unknown, bytes: unknown) => {
    if (!fromSettings(e) || typeof name !== 'string' || !isImportFileName(name.slice(-64)))
      return { ok: false, message: '' };
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) return { ok: false, message: '' };
    const buf = ArrayBuffer.isView(bytes)
      ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Buffer.from(bytes);
    return v2.importPetDrop(name.slice(-64), buf);
  });
  ipcMain.handle(SETTINGS.galleryList, (e) =>
    fromSettings(e) ? gallery.list() : { ok: false, reason: 'bad' },
  );
  ipcMain.handle(SETTINGS.galleryAdopt, (e, id: unknown, asFriend: unknown) =>
    fromSettings(e) ? gallery.adopt(id, asFriend === true) : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.galleryShare, (e, meta: unknown) =>
    fromSettings(e) ? gallery.share(meta, win) : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.syncCalendar, (e) =>
    fromSettings(e) ? v2.syncCalendar() : { text: '', ok: true },
  );
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

  /** 칸을 주면 그 칸(#stats), 아니면 지난번 탭(#ai)을 # 뒤에 넣어 연다 (화면이 settings-tabs.ts tabFromHash 로 읽는다) */
  function load(w: BrowserWindow, section?: SettingsSection) {
    const hash = section ?? lastTab;
    const devUrl = devRendererUrl();
    if (devUrl) w.loadURL(`${devUrl}/settings.html${hash ? `#${hash}` : ''}`);
    else w.loadFile(join(import.meta.dirname, '../renderer/settings.html'), { hash });
  }

  /** 기다리는 복원이 바뀌었다 (두 번 눌러 연 백업 파일, 그만두기): 열린 설정 창에 새 상태를 보낸다 */
  function sendRestore() {
    if (win && !win.isDestroyed()) win.webContents.send(SETTINGS.restoreChanged, v2.restore.state());
  }

  return {
    open,
    sendRestore,
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
