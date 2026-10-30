// 공지 창 (docs/server-plan.md 23절). 펫 말풍선이 아니라 앱 자체의 작은 창이다 (운영체제 알림이나 시스템 대화 상자 아님).
// 한 번에 하나만 띄우고, 같은 창을 다시 쓴다. 무엇을 언제 띄울지는 main/notices.ts.
import { join } from 'node:path';
import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from 'electron';
import { t } from '../shared/i18n/index.ts';
import { NOTICE, type NoticeView } from '../shared/notice-ipc.ts';
import { onActiveSpace } from './active-space.ts';
import { devRendererUrl } from './dev-url.ts';
import { langArg } from './lang.ts';
import { reviveOnCrash } from './revive.ts';

const WIDTH = 400;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 560;

/**
 * 공지 창을 띄우고 누른 단추를 기다린다.
 * - 강제(kind force)는 닫기 단추가 없고 닫히지도 않는다. 앱을 끝낼 때만 닫힌다 (끝내기는 막지 않는다).
 * - 그 밖은 닫기 단추로 닫으면 'close'.
 * - 창은 앞으로 가져오되 입력은 뺏지 않는다(showInactive). 쓰는 사람이 치던 글이 공지 창으로 가지 않게.
 *   시험 인스턴스(JJ_NO_FOCUS=1)의 숨김과 내장 화면 규칙은 focus.ts confineTestDisplay 가 모든 창에 건다.
 */
export function createNoticeWindow(o: {
  /** 단추 id 가 link 일 때 (창은 그대로 둔다) */
  openLink: (key: string) => void;
  log: (tag: string, ...rest: unknown[]) => void;
}) {
  let win: BrowserWindow | undefined;
  let view: NoticeView | undefined;
  let answer: ((id: string | undefined) => void) | undefined;
  let quitting = false;
  let reviveWin: (() => void) | undefined;
  app.once('before-quit', () => {
    quitting = true;
    // 닫을 수 없게 한 창(강제)이 있으면 맥은 끝내기 전체를 취소한다 (2026-10-15 시험: 끝내기를 눌러도 앱이 남음)
    if (win && !win.isDestroyed()) win.setClosable(true);
  });
  const ours = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.handle(NOTICE.get, (e) => (ours(e) ? view : undefined));
  ipcMain.on(NOTICE.act, (e, id: unknown) => {
    if (!ours(e) || typeof id !== 'string' || !view) return;
    if (!view.buttons.some((b) => b.id === id)) return;
    if (id === 'link') {
      o.openLink(view.key);
      return;
    }
    settle(id);
  });
  ipcMain.on(NOTICE.size, (e, height: unknown) => {
    if (!ours(e) || !win || typeof height !== 'number' || !Number.isFinite(height)) return;
    const h = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
    const [, now] = win.getContentSize();
    if (now !== h) win.setContentSize(WIDTH, h);
  });

  /** 기다리던 쪽에 답을 준다. 강제가 아니면 창도 닫는다 */
  function settle(id: string | undefined) {
    const done = answer;
    answer = undefined;
    const kind = view?.kind;
    if (kind !== 'force') close();
    done?.(id);
  }

  function create(): BrowserWindow {
    const w = new BrowserWindow({
      width: WIDTH,
      height: 260,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: t('notice.window'),
      show: false,
      acceptFirstMouse: true,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--jj-window=notice', langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    w.on('close', (ev) => {
      // 강제 안내는 닫을 수 없다. 앱 끝내기(메뉴 막대 아이콘의 끝내기)는 막지 않는다: 데이터를 꺼내고 끌 길은 남긴다
      if (view?.kind === 'force' && !quitting) ev.preventDefault();
    });
    w.on('closed', () => {
      win = undefined;
      view = undefined;
      const done = answer;
      answer = undefined;
      done?.('close');
    });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (ev) => ev.preventDefault());
    reviveWin = reviveOnCrash(w.webContents, 'notice', o.log);
    w.once('ready-to-show', () => reveal(w));
    const devUrl = devRendererUrl();
    if (devUrl) void w.loadURL(`${devUrl}/notice.html`);
    else void w.loadFile(join(import.meta.dirname, '../renderer/notice.html'));
    return w;
  }

  function reveal(w: BrowserWindow) {
    if (w.isDestroyed()) return;
    // 지금 보고 있는 데스크톱에 띄운다 (맥). 앱을 앞으로 가져오지 않는다
    onActiveSpace(w, () => w.showInactive());
  }

  /**
   * 공지를 띄우고 누른 단추를 돌려준다 (닫기 단추면 'close', 다른 공지로 바뀌었으면 undefined).
   * 이미 떠 있으면 내용만 바꾼다.
   */
  function show(next: NoticeView): Promise<string | undefined> {
    // 앞의 공지를 기다리던 쪽은 바뀌었다는 답(undefined)을 받는다
    const prev = answer;
    answer = undefined;
    prev?.(undefined);
    view = next;
    return new Promise((resolve) => {
      answer = resolve;
      if (!win || win.isDestroyed()) {
        win = create();
      } else {
        reviveWin?.();
        win.webContents.send(NOTICE.changed, next);
        if (!win.isVisible()) reveal(win);
      }
      win.setClosable(next.kind !== 'force');
      o.log('notice', '띄움', next.kind, next.key);
    });
  }

  /** 창을 닫는다 (강제 안내도 닫는다: 잠금이 풀렸을 때) */
  function close() {
    if (!win || win.isDestroyed()) return;
    view = undefined;
    win.setClosable(true);
    win.close();
  }

  return {
    show,
    close,
    /** 떠 있는 공지 (없으면 undefined) */
    get current() {
      return view;
    },
    /** 떠 있으면 다시 앞으로 (입력은 뺏지 않는다) */
    raise() {
      if (win && !win.isDestroyed()) reveal(win);
    },
    get window() {
      return win;
    },
  };
}
