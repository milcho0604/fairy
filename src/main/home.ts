import { join } from 'node:path';
import {
  type BaseWindow,
  ipcMain,
  type Rectangle,
  screen,
  type WebContents,
  WebContentsView,
} from 'electron';
import { FrontMemo } from '../shared/front-memo.ts';
import {
  HOME_KEEP_MS,
  HOME_MIN,
  HOME_SIZE,
  type HomeLook,
  homeClickAction,
  homeExpired,
  isHomeChord,
  parseChatRect,
  promoteAction,
} from '../shared/home-policy.ts';
import { t } from '../shared/i18n/index.ts';
import { type ChatKeyEvent, type HomeChatRect, PANEL, type PanelTab } from '../shared/ipc.ts';
import { devRendererUrl } from './dev-url.ts';
import type { Dock } from './dock.ts';
import { confineTestWindow, focusWindow } from './focus.ts';
import { langArg } from './lang.ts';
import { reviveOnCrash } from './revive.ts';
import type { SurfaceWin } from './surface.ts';
import { openRememberedBase } from './window-bounds.ts';

// 큰 창 (큰 창 설계 #159, 이슈 #161). 사이드바와 넓은 본문을 가진 일반 프레임 창이다.
// 창은 BaseWindow 이고 화면은 view 로 싣는다 (이슈 #165): 본문 view(home.html)가 창 가득, 채팅 구역일 때만 그 위 본문 칸 자리에
// 채팅 view(chat.html)를 얹는다. 채팅은 자기 문서라 창 단위 리스너(focus, drop, keydown)와 CSS 가 그대로 동작한다
// - 항상 위 아님, 크기 조절, 최대화, 전체 화면 허용. 맥은 제목 표시줄을 내용과 합친다(hiddenInset, 채팅과 설정이 같다)
// - 닫기(빨간 단추, Cmd/Ctrl+W)는 창을 없앤다. 앱은 계속 돈다. 다시 누르면 숨기고(스크롤 유지), 숨긴 채 10분이면 없앤다
// - 열려 있는 동안만 맥 Dock 에 보인다 (main/dock.ts). 윈도우, 리눅스는 작업 표시줄에 나온다(skipTaskbar:false)
// - 작은 패널과 동시에 열지 않는다: 큰 창이 보이면 패널을 닫는다
// 상태는 패널과 같다. 메인이 진실이고 panel.ts 가 이 창에도 같은 상태를 보낸다 (registerHome).

export interface HomeOptions {
  /** 패널 모듈에 면으로 알린다 (panel.registerHome). 돌려주는 함수로 뗀다 */
  registerSurface: (win: SurfaceWin, hidden: () => boolean) => () => void;
  /** 채팅을 view 로 품는다 (chat.ts embed). 채팅 구역을 처음 열 때 만든다 */
  chat: HomeChat;
  /** 사이드바 구역 수(친구가 켜졌는지)에 따라 Cmd/Ctrl+숫자의 범위가 달라 채팅 view 의 단축키를 본문에 넘길 때 쓴다 */
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

/** 채팅 view 를 만들어 주는 쪽 (chat.ts 의 embed) */
export interface HomeChat {
  embed(
    frame: BaseWindow,
    shown: () => boolean,
    onGone?: () => void,
  ): { view: WebContentsView; reveal: () => void; remove: () => void };
}

/** 승격 한 번의 시각 (밀리초). 패널은 큰 창이 보인 뒤에 닫히니 panelClosedAt >= shownAt */
export interface PromoteLog {
  requestedAt: number;
  shownAt?: number;
  panelClosedAt?: number;
}

export function createHome(o: HomeOptions) {
  let win: BaseWindow | undefined;
  /** 본문 view (home.html). 창 가득 */
  let body: WebContentsView | undefined;
  /** 채팅 view (chat.html). 채팅 구역을 처음 열 때 만들어 창이 닫힐 때까지 둔다 */
  let chatPart: ReturnType<HomeChat['embed']> | undefined;
  /** 본문이 알려 준 채팅 자리. null 이면 채팅 구역이 아니라 채팅 view 를 감춘다 */
  let chatRect: HomeChatRect | null = null;
  /** 첫 화면을 그리기 전에 온 "채팅 구역 열어" 요청 */
  let chatWhenReady = false;
  /** 숨겨 둔 때. 없으면 숨기지 않았다 */
  let hiddenAt: number | undefined;
  let keepTimer: ReturnType<typeof setTimeout> | undefined;
  /** 첫 화면을 그렸다 (그리기 전에는 띄우지 않는다. 흰 화면이 보이지 않게) */
  let ready = false;
  /** 숨기기 요청 차례. 전체 화면이 풀리기를 기다리는 동안 다시 열면 늦게 온 숨기기가 무시된다 */
  let hideSeq = 0;
  const keepMs = o.keepMs ?? HOME_KEEP_MS;
  let reviveBody: (() => void) | undefined;
  const alive = () => !!win && !win.isDestroyed() && !!body && !body.webContents.isDestroyed();
  const bodyContents = (): WebContents | undefined => (alive() ? body?.webContents : undefined);

  const look = (): HomeLook => ({ alive: alive(), hidden: hiddenAt !== undefined });

  /** 본문 view 는 창 가득, 채팅 view 는 본문이 알려 준 자리에 (본문 글자 크기 배율을 곱해 화면 픽셀로) */
  function layout() {
    const w = win;
    if (!w || w.isDestroyed() || !body) return;
    const c = w.getContentBounds();
    body.setBounds({ x: 0, y: 0, width: c.width, height: c.height });
    const chat = chatPart?.view;
    if (!chat) return;
    if (!chatRect) {
      chat.setVisible(false);
      return;
    }
    const z = body.webContents.getZoomFactor();
    chat.setBounds({
      x: Math.round(chatRect.x * z),
      y: Math.round(chatRect.y * z),
      width: Math.max(1, Math.min(Math.round(chatRect.width * z), c.width)),
      height: Math.max(1, Math.min(Math.round(chatRect.height * z), c.height)),
    });
    chat.setVisible(true);
  }

  /** 큰 창이 뒤로 갔다 포커스를 되찾은 때 (펫을 누르며 앱이 깨어난 것을 맨 앞이었던 것과 구별한다) */
  let front: FrontMemo | undefined;

  function bring(w: BaseWindow) {
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
  function reveal(w: BaseWindow) {
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

  /** 채팅 view 를 처음 열 때 만들어 창에 얹는다 (본문 view 위) */
  function ensureChat(w: BaseWindow) {
    if (chatPart) return chatPart;
    const part = o.chat.embed(
      w,
      () => chatRect !== null,
      // 채팅 화면이 없어졌다: 비우고 구역도 닫는다. 다음 채팅 열기에서 새로 만든다
      () => {
        if (chatPart !== part) return;
        chatPart = undefined;
        chatRect = null;
        bodyContents()?.send(PANEL.chatSection, false);
        if (!w.isDestroyed()) w.contentView.removeChildView(part.view);
      },
    );
    chatPart = part;
    part.view.setVisible(false);
    w.contentView.addChildView(part.view);
    // 채팅 view 가 포커스를 쥐면 본문이 창 단축키를 못 받는다: 큰 창이 맡는 키만 본문에 넘긴다
    part.view.webContents.on('before-input-event', (ev, input) => {
      if (!isHomeChord(input, process.platform === 'darwin')) return;
      ev.preventDefault();
      const key: ChatKeyEvent = {
        key: input.key,
        code: input.code,
        metaKey: input.meta,
        ctrlKey: input.control,
        altKey: input.alt,
        shiftKey: input.shift,
        isComposing: !!input.isComposing,
      };
      bodyContents()?.send(PANEL.chatKey, key);
    });
    return part;
  }

  function create(tab?: PanelTab) {
    hiddenAt = undefined;
    chatRect = null;
    chatWhenReady = false;
    clearTimeout(keepTimer);
    o.dock.open();
    const area = () => screen.getDisplayMatching(o.petBounds()).workArea;
    const w = openRememberedBase('home', {
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
      },
    });
    // BaseWindow 는 browser-window-created 가 없다: 시험 실행이면 숨기고 내장 화면 안으로 (focus.ts). 보이기 전에 부른다
    confineTestWindow(w);
    const b = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=home', langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    w.contentView.addChildView(b);
    reviveBody = reviveOnCrash(b.webContents, 'home', o.log);
    win = w;
    body = b;
    chatPart = undefined;
    layout();
    w.on('resize', layout);
    front = new FrontMemo();
    const memo = front;
    w.on('focus', () => memo.gained());
    w.on('blur', () => memo.lost());
    // 면으로 알린다. 큰 창은 webContents 가 본문 view 의 것이다
    const face: SurfaceWin = {
      webContents: b.webContents,
      isDestroyed: () => w.isDestroyed() || b.webContents.isDestroyed(),
      once: (event, listener) => w.once(event, listener),
    };
    const unregister = o.registerSurface(face, () => hiddenAt !== undefined);
    ready = false;
    // BaseWindow 에는 ready-to-show 가 없다: 본문을 다 읽고 첫 화면을 그릴 틈을 준 뒤 띄운다 (흰 화면이 보이지 않게)
    let shown = false;
    const onReady = () => {
      if (shown || w.isDestroyed()) return;
      shown = true;
      ready = true;
      reveal(w);
      if (chatWhenReady) {
        chatWhenReady = false;
        b.webContents.send(PANEL.chatSection, true);
      }
    };
    b.webContents.once('did-finish-load', () => setTimeout(onReady, 120).unref());
    w.on('enter-full-screen', () => o.onFullScreen(true));
    w.on('leave-full-screen', () => o.onFullScreen(false));
    /** 이 창을 "없는 것"으로 친다 (닫기가 시작되면 곧바로: 그 사이 다시 열면 새 창이 뜬다). 여러 번 불러도 한 번만 */
    const detach = () => {
      if (win !== w) return;
      chatPart?.remove();
      win = undefined;
      body = undefined;
      chatPart = undefined;
      chatRect = null;
      hiddenAt = undefined;
      clearTimeout(keepTimer);
      o.dock.close();
      o.onFullScreen(false);
    };
    // 닫을 때는 본문이 beforeunload 로 쓰던 글(메모)을 저장하게 하고 닫는다 (BrowserWindow 는 저절로 했던 일)
    let closing: 'no' | 'waiting' | 'done' = 'no';
    // 화면이 파괴되면 view.webContents도 비워진다. 닫는 중에는 처음의 WebContents를 붙잡아 둔다.
    const closingContents = b.webContents;
    w.on('close', (ev) => {
      if (closing === 'done' || closingContents.isDestroyed()) return;
      ev.preventDefault();
      if (closing === 'waiting') return;
      closing = 'waiting';
      detach();
      const finish = () => {
        if (closing === 'done') return;
        closing = 'done';
        if (!w.isDestroyed()) w.close();
      };
      closingContents.once('destroyed', finish);
      setTimeout(finish, 2000).unref();
      closingContents.close({ waitForBeforeUnload: true });
    });
    w.on('closed', () => {
      unregister();
      detach();
      if (!closingContents.isDestroyed()) closingContents.close();
    });
    const devUrl = devRendererUrl();
    if (devUrl) void b.webContents.loadURL(`${devUrl}/home.html${tab ? `#${tab}` : ''}`);
    else void b.webContents.loadFile(join(import.meta.dirname, '../renderer/home.html'), { hash: tab });
  }

  /** 있는 창을 앞으로 (숨겨 뒀으면 다시 보이고, 내려가 있으면 올린다). tab 을 주면 그 구역으로 */
  function showExisting(tab?: PanelTab) {
    const w = win;
    if (!w || w.isDestroyed()) return;
    reviveBody?.();
    const wasHidden = hiddenAt !== undefined;
    hiddenAt = undefined;
    hideSeq++;
    clearTimeout(keepTimer);
    o.dock.open();
    if (wasHidden) o.onShown?.();
    // 숨긴 사이 따로 채팅 창이 떴어도 채팅 구역이 열린 채 다시 보이면 면은 하나만 남긴다
    if (chatRect) chatPart?.reveal();
    if (tab) bodyContents()?.send(PANEL.tab, tab);
    // 아직 첫 화면을 그리는 중이면 첫 그림이 띄운다
    if (ready) reveal(w);
  }

  function hide() {
    const w = win;
    if (!w || w.isDestroyed()) return;
    const seq = ++hideSeq;
    const go = () => {
      if (w.isDestroyed() || seq !== hideSeq) return;
      // 숨겨도 창은 안 닫혀 beforeunload 가 없다: 쓰던 글(메모 편집기)이 바로 저장되게 알린다
      bodyContents()?.send(PANEL.hiding);
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
      freshFocus: front?.fresh() ?? false,
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
    const oldBody = body;
    body = undefined;
    chatPart?.remove();
    chatPart = undefined;
    chatRect = null;
    hiddenAt = undefined;
    clearTimeout(keepTimer);
    ready = false;
    if (oldBody && !oldBody.webContents.isDestroyed()) oldBody.webContents.close();
    if (old && !old.isDestroyed()) old.destroy();
  }

  function close() {
    if (alive()) win?.close();
  }

  /**
   * 채팅 열기 요청을 큰 창이 대신 받는다 (chat.ts host). 큰 창이 보이는 중이면 앞으로 가져와 채팅 구역을 열고 true.
   * 숨겼거나 없으면 false (따로 채팅 창이 뜬다)
   */
  function openChat(): boolean {
    if (!alive() || hiddenAt !== undefined) return false;
    if (ready) bodyContents()?.send(PANEL.chatSection, true);
    else chatWhenReady = true;
    showExisting();
    return true;
  }

  // 큰 창 안의 닫기 (Cmd/Ctrl+W). 작은 패널의 닫기는 panel.ts 가 맡는다
  ipcMain.on(PANEL.close, (e) => {
    if (win && !win.isDestroyed() && e.sender === body?.webContents) win.close();
  });

  // 본문이 알려 주는 채팅 자리. 자리가 오면 채팅 view 를 그 자리에 얹고(따로 채팅 창은 닫는다), null 이면 감춘다
  ipcMain.on(PANEL.homeChat, (e, raw: unknown) => {
    const w = win;
    if (!w || w.isDestroyed() || !body || e.sender !== body.webContents) return;
    if (raw === null) {
      chatRect = null;
      layout();
      return;
    }
    const rect = parseChatRect(raw);
    if (!rect) return;
    const part = ensureChat(w);
    const opening = chatRect === null;
    chatRect = rect;
    layout();
    if (!opening) return;
    // 채팅 면은 한 번에 하나: 따로 뜬 채팅 창은 닫는다 (대화와 쓰던 글은 메인에 있다)
    part.reveal();
    // 시험 실행(JJ_NO_FOCUS)은 포커스를 건드리지 않는다
    if (!process.env.JJ_NO_FOCUS && w.isFocused()) part.view.webContents.focus();
  });

  return {
    open,
    toggle,
    promote,
    hide,
    close,
    look,
    openChat,
    /** 마지막 승격의 시각 기록 (시험용) */
    lastPromote: () => lastPromote,
    /** 큰 창 (BaseWindow) */
    get window() {
      return win;
    },
    /** 본문 view 의 화면 (home.html) */
    get contents() {
      return bodyContents();
    },
    /** 채팅 view (시험용). 채팅 구역을 연 적이 없으면 없다 */
    get chatView() {
      return chatPart?.view;
    },
    chatRect: () => chatRect,
    /** 전체 화면인가 (펫의 "전체 화면이면 숨기" 판정에서 우리 창은 뺀다) */
    isFullScreen: () => alive() && !!win?.isFullScreen(),
  };
}
