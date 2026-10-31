import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  type BaseWindow,
  type BrowserWindow,
  clipboard,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  powerMonitor,
  shell,
  type WebContents,
} from 'electron';
import type { Catalog } from '../shared/ai/catalog.ts';
import { type BetaReport, reportText, type StatStore } from '../shared/beta-stats.ts';
import { issueUrl } from '../shared/feedback.ts';
import type { GalleryList } from '../shared/gallery.ts';
import { helpSummary } from '../shared/help-pack.ts';
import { HUB_METHODS, hubPatchOk } from '../shared/hub-policy.ts';
import { getLang, t } from '../shared/i18n/index.ts';
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
import type { ServerStatus } from '../shared/server-account.ts';
import { isGait, type Settings } from '../shared/settings.ts';
import { isSettingsTab, type SettingsTab } from '../shared/settings-tabs.ts';
import { type CoinResetResult, type CoinResetScope, isCoinResetScope } from '../shared/shop.ts';
import { parsePetChoice } from '../shared/starter-pets.ts';
import { PUBLIC_REPO } from '../shared/update-policy.ts';
import { isImportFileName } from '../shared/url-scheme.ts';
import { detectAi } from './ai/detect.ts';
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
import { reviveOnCrash } from './revive.ts';
import { settings } from './settings.ts';
import { removeModel, storedModels } from './storage.ts';
import { openRemembered } from './window-bounds.ts';

export interface SettingsWindowOptions {
  scale: () => number;
  setScale: (scale: number) => void;
  openMaker: (target: MakerTarget) => void;
  /** 큰 창의 페어리, 비서 구역 화면 (설정 창의 화면 조각을 쓰므로 같은 설정 다리를 받는다). 없으면 undefined */
  hub: () => WebContents | undefined;
  /** 큰 창 (파일 대화상자의 부모) */
  hubWindow: () => BaseWindow | undefined;
  /** 큰 창의 구역을 연다 (설정에서 꺼낸 항목으로 가는 길) */
  openHome: (tab: 'pet' | 'assist') => void;
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
  /** 도움 보내기 머리에 들어가는, 설정 밖의 상태 (이슈 #126). 비밀은 받지 않는다 */
  help: {
    /** 지금 채팅이 고른 AI 의 id */
    provider: () => string;
    /** 서버 연결 상태 (서버 주소가 없는 판이면 undefined) */
    server: () => ServerStatus | undefined;
  };
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
    importFriend: (win?: BaseWindow) => Promise<{ ok: boolean; message: string }>;
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
    share: (meta: unknown, win?: BaseWindow) => Promise<{ ok: boolean; message: string }>;
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
  hub,
  hubWindow,
  openHome,
  remakeBody,
  cancelRemake,
  stats,
  coins,
  checkUpdate,
  openOnboarding,
  log,
  logDir,
  privateWords,
  help,
  v2,
  gallery,
}: SettingsWindowOptions) {
  let win: BrowserWindow | undefined;
  // 마지막으로 본 탭. 창은 닫으면 없어져서 메인이 앱이 켜져 있는 동안만 기억한다 (설정 파일에는 남기지 않는다)
  let lastTab: SettingsTab | undefined;
  /** 설정 창이나 큰 창의 페어리, 비서 구역 화면이 보낸 것인가 */
  const owns = (wc: WebContents) => {
    if (win && !win.isDestroyed() && wc === win.webContents) return true;
    const h = hub();
    return !!h && !h.isDestroyed() && wc === h;
  };
  /** 두 화면 모두에게 (설정 창, 큰 창 구역) */
  const sendAll = (channel: string, ...args: unknown[]) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
    const h = hub();
    if (h && !h.isDestroyed()) h.send(channel, ...args);
  };
  /** 설정 창이 보낸 것만 (모든 채널의 기본) */
  const fromSettings = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;
  /** 큰 창 구역이 보낸 것 */
  const fromHub = (e: IpcMainEvent | IpcMainInvokeEvent) => {
    const h = hub();
    return !!h && !h.isDestroyed() && e.sender === h;
  };
  /**
   * 설정 창은 모든 채널, 큰 창 구역은 허용표(shared/hub-policy.ts HUB_METHODS)에 있는 채널만.
   * 위험한 것(다시 켜기, 가져오기, 내보내기, 복원, 코인 초기화, 기록 지우기, 모델 지우기, 업데이트, 진단)은 큰 창에서 거절한다
   */
  const hubChannels: readonly string[] = HUB_METHODS.map((m) => SETTINGS[m]);
  const allowed = (e: IpcMainEvent | IpcMainInvokeEvent, channel: string) =>
    fromSettings(e) || (fromHub(e) && hubChannels.includes(channel));
  /** 파일 대화상자의 부모: 부른 화면이 있는 창 */
  const parentOf = (e: IpcMainEvent | IpcMainInvokeEvent): BaseWindow | undefined =>
    fromHub(e) ? hubWindow() : win;
  ipcMain.on(SETTINGS.openHome, (e, tab: unknown) => {
    if (fromSettings(e) && (tab === 'pet' || tab === 'assist')) openHome(tab);
  });

  ipcMain.handle(SETTINGS.get, (e): SettingsSnapshot | undefined =>
    allowed(e, SETTINGS.get)
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
    const c = allowed(e, SETTINGS.choosePet) ? parsePetChoice(choice) : undefined;
    if (!c) return library.view();
    if ('kind' in c) library.toDefault(c.kind);
    else if ('starter' in c) library.fromStarter(c.starter);
    else if ('friend' in c) library.fromFriend(c.friend);
    else library.restore(c.id);
    return library.view();
  });
  ipcMain.handle(SETTINGS.removeSavedPet, (e, id: unknown) => {
    if (allowed(e, SETTINGS.removeSavedPet) && typeof id === 'string') library.remove(id);
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
    allowed(e, SETTINGS.remakeBody) && isGait(gait)
      ? remakeBody(gait)
      : { ok: false, error: t('main.maker.reopen') },
  );
  ipcMain.on(SETTINGS.cancelRemake, (e) => {
    if (allowed(e, SETTINGS.cancelRemake)) cancelRemake();
  });
  ipcMain.on(SETTINGS.tab, (e, tab: unknown) => {
    if (fromSettings(e) && isSettingsTab(tab)) lastTab = tab;
  });
  ipcMain.handle(SETTINGS.set, (e, patch: Partial<Settings>) =>
    allowed(e, SETTINGS.set) && (fromSettings(e) || hubPatchOk(patch)) ? settings.set(patch) : settings.get(),
  );
  ipcMain.handle(SETTINGS.reset, (e) => (fromSettings(e) ? settings.resetPreferences() : settings.get()));
  ipcMain.on(SETTINGS.setScale, (e, next: number) => {
    if (allowed(e, SETTINGS.setScale) && typeof next === 'number') setScale(next);
  });
  ipcMain.on(SETTINGS.openMaker, (e, target: unknown) => {
    const ok = target === 'happy' || target === 'sleepy' || target === 'hungry' || target === 'sprites';
    if (allowed(e, SETTINGS.openMaker)) openMaker(ok ? target : 'main');
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
  // 머리: 판, 운영체제, 켜진 기능, AI 감지, 서버 연결 상태 (shared/help-pack.ts). AI 감지는 오래 걸릴 수 있어 6초까지만 기다린다
  const summary = async () => {
    const detect = await Promise.race([
      detectAi(v2.catalog().local.some(localModelReady)),
      new Promise<[]>((resolve) => setTimeout(() => resolve([]), 6000).unref()),
    ]);
    const server = help.server();
    return helpSummary({
      version: app.getVersion(),
      packaged: app.isPackaged,
      os: osLabel(),
      arch: process.arch,
      lang: getLang(),
      electron: process.versions.electron ?? '',
      provider: help.provider(),
      settings: settings.get(),
      detect,
      ...(server ? { server } : {}),
      now: Date.now(),
    });
  };
  const diagnostics = createDiagnostics({ logDir, statsText, summary, secrets: privateWords, log });
  ipcMain.handle(SETTINGS.diagnostics, async (e) => {
    if (!fromSettings(e)) return undefined;
    try {
      return await diagnostics.preview();
    } catch (err) {
      log('feedback', '미리 보기 실패', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  });
  ipcMain.handle(SETTINGS.copyDiagnostics, (e) => fromSettings(e) && diagnostics.copy());
  ipcMain.handle(SETTINGS.saveDiagnostics, (e) =>
    fromSettings(e) ? diagnostics.save(win) : { ok: false, message: '' },
  );
  // AI 자동 감지 (이슈 #126): 설치, 로그인, 내 컴퓨터 AI 모델 유무
  ipcMain.handle(SETTINGS.aiDetect, (e, refresh: unknown) =>
    fromSettings(e) ? detectAi(v2.catalog().local.some(localModelReady), refresh === true) : [],
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
    allowed(e, SETTINGS.importFriend) ? v2.importFriend(parentOf(e)) : { ok: false, message: '' },
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
    allowed(e, SETTINGS.galleryList) ? gallery.list() : { ok: false, reason: 'bad' },
  );
  ipcMain.handle(SETTINGS.galleryAdopt, (e, id: unknown, asFriend: unknown) =>
    allowed(e, SETTINGS.galleryAdopt) ? gallery.adopt(id, asFriend === true) : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.galleryShare, (e, meta: unknown) =>
    allowed(e, SETTINGS.galleryShare) ? gallery.share(meta, parentOf(e)) : { ok: false, message: '' },
  );
  ipcMain.handle(SETTINGS.syncCalendar, (e) =>
    allowed(e, SETTINGS.syncCalendar) ? v2.syncCalendar() : { text: '', ok: true },
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
    sendAll(SETTINGS.changed, next);
  });
  // 전원을 꽂고 빼면 부스트가 쉬는지 표시를 바꾼다
  const sendPower = () => {
    sendAll(SETTINGS.power, powerMonitor.isOnBatteryPower());
  };
  powerMonitor.on('on-ac', sendPower);
  powerMonitor.on('on-battery', sendPower);

  /** section 을 주면 그 칸을 바로 보여 준다 (메뉴 막대 "의견 보내기" → 베타 기록). */
  let reviveWin: ReturnType<typeof reviveOnCrash> | undefined;
  function open(section?: SettingsSection) {
    if (win && !win.isDestroyed()) {
      // 화면 프로세스가 죽었으면(메모리 부족, 강제 종료) 빈 창만 남는다. 같은 창에 다시 읽는다
      const w = win;
      const crashed = w.webContents.isCrashed();
      reviveWin?.(() => load(w, section));
      if (!crashed && section) w.webContents.send(SETTINGS.focus, section);
      focusWindow(win);
      return;
    }
    // 닫을 때 크기와 자리를 기억해 다음에 그대로 연다. 처음이면 화면 가운데 (window-bounds.ts)
    win = openRemembered('settings', {
      size: { width: 440, height: 620 },
      min: { width: 360, height: 520 },
      options: {
        title: t('common.title.settings'),
        show: false,
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/index.cjs'),
          additionalArguments: ['--jj-window=settings', langArg()],
          sandbox: true,
          contextIsolation: true,
        },
      },
    });
    win.once('ready-to-show', () => showWindow(win));
    win.on('closed', () => {
      win = undefined;
      // 몸 다시 만들기는 결과를 볼 창이 없으면 멈춘다 (펫 만들기 창과 같다)
      cancelRemake();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    // 열려 있는 채로 죽어도 저절로 다시 읽는다 (여러 번 죽으면 멈춘다)
    reviveWin = reviveOnCrash(win.webContents, 'settings', log);
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
    owns,
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
