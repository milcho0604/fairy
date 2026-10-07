import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  type IpcMainEvent,
  ipcMain,
  Menu,
  powerMonitor,
  screen,
} from 'electron';
import { type Activity, pickActivity, WALK_SPEED, walkOffset } from '../shared/behavior.ts';
import { layoutBubble } from '../shared/bubble-layout.ts';
import {
  bundleText,
  fateOf,
  type HeldBubble,
  HeldBubbles,
  type MissedItem,
  MissedLog,
} from '../shared/bubble-queue.ts';
import { type BubbleKind, ChatterGate, type ChatterLevel, LEVEL_LABEL, quieter } from '../shared/chatter.ts';
import { type Gaze, gazeAt, sameGaze } from '../shared/gaze.ts';
import { clampIntoAreas, type Rect } from '../shared/geometry.ts';
import type { GestureEvent } from '../shared/gesture.ts';
import { t } from '../shared/i18n/index.ts';
import { type BubbleButton, IPC, type PlayKind, type ReactKind } from '../shared/ipc.ts';
import { hopAt, perchHolds, pickPerch } from '../shared/perch.ts';
import { type DisplayInfo, parseSavedScale, restorePetBounds } from '../shared/placement.ts';
import { type HideReason, HideReasons } from '../shared/presence.ts';
import { acceleratorLabel } from '../shared/shortcut.ts';
import { clampScale, resizeFromBottomCenter, scaleByStep, scaleByWheel } from '../shared/size.ts';
import {
  bounce,
  FLIGHT_MAX_MS,
  GRAVITY,
  releaseVelocity,
  THROW_MAX_SPEED,
  THROW_MIN_SPEED,
} from '../shared/throw.ts';
import { boostOn } from './boost.ts';
import { watchCursor } from './cursor-watch.ts';
import { langArg } from './lang.ts';
import { settings } from './settings.ts';
import { readJson, writeJson } from './store.ts';
import { watchSystem } from './system-watch.ts';
import { hideShortcut, quickAddShortcut } from './tray.ts';
import { windowLister } from './window-list.ts';

/** 한가할 때 창 위에 올라앉아 볼 확률 (v1 추가 행동) */
const PERCH_CHANCE = 0.15;
const HOP_MS = 700;

/** 배율 100% 일 때 펫 창 크기. 펫보다 조금 크게 잡아 통통 튀는 동작이 잘리지 않게 한다. */
const BASE_SIZE = 160;
/** 드래그 중 창을 옮기는 간격. 60fps. */
const DRAG_INTERVAL_MS = 16;
/** 펫 위치와 크기를 저장하는 파일 이름 (사용자 데이터 폴더의 pet-position.json). */
const POSITION_FILE = 'pet-position';
/** 오늘 놓친 알림 (missed.json) */
const MISSED_FILE = 'missed';
/** 크기를 바꾼 뒤 이만큼 조용하면 저장한다. 휠을 굴리는 동안 파일을 계속 쓰지 않으려고. */
const SAVE_DELAY_MS = 500;
/** 펫 위에서 그냥 휠을 굴리면 이 시간 동안 마우스를 아래 창으로 넘긴다. */
const WHEEL_PASS_MS = 400;
/** 크기 단축키. 다른 앱과 덜 겹치도록 Option(Alt)을 같이 누른다. */
/** 말풍선이 저절로 닫히는 시간 (기획서: 8초) */
const BUBBLE_TTL_MS = 8000;
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
  openSettings(): void;
  quickAdd(): void;
  feed(): void;
  makePet(): void;
  /** 집중 타이머가 도는지 (메뉴 글자를 바꾼다) */
  focusRunning(): boolean;
  toggleFocus(): void;
  /** 쓰다듬었다 (v1) */
  petted(): void;
  /** 놀이 (v1) */
  play(kind: PlayKind): void;
  /** 가진 공 이름 (털실, 공). 없으면 undefined */
  toy(): string | undefined;
  openShop(): void;
}

export interface SayOptions {
  kind: BubbleKind;
  text: string;
  /** 글 옆 작은 그림 (data URL) */
  image?: string;
  buttons?: BubbleButton[];
  ttlMs?: number;
  /**
   * 놓치면 안 되는 말 (일정 알림, 업적 등). 숨어 있으면 모아 두었다가 나올 때 묶어서 말하고,
   * 보지 못하고 지나가면(시간 끝, 밀려남, 못 띄움) 패널 오늘 탭의 놓친 알림에 남긴다.
   * staleAt 이 지나서 나오면 말풍선 없이 놓친 알림에만 둔다.
   */
  hold?: Pick<HeldBubble, 'staleAt' | 'lines' | 'render' | 'missedLines'>;
}

export interface PetWindow {
  /** 펫 화면만 다시 불러온다 (우클릭 새로고침) */
  reload: () => void;
  win: BrowserWindow;
  /** 화면 좌표의 펫 사각형 (말풍선 자리를 뺀 것) */
  bounds(): Rect;
  /**
   * 말풍선을 띄운다. 수다 빈도에 막히면 undefined, 아니면 닫힌 방법(버튼 id, 'timeout', 'dismiss' 누름, 'cleared' 숨기기나 끌기로 치움, 'replaced').
   */
  say(options: SayOptions): Promise<string | undefined>;
  /** 숨길 까닭을 켜고 끈다. 까닭이 하나라도 있으면 숨는다 (P1-10). */
  setHidden(reason: HideReason, on: boolean, hint?: boolean): void;
  isHidden(reason?: HideReason): boolean;
  scale(): number;
  setScale(scale: number): void;
  /** 반응 동작 (할 일 끝냄, 밥 먹음) */
  react(kind?: ReactKind): void;
  debugMoveTo(x: number, y: number): void;
  debugScale(scale: number): void;
  debugThrow(vx: number, vy: number): void;
  debugPerch(): boolean;
  /** 가로로 x 까지 걷는다 (놀이). 끝까지 걸었으면 true */
  walkTo(x: number, speed?: number): Promise<boolean>;
  /** 산책: minutes 동안 바닥을 오간다 */
  stroll(minutes: number): Promise<boolean>;
  peekAt(x: number, y: number): void;
  comeBack(to: { x: number; y: number }): void;
  /** 한가한지: 보이고, 들리거나 날거나 걷거나 앉으러 뛰거나 창 위에 앉아 있지 않고, 말풍선이 없다 (친구 놀이) */
  isIdle(): boolean;
  /** 친구와 만났다: 그쪽을 보고 하트 (친구 놀이) */
  greet(dir: -1 | 1): void;
  /** 오늘 놓친 알림 (최근 것이 위로) */
  missed(): MissedItem[];
  clearMissed(): void;
}

export interface PetWindowOptions {
  /** 지금 펫 이름 (설정에서 바뀔 수 있어 쓸 때마다 읽는다) */
  petName: () => string;
  actions: PetActions;
  log: (tag: string, ...rest: unknown[]) => void;
  /** 친구 펫(v2 여러 마리)이면 그 id. 자리를 따로 저장한다 */
  id?: string;
  /** 저장된 자리가 없을 때 처음 자리 */
  initial?: { x: number; y: number };
  /** 친구 펫의 우클릭 메뉴 (없으면 기본 펫 메뉴) */
  menu?: () => Electron.MenuItemConstructorOptions[];
  /** 놓친 알림이 바뀌었다 (패널 다시 그리기) */
  onMissed?: () => void;
}

/**
 * 펫 하나를 담는 작은 투명 창. 펫이 움직이면 창이 같이 움직인다.
 * 모니터마다 큰 창을 두는 대신 이렇게 하면 렌더러가 하나라 가볍고(L6),
 * 모니터를 건너가거나 뽑아도 창 위치만 고치면 된다(L7).
 */
export function createPetWindow({
  petName,
  actions,
  log,
  id,
  initial,
  menu,
  onMissed,
}: PetWindowOptions): PetWindow {
  const positionFile = id ? `${POSITION_FILE}-${id}` : POSITION_FILE;
  const saved = readJson(positionFile) ?? (initial ? { ...initial, scale: 1 } : undefined);
  let scale = parseSavedScale(saved);
  // 펫 사각형. 말풍선이 뜨면 창은 이보다 커지지만 펫은 화면에서 제자리에 있다.
  let pet: Rect = restorePetBounds(saved, currentDisplays(), Math.round(BASE_SIZE * scale));

  const hideReasons = new HideReasons();
  /** 숨어 있는 동안 온 답 알림. 다시 나올 때 한 번 말한다 (기획서: 알림은 쌓아 두었다가 나올 때 한 번에). */
  let heldAnswer: { options: SayOptions; resolve: (action: string | undefined) => void } | undefined;
  /** 숨어 있는 동안 온 놓치면 안 되는 말 (SayOptions.hold) */
  const held = new HeldBubbles();
  // 오늘 놓친 알림은 기본 펫만 저장한다 (앱을 다시 켜도 남게)
  const missed = id ? new MissedLog() : MissedLog.from(readJson(MISSED_FILE), Date.now());
  const gate = new ChatterGate(settings.get().chatter);
  const stopSettings = settings.onChange((next) => {
    gate.level = next.chatter;
  });
  const win = new BrowserWindow({
    ...pet,
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
      additionalArguments: ['--jj-window=pet', langArg()],
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
  let walkTimer: NodeJS.Timeout | undefined;
  /** 지금 떠 있는 말풍선. size 는 화면이 재서 알려 준 크기 */
  let bubble:
    | { id: string; size?: { width: number; height: number }; done: (action: string) => void }
    | undefined;

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
      actions.click(pet);
    } else if (event.type === 'drag-start') {
      // 들어 옮기는 동안은 말풍선을 치운다. 창 안 펫 자리가 바뀌므로 오프셋은 펫 기준으로 바꿔 둔다.
      const inWindow = win.getBounds();
      const offset = { x: event.offset.x - (pet.x - inWindow.x), y: event.offset.y - (pet.y - inWindow.y) };
      // 사용자가 말풍선을 누른 것(dismiss)과 구별한다. dismiss 는 "답 왔어"를 연다
      closeBubble('cleared');
      stopWalk();
      clearInterval(dragTimer);
      stopFlight();
      leavePerch();
      samples = [];
      dragTimer = setInterval(() => {
        const cursor = screen.getCursorScreenPoint();
        pet = { ...pet, x: Math.round(cursor.x - offset.x), y: Math.round(cursor.y - offset.y) };
        win.setPosition(pet.x, pet.y);
        samples.push({ t: Date.now(), x: cursor.x, y: cursor.y });
        if (samples.length > 12) samples.shift();
      }, DRAG_INTERVAL_MS);
    } else if (event.type === 'drag-end') {
      clearInterval(dragTimer);
      dragTimer = undefined;
      win.setIgnoreMouseEvents(!overPet, { forward: true });
      // 빠르게 휙 놓으면 던진 것: 날아가다 떨어져 튕긴다 (v1).
      const v = releaseVelocity(samples, Date.now());
      if (v && Math.hypot(v.vx, v.vy) >= THROW_MIN_SPEED) startFlight(v.vx, v.vy);
      else {
        keepOnScreen();
        save();
      }
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
    pet = clampIntoAreas(resizeFromBottomCenter(pet, BASE_SIZE * scale), areas);
    applyLayout();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function save() {
    clearTimeout(saveTimer);
    const { x, y } = pet;
    writeJson(positionFile, { x, y, scale });
    log('pet', 'saved', JSON.stringify({ x, y, scale }));
  }

  const onContextMenu = (e: IpcMainEvent) => {
    if (!fromThisWindow(e)) return;
    log('pet', 'context-menu');
    if (menu) {
      Menu.buildFromTemplate(menu()).popup({ window: win });
      return;
    }
    Menu.buildFromTemplate([
      { label: t('pet.menu.look', { name: petName() }), click: () => actions.lookTogether() },
      { label: t('pet.menu.chat', { name: petName() }), click: () => actions.openChat(pet) },
      { label: t('pet.menu.addTodo'), accelerator: quickAddShortcut(), click: () => actions.quickAdd() },
      { label: t('pet.menu.feed'), click: () => actions.feed() },
      {
        label: t('pet.menu.play'),
        submenu: [
          { label: t('pet.menu.walk'), click: () => actions.play('walk') },
          { label: t('pet.menu.seek'), click: () => actions.play('seek') },
          actions.toy()
            ? {
                label: t('pet.menu.throwToy', { toy: actions.toy() ?? '' }),
                click: () => actions.play('ball'),
              }
            : { label: t('pet.menu.throwNoBall'), click: () => actions.openShop() },
          { label: t('pet.menu.shop'), click: () => actions.openShop() },
        ],
      },
      {
        label: actions.focusRunning()
          ? t('pet.menu.focusStop')
          : t('pet.menu.focusStart', { n: settings.get().focusMin }),
        click: () => actions.toggleFocus(),
      },
      { type: 'separator' },
      {
        label: t('pet.menu.bubbles'),
        submenu: (['quiet', 'normal', 'chatty'] as const).map((level) => ({
          label: LEVEL_LABEL[level],
          type: 'radio' as const,
          checked: gate.level === level,
          click: () => setChatter(level),
        })),
      },
      {
        label: t('pet.menu.hide', { name: petName() }),
        accelerator: hideShortcut(),
        click: () => setHidden('user', true),
      },
      { label: t('pet.menu.makePet'), click: () => actions.makePet() },
      { label: t('pet.menu.settings'), click: () => actions.openSettings() },
      { type: 'separator' },
      { label: t('pet.menu.reload'), click: () => reload() },
      {
        label: t('pet.menu.relaunch', { name: petName() }),
        click: () => {
          // will-quit 정리(기록, AI 끝내기, 저장 닫기)를 거쳐 다시 켠다
          app.relaunch();
          app.quit();
        },
      },
      { label: t('pet.menu.quit'), role: 'quit' },
    ]).popup({ window: win });
  };

  /** 펫 화면만 다시 불러온다 (그림이 이상하거나 멈췄을 때). 떠 있던 말풍선은 닫고, 상태와 그림은 불러온 뒤 다시 보낸다 */
  function reload() {
    if (win.isDestroyed()) return;
    log('pet', 'reload');
    closeBubble('cleared');
    win.webContents.reload();
  }

  function keepOnScreen() {
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    pet = clampIntoAreas(pet, areas);
    applyLayout();
  }

  /** 펫 사각형과 말풍선 크기로 창 크기와 창 안 배치를 정해 적용한다. */
  function applyLayout() {
    if (win.isDestroyed()) return;
    const area = screen.getDisplayMatching(pet).workArea;
    const layout = layoutBubble(pet, bubble?.size, area);
    const now = win.getBounds();
    const w = layout.window;
    if (now.x !== w.x || now.y !== w.y || now.width !== w.width || now.height !== w.height) win.setBounds(w);
    win.webContents.send(IPC.layout, layout);
  }

  function setChatter(level: ChatterLevel) {
    settings.set({ chatter: level });
    log('pet', 'chatter', level);
  }

  // ---- 기본 행동 (P1-06) ----
  // 화면이 한가하다고 알리면 행동을 고른다. 걷기는 창을 30fps 로 옮기고 끝나면 자리를 저장한다.
  const onActivityRequest = (e: IpcMainEvent) => {
    if (
      !fromThisWindow(e) ||
      dragTimer ||
      flightTimer ||
      hopTimer ||
      bubble ||
      walkTimer ||
      !win.isVisible() ||
      !settings.get().wander
    )
      return;
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const area = screen.getDisplayMatching(pet).workArea;
    // 가끔 다른 앱 창 윗변으로 깡충 올라간다. 이미 앉아 있으면 걷지 않는다 (걸으면 떨어지니까).
    if (!perch && Math.random() < PERCH_CHANCE && tryPerch()) return;
    let activity: Activity = pickActivity(pet, area, Math.random, areas);
    if (perch && activity.type === 'walk') activity = { type: 'sit', ms: 12_000 };
    if (activity.type === 'walk') startWalk(activity);
    win.webContents.send(IPC.activity, activity);
  };

  const onActivityStop = (e: IpcMainEvent) => {
    if (fromThisWindow(e)) stopWalk();
  };

  const onPetted = (e: IpcMainEvent) => {
    if (fromThisWindow(e)) actions.petted();
  };

  /** 걷기가 끝나거나 끊기면 알린다 (walkTo). 끝까지 걸었으면 true */
  let walkDone: ((finished: boolean) => void) | undefined;

  function startWalk(walk: Extract<Activity, { type: 'walk' }>) {
    const fromX = pet.x;
    const started = Date.now();
    walkTimer = setInterval(
      () => {
        const t = (Date.now() - started) / walk.ms;
        const x = fromX + walkOffset(walk.dx, t);
        // 걷기 CPU 의 절반이 창 옮기기다. 픽셀이 그대로인 틱(출발, 멈춤 감속)은 옮기지 않는다
        const moved = Math.round(x) !== Math.round(pet.x);
        pet = { ...pet, x };
        if (moved && !win.isDestroyed()) win.setPosition(Math.round(pet.x), pet.y);
        if (t >= 1) stopWalk(true);
        // 부스트 모드면 60Hz 로 옮긴다 (빨리 걸을 때 한 번에 2~4px 씩 뛰던 것이 1~2px 로)
      },
      boostOn() ? 16 : 33,
    );
  }

  /** 가로로 x 까지 걷는다 (v1 놀이). speed 는 px/초. 끊기면(잡기, 숨기, 말풍선) false */
  function walkTo(x: number, speed = WALK_SPEED * 3): Promise<boolean> {
    stopWalk();
    const dx = Math.round(x - pet.x);
    if (Math.abs(dx) < 4 || win.isDestroyed() || !win.isVisible()) return Promise.resolve(true);
    const walk = { type: 'walk' as const, dx, ms: Math.round((Math.abs(dx) / speed) * 1000) };
    return new Promise((resolve) => {
      walkDone = resolve;
      startWalk(walk);
      win.webContents.send(IPC.activity, walk);
    });
  }

  /** 산책 (v1): minutes 동안 화면 바닥을 이쪽 끝에서 저쪽 끝으로 오간다. 끝까지 하면 true */
  async function stroll(minutes: number): Promise<boolean> {
    const end = Date.now() + minutes * 60_000;
    leavePerch();
    // 바닥으로 먼저 내려간다
    const area = screen.getDisplayMatching(pet).workArea;
    pet = { ...pet, y: area.y + area.height - pet.height };
    if (!win.isDestroyed()) win.setPosition(pet.x, pet.y);
    let toRight = pet.x + pet.width / 2 < area.x + area.width / 2;
    while (Date.now() < end) {
      const a = screen.getDisplayMatching(pet).workArea;
      const target = toRight ? a.x + a.width - pet.width - 10 : a.x + 10;
      if (!(await walkTo(target, WALK_SPEED * 1.5))) return false;
      toRight = !toRight;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return true;
  }

  // ---- 창 위에 올라앉기 (v1) ----
  let perch: Rect | undefined;
  let perchTimer: NodeJS.Timeout | undefined;
  let hopTimer: NodeJS.Timeout | undefined;

  /** 앉을 창이 있으면 깡충 뛰어 올라간다. 올라가면 true */
  function tryPerch(): boolean {
    const list = windowLister(log);
    if (!list) return false;
    const spot = pickPerch(pet, list(), screen.getDisplayMatching(pet).workArea);
    if (!spot) return false;
    log('pet', 'perch', JSON.stringify(spot.win));
    hopTo({ x: spot.x, y: spot.y }, () => {
      perch = spot.win;
      clearInterval(perchTimer);
      // 1초마다 창이 그대로인지 본다. 옮기거나 닫으면 떨어진다.
      perchTimer = setInterval(() => {
        if (perch && !perchHolds(perch, list())) {
          log('pet', 'perch lost');
          leavePerch();
          startFlight(0, 0);
        }
      }, 1000);
    });
    return true;
  }

  function leavePerch() {
    perch = undefined;
    clearInterval(perchTimer);
    perchTimer = undefined;
  }

  function hopTo(to: { x: number; y: number }, done: () => void) {
    clearInterval(hopTimer);
    const from = { x: pet.x, y: pet.y };
    const started = Date.now();
    if (!win.isDestroyed()) win.webContents.send(IPC.react, 'happy');
    hopTimer = setInterval(() => {
      const t = (Date.now() - started) / HOP_MS;
      const p = hopAt(from, to, t);
      pet = { ...pet, x: p.x, y: p.y };
      if (!win.isDestroyed()) win.setPosition(pet.x, pet.y);
      if (t >= 1) {
        clearInterval(hopTimer);
        hopTimer = undefined;
        save();
        done();
      }
    }, 16);
  }

  // ---- 던지기 (v1) ----
  let samples: { t: number; x: number; y: number }[] = [];
  let flightTimer: NodeJS.Timeout | undefined;

  function startFlight(vx0: number, vy0: number) {
    let vx = Math.max(-THROW_MAX_SPEED, Math.min(THROW_MAX_SPEED, vx0));
    let vy = Math.max(-THROW_MAX_SPEED, Math.min(THROW_MAX_SPEED, vy0));
    let x = pet.x;
    let y = pet.y;
    let last = Date.now();
    const started = last;
    log('pet', 'throw', Math.round(vx), Math.round(vy));
    win.webContents.send(IPC.flight, true);
    flightTimer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      // 지금 있는 모니터(가운데 기준)의 작업 영역 안에서 튕긴다. 옆 모니터로 넘어가면 그 모니터 기준.
      const area = screen.getDisplayNearestPoint({
        x: Math.round(x + pet.width / 2),
        y: Math.round(y + pet.height / 2),
      }).workArea;
      const step = bounce(
        { x, y, vx, vy },
        pet.width,
        pet.height,
        area,
        screen.getAllDisplays().map((d) => d.workArea),
      );
      ({ x, y, vx, vy } = step);
      pet = { ...pet, x: Math.round(x), y: Math.round(y) };
      if (!win.isDestroyed()) win.setPosition(pet.x, pet.y);
      if (step.rest || now - started > FLIGHT_MAX_MS) stopFlight();
    }, 16);
  }

  function stopFlight() {
    if (!flightTimer) return;
    clearInterval(flightTimer);
    flightTimer = undefined;
    if (!win.isDestroyed()) win.webContents.send(IPC.flight, false);
    keepOnScreen();
    save();
  }

  function stopWalk(finished = false) {
    const done = walkDone;
    walkDone = undefined;
    if (walkTimer) {
      clearInterval(walkTimer);
      walkTimer = undefined;
      keepOnScreen();
      save();
    }
    done?.(finished);
  }

  /** 같은 밀리초에 두 번 띄워도 id 가 겹치지 않게 */
  let bubbleSeq = 0;

  function closeBubble(action: string) {
    const current = bubble;
    if (!current) return;
    bubble = undefined;
    win.webContents.send(IPC.bubble, null);
    applyLayout();
    current.done(action);
  }

  /** 숨기기 전에 다시 부르는 법을 알려 준다. 메뉴 막대가 붐비면 아이콘이 안 보일 수 있어서다. 처음 3번만. */
  const HIDE_HINT_TIMES = 3;
  let hinting = false;

  async function hideWithHint() {
    const shown = settings.get().hideHints;
    if (shown >= HIDE_HINT_TIMES || hinting) {
      setHidden('user', true, false);
      return;
    }
    hinting = true;
    settings.set({ hideHints: shown + 1 });
    const keys = acceleratorLabel(hideShortcut(), process.platform === 'darwin').join('+');
    await say({ kind: 'answer', text: t('pet.hideHint', { keys }), ttlMs: 2500 });
    hinting = false;
    setHidden('user', true, false);
  }

  function setHidden(reason: HideReason, on: boolean, hint = true) {
    if (reason === 'user' && on && hint && !hideReasons.has('user')) {
      void hideWithHint();
      return;
    }
    if (win.isDestroyed() || !hideReasons.set(reason, on)) return;
    log('pet', hideReasons.hidden ? 'hidden' : 'shown', reason);
    if (hideReasons.hidden) {
      closeBubble('cleared');
      stopWalk();
      leavePerch();
      win.hide();
      return;
    }
    win.showInactive();
    applyLayout();
    const answer = heldAnswer;
    heldAnswer = undefined;
    // 답 알림은 예전처럼 먼저, 모아 둔 놓치면 안 되는 말은 그 뒤에 (releaseHeld)
    setTimeout(async () => {
      if (answer) answer.resolve(await say(answer.options));
      releaseHeld();
    }, 600);
  }

  // ---- 놓치면 안 되는 말 (SayOptions.hold) ----
  // 숨음, 끄는 중, 화면 잠금이면 모아 두고, 다시 띄울 수 있고 사용자가 자리에 있으면 하나로 묶어 말한다.
  let screenLocked = false;
  const onLock = () => {
    screenLocked = true;
  };
  const onUnlock = () => {
    screenLocked = false;
  };
  powerMonitor.on('lock-screen', onLock);
  powerMonitor.on('unlock-screen', onUnlock);
  /** 지금 띄울 수 없다 */
  const blocked = () =>
    win.isDestroyed() || hideReasons.hidden || !!dragTimer || screenLocked || !win.isVisible();
  /** 사용자가 자리를 비웠다 (20초 넘게 입력이 없음) */
  const away = () => powerMonitor.getSystemIdleTime() >= 20;

  function addMissed(h: HeldBubble) {
    for (const text of h.missedLines ?? h.lines ?? [h.text]) missed.add({ text, at: h.at });
    if (!id) writeJson(MISSED_FILE, missed.items);
    onMissed?.();
  }

  function keep(items: readonly HeldBubble[]) {
    for (const h of items) for (const out of held.hold(h)) addMissed(out);
  }

  /** 놓치면 안 되는 말이 닫혔거나 못 떴다: 봤으면 끝, 아니면 다시 모으거나 놓친 알림으로 (fateOf) */
  function unseen(items: readonly HeldBubble[], action: string | undefined) {
    for (const h of items) {
      const fate = fateOf(action, { blocked: blocked(), away: away(), shown: h.shown ?? 0 });
      if (fate === 'hold') keep([h]);
      else if (fate === 'missed') addMissed(h);
    }
  }

  /** 모아 둔 것을 꺼낸다: 시작이 한참 지난 일정은 놓친 알림에만, 나머지는 말풍선 하나로 */
  function releaseHeld() {
    if (held.size === 0 || blocked() || away() || bubble) return;
    const { fresh, stale } = held.flush(Date.now());
    for (const h of stale) addMissed(h);
    if (fresh.length === 0) return;
    const now = Date.now();
    const shown = fresh.map((h) => ({ ...h, lines: h.render?.(now) ?? h.lines, shown: (h.shown ?? 0) + 1 }));
    void say({
      kind: 'schedule',
      text: bundleText(shown),
      buttons: [{ id: 'ok', label: t('panel.remind.ok') }],
      ttlMs: 30_000,
    }).then((action) => unseen(shown, action));
  }
  // 끌기가 끝나거나 화면 잠금이 풀리거나 자리로 돌아오면 2초 안에 꺼낸다
  const releaseTimer = setInterval(releaseHeld, 2000);

  function say(options: SayOptions): Promise<string | undefined> {
    const { kind, text, buttons = [], ttlMs = BUBBLE_TTL_MS, image, hold } = options;
    if (hideReasons.hidden && kind === 'answer') {
      // 앞에 기다리던 알림은 새 것으로 바꾼다 (가장 최근 답 하나만).
      heldAnswer?.resolve(undefined);
      return new Promise((resolve) => {
        heldAnswer = { options, resolve };
      });
    }
    const item: HeldBubble | undefined = hold ? { ...hold, text, at: Date.now(), shown: 1 } : undefined;
    if (item && !win.isDestroyed()) {
      // 이 수다 빈도에서 안 하는 말은 모으지도 않는다
      if (!gate.allows(kind)) return Promise.resolve(undefined);
      if (blocked()) {
        keep([{ ...item, shown: 0 }]);
        return Promise.resolve(undefined);
      }
    }
    // 혼잣말은 떠 있는 다른 말을 밀어내지 않는다
    if (kind === 'idle-talk' && bubble) return Promise.resolve(undefined);
    if (win.isDestroyed() || !win.isVisible() || dragTimer || !gate.take(kind, Date.now())) {
      if (item && !win.isDestroyed()) unseen([item], undefined);
      return Promise.resolve(undefined);
    }
    // 하나만 띄운다. 새 말이 오면 앞 말풍선은 닫는다. 걷던 중이면 멈춰 서서 말한다.
    closeBubble('replaced');
    stopWalk();
    const id = `b${Date.now().toString(36)}${(++bubbleSeq).toString(36)}`;
    return new Promise((resolve) => {
      bubble = {
        id,
        done: (action) => {
          log('bubble', id, action);
          // "나중에"가 쌓이면 조용히 할지 한 번 묻는다 (기획서: 세 번 연속).
          if (kind !== 'answer' && gate.closed(action === 'later' ? 'later' : 'other')) askQuieter();
          if (item) unseen([item], action);
          resolve(action);
        },
      };
      win.webContents.send(IPC.bubble, { id, text, buttons, ttlMs, image, kind });
    });
  }

  async function askQuieter() {
    const answer = await say({
      kind: 'answer',
      text: t('pet.tooChatty'),
      buttons: [
        { id: 'yes', label: t('pet.tooChattyYes') },
        { id: 'no', label: t('pet.tooChattyNo') },
      ],
      ttlMs: 15_000,
    });
    if (answer === 'yes') setChatter(quieter(gate.level));
  }

  const onBubbleSize = (e: IpcMainEvent, id: string, width: number, height: number) => {
    if (!fromThisWindow(e) || bubble?.id !== id) return;
    bubble.size = { width, height };
    applyLayout();
  };

  const onBubbleClosed = (e: IpcMainEvent, id: string, action: string) => {
    if (!fromThisWindow(e) || bubble?.id !== id) return;
    closeBubble(action);
  };

  const onDisplaysChanged = () => {
    keepOnScreen();
    log('display', 'changed', JSON.stringify(win.getBounds()));
  };

  ipcMain.on(IPC.hover, onHover);
  ipcMain.on(IPC.gesture, onGesture);
  ipcMain.on(IPC.contextMenu, onContextMenu);
  ipcMain.on(IPC.wheel, onWheel);
  ipcMain.on(IPC.bubbleSize, onBubbleSize);
  ipcMain.on(IPC.activityRequest, onActivityRequest);
  ipcMain.on(IPC.activityStop, onActivityStop);
  ipcMain.on(IPC.petted, onPetted);
  ipcMain.on(IPC.bubbleClosed, onBubbleClosed);
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  // ---- 커서 바라보기 ----
  // 한가하고 보일 때만 커서를 본다. 방향 칸이 바뀔 때만 화면에 알린다 (화면도 그때만 다시 그린다).
  // 커서는 펫 창들이 같이 한 번만 읽는다 (cursor-watch.ts)
  let gaze: Gaze | null = null;
  const stopGaze = watchCursor({
    rect: () => pet,
    onCursor: (cursor) => {
      if (win.isDestroyed()) return;
      const idle =
        settings.get().lookAtCursor &&
        win.isVisible() &&
        !hideReasons.hidden &&
        !wasBusy &&
        !dragTimer &&
        !flightTimer &&
        !walkTimer &&
        !hopTimer;
      const next = idle ? gazeAt(pet, cursor, boostOn()) : null;
      if (sameGaze(next, gaze)) return;
      gaze = next;
      win.webContents.send(IPC.gaze, gaze);
    },
  });

  let wasBusy = false;
  const stopWatching = watchSystem((env) => {
    if (win.isDestroyed()) return;
    win.webContents.send(IPC.env, env);
    // 바빠지는 순간에 한 번만 말한다.
    if (env.systemBusy && !wasBusy) void say({ kind: 'system', text: t('pet.busyCpu') });
    wasBusy = env.systemBusy;
  }, log);
  win.webContents.on('did-finish-load', () => applyLayout());

  win.on('closed', () => {
    stopGaze();
    clearInterval(releaseTimer);
    powerMonitor.off('lock-screen', onLock);
    powerMonitor.off('unlock-screen', onUnlock);
    // 끄는 동안 모아 둔 것은 놓친 알림으로 남긴다 (다시 켜면 패널 오늘 탭에)
    const { fresh, stale } = held.flush(Date.now());
    for (const h of [...stale, ...fresh])
      for (const text of h.missedLines ?? h.lines ?? [h.text]) missed.add({ text, at: h.at });
    if (!id && fresh.length + stale.length > 0) writeJson(MISSED_FILE, missed.items);
    stopSettings();
    stopWatching();
    clearInterval(dragTimer);
    clearTimeout(saveTimer);
    setShortcuts(false);
    ipcMain.off(IPC.wheel, onWheel);
    ipcMain.off(IPC.bubbleSize, onBubbleSize);
    ipcMain.off(IPC.activityRequest, onActivityRequest);
    ipcMain.off(IPC.activityStop, onActivityStop);
    ipcMain.off(IPC.petted, onPetted);
    clearInterval(walkTimer);
    clearInterval(flightTimer);
    clearInterval(perchTimer);
    clearInterval(hopTimer);
    ipcMain.off(IPC.bubbleClosed, onBubbleClosed);
    ipcMain.off(IPC.hover, onHover);
    ipcMain.off(IPC.gesture, onGesture);
    ipcMain.off(IPC.contextMenu, onContextMenu);
    screen.off('display-added', onDisplaysChanged);
    screen.off('display-removed', onDisplaysChanged);
    screen.off('display-metrics-changed', onDisplaysChanged);
  });

  return {
    win,
    reload,
    bounds: () => ({ ...pet }),
    say,
    setHidden: (reason: HideReason, on: boolean, hint?: boolean) => setHidden(reason, on, hint),
    scale: () => scale,
    react: (kind: ReactKind = 'happy') => {
      if (!win.isDestroyed()) win.webContents.send(IPC.react, kind);
    },
    setScale: (next: number) => resize(clampScale(next)),
    isHidden: (reason?: HideReason) => (reason ? hideReasons.has(reason) : hideReasons.hidden),
    // 개발용: 디자인 점검 때 위치와 크기를 바로 바꾼다 (메인 디버거의 __jj 에서만 부른다).
    debugMoveTo(x: number, y: number) {
      pet = { ...pet, x, y };
      keepOnScreen();
    },
    debugScale: (next: number) => resize(next),
    /** 개발용: 던지기 (실제 던지기는 운영체제 커서 속도가 필요하다) */
    debugThrow: (vx: number, vy: number) => startFlight(vx, vy),
    /** 개발용: 창 위에 올라앉기 */
    debugPerch: () => tryPerch(),
    walkTo,
    stroll,
    /** 숨바꼭질 (v2): 화면 가장자리 밖으로 반쯤 나간 자리로 순간이동 (안 보이게 숨겼다가 나타난다) */
    peekAt(x: number, y: number) {
      stopWalk();
      stopFlight();
      leavePerch();
      closeBubble('replaced');
      if (win.isDestroyed()) return;
      win.hide();
      pet = { ...pet, x: Math.round(x), y: Math.round(y) };
      applyLayout();
      setTimeout(() => {
        if (!win.isDestroyed() && !hideReasons.hidden) win.showInactive();
      }, 400);
    },
    /** 숨바꼭질이 끝나면 원래 자리로 */
    comeBack(to: { x: number; y: number }) {
      pet = { ...pet, x: to.x, y: to.y };
      keepOnScreen();
      save();
    },
    isIdle: () =>
      !win.isDestroyed() &&
      win.isVisible() &&
      !hideReasons.hidden &&
      !dragTimer &&
      !flightTimer &&
      !walkTimer &&
      !hopTimer &&
      !perch &&
      !bubble,
    greet(dir: -1 | 1) {
      if (win.isDestroyed()) return;
      win.webContents.send(IPC.activity, { type: 'look', dir, ms: 2600 });
      win.webContents.send(IPC.react, 'love');
    },
    missed: () => missed.list(Date.now()),
    clearMissed: () => {
      missed.clear();
      if (!id) writeJson(MISSED_FILE, []);
      onMissed?.();
    },
  };
}

function currentDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d) => ({
    workArea: d.workArea,
    internal: d.internal,
    primary: d.id === primaryId,
  }));
}
