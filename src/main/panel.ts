import { join } from 'node:path';
import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  type Rectangle,
  screen,
} from 'electron';
import { type EventStore, parseQuickEvent } from '../shared/event-store.ts';
import type { FocusState } from '../shared/focus.ts';
import { clampIntoAreas } from '../shared/geometry.ts';
import { t } from '../shared/i18n/index.ts';
import { type NoteAiKind, PANEL, type PanelState, type PanelTab, type PlayKind } from '../shared/ipc.ts';
import { type NoteStore, notePreview, noteTitle } from '../shared/note-store.ts';
import { parseQuickTodo } from '../shared/quick-add.ts';
import { CUSTOM_FOOD_COST, CUSTOM_FOOD_MAX, type Food, type ItemStore } from '../shared/shop.ts';
import { COIN, FULLNESS, localDay, type TodoStore } from '../shared/todo-store.ts';
import { focusWindow, stealFocus } from './focus.ts';
import { langArg } from './lang.ts';
import { localTime, minuteOfDay, startOfDay } from './planner.ts';

const PANEL_SIZE = { width: 360, height: 540 };
const QUICK_SIZE = { width: 480, height: 64 };

export interface PanelOptions {
  store: TodoStore;
  notes: NoteStore;
  events: EventStore;
  focus: () => FocusState;
  startFocus: () => void;
  stopFocus: () => void;
  /** 일정이 바뀌었다 (곧 시작하는 일정이면 바로 알림) */
  onEventsChanged: () => void;
  /** 채팅 창을 열고 묻는다. 답을 기다리는 중이면 false */
  askAi: (prompt: string) => boolean;
  life: () => { sulk: number; mood: number; affection: number };
  /** 상점 (v1) */
  shop: ItemStore;
  foodImage: (file: string | undefined) => string;
  /** 먹이를 줬다 (펫 반응, 기분) */
  onFedWith: (food: Food) => void;
  /** 커스텀 먹이 만들기 창 열기 */
  openFoodMaker: () => void;
  removeFoodImage: (file: string | undefined) => void;
  /** 집 단계가 바뀌었다 */
  onHouseChanged: () => void;
  /** 놀이 시작 (공놀이, 산책) */
  play: (kind: PlayKind) => void;
  achieve: () => PanelState['achieve'];
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
      notes: o.notes.list().map((n) => ({
        id: n.id,
        title: noteTitle(n),
        preview: notePreview(n),
        source: n.source,
        updatedAt: n.updatedAt,
      })),
      events: o.events.between(startOfDay(now), startOfDay(now) + 14 * 86_400_000),
      focus: o.focus(),
      focusCoins: COIN.focus,
      life: o.life(),
      achieve: o.achieve(),
      shop: {
        ...o.shop.state(),
        foodImages: Object.fromEntries(o.shop.state().customFoods.map((f) => [f.key, o.foodImage(f.image)])),
      },
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
    const now = Date.now();
    // 시각이 들어 있으면("내일 3시 회의") 일정으로 넣는다. "3시까지"는 마감이라 할 일로 둔다.
    const ev = text.includes('까지') ? null : parseQuickEvent(text, localDay(now), minuteOfDay(now));
    if (ev) {
      const startAt = localTime(ev.day, ev.minute);
      o.events.add(
        { title: ev.title, startAt, endAt: ev.durationMin ? startAt + ev.durationMin * 60_000 : null },
        now,
      );
      push();
      o.onEventsChanged();
      return { ok: true, kind: 'event' as const };
    }
    const parsed = parseQuickTodo(text, localDay(now));
    if (!parsed.title) return { ok: false, error: t('panel.add.empty') };
    o.store.add(parsed, now);
    push();
    return { ok: true, kind: 'todo' as const };
  });
  // ---- 메모 ----
  ipcMain.handle(PANEL.noteGet, (e, id: number) => (ours(e) ? o.notes.get(id) : undefined));
  ipcMain.handle(PANEL.noteAdd, (e) => {
    if (!ours(e)) return undefined;
    const n = o.notes.add({}, Date.now());
    push();
    return n;
  });
  ipcMain.on(PANEL.noteUpdate, (e, id: number, patch) => {
    if (!ours(e) || typeof patch !== 'object' || patch === null) return;
    const { title, body } = patch as { title?: unknown; body?: unknown };
    o.notes.update(
      id,
      {
        ...(typeof title === 'string' ? { title } : {}),
        ...(typeof body === 'string' ? { body } : {}),
      },
      Date.now(),
    );
    push();
  });
  ipcMain.on(PANEL.noteRemove, (e, id: number) => {
    if (!ours(e)) return;
    o.notes.remove(id, Date.now());
    push();
  });
  ipcMain.handle(PANEL.noteAi, (e, id: number, kind: NoteAiKind) => {
    const n = ours(e) ? o.notes.get(id) : undefined;
    if (!n?.body.trim()) return false;
    const ask = kind === 'summary' ? t('panel.noteAi.summary') : t('panel.noteAi.todos');
    const title = n.title.trim() ? `${t('panel.noteAi.title', { title: n.title.trim() })}\n` : '';
    if (!o.askAi(`${ask}\n\n${title}${n.body}`)) return false;
    closePanel();
    return true;
  });
  ipcMain.on(PANEL.noteRestore, (e, id: number) => {
    if (!ours(e)) return;
    o.notes.restore(id);
    push();
  });
  // ---- 일정 ----
  ipcMain.handle(PANEL.eventAdd, (e, text: string) => {
    if (!ours(e) || typeof text !== 'string') return { ok: false };
    const now = Date.now();
    const ev = parseQuickEvent(text, localDay(now), minuteOfDay(now));
    if (!ev) return { ok: false, error: t('panel.event.needTime') };
    const startAt = localTime(ev.day, ev.minute);
    const event = o.events.add(
      { title: ev.title, startAt, endAt: ev.durationMin ? startAt + ev.durationMin * 60_000 : null },
      now,
    );
    push();
    o.onEventsChanged();
    return { ok: true, event };
  });
  ipcMain.on(PANEL.eventUpdate, (e, id: number, patch) => {
    if (!ours(e) || typeof patch !== 'object' || patch === null) return;
    const p = patch as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    o.events.update(id, {
      ...(typeof p.title === 'string' ? { title: p.title } : {}),
      ...(num(p.startAt) !== undefined ? { startAt: num(p.startAt) } : {}),
      ...(p.endAt === null || num(p.endAt) !== undefined
        ? { endAt: (p.endAt as number | null) ?? null }
        : {}),
      ...(num(p.remindMin) !== undefined ? { remindMin: num(p.remindMin) } : {}),
    });
    push();
    o.onEventsChanged();
  });
  ipcMain.on(PANEL.eventRemove, (e, id: number) => {
    if (!ours(e)) return;
    o.events.remove(id, Date.now());
    push();
  });
  ipcMain.on(PANEL.eventRestore, (e, id: number) => {
    if (!ours(e)) return;
    o.events.restore(id);
    push();
  });
  // ---- 상점과 놀이 (v1) ----
  ipcMain.handle(PANEL.buyToy, (e, key: string) => {
    if (!ours(e) || typeof key !== 'string') return { ok: false, error: t('panel.retry') };
    const r = o.shop.buyToy(key, Date.now());
    push();
    return r;
  });
  ipcMain.handle(PANEL.buyHouse, (e) => {
    if (!ours(e)) return { ok: false, error: t('panel.retry') };
    const r = o.shop.buyHouse(Date.now());
    push();
    if (r.ok) o.onHouseChanged();
    return r;
  });
  ipcMain.handle(PANEL.feedWith, (e, key: string) => {
    if (!ours(e) || typeof key !== 'string') return { ok: false };
    const food = o.shop.food(key);
    if (!food) return { ok: false, error: t('shop.err.noFood') };
    const r = o.store.feed(Date.now(), food);
    push();
    if (!r.ok)
      return { ok: false, error: r.full ? t('pet.full') : t('shop.err.needCoins', { n: food.cost }) };
    o.onFedWith(food);
    return { ok: true };
  });
  ipcMain.handle(PANEL.makeFood, (e) => {
    if (!ours(e)) return { ok: false, error: t('panel.retry') };
    if (o.store.balance() < CUSTOM_FOOD_COST)
      return { ok: false, error: t('shop.err.needCoins', { n: CUSTOM_FOOD_COST }) };
    if (o.shop.state().customFoods.length >= CUSTOM_FOOD_MAX)
      return { ok: false, error: t('shop.err.foodMaxShort', { n: CUSTOM_FOOD_MAX }) };
    closePanel();
    o.openFoodMaker();
    return { ok: true };
  });
  ipcMain.on(PANEL.removeFood, (e, key: string) => {
    if (!ours(e) || typeof key !== 'string') return;
    o.removeFoodImage(o.shop.removeCustomFood(key));
    push();
  });
  ipcMain.on(PANEL.play, (e, kind: PlayKind) => {
    if (!ours(e) || (kind !== 'ball' && kind !== 'walk' && kind !== 'seek')) return;
    closePanel();
    o.play(kind);
  });
  // ---- 집중 타이머 ----
  ipcMain.on(PANEL.focusStart, (e) => {
    if (ours(e)) o.startFocus();
  });
  ipcMain.on(PANEL.focusStop, (e) => {
    if (ours(e)) o.stopFocus();
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

  function makeWindow(kind: 'panel' | 'quick', bounds: Rectangle, tab?: PanelTab) {
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
        additionalArguments: [`--jj-window=${kind}`, langArg()],
        sandbox: true,
        contextIsolation: true,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) win.loadURL(`${devUrl}/${kind}.html${tab ? `#${tab}` : ''}`);
    else win.loadFile(join(import.meta.dirname, `../renderer/${kind}.html`), { hash: tab });
    win.once('ready-to-show', () => {
      stealFocus();
      focusWindow(win);
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

  /** 패널을 열고 이 탭을 보여 준다 (이미 열려 있으면 탭만) */
  function openTab(tab: PanelTab) {
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send(PANEL.tab, tab);
      focusWindow(panel);
      return;
    }
    const win = makeWindow('panel', placeNear(o.petBounds(), PANEL_SIZE), tab);
    panel = win;
    // 옛 창이 늦게 닫혀도 새 창 참조를 지우지 않게 (빨리 닫았다 열면 빈 패널이 남았다)
    win.on('closed', () => {
      if (panel === win) panel = undefined;
    });
  }

  function togglePanel() {
    if (panel && !panel.isDestroyed()) {
      closePanel();
      return;
    }
    const win = makeWindow('panel', placeNear(o.petBounds(), PANEL_SIZE));
    panel = win;
    win.on('closed', () => {
      if (panel === win) panel = undefined;
    });
  }

  function openQuick() {
    if (quick && !quick.isDestroyed()) {
      focusWindow(quick);
      return;
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    quick = makeWindow('quick', {
      ...QUICK_SIZE,
      x: Math.round(area.x + (area.width - QUICK_SIZE.width) / 2),
      y: Math.round(area.y + area.height * 0.22),
    });
    const win = quick;
    win.on('closed', () => {
      if (quick === win) quick = undefined;
    });
  }

  return {
    togglePanel,
    openTab,
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
