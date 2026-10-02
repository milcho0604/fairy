import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  type Rectangle,
  screen,
} from 'electron';
import { clampIntoAreas } from '../shared/geometry.ts';
import { PANEL, type PanelState } from '../shared/ipc.ts';
import { parseQuickTodo } from '../shared/quick-add.ts';
import { COIN, FULLNESS, localDay, type TodoStore } from '../shared/todo-store.ts';

const PANEL_SIZE = { width: 340, height: 500 };
const QUICK_SIZE = { width: 480, height: 64 };

export interface PanelOptions {
  store: TodoStore;
  petName: () => string;
  /** 펫 자리 (패널을 그 옆에 연다) */
  petBounds: () => Rectangle;
  onCompleted: (coins: number) => void;
  onFed: () => void;
  /** 할 일이나 배부름이 바뀌었다 (펫 배고픔 표정 등) */
  onChanged: () => void;
  openChat: () => void;
  lookTogether: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 패널(P2-02)과 빠른 입력(P2-04). 패널은 펫 옆에 뜨고 다른 곳을 누르거나 Esc 면 닫힌다.
 * 둘 다 열 때 만들고 닫으면 없앤다 (L6).
 */
export function createPanel(o: PanelOptions) {
  let panel: BrowserWindow | undefined;
  let quick: BrowserWindow | undefined;

  const ours = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    (!!panel && !panel.isDestroyed() && e.sender === panel.webContents) ||
    (!!quick && !quick.isDestroyed() && e.sender === quick.webContents);

  function state(): PanelState {
    const now = Date.now();
    const { open, doneToday } = o.store.list(now);
    return {
      petName: o.petName(),
      today: localDay(now),
      open,
      doneToday,
      balance: o.store.balance(),
      fullness: Math.round(o.store.fullness(now)),
      hungryBelow: FULLNESS.hungry,
      foodCost: COIN.food,
    };
  }

  function push() {
    const s = state();
    for (const w of [panel, quick]) if (w && !w.isDestroyed()) w.webContents.send(PANEL.state, s);
    o.onChanged();
  }

  ipcMain.handle(PANEL.snapshot, (e) => (ours(e) ? state() : undefined));
  ipcMain.handle(PANEL.add, (e, text: string) => {
    if (!ours(e) || typeof text !== 'string') return { ok: false };
    const parsed = parseQuickTodo(text, localDay(Date.now()));
    if (!parsed.title) return { ok: false, error: '할 일을 적어 줘.' };
    o.store.add(parsed, Date.now());
    push();
    return { ok: true };
  });
  ipcMain.handle(PANEL.complete, (e, id: number) => {
    if (!ours(e)) return 0;
    const coins = o.store.complete(id, Date.now());
    log('todo', 'complete', id, coins);
    push();
    o.onCompleted(coins);
    return coins;
  });
  ipcMain.handle(PANEL.undo, (e, id: number) => {
    if (!ours(e)) return 0;
    const back = o.store.undo(id, Date.now());
    push();
    return back;
  });
  ipcMain.on(PANEL.update, (e, id: number, patch) => {
    if (!ours(e)) return;
    o.store.update(id, patch ?? {});
    push();
  });
  ipcMain.on(PANEL.remove, (e, id: number) => {
    if (!ours(e)) return;
    o.store.remove(id, Date.now());
    push();
  });
  ipcMain.handle(PANEL.feed, (e) => {
    if (!ours(e)) return { ok: false };
    const r = o.store.feed(Date.now());
    push();
    if (r.ok) o.onFed();
    return { ok: r.ok };
  });
  ipcMain.on(PANEL.openChat, (e) => {
    if (!ours(e)) return;
    closePanel();
    o.openChat();
  });
  ipcMain.on(PANEL.lookTogether, (e) => {
    if (!ours(e)) return;
    closePanel();
    o.lookTogether();
  });
  ipcMain.on(PANEL.close, (e) => {
    if (!ours(e)) return;
    if (panel && e.sender === panel.webContents) closePanel();
    if (quick && !quick.isDestroyed() && e.sender === quick.webContents) quick.close();
  });

  function log(...rest: unknown[]) {
    o.log(...(rest as [string, ...unknown[]]));
  }

  function makeWindow(kind: 'panel' | 'quick', bounds: Rectangle) {
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: [`--jj-window=${kind}`],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) win.loadURL(`${devUrl}/${kind}.html`);
    else win.loadFile(join(import.meta.dirname, `../renderer/${kind}.html`));
    win.once('ready-to-show', () => {
      if (process.platform === 'darwin') app.focus({ steal: true });
      win.show();
      win.focus();
    });
    // 다른 곳을 누르면 닫힌다 (팝오버처럼).
    win.on('blur', () => {
      if (!win.isDestroyed()) win.close();
    });
    return win;
  }

  function closePanel() {
    if (panel && !panel.isDestroyed()) panel.close();
    panel = undefined;
  }

  function togglePanel() {
    if (panel && !panel.isDestroyed()) {
      closePanel();
      return;
    }
    panel = makeWindow('panel', placeNear(o.petBounds(), PANEL_SIZE));
    panel.on('closed', () => {
      panel = undefined;
    });
  }

  function openQuick() {
    if (quick && !quick.isDestroyed()) {
      quick.focus();
      return;
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    quick = makeWindow('quick', {
      ...QUICK_SIZE,
      x: Math.round(area.x + (area.width - QUICK_SIZE.width) / 2),
      y: Math.round(area.y + area.height * 0.22),
    });
    quick.on('closed', () => {
      quick = undefined;
    });
  }

  return {
    togglePanel,
    closePanel,
    openQuick,
    /** 펫 이름이나 배부름 등이 밖에서 바뀌었을 때 */
    refresh: push,
    get window() {
      return panel;
    },
    get quickWindow() {
      return quick;
    },
  };
}

/** 펫 왼쪽(자리가 없으면 오른쪽), 펫 아래쪽에 맞춘다. */
function placeNear(pet: Rectangle, size: { width: number; height: number }): Rectangle {
  const area = screen.getDisplayMatching(pet).workArea;
  const gap = 6;
  const left = pet.x - size.width - gap;
  const x = left >= area.x ? left : pet.x + pet.width + gap;
  const y = pet.y + pet.height - size.height;
  return clampIntoAreas({ x, y, ...size }, [area]);
}
