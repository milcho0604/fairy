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
import { type EventStore, parseQuickEvent } from '../shared/event-store.ts';
import type { FocusState } from '../shared/focus.ts';
import { clampIntoAreas } from '../shared/geometry.ts';
import { type NoteAiKind, PANEL, type PanelState } from '../shared/ipc.ts';
import { type NoteStore, notePreview, noteTitle } from '../shared/note-store.ts';
import { parseQuickTodo } from '../shared/quick-add.ts';
import { COIN, FULLNESS, localDay, type TodoStore } from '../shared/todo-store.ts';
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
    if (!parsed.title) return { ok: false, error: '할 일을 적어 줘.' };
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
    const ask =
      kind === 'summary'
        ? '아래 메모를 세 줄 안으로 요약해 줘.'
        : "아래 메모를 바로 할 수 있는 할 일 목록으로 쪼개 줘. 한 줄에 하나씩 '- '로 시작하고 설명은 붙이지 마.";
    const title = n.title.trim() ? `제목: ${n.title.trim()}\n` : '';
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
    if (!ev) return { ok: false, error: '시각을 같이 적어 줘. 예: 내일 3시 회의, 금요일 오전 10시 반 면접' };
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
