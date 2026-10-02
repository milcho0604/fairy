import { join } from 'node:path';
import { BrowserWindow, globalShortcut, type IpcMainEvent, ipcMain, Menu, screen } from 'electron';
import { clampIntoAreas } from '../shared/geometry.ts';
import type { GestureEvent } from '../shared/gesture.ts';
import { IPC } from '../shared/ipc.ts';
import { withParticle } from '../shared/josa.ts';
import { type DisplayInfo, parseSavedScale, restorePetBounds } from '../shared/placement.ts';
import { resizeFromBottomCenter, scaleByStep, scaleByWheel } from '../shared/size.ts';
import { readJson, writeJson } from './store.ts';
import { watchSystem } from './system-watch.ts';

/** 배율 100% 일 때 펫 창 크기. 펫보다 조금 크게 잡아 통통 튀는 동작이 잘리지 않게 한다. */
const BASE_SIZE = 160;
/** 드래그 중 창을 옮기는 간격. 60fps. */
const DRAG_INTERVAL_MS = 16;
/** 펫 위치와 크기를 저장하는 파일 이름 (사용자 데이터 폴더의 pet-position.json). */
const POSITION_FILE = 'pet-position';
/** 크기를 바꾼 뒤 이만큼 조용하면 저장한다. 휠을 굴리는 동안 파일을 계속 쓰지 않으려고. */
const SAVE_DELAY_MS = 500;
/** 펫 위에서 그냥 휠을 굴리면 이 시간 동안 마우스를 아래 창으로 넘긴다. */
const WHEEL_PASS_MS = 400;
/** 크기 단축키. 다른 앱과 덜 겹치도록 Option(Alt)을 같이 누른다. */
const SIZE_SHORTCUTS = {
  bigger: 'CommandOrControl+Alt+=',
  smaller: 'CommandOrControl+Alt+-',
  reset: 'CommandOrControl+Alt+0',
};

export interface PetActions {
  /** 왼쪽 클릭. 패널(2단계) 전까지는 채팅 창을 열고 닫는다. */
  click(petBounds: Electron.Rectangle): void;
  openChat(petBounds: Electron.Rectangle): void;
  lookTogether(): void;
}

export interface PetWindowOptions {
  petName: string;
  actions: PetActions;
  log: (tag: string, ...rest: unknown[]) => void;
}

/**
 * 펫 하나를 담는 작은 투명 창. 펫이 움직이면 창이 같이 움직인다.
 * 모니터마다 큰 창을 두는 대신 이렇게 하면 렌더러가 하나라 가볍고(L6),
 * 모니터를 건너가거나 뽑아도 창 위치만 고치면 된다(L7).
 */
export function createPetWindow({ petName, actions, log }: PetWindowOptions): BrowserWindow {
  const saved = readJson(POSITION_FILE);
  let scale = parseSavedScale(saved);
  const start = restorePetBounds(saved, currentDisplays(), Math.round(BASE_SIZE * scale));
  const win = new BrowserWindow({
    ...start,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      additionalArguments: ['--jj-window=pet'],
      sandbox: true,
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  // 모든 데스크톱(Space)에 보이되, 다른 앱의 전체 화면 위에는 올라가지 않는다.
  // (전체 화면 위에도 띄우면 다른 앱을 크게 쓰는 중에 펫이 가린다. 2026-10-02 사용자 지적)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 처음에는 모두 통과시킨다. 커서가 펫 위에 오면 화면이 알려 준다.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.once('ready-to-show', () => win.showInactive());

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) win.loadURL(`${devUrl}/pet.html`);
  else win.loadFile(join(import.meta.dirname, '../renderer/pet.html'));

  let dragTimer: NodeJS.Timeout | undefined;
  let saveTimer: NodeJS.Timeout | undefined;
  let overPet = false;
  let passWheelUntil = 0;

  const shortcuts: [string, () => void][] = [
    [SIZE_SHORTCUTS.bigger, () => resize(scaleByStep(scale, 1))],
    [SIZE_SHORTCUTS.smaller, () => resize(scaleByStep(scale, -1))],
    [SIZE_SHORTCUTS.reset, () => resize(1)],
  ];

  const fromThisWindow = (e: IpcMainEvent) => e.sender === win.webContents;

  const onHover = (e: IpcMainEvent, over: boolean) => {
    if (!fromThisWindow(e)) return;
    overPet = over;
    setShortcuts(over);
    if (dragTimer || Date.now() < passWheelUntil) return;
    win.setIgnoreMouseEvents(!over, { forward: true });
  };

  // 크기 단축키는 컴퓨터 전체에 걸리는 전역 단축키라, 늘 걸어 두면 다른 앱의 같은 키를 빼앗는다
  // (예: Notion 의 Cmd+Option+0). 마우스가 펫 위에 있을 때만 건다.
  let shortcutsOn = false;
  function setShortcuts(on: boolean) {
    if (on === shortcutsOn) return;
    shortcutsOn = on;
    for (const [accelerator, run] of shortcuts) {
      if (!on) globalShortcut.unregister(accelerator);
      else if (!globalShortcut.register(accelerator, run))
        log('shortcut', '등록 실패 (다른 앱이 사용 중)', accelerator);
    }
  }

  const onGesture = (e: IpcMainEvent, event: GestureEvent) => {
    if (!fromThisWindow(e)) return;
    log('pet', event.type);
    if (event.type === 'click') {
      actions.click(win.getBounds());
    } else if (event.type === 'drag-start') {
      clearInterval(dragTimer);
      dragTimer = setInterval(() => {
        const cursor = screen.getCursorScreenPoint();
        win.setPosition(Math.round(cursor.x - event.offset.x), Math.round(cursor.y - event.offset.y));
      }, DRAG_INTERVAL_MS);
    } else if (event.type === 'drag-end') {
      clearInterval(dragTimer);
      dragTimer = undefined;
      keepOnScreen();
      win.setIgnoreMouseEvents(!overPet, { forward: true });
      save();
    }
  };

  const onWheel = (e: IpcMainEvent, deltaY: number, zoom: boolean) => {
    if (!fromThisWindow(e)) return;
    if (zoom) {
      resize(scaleByWheel(scale, deltaY));
      return;
    }
    // 창은 휠을 아래 앱에 넘겨줄 수 없다. 잠깐 마우스를 통과시켜 다음 휠부터 아래 앱이 받게 한다.
    passWheelUntil = Date.now() + WHEEL_PASS_MS;
    win.setIgnoreMouseEvents(true, { forward: true });
    setTimeout(() => {
      if (!win.isDestroyed() && !dragTimer) win.setIgnoreMouseEvents(!overPet, { forward: true });
    }, WHEEL_PASS_MS);
  };

  function resize(next: number) {
    if (next === scale) return;
    scale = next;
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    win.setBounds(clampIntoAreas(resizeFromBottomCenter(win.getBounds(), BASE_SIZE * scale), areas));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function save() {
    clearTimeout(saveTimer);
    const { x, y } = win.getBounds();
    writeJson(POSITION_FILE, { x, y, scale });
    log('pet', 'saved', JSON.stringify({ x, y, scale }));
  }

  const onContextMenu = (e: IpcMainEvent) => {
    if (!fromThisWindow(e)) return;
    log('pet', 'context-menu');
    // 할 일 추가, 밥 주기, 설정은 2단계와 P1-12 에서 더한다.
    Menu.buildFromTemplate([
      { label: `${withParticle(petName, '이랑')} 같이 보기`, click: () => actions.lookTogether() },
      { label: `${withParticle(petName, '과')} 대화`, click: () => actions.openChat(win.getBounds()) },
      { type: 'separator' },
      { label: '끝내기', role: 'quit' },
    ]).popup({ window: win });
  };

  function keepOnScreen() {
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const now = win.getBounds();
    const next = clampIntoAreas(now, areas);
    if (next.x !== now.x || next.y !== now.y) win.setPosition(next.x, next.y);
  }

  const onDisplaysChanged = () => {
    keepOnScreen();
    log('display', 'changed', JSON.stringify(win.getBounds()));
  };

  ipcMain.on(IPC.hover, onHover);
  ipcMain.on(IPC.gesture, onGesture);
  ipcMain.on(IPC.contextMenu, onContextMenu);
  ipcMain.on(IPC.wheel, onWheel);
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  const stopWatching = watchSystem((env) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.env, env);
  }, log);

  win.on('closed', () => {
    stopWatching();
    clearInterval(dragTimer);
    clearTimeout(saveTimer);
    setShortcuts(false);
    ipcMain.off(IPC.wheel, onWheel);
    ipcMain.off(IPC.hover, onHover);
    ipcMain.off(IPC.gesture, onGesture);
    ipcMain.off(IPC.contextMenu, onContextMenu);
    screen.off('display-added', onDisplaysChanged);
    screen.off('display-removed', onDisplaysChanged);
    screen.off('display-metrics-changed', onDisplaysChanged);
  });

  return win;
}

function currentDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    workArea: d.workArea,
    internal: d.internal,
    primary: d.id === primaryId,
  }));
}
