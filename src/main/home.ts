import { join } from 'node:path';
import { type BrowserWindow, ipcMain, type Rectangle, screen } from 'electron';
import {
  HOME_KEEP_MS,
  HOME_MIN,
  HOME_SIZE,
  type HomeLook,
  homeClickAction,
  homeExpired,
  promoteAction,
} from '../shared/home-policy.ts';
import { t } from '../shared/i18n/index.ts';
import { PANEL, type PanelTab } from '../shared/ipc.ts';
import { devRendererUrl } from './dev-url.ts';
import type { Dock } from './dock.ts';
import { focusWindow } from './focus.ts';
import { langArg } from './lang.ts';
import { openRemembered } from './window-bounds.ts';

// 큰 창 (큰 창 설계 #159, 이슈 #161). 사이드바와 넓은 본문을 가진 일반 프레임 창이다.
// - 항상 위 아님, 크기 조절, 최대화, 전체 화면 허용. 맥은 제목 표시줄을 내용과 합친다(hiddenInset, 채팅과 설정이 같다)
// - 닫기(빨간 단추, Cmd/Ctrl+W)는 창을 없앤다. 앱은 계속 돈다. 다시 누르면 숨기고(스크롤 유지), 숨긴 채 10분이면 없앤다
// - 열려 있는 동안만 맥 Dock 에 보인다 (main/dock.ts). 윈도우, 리눅스는 작업 표시줄에 나온다(skipTaskbar:false)
// - 작은 패널과 동시에 열지 않는다: 큰 창이 보이면 패널을 닫는다
// 상태는 패널과 같다. 메인이 진실이고 panel.ts 가 이 창에도 같은 상태를 보낸다 (registerHome).

export interface HomeOptions {
  /** 패널 모듈에 면으로 알린다 (panel.registerHome). 돌려주는 함수로 뗀다 */
  registerSurface: (win: BrowserWindow, hidden: () => boolean) => () => void;
  /** 숨겨 둔 큰 창이 다시 보인다 (숨긴 동안 못 받은 상태를 한 번 보낸다) */
  onShown?: () => void;
  /** 작은 패널을 닫는다 */
  closePanel: () => void;
  petBounds: () => Rectangle;
  dock: Dock;
  /** 큰 창이 전체 화면이 되거나 풀렸다 (펫이 전체 화면 위에 같이 남게) */
  onFullScreen: (on: boolean) => void;
  /** 숨겨 둔 큰 창을 없애는 때 (시험이 줄인다). 기본 10분 */
  keepMs?: number;
  log: (tag: string, ...rest: unknown[]) => void;
}

/** 승격 한 번의 시각 (밀리초). 패널은 큰 창이 보인 뒤에 닫히니 panelClosedAt >= shownAt */
export interface PromoteLog {
  requestedAt: number;
  shownAt?: number;
  panelClosedAt?: number;
}

export function createHome(o: HomeOptions) {
  let win: BrowserWindow | undefined;
  /** 숨겨 둔 때. 없으면 숨기지 않았다 */
  let hiddenAt: number | undefined;
  let keepTimer: ReturnType<typeof setTimeout> | undefined;
  /** 첫 화면을 그렸다 (그리기 전에는 띄우지 않는다. 흰 화면이 보이지 않게) */
  let ready = false;
  /** 숨기기 요청 차례. 전체 화면이 풀리기를 기다리는 동안 다시 열면 늦게 온 숨기기가 무시된다 */
  let hideSeq = 0;
  const keepMs = o.keepMs ?? HOME_KEEP_MS;
  const alive = () => !!win && !win.isDestroyed();

  const look = (): HomeLook => ({ alive: alive(), hidden: hiddenAt !== undefined });

  function bring(w: BrowserWindow) {
    // 전체 화면 창은 모든 데스크톱 표시를 켰다 끌 수 없다 (자기 데스크톱이 있다). 그대로 앞으로
    if (w.isFullScreen()) {
      if (process.env.JJ_NO_FOCUS) w.showInactive();
      else {
        w.show();
        w.focus();
      }
      return;
    }
    focusWindow(w);
  }

  /** 마지막 "크게 보기" 승격의 시각 기록 (시험이 빈 순간 없음을 확인한다: panelClosedAt >= shownAt) */
  let lastPromote: PromoteLog | undefined;

  /** Dock 이 보인 뒤에 창을 띄우고 패널을 닫는다 (빈 순간 없이: 큰 창이 보인 뒤에 패널을 치운다) */
  function reveal(w: BrowserWindow) {
    void o.dock.ready().then(() => {
      if (w.isDestroyed()) return;
      if (w.isMinimized()) w.restore();
      bring(w);
      // 보이는 것을 확인한 뒤에만 패널을 닫는다 (보이지 않으면 패널을 남겨 화면이 비지 않게)
      const shownAt = Date.now();
      if (!w.isVisible()) {
        o.log('home', '큰 창이 아직 안 보여 패널을 닫지 않음');
        return;
      }
      o.closePanel();
      if (lastPromote && lastPromote.shownAt === undefined) {
        lastPromote.shownAt = shownAt;
        lastPromote.panelClosedAt = Date.now();
        o.log('home', 'promote', lastPromote.panelClosedAt - lastPromote.requestedAt, 'ms');
      }
    });
  }

  function startKeep() {
    clearTimeout(keepTimer);
    keepTimer = setTimeout(() => {
      if (alive() && homeExpired(hiddenAt, Date.now(), keepMs)) {
        o.log('home', '숨긴 지 오래라 없앰');
        win?.close();
      }
    }, keepMs + 50);
    keepTimer.unref();
  }

  function create(tab?: PanelTab) {
    hiddenAt = undefined;
    clearTimeout(keepTimer);
    o.dock.open();
    const area = () => screen.getDisplayMatching(o.petBounds()).workArea;
    const w = openRemembered('home', {
      size: HOME_SIZE,
      min: HOME_MIN,
      // 처음은 펫이 있는 화면 가운데. 옮긴 뒤로는 적어 둔 자리(window-bounds.ts)
      place: (size) => {
        const a = area();
        const width = Math.min(size.width, a.width);
        const height = Math.min(size.height, a.height);
        return {
          width,
          height,
          x: Math.round(a.x + (a.width - width) / 2),
          y: Math.round(a.y + (a.height - height) / 2),
        };
      },
      options: {
        title: t('common.title.home'),
        show: false,
        skipTaskbar: false,
        alwaysOnTop: false,
        resizable: true,
        minimizable: true,
        maximizable: true,
        fullscreenable: true,
        // 맥은 제목 표시줄을 내용과 합쳐 한 장처럼 보이게 한다. 창 이동은 머리줄을 잡고 한다
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/index.cjs'),
          additionalArguments: ['--jj-window=home', langArg()],
          sandbox: true,
          contextIsolation: true,
        },
      },
    });
    win = w;
    const unregister = o.registerSurface(w, () => hiddenAt !== undefined);
    ready = false;
    w.once('ready-to-show', () => {
      ready = true;
      reveal(w);
    });
    w.on('enter-full-screen', () => o.onFullScreen(true));
    w.on('leave-full-screen', () => o.onFullScreen(false));
    w.on('closed', () => {
      unregister();
      if (win === w) {
        win = undefined;
        hiddenAt = undefined;
        clearTimeout(keepTimer);
        o.dock.close();
        o.onFullScreen(false);
      }
    });
    const devUrl = devRendererUrl();
    if (devUrl) w.loadURL(`${devUrl}/home.html${tab ? `#${tab}` : ''}`);
    else w.loadFile(join(import.meta.dirname, '../renderer/home.html'), { hash: tab });
  }

  /** 있는 창을 앞으로 (숨겨 뒀으면 다시 보이고, 내려가 있으면 올린다). tab 을 주면 그 구역으로 */
  function showExisting(tab?: PanelTab) {
    const w = win;
    if (!w || w.isDestroyed()) return;
    const wasHidden = hiddenAt !== undefined;
    hiddenAt = undefined;
    hideSeq++;
    clearTimeout(keepTimer);
    o.dock.open();
    if (wasHidden) o.onShown?.();
    if (tab) w.webContents.send(PANEL.tab, tab);
    // 아직 첫 화면을 그리는 중이면 ready-to-show 가 띄운다
    if (ready) reveal(w);
  }

  function hide() {
    const w = win;
    if (!w || w.isDestroyed()) return;
    const seq = ++hideSeq;
    const go = () => {
      if (w.isDestroyed() || seq !== hideSeq) return;
      // 숨겨도 창은 안 닫혀 beforeunload 가 없다: 쓰던 글(메모 편집기)이 바로 저장되게 알린다
      w.webContents.send(PANEL.hiding);
      w.hide();
      hiddenAt = Date.now();
      startKeep();
      o.dock.close();
    };
    // 전체 화면인 채로 숨기면 빈 데스크톱이 남는다. 풀리기를 기다렸다 숨긴다
    if (w.isFullScreen()) {
      w.once('leave-full-screen', () => setTimeout(go, 50));
      w.setFullScreen(false);
    } else go();
  }

  /** 열기: 없으면 만들고, 있으면 앞으로 (펫 클릭이 큰 창을 열 때, 트레이, 단축키 "열기") */
  function open(tab?: PanelTab) {
    if (!alive()) create(tab);
    else showExisting(tab);
  }

  /** 다시 누르기: 없으면 만들고, 숨겼거나 내려갔으면 띄우고, 뒤에 있으면 앞으로, 맨 앞이면 숨긴다 */
  function toggle(tab?: PanelTab) {
    const w = win;
    const action = homeClickAction({
      alive: alive(),
      hidden: hiddenAt !== undefined,
      minimized: !!w && !w.isDestroyed() && w.isMinimized(),
      focused: !!w && !w.isDestroyed() && w.isFocused(),
    });
    o.log('home', 'toggle', action);
    if (action === 'create') create(tab);
    else if (action === 'hide') hide();
    else showExisting(tab);
  }

  /**
   * 작은 패널의 "크게 보기" (이슈 #164): 이 탭 그대로 큰 창을 띄우고, 보인 뒤에 패널을 닫는다.
   * 쓰던 글은 패널이 먼저 메인에 보내 놓았다. 숨겨 둔 큰 창은 처음 읽어 온 글이 낡았으니 없애고 새로 만든다
   */
  function promote(tab?: PanelTab) {
    const action = promoteAction(look());
    o.log('home', 'promote', action);
    lastPromote = { requestedAt: Date.now() };
    if (action === 'show') {
      showExisting(tab);
      return;
    }
    if (action === 'recreate') discard();
    create(tab);
  }

  /** 숨겨 둔 큰 창을 바로 없앤다 (바로 새로 만들 때) */
  function discard() {
    const old = win;
    win = undefined;
    hiddenAt = undefined;
    clearTimeout(keepTimer);
    ready = false;
    if (old && !old.isDestroyed()) old.destroy();
  }

  function close() {
    if (alive()) win?.close();
  }

  // 큰 창 안의 닫기 (Cmd/Ctrl+W). 작은 패널의 닫기는 panel.ts 가 맡는다
  ipcMain.on(PANEL.close, (e) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents) win.close();
  });

  return {
    open,
    toggle,
    promote,
    hide,
    close,
    look,
    /** 마지막 승격의 시각 기록 (시험용) */
    lastPromote: () => lastPromote,
    get window() {
      return win;
    },
    /** 전체 화면인가 (펫의 "전체 화면이면 숨기" 판정에서 우리 창은 뺀다) */
    isFullScreen: () => alive() && !!win?.isFullScreen(),
  };
}
