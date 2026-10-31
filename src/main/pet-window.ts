import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  globalShortcut,
  type IpcMainEvent,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  screen,
} from 'electron';
import { followTickMs, perchPollMs, SAVER, walkTickMs } from '../shared/battery.ts';
import {
  type Activity,
  clampWalkX,
  pickActivity,
  WALK_SPEED,
  walkOffset,
  walkSpan,
} from '../shared/behavior.ts';
import {
  BUBBLE_GUESS,
  type BubbleAnchor,
  bubbleClashes,
  bubbleRectOf,
  layoutBubble,
  parseBubbleAnchor,
} from '../shared/bubble-layout.ts';
import {
  bundleText,
  fateOf,
  type HeldBubble,
  HeldBubbles,
  heldButtons,
  type MissedItem,
  MissedLog,
  missedEntries,
  OS_AWAY_SEC,
  osClickAction,
  osNotifyFor,
} from '../shared/bubble-queue.ts';
import { type BubbleKind, ChatterGate, type ChatterLevel, LEVEL_LABEL, quieter } from '../shared/chatter.ts';
import { Conceal, type ConcealReason } from '../shared/conceal.ts';
import { CrashGuard } from '../shared/crash-guard.ts';
import { type CarryToy, fromBox, toBox } from '../shared/fetch.ts';
import { type Gaze, gazeAt, sameGaze } from '../shared/gaze.ts';
import { clampIntoAreas, type Point, type Rect, snapRect } from '../shared/geometry.ts';
import { isGesture } from '../shared/gesture.ts';
import { approachMs, doorFrame, OUT_MS, STRETCH_MS } from '../shared/house-rest.ts';
import { type HouseSprites, parseSprites } from '../shared/house-room.ts';
import { t } from '../shared/i18n/index.ts';
import { type BubbleButton, IPC, type PetBody, type PlayKind, type ReactKind } from '../shared/ipc.ts';
import {
  FOUND_MS,
  LOOK_POLL_MS,
  type LookPhase,
  lookDir,
  REVEAL_MS,
  sameDir,
} from '../shared/look-motion.ts';
import { burrowFrame } from '../shared/minigames.ts';
import { isMove, type MoveHistory, moveAskOf, rememberMove } from '../shared/moves.ts';
import { hopAt, perchHolds, pickPerch } from '../shared/perch.ts';
import { voiced } from '../shared/persona-voice.ts';
import { isPetKey, KEY_NUDGE, KEY_WALK, type PetKey } from '../shared/pet-keys.ts';
import type { Blueprint } from '../shared/pet3d/blueprint.ts';
import { type DisplayInfo, parseSavedScale, restorePetBounds } from '../shared/placement.ts';
import { type HideReason, HideReasons } from '../shared/presence.ts';
import { acceleratorLabel } from '../shared/shortcut.ts';
import { clampScale, resizeFromBottomCenter, scaleByStep, scaleByWheel } from '../shared/size.ts';
import type { SoundKind } from '../shared/sound.ts';
import {
  bounce,
  bounceHit,
  FLIGHT_MAX_MS,
  GRAVITY,
  releaseVelocity,
  THROW_MAX_SPEED,
  THROW_MIN_SPEED,
} from '../shared/throw.ts';
import type { NoteLook } from '../shared/together.ts';
import { KEEP_APP_TYPE } from './active-space.ts';
import { motionCalm, saverNow } from './battery.ts';
import { boostOn } from './boost.ts';
import { watchCursor } from './cursor-watch.ts';
import { devRendererUrl } from './dev-url.ts';
import { onDisplaysChanged as watchDisplays } from './display-watch.ts';
import { focusWindow, stealFocus } from './focus.ts';
import { hideHintDelivery, hideHintFor } from './hide-hint.ts';
import { langArg } from './lang.ts';
import { createHoverGuard } from './pet-hover.ts';
import { markPetPress } from './pet-press.ts';
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
  /** 왼쪽 클릭 동작 */
  click(petBounds: Electron.Rectangle): void;
  /** 더블클릭 동작. 친구 펫은 지정하지 않으면 왼쪽 클릭 동작을 한 번 실행한다. */
  doubleClick?(petBounds: Electron.Rectangle): void;
  openChat(petBounds: Electron.Rectangle): void;
  lookTogether(): void;
  openSettings(): void;
  quickAdd(): void;
  addNote?(): void;
  openPanel?(): void;
  /** 큰 창으로 열기 (큰 창 설계 #159). 없으면 우클릭 메뉴에 항목이 없다 */
  openHome?(): void;
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
  /** 지금 노는 중 (놀기 메뉴 맨 위에 "그만 놀기") */
  playing?(): boolean;
  /** 그만 놀기 */
  stopPlay?(): void;
  /** 술래잡기 할 친구 이름 (없으면 메뉴에 안 보인다) */
  playmate?(): string | undefined;
  /** 들어 옮기기 시작 (매운맛: 쓰다듬다 바로 들면 내려놓은 뒤 "앗" 하고 놀란다. 삐지지는 않는다) */
  grabbed?(): void;
  /** 우클릭 메뉴 맨 위에 흐리게 보일 한 줄 (토라지면 대답이 짧다). 없으면 안 보인다 */
  menuNote?(): string | undefined;
  /** 놀러 온 친구 펫 항목 (main/visitors.ts: 오늘은 그만, 돌려보내기). 펫 놀러 가기가 꺼졌으면 빈 배열 */
  visitItems?(): Electron.MenuItemConstructorOptions[];
  /** 짝꿍이 아는 것 창 (main/knows.ts). 없으면 메뉴에 안 보인다 */
  openKnows?(): void;
  /** 쪽지함을 연다 (펫 메뉴). mailUnread 는 메뉴에 붙는 안 읽은 쪽지 수 */
  openMailbox?(): void;
  mailUnread?(): number;
  /** 질문 칩 (main/pet-chips.ts, 이슈 #124). 없으면 메뉴에 안 보인다 */
  askChips?(): void;
  /** "오늘 뭐부터?" 규칙 답을 말풍선으로 (main/what-first.ts). 없으면 메뉴에 안 보인다 */
  whatFirst?(): void;
  /** 집 숨기기, 다시 보이기 (shared/house-stow.ts). 집이 없으면 undefined 라 메뉴에 안 보인다 */
  houseItem?(): Electron.MenuItemConstructorOptions | undefined;
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
  hold?: Pick<
    HeldBubble,
    'staleAt' | 'lines' | 'render' | 'missedLines' | 'missedMsgs' | 'onAction' | 'osNotify' | 'osActions'
  >;
  /** 끊으면 이 말풍선을 닫는다(떠 있을 때) 또는 기다리던 것을 버린다. 시간 끝 없는 안내를 거둘 때 (강제 업데이트가 풀림) */
  signal?: AbortSignal;
  /** 펼친 쪽지 모양 (매일 쪽지, 특별한 편지). 없으면 보통 말풍선 */
  paper?: NoteLook;
}

/** 설계도 정면 그림을 기다리는 시간 (입체 모듈을 처음 불러오는 데도 걸린다) */
const SHOT_WAIT_MS = 15_000;

// ---- 두 펫이 같이 말할 때 (이슈 #65) ----
// 기본 펫과 친구 펫이 동시에 말하면 말풍선이 포개졌다. 다른 펫 말풍선과 겹칠 자리면 혼잣말은 건너뛰고,
// 다른 말은 그 말풍선이 닫힐 때까지 조금(BUBBLE_WAIT_MAX_MS) 미뤘다가 띄운다
/** 떠 있는 펫 창마다 지금 말풍선의 화면 사각형 (없으면 undefined) */
const talkers = new Set<() => Rect | undefined>();
/** 말풍선이 닫히기를 기다리는 말 */
const roomWaiters = new Set<() => void>();
/** 다른 펫 말풍선이 닫히기를 이만큼까지 기다린다. 넘으면 그냥 띄운다 (놓치면 안 되는 말을 오래 붙잡지 않게) */
const BUBBLE_WAIT_MAX_MS = 6000;
/** 꾹 눌러 커지기 요청 처리기, 펫 창(webContents id)마다 하나 (이슈 #124) */
const peekHandlers = new Map<number, (on: boolean, calm: boolean) => boolean>();
let peekHandlerSet = false;
function registerPeekHandler() {
  if (peekHandlerSet) return;
  peekHandlerSet = true;
  ipcMain.handle(IPC.peek, (e, on: unknown, calm: unknown) =>
    (peekHandlers.get(e.sender.id) ?? (() => false))(on === true, calm === true),
  );
}
const roomMaybe = () => {
  for (const w of [...roomWaiters]) w();
};

export interface PetWindow {
  /** 펫 화면만 다시 불러온다 (우클릭 새로고침) */
  reload: () => void;
  /**
   * 머리 위에 늘 떠 있는 상태 말풍선 (진행 중, 집중 남은 시간, 이슈 #124). null 이면 치운다.
   * 다른 말풍선이 뜨면 비켜 주고 닫히면 돌아온다. 누르면 onClick
   */
  setStatus(status: { text: string; onClick: () => void } | null): void;
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
  /**
   * 설계도를 정면에서 그린 PNG data URL (만들기 창의 펫 그림과 같은 크기, 자르기). 펫 화면이 그린다.
   * 못 그리거나(입체를 못 씀) 창이 닫히거나 오래 걸리면 undefined
   */
  shot(model: Blueprint): Promise<string | undefined>;
  /** 가로로 x 까지 걷는다 (놀이). 끝까지 걸었으면 true */
  walkTo(x: number, speed?: number): Promise<boolean>;
  /** 산책: minutes 동안 바닥을 오간다 */
  stroll(minutes: number): Promise<boolean>;
  peekAt(x: number, y: number): void;
  comeBack(to: { x: number; y: number }): void;
  /** 깡충 뛰어 (x, y) 로 간다 (집에서 쉬기: 바닥이 아닌 곳에서 집 앞으로). 끝까지 뛰었으면 true */
  jumpTo(x: number, y: number): Promise<boolean>;
  /**
   * 집 문으로 들어간다 (집에서 쉬기): 문 쪽으로 걸어가며 to(문간 펫 그림과 같은 자리, shared/house-room.ts spriteToPet)
   * 크기로 줄어든다. 다 가면 handoff(집 창이 같은 자리에 펫 그림을 띄운다)를 기다린 뒤 숨는다(숨김 까닭 house).
   * 숨은 뒤 펫 자리는 문간에 선 원래 크기로 돌려 둔다. 끌리거나 하면 false (들어가지 않았다)
   */
  enterDoor(to: Rect, handoff: () => Promise<void>): Promise<boolean>;
  /**
   * 집 문에서 나온다: from(문간 펫 그림 자리)에 나타나 handoff(집 창 그림 거두기) 하고, stand 자리(문간)까지
   * 걸어 나오며 커진다. 다 나오면 기지개를 켜고 좋아한다. 숨김 까닭 house 를 끈다
   */
  leaveDoor(from: Rect, stand: { x: number; y: number }, handoff: () => void): Promise<void>;
  /** 문으로 걸어가며 줄던 것을 그만둔다 (가는 중에 불렀다). 그 자리에서 원래 크기로 돌아온다 */
  cancelDoor(): void;
  /** 펫 화면이 그려 준 집 안 그림 (깬 몸, 자는 얼굴). 아직 없으면 undefined */
  sprites(): HouseSprites | undefined;
  /**
   * 놀이: target() 이 주는 x(펫 사각형 왼쪽)로 계속 달린다 (레이저 쫓기, 술래잡기). 걷기와 같은 타이머라
   * 잡기, 숨기, 말풍선이 끊는다. ms 가 다 되면 true, 끊기면 false, signal 로 끝내면 true
   */
  follow(target: () => number | undefined, speed: number, ms: number, signal?: AbortSignal): Promise<boolean>;
  /** 창 위에 앉았거나 공중이면 바닥으로 떨어진다 (놀이 전에). 바닥에 서면 끝 */
  land(): Promise<void>;
  /** 걷기와 놀이 달리기, 산책을 멈춘다 (그만 놀기) */
  halt(): void;
  /** 사용자가 들고 있거나 던져져 나는 중 */
  held(): boolean;
  /** 효과음 하나 (설정과 펫 상태를 따른다) */
  sound(kind: SoundKind): void;
  /**
   * 두더지 잡기: 발밑(foot)을 붙잡고 구멍에서 ms 동안 솟는다(up) 또는 쏙 들어가 안 보인다. ms 가 0 이면 바로.
   * 처음 부르면 두더지 모드가 켜져 혼자 걷거나 몸짓하지 않는다 (unburrow 까지). 끌리면 false
   */
  burrow(foot: Point, up: boolean, ms: number): Promise<boolean>;
  /** 두더지 모드를 끝낸다: 원래 크기로 at(펫 왼쪽 위, 없으면 지금 발밑)에 보이게 */
  unburrow(at?: Point): void;
  /** 한가한지: 보이고, 들리거나 날거나 걷거나 앉으러 뛰거나 창 위에 앉아 있지 않고, 말풍선이 없다 (친구 놀이) */
  isIdle(): boolean;
  /** 친구와 만났다: 그쪽을 보고 하트 (친구 놀이) */
  greet(dir: -1 | 1): void;
  /** 오늘 놓친 알림 (최근 것이 위로) */
  missed(): MissedItem[];
  clearMissed(): void;
  /**
   * 같이 보기 돋보기 모션 (shared/look-motion.ts). 'aim' 은 영역 고르는 중(커서 쪽을 들여다본다, 다시 부르면 오버레이 위로),
   * found 는 찍은 뒤 그 자리를 보며 찾았다(FOUND_MS 뒤 저절로 끝), null 은 바로 끝. 친구 펫은 돋보기 없이 같은 쪽만 본다
   */
  look(state: 'aim' | { found: Point } | null): void;
  /** 화면을 찍는 동안 펫 창(말풍선 포함)을 안 보이게 한다. true 는 다 가린 뒤 끝난다. false 는 원래 불투명도로 다시 나타난다 */
  veil(on: boolean): Promise<void>;
  /** 화면이 알려 준 그리는 몸: 네 발로 걷는지, 흔들 꼬리가 있는지 (공 물어 오기). 알려 주기 전엔 둘 다 false */
  body(): PetBody;
  /**
   * 공을 입에 문다 (네 발 펫 공놀이, shared/fetch.ts): 고개를 숙여 at(공 가운데, 화면 좌표)에 있는 공을 물고,
   * 그 뒤로는 펫 화면이 입 자리에 공을 그린다. null 이면 내려놓았다 (그리기 끝)
   */
  carry(toy: CarryToy | null, at?: Point, size?: number): void;
  /** 지금 문 공 가운데 (화면 좌표). 화면이 답하지 않거나 안 물고 있으면 undefined */
  carriedAt(): Promise<Point | undefined>;
  /** ms 동안 기다린다. 그사이 잡히거나 던져지거나 숨거나 그만 놀기를 누르면 false */
  pause(ms: number): Promise<boolean>;
  /**
   * 키보드로 펫 다루기 (접근성, 펫 고르기 단축키): 펫 창이 키보드를 받아 Enter 패널, Shift+F10 메뉴, 화살표 걷기.
   * Esc 나 다른 창으로 가면 끝난다. 이미 켜져 있으면 끈다
   */
  keyboard(): void;
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
  /** 집에서 쉬는 중(숨김 까닭이 house 하나)에 말이 와서 모아 두었다. important 는 놓치면 안 되는 말(hold) */
  onRestHeld?: (kind: BubbleKind, important: boolean) => void;
  /** 운영체제 알림을 쓸 수 없을 때 트레이에 잠시 숨김 안내를 보인다 (이슈 #148) */
  onHideHint?: (message: string, shortMessage: string) => void;
  /** 미리 만든 창 (친구 펫을 기본 펫 화면 프로세스에서 연 것, openPetWindowIn). 없으면 새로 만든다 */
  win?: BrowserWindow;
  /**
   * 마우스를 늘 통과시키고(쓰다듬기, 끌기, 우클릭 메뉴가 없다) 자리를 저장하지 않는다. 놀러 온 친구 펫(#141, main/visitors.ts)이 쓴다:
   * 손님은 쓰는 사람의 입력을 받지도 가로채지도 않는다
   */
  ghost?: boolean;
}

/** 펫 창 옵션 (자리는 빼고). 기본 펫과 친구 펫, 미리 만드는 창이 같이 쓴다 */
function petWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: BASE_SIZE,
    height: BASE_SIZE,
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
  };
}

/** 모든 데스크톱에 보이게 걸어 둔 펫 창들 (기본 펫, 친구 펫). reassertSpaces 가 다시 건다 */
const spaceWins = new Set<BrowserWindow>();
/**
 * 펫을 다른 앱의 전체 화면 위에도 올릴지. 평소 false (다른 앱을 크게 쓰는 중에 펫이 가리면 안 된다, 2026-10-02).
 * 우리 큰 창이 전체 화면인 동안만 true (펫이 큰 창 위에서 같이 지낸다. 큰 창 설계 #159)
 */
let overFullScreen = false;

/**
 * 펫 창의 "모든 데스크톱, (전체 화면 위), 항상 위" 설정을 다시 건다. 맥 Dock 아이콘을 껐다 켜면(앱 종류가 바뀌면)
 * 이 설정이 풀리는지 확실치 않아, 바꾼 뒤 늘 다시 건다 (main/dock.ts). 앱 종류는 건드리지 않는다(KEEP_APP_TYPE).
 * over 를 주면 전체 화면 위 여부도 바꾼다
 */
export function reassertSpaces(over?: boolean): void {
  if (over !== undefined) overFullScreen = over;
  for (const w of spaceWins) {
    if (w.isDestroyed()) continue;
    w.setAlwaysOnTop(true, 'floating');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: overFullScreen, ...KEEP_APP_TYPE });
  }
}

/** 한 번에 하나씩 연다 (여는 동안 host 의 새 창 처리기를 잠깐 바꾼다) */
let opening: Promise<unknown> = Promise.resolve();

/**
 * 친구 펫 창을 host(기본 펫 화면)에서 window.open 으로 연다. 그러면 같은 렌더러 프로세스를 같이 써서 친구 하나에
 * 렌더러 하나(약 120MB RSS)가 늘지 않는다. host 화면이 아직 없으면 기다리고, 10초 안에 못 열면 undefined (따로 만든다).
 * 여는 동안만 host 의 새 창 처리기가 이 이름의 빈 창 하나를 받고, 끝나면 다시 모두 거절한다 (index.ts)
 */
export function openPetWindowIn(host: Electron.WebContents): Promise<BrowserWindow | undefined> {
  const run = opening.then(() => openIn(host));
  opening = run;
  return run;
}

function openIn(host: Electron.WebContents): Promise<BrowserWindow | undefined> {
  return new Promise((resolve) => {
    if (host.isDestroyed()) {
      resolve(undefined);
      return;
    }
    const name = `jj-friend-${randomUUID()}`;
    let settled = false;
    const done = (w: BrowserWindow | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      host.off('did-finish-load', go);
      if (!host.isDestroyed()) host.setWindowOpenHandler(() => ({ action: 'deny' }));
      resolve(w);
    };
    // 기본 펫 화면을 불러오는 중이면 다 불러올 때까지 기다린다 (켤 때)
    const timer = setTimeout(() => done(undefined), 10_000);
    function go() {
      if (settled || host.isDestroyed()) return;
      host.setWindowOpenHandler((d) => {
        if (settled || d.frameName !== name || d.url !== 'about:blank') return { action: 'deny' };
        return {
          action: 'allow',
          overrideBrowserWindowOptions: petWindowOptions(),
          createWindow: (options) => {
            const w = new BrowserWindow(options);
            done(w);
            return w.webContents;
          },
        };
      });
      host.executeJavaScript(`window.open('', ${JSON.stringify(name)}) !== null`, true).then(
        (ok) => {
          if (!ok) done(undefined);
        },
        () => done(undefined),
      );
    }
    // 켤 때는 화면이 아직 없다(주소가 비고 isCrashed 도 true). 죽었으면 다시 불러온 뒤에.
    // 불러오는 중(isLoading)이면 그냥 연다: did-finish-load 를 부르는 동안에도 true 라 기다리면 오지 않는다
    if (!host.getURL() || host.isCrashed()) host.once('did-finish-load', go);
    else go();
  });
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
  onRestHeld,
  onHideHint,
  win: prebuilt,
  ghost = false,
}: PetWindowOptions): PetWindow {
  const positionFile = id ? `${POSITION_FILE}-${id}` : POSITION_FILE;
  const saved = readJson(positionFile) ?? (initial ? { ...initial, scale: 1 } : undefined);
  let scale = parseSavedScale(saved);
  // 펫 사각형. 말풍선이 뜨면 창은 이보다 커지지만 펫은 화면에서 제자리에 있다.
  let pet: Rect = restorePetBounds(saved, currentDisplays(), Math.round(BASE_SIZE * scale));

  let bubbleAnchor: BubbleAnchor | undefined;
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
  const win = prebuilt ?? new BrowserWindow({ ...petWindowOptions(), ...pet });
  if (prebuilt) win.setBounds(pet);
  /** 지금 말풍선의 화면 사각형. 크기를 재기 전이면 어림 크기로 */
  const bubbleRect = (): Rect | undefined =>
    bubble && !bubble.ambient && !win.isDestroyed() && win.isVisible()
      ? bubbleRectOf(pet, bubble.size ?? BUBBLE_GUESS, screen.getDisplayMatching(pet).workArea, bubbleAnchor)
      : undefined;
  talkers.add(bubbleRect);
  /** 다른 펫의 떠 있는 말풍선과 겹칠 자리인지 */
  const clashing = () => {
    const others = [...talkers].filter((r) => r !== bubbleRect).map((r) => r());
    const list = others.filter((r): r is Rect => !!r);
    return (
      list.length > 0 &&
      bubbleClashes(pet, screen.getDisplayMatching(pet).workArea, list, BUBBLE_GUESS, bubbleAnchor)
    );
  };
  /** 다른 펫 말풍선이 닫혀 자리가 나면 true, 기다리다 끝나거나 그만두면 false */
  const waitForRoom = (until: number, signal?: AbortSignal): Promise<boolean> =>
    new Promise((resolve) => {
      const end = (room: boolean) => {
        clearTimeout(timer);
        roomWaiters.delete(check);
        signal?.removeEventListener('abort', abort);
        resolve(room);
      };
      const check = () => {
        if (!clashing()) end(true);
      };
      const abort = () => end(false);
      const timer = setTimeout(abort, Math.max(0, until - Date.now()));
      roomWaiters.add(check);
      signal?.addEventListener('abort', abort, { once: true });
    });
  // 펫 화면을 다 불러오면 할 일이 여럿이라(상태, 집, 친구, 쪽지, 알림 등) 켤 때 did-finish-load 듣개가 11개를 넘는다.
  // 켤 때 한 번 붙는 정해진 수라 새는 것이 아니다: 기본 상한 10 의 MaxListenersExceededWarning 이 기록마다 남지 않게
  win.webContents.setMaxListeners(30);
  win.setAlwaysOnTop(true, 'floating');
  // 모든 데스크톱(Space)에 보이되, 다른 앱의 전체 화면 위에는 올라가지 않는다.
  // (전체 화면 위에도 띄우면 다른 앱을 크게 쓰는 중에 펫이 가린다. 2026-10-02 사용자 지적)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: overFullScreen, ...KEEP_APP_TYPE });
  spaceWins.add(win);
  win.once('closed', () => spaceWins.delete(win));
  // 처음에는 모두 통과시킨다. 커서가 펫 위에 오면 화면이 알려 준다.
  win.setIgnoreMouseEvents(true, { forward: true });
  // 미리 만든 창은 빈 화면을 이미 그려 ready-to-show 가 지나갔을 수 있다: 펫 화면을 다 불러오면 보인다
  // 다 불러오기 전에 숨겼으면(숨긴 동안 온 친구 펫) 보이지 않는다
  const firstShow = () => {
    if (!win.isDestroyed() && !hideReasons.hidden) win.showInactive();
  };
  if (prebuilt) win.webContents.once('did-finish-load', firstShow);
  else win.once('ready-to-show', firstShow);

  const devUrl = devRendererUrl();
  if (devUrl) win.loadURL(`${devUrl}/pet.html`);
  else win.loadFile(join(import.meta.dirname, '../renderer/pet.html'));

  // 펫 화면(렌더러)이 죽으면 창은 남고 펫만 사라진다. 저절로 다시 불러온다. 1분 안에 네 번째로 죽으면
  // 원인이 그대로라 보고 멈춘다(기록만). 메뉴 막대나 우클릭의 새로고침이 세던 것을 지우고 다시 부른다
  const crashes = new CrashGuard();
  win.webContents.on('render-process-gone', (_e, d) => {
    if (win.isDestroyed() || d.reason === 'clean-exit') return;
    const next = crashes.crashed(Date.now());
    log('pet', 'render-process-gone', id ?? 'main', d.reason, d.exitCode, next);
    // 끌던 중에 죽으면 놓았다는 알림(drag-end)이 오지 않는다. 다시 부르지 않고 멈출 때도 커서를 따라가지 않게
    endDrag();
    if (next === 'reload') reload(false);
  });

  let dragTimer: NodeJS.Timeout | undefined;
  let saveTimer: NodeJS.Timeout | undefined;
  let overPet = false;
  /** 펫이 움직이거나 모양이 바뀔 때 부른다 (아래에서 채운다. 그 전에 부르는 배치는 아무것도 안 한다) */
  let recheckHover: () => boolean = () => false;
  let passWheelUntil = 0;
  let walkTimer: NodeJS.Timeout | undefined;
  /** 지금 떠 있는 말풍선. size 는 화면이 재서 알려 준 크기 */
  let bubble:
    | {
        id: string;
        size?: { width: number; height: number };
        done: (action: string) => void;
        /** 늘 떠 있는 상태 말풍선 (setStatus). 말하는 말풍선이 아니라서 걷기, 혼잣말, 모은 알림을 막지 않는다 */
        ambient?: { text: string };
      }
    | undefined;
  /** 꾹 눌러 커진 동안: 원래 사각형과 끝낼 타이머 (이슈 #124) */
  let peek:
    | { base: Rect; timer?: NodeJS.Timeout; guard: NodeJS.Timeout; calm: boolean; k: number }
    | undefined;
  /** 머리 위 상태 말풍선 (setStatus) */
  let status: { text: string; onClick: () => void } | undefined;
  let statusTimer: NodeJS.Timeout | undefined;

  const shortcuts: [string, () => void][] = [
    [SIZE_SHORTCUTS.bigger, () => resize(scaleByStep(scale, 1))],
    [SIZE_SHORTCUTS.smaller, () => resize(scaleByStep(scale, -1))],
    [SIZE_SHORTCUTS.reset, () => resize(1)],
  ];

  const fromThisWindow = (e: IpcMainEvent) => e.sender === win.webContents;
  /** 화면이 알려 준 크기(px)가 쓸 수 있는 수인지 */
  const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

  const onHover = (e: IpcMainEvent, over: unknown) => {
    if (!fromThisWindow(e) || ghost || typeof over !== 'boolean') return;
    overPet = over;
    setShortcuts(over);
    if (dragTimer || looking || Date.now() < passWheelUntil) return;
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

  // 마우스가 가만히 있는 채 펫이 걸어 비켜 가면 화면은 움직임을 못 받아 "펫 위" 표시가 남고, 투명한 창이 아래 패널의 클릭을 먹는다.
  // 펫이 움직이거나 모양이 바뀔 때(창 이동과 크기, 말풍선 변화) 커서를 다시 재서 펫과 말풍선 근처가 아니면 통과로 돌린다.
  recheckHover = createHoverGuard({
    isOver: () => overPet && !win.isDestroyed(),
    busy: () => Boolean(dragTimer) || Boolean(looking) || Date.now() < passWheelUntil,
    cursor: () => screen.getCursorScreenPoint(),
    pet: () => pet,
    // 화면이 펫 위로 치는 말풍선은 가벼운 안내(ambient)도 포함한다
    bubble: () =>
      bubble && win.isVisible()
        ? bubbleRectOf(
            pet,
            bubble.size ?? BUBBLE_GUESS,
            screen.getDisplayMatching(pet).workArea,
            bubbleAnchor,
          )
        : undefined,
    release: () => {
      overPet = false;
      setShortcuts(false);
      win.setIgnoreMouseEvents(true, { forward: true });
      win.webContents.send(IPC.hoverReset);
    },
  });
  win.on('move', recheckHover);
  win.on('resize', recheckHover);

  const onGesture = (e: IpcMainEvent, raw: unknown) => {
    if (!fromThisWindow(e) || !isGesture(raw)) return;
    const event = raw;
    if (event.type === 'down') {
      markPetPress();
      return;
    }
    log('pet', event.type);
    if (event.type === 'click') {
      actions.click(pet);
    } else if (event.type === 'double-click') {
      (actions.doubleClick ?? actions.click)(pet);
    } else if (event.type === 'drag-start') {
      if (looking) return;
      // 꾹 눌러 커진 채 움직이면 끌기다: 원래 크기로 돌려 놓고 그 크기로 잡는다 (이슈 #124)
      endPeek(true);
      actions.grabbed?.();
      // 들어 옮기는 동안은 말풍선을 치운다. 창 안 펫 자리가 바뀌므로 오프셋은 펫 기준으로 바꿔 둔다.
      const inWindow = win.getBounds();
      // petRelative: 꾹 눌러 커졌다 끌기로 바뀐 것. 화면이 펫 기준으로 알린다 (커지며 말풍선이 닫혀 창 안 자리가 바뀌었다)
      let offset = event.petRelative
        ? { x: event.offset.x, y: event.offset.y }
        : { x: event.offset.x - (pet.x - inWindow.x), y: event.offset.y - (pet.y - inWindow.y) };
      // 두더지 잡기 중 구멍 속 작은 펫을 끌면 원래 크기로 돌려 가운데를 잡는다 (놀이는 들림을 보고 끝난다)
      if (moleSize !== undefined) {
        unburrow();
        offset = { x: pet.width / 2, y: pet.height / 2 };
      }
      // 사용자가 말풍선을 누른 것(dismiss)과 구별한다. dismiss 는 "답 왔어"를 연다
      closeBubble('cleared');
      stopWalk();
      stopDoor();
      clearInterval(dragTimer);
      stopFlight();
      // 깡충 뛰던 중이면 멈춘다. 안 멈추면 끌리는 펫을 뛰던 자리로 잡아당기고, 다 뛰면 창 위에 앉은 것으로
      // 쳐서(perch) 끌어다 놓은 바닥에서도 돌아다니지 않았다
      stopHop();
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

  const onWheel = (e: IpcMainEvent, deltaY: unknown, zoom: unknown) => {
    if (!fromThisWindow(e) || typeof deltaY !== 'number' || !Number.isFinite(deltaY)) return;
    if (zoom === true) {
      resize(scaleByWheel(scale, deltaY));
      return;
    }
    // 창은 휠을 아래 앱에 넘겨줄 수 없다. 잠깐 마우스를 통과시켜 다음 휠부터 아래 앱이 받게 한다.
    passWheelUntil = Date.now() + WHEEL_PASS_MS;
    win.setIgnoreMouseEvents(true, { forward: true });
    setTimeout(() => {
      if (!win.isDestroyed() && !dragTimer && !looking) win.setIgnoreMouseEvents(!overPet, { forward: true });
    }, WHEEL_PASS_MS);
  };

  function resize(next: number) {
    endPeek(true);
    if (next === scale) return;
    scale = next;
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const before = pet.x;
    pet = clampIntoAreas(resizeFromBottomCenter(pet, BASE_SIZE * scale), areas);
    // 걷던 중이면 걷기 기준도 같이 옮긴다. 안 하면 다음 틱에 옛 기준으로 돌아가 펫이 옆으로 튀었다
    if (walkTimer) walkFrom += pet.x - before;
    applyLayout();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  function save() {
    clearTimeout(saveTimer);
    if (ghost) return;
    const { x, y } = peek?.base ?? pet;
    // 휠은 반올림 안 한 작업 배율로 굴린다(size.ts scaleByWheel). 저장은 0.01 단위로
    const kept = { x, y, scale: clampScale(scale) };
    writeJson(positionFile, kept);
    log('pet', 'saved', JSON.stringify(kept));
  }

  const onContextMenu = (e: IpcMainEvent) => {
    if (fromThisWindow(e)) showMenu();
  };

  /** 우클릭 메뉴. 키보드로 열면(Shift+F10, 메뉴 키) at 에 (창 안 좌표, 펫 가운데) */
  function showMenu(at?: { x: number; y: number }) {
    log('pet', 'context-menu');
    const where = at ? { window: win, ...at } : { window: win };
    if (menu) {
      Menu.buildFromTemplate(menu()).popup(where);
      return;
    }
    const note = actions.menuNote?.();
    Menu.buildFromTemplate([
      ...(note ? [{ label: note, enabled: false }, { type: 'separator' as const }] : []),
      // 자주 하는 작업을 맨 위에 둔다.
      {
        label: t('pet.menu.addTodo'),
        accelerator: quickAddShortcut() || undefined,
        click: () => actions.quickAdd(),
      },
      {
        label: actions.focusRunning()
          ? t('pet.menu.focusStop')
          : t('pet.menu.focusStart', { n: settings.get().focusMin }),
        click: () => actions.toggleFocus(),
      },
      { label: t('pet.menu.feed'), click: () => actions.feed() },
      ...(actions.addNote ? [{ label: t('pet.menu.addNote'), click: () => actions.addNote?.() }] : []),
      ...(actions.openPanel
        ? [
            {
              label: t('pet.menu.openPanel'),
              accelerator: settings.get().shortcuts.panel || undefined,
              click: () => actions.openPanel?.(),
            },
          ]
        : []),
      { type: 'separator' },
      {
        label: t('pet.menu.chat', { name: petName() }),
        accelerator: settings.get().shortcuts.chat || undefined,
        click: () => actions.openChat(pet),
      },
      {
        label: t('pet.menu.look', { name: petName() }),
        accelerator: settings.get().shortcuts.look || undefined,
        click: () => actions.lookTogether(),
      },
      ...(actions.openHome
        ? [
            {
              label: t('pet.menu.openHome'),
              accelerator: settings.get().shortcuts.home || undefined,
              click: () => actions.openHome?.(),
            },
          ]
        : []),
      ...(actions.openMailbox
        ? [
            {
              label: t('pet.menu.mail', { n: actions.mailUnread?.() ?? 0 }),
              click: () => actions.openMailbox?.(),
            },
          ]
        : []),
      { label: t('pet.menu.play'), submenu: playMenu() },
      { type: 'separator' },
      {
        label: t('pet.menu.hide', { name: petName() }),
        accelerator: hideShortcut() || undefined,
        click: () => setHidden('user', true),
      },
      { label: t('pet.menu.settings'), click: () => actions.openSettings() },
      { type: 'separator' },
      {
        label: t('pet.menu.more'),
        submenu: [
          ...(actions.whatFirst ? [{ label: t('first.menu'), click: () => actions.whatFirst?.() }] : []),
          ...(actions.askChips && settings.get().petChips
            ? [{ label: t('chips.menu'), click: () => actions.askChips?.() }]
            : []),
          { label: t('pet.menu.makePet'), click: () => actions.makePet() },
          ...(actions.openKnows
            ? [{ label: t('bond.menu.knows', { name: petName() }), click: () => actions.openKnows?.() }]
            : []),
          ...houseMenu(),
          { type: 'separator' },
          {
            label: t('pet.menu.bubbles'),
            submenu: (['quiet', 'normal', 'sometimes', 'chatty'] as const).map((level) => ({
              label: LEVEL_LABEL[level],
              type: 'radio' as const,
              checked: gate.level === level,
              click: () => setChatter(level),
            })),
          },
          // 배터리일 때 움직임 줄이기 (사용자 요청 2026-10-11: 바로 끄고 켤 수 있게). 켜면 자동, 끄면 끄기
          {
            label: t('pet.menu.saver'),
            type: 'checkbox',
            checked: settings.get().batterySaver !== 'off',
            click: (item) => settings.set({ batterySaver: item.checked ? 'auto' : 'off' }),
          },
          // 같이 타자 치기 (shared/together.ts): 키 내용은 읽지 않고 입력이 있는지만 본다
          {
            label: t('pet.menu.typeAlong'),
            type: 'checkbox',
            checked: settings.get().typeAlong,
            click: (item) => settings.set({ typeAlong: item.checked }),
          },
          ...(actions.visitItems?.() ?? []),
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
        ],
      },
      { type: 'separator' },
      { label: t('pet.menu.quit'), role: 'quit' },
    ]).popup(where);
  }

  /** 집 숨기기, 다시 보이기 한 줄 (집이 있을 때만) */
  function houseMenu(): Electron.MenuItemConstructorOptions[] {
    const item = actions.houseItem?.();
    return item ? [item] : [];
  }

  /** 놀기 하위 메뉴. 노는 중이면 맨 위에 "그만 놀기", 다른 놀이는 흐리게 */
  function playMenu(): Electron.MenuItemConstructorOptions[] {
    const busy = !!actions.playing?.();
    const mate = busy ? undefined : actions.playmate?.();
    const item = (label: string, kind: PlayKind) => ({
      label,
      enabled: !busy,
      click: () => actions.play(kind),
    });
    return [
      ...(busy
        ? [{ label: t('play.menu.stop'), click: () => actions.stopPlay?.() }, { type: 'separator' as const }]
        : []),
      item(t('pet.menu.walk'), 'walk'),
      item(t('pet.menu.seek'), 'seek'),
      actions.toy()
        ? item(t('pet.menu.throwToy', { toy: actions.toy() ?? '' }), 'ball')
        : { label: t('pet.menu.throwNoBall'), enabled: !busy, click: () => actions.openShop() },
      { type: 'separator' },
      item(t('play.menu.bubbles'), 'bubbles'),
      item(t('play.menu.laser'), 'laser'),
      item(t('play.menu.treats'), 'treats'),
      item(t('play.menu.rps'), 'rps'),
      item(t('play.menu.mole'), 'mole'),
      ...(mate ? [item(t('play.menu.tag', { name: mate }), 'tag')] : []),
      { type: 'separator' },
      // 웃게 하기 (shared/fun.ts): AI 없이. 끝말잇기는 채팅 창에서 해서 노는 중이어도 열 수 있다
      item(t('fun.menu.joke'), 'joke'),
      item(t('fun.menu.five'), 'highfive'),
      { label: t('fun.menu.chain'), click: () => actions.play('wordchain') },
      { type: 'separator' },
      { label: t('pet.menu.shop'), click: () => actions.openShop() },
    ];
  }

  /** 펫 화면만 다시 불러온다 (그림이 이상하거나 멈췄을 때). 떠 있던 말풍선은 닫고, 상태와 그림은 불러온 뒤 다시 보낸다 */
  function reload(byUser = true) {
    if (win.isDestroyed()) return;
    log('pet', 'reload');
    // 사용자가 직접 부르면 화면이 죽은 횟수를 다시 센다 (자동으로 멈춘 뒤 살리는 길)
    if (byUser) crashes.reset();
    closeBubble('cleared');
    endDrag();
    win.webContents.reload();
  }

  /** 화면이 drag-end 를 못 보낸 채 사라질 때(새로고침, 죽음) 끌기를 끝낸다: 놓은 자리에 둔다 */
  function endDrag() {
    if (!dragTimer) return;
    clearInterval(dragTimer);
    dragTimer = undefined;
    keepOnScreen();
    save();
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
    const layout = layoutBubble(pet, bubble?.size, area, bubbleAnchor);
    const now = win.getBounds();
    const w = layout.window;
    if (now.x !== w.x || now.y !== w.y || now.width !== w.width || now.height !== w.height) win.setBounds(w);
    win.webContents.send(IPC.layout, layout);
    recheckHover();
  }

  function setChatter(level: ChatterLevel) {
    settings.set({ chatter: level });
    log('pet', 'chatter', level);
  }

  // ---- 기본 행동 (P1-06) ----
  // 화면이 한가하다고 알리면 행동을 고른다. 걷기는 창을 30fps 로 옮기고 끝나면 자리를 저장한다.
  /** 최근에 한 제자리 몸짓 (같은 몸짓이 연달아 나오지 않게, shared/moves.ts) */
  let moveHistory: MoveHistory = { at: {} };
  const onActivityRequest = (e: IpcMainEvent, ask?: unknown) => {
    if (
      !fromThisWindow(e) ||
      screenLocked ||
      looking ||
      dragTimer ||
      flightTimer ||
      hopTimer ||
      doorTimer ||
      moleSize !== undefined ||
      (bubble && !bubble.ambient) ||
      peek ||
      walkTimer ||
      carrying ||
      !win.isVisible() ||
      !settings.get().wander
    )
      return;
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const area = screen.getDisplayMatching(pet).workArea;
    // 가끔 다른 앱 창 윗변으로 깡충 올라간다. 이미 앉아 있으면 걷지 않는다 (걸으면 떨어지니까).
    // 배터리 절약이면 덜 올라간다 (창 목록 읽기가 비싸다)
    const perchChance = PERCH_CHANCE * (saverNow() ? SAVER.perchChance : 1);
    // 운영체제 동작 줄이기: 창 위로 뛰어오르지도, 화면을 가로질러 걷지도 않는다 (제자리 몸짓만)
    const calm = motionCalm();
    if (!calm && !perch && Math.random() < perchChance && tryPerch()) return;
    const now = Date.now();
    let activity: Activity = pickActivity(pet, area, Math.random, areas, {
      ask: moveAskOf(ask),
      recent: moveHistory,
      now,
      hour: new Date(now).getHours(),
      perched: !!perch,
    });
    if ((perch || calm) && activity.type === 'walk') activity = { type: 'sit', ms: 12_000 };
    if (activity.type === 'walk') activity = { ...activity, idle: true };
    if (isMove(activity.type)) moveHistory = rememberMove(moveHistory, activity.type, now);
    if (activity.type === 'walk') startWalk(activity);
    win.webContents.send(IPC.activity, activity);
  };

  const onActivityStop = (e: IpcMainEvent) => {
    if (fromThisWindow(e)) stopWalk();
  };

  const onPetted = (e: IpcMainEvent) => {
    if (fromThisWindow(e)) actions.petted();
  };

  // ---- 공 물어 오기 (shared/fetch.ts) ----
  let body: PetBody = { quad: false, tail: false };
  /** 공을 물고 있다 (그사이 한가한 행동을 고르지 않는다) */
  let carrying = false;
  /** 문 공 자리를 물어보고 기다리는 중 */
  let carriedWait: ((at: Point | null) => void) | undefined;
  const onBody = (e: IpcMainEvent, raw: unknown) => {
    if (!fromThisWindow(e) || typeof raw !== 'object' || raw === null) return;
    const r = raw as Record<string, unknown>;
    body = { quad: r.quad === true, tail: r.tail === true };
  };
  /** 집 안 그림 (집에서 쉬기). 내 펫 화면만 보낸다 (PetStatus.face) */
  let sprites: HouseSprites | undefined;
  const onSprites = (e: IpcMainEvent, raw: unknown) => {
    if (!fromThisWindow(e)) return;
    const got = parseSprites(raw);
    if (got) sprites = got;
    else log('pet', '집 안 그림 거절');
  };
  const onCarried = (e: IpcMainEvent, raw: unknown) => {
    if (!fromThisWindow(e)) return;
    const r = raw as Partial<Point> | null;
    const ok = !!r && Number.isFinite(r.x) && Number.isFinite(r.y);
    carriedWait?.(ok ? { x: r.x as number, y: r.y as number } : null);
  };

  function carry(toy: CarryToy | null, at?: Point, size = 0) {
    carrying = toy !== null && !!at;
    if (win.isDestroyed()) return;
    win.webContents.send(
      IPC.carry,
      toy && at ? { kind: 'pick', toy, from: toBox(at, pet), size: size / pet.width } : null,
    );
  }

  function carriedAt(): Promise<Point | undefined> {
    if (!carrying || win.isDestroyed()) return Promise.resolve(undefined);
    carriedWait?.(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), 400);
      const done = (at: Point | null) => {
        clearTimeout(timer);
        carriedWait = undefined;
        resolve(at ? fromBox(at, pet) : undefined);
      };
      carriedWait = done;
      win.webContents.send(IPC.carry, { kind: 'where' });
    });
  }

  function pause(ms: number): Promise<boolean> {
    const from = Date.now();
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const cut = haltedAt >= from || !!dragTimer || !!flightTimer || win.isDestroyed() || !win.isVisible();
        if (!cut && Date.now() - from < ms) return;
        clearInterval(timer);
        resolve(!cut);
      }, 30);
    });
  }

  /** 걷기가 끝나거나 끊기면 알린다 (walkTo). 끝까지 걸었으면 true */
  let walkDone: ((finished: boolean) => void) | undefined;

  /** 걷기 시작 자리. 걷는 중에 크기를 바꾸면(휠, 단축키) 바뀐 자리만큼 같이 옮긴다 (resize) */
  let walkFrom = 0;

  function startWalk(walk: Extract<Activity, { type: 'walk' }>) {
    endPeek(true);
    walkFrom = pet.x;
    const started = Date.now();
    // 걸을 수 있는 가로 범위 (맞붙은 옆 모니터까지, shared/behavior.ts)
    const span = walkSpan(
      pet,
      screen.getDisplayMatching(pet).workArea,
      screen.getAllDisplays().map((d) => d.workArea),
    );
    walkTimer = setInterval(
      () => {
        const t = (Date.now() - started) / walk.ms;
        // 걷는 중에 커지면 처음 고른 거리만큼 가다 화면 밖으로 나갔다(300% 에서 300px 넘게). 범위 안에서 멈춘다
        const x = clampWalkX(walkFrom + walkOffset(walk.dx, t), pet.width, span);
        // 걷기 CPU 의 절반이 창 옮기기다. 픽셀이 그대로인 틱(출발, 멈춤 감속)은 옮기지 않는다
        // 창 좌표는 정수만 받는다. 소수를 담아 두면 다음 setPosition(산책 등)이 던졌다
        const moved = Math.round(x) !== pet.x;
        pet = snapRect({ ...pet, x });
        if (moved && !win.isDestroyed()) win.setPosition(pet.x, pet.y);
        if (t >= 1) stopWalk(true);
        // 부스트 모드면 60Hz 로 옮긴다 (빨리 걸을 때 한 번에 2~4px 씩 뛰던 것이 1~2px 로). 배터리 절약이면 15Hz
      },
      walkTickMs(saverNow(), boostOn()),
    );
  }

  /** 가로로 x 까지 걷는다 (v1 놀이). speed 는 px/초. 끊기면(잡기, 숨기, 말풍선) false */
  function walkTo(x: number, speed = WALK_SPEED * 3): Promise<boolean> {
    stopWalk();
    const dx = Math.round(x - pet.x);
    if (Math.abs(dx) < 4 || win.isDestroyed() || !win.isVisible()) return Promise.resolve(true);
    // 운영체제 동작 줄이기: 걷지 않고 바로 그 자리에 선다
    if (motionCalm()) {
      pet = snapRect({ ...pet, x: Math.round(x) });
      win.setPosition(pet.x, pet.y);
      return Promise.resolve(true);
    }
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
    pet = snapRect({ ...pet, y: area.y + area.height - pet.height });
    if (!win.isDestroyed()) win.setPosition(pet.x, pet.y);
    let toRight = pet.x + pet.width / 2 < area.x + area.width / 2;
    while (Date.now() < end) {
      const a = screen.getDisplayMatching(pet).workArea;
      const target = toRight ? a.x + a.width - pet.width - 10 : a.x + 10;
      if (!(await walkTo(target, WALK_SPEED * 1.5))) return false;
      toRight = !toRight;
      await new Promise((r) => setTimeout(r, 1500));
      // 쉬는 사이에 그만 놀기를 눌렀으면 (halt)
      if (haltedAt >= end - minutes * 60_000) return false;
    }
    return true;
  }

  /** 그만 놀기를 누른 때 (산책이 쉬는 사이에 눌러도 멈추게) */
  let haltedAt = 0;

  /** 놀이: 커서나 친구 쪽으로 계속 달린다 (PetWindow.follow) */
  function follow(
    target: () => number | undefined,
    speed: number,
    ms: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    stopWalk();
    if (win.isDestroyed() || !win.isVisible() || dragTimer || flightTimer || signal?.aborted)
      return Promise.resolve(!!signal?.aborted);
    leavePerch();
    const started = Date.now();
    let last = started;
    /** 화면에 알린 방향 (0 이면 서 있음) */
    let dir: -1 | 0 | 1 = 0;
    let face: -1 | 1 = 1;
    let sentAt = 0;
    let area = screen.getDisplayMatching(pet).workArea;
    let areaAt = started;
    /** 느리게 달리면 틱마다 1px 이 안 된다. 소수는 여기에만 쌓고 pet 에는 정수를 담는다 */
    let fx = pet.x;
    const onAbort = () => stopWalk(true);
    signal?.addEventListener('abort', onAbort, { once: true });
    return new Promise((resolve) => {
      walkDone = (finished) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(finished);
      };
      walkTimer = setInterval(
        () => {
          const now = Date.now();
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          if (now - started >= ms) return stopWalk(true);
          // 화면 영역은 0.5초마다만 다시 읽는다 (틱마다 읽으면 그것만으로 CPU 를 먹는다)
          if (now - areaAt > 500) {
            area = screen.getDisplayMatching(pet).workArea;
            areaAt = now;
          }
          const want = target();
          const tx =
            want === undefined ? pet.x : Math.max(area.x, Math.min(area.x + area.width - pet.width, want));
          const dx = tx - pet.x;
          const next: -1 | 0 | 1 = Math.abs(dx) < 3 ? 0 : dx < 0 ? -1 : 1;
          if (next !== 0) {
            if (Math.round(fx) !== pet.x) fx = pet.x;
            fx += next * Math.min(Math.abs(tx - fx), speed * dt);
            const moved = Math.round(fx) !== pet.x;
            pet = snapRect({ ...pet, x: fx });
            if (moved && !win.isDestroyed()) win.setPosition(pet.x, pet.y);
            face = next;
          }
          // 걷는 모습: 방향이 바뀌거나 서거나 출발할 때, 걷는 중에는 1040ms 마다 이어 붙인다. 화면은 같은 쪽 걷기를 이어 받으면
          // 돌아서기와 걸음을 처음부터 하지 않고 잇는다 (pet.ts). 실제 빠르기를 보내 걸음이 간 거리에 맞는다 (walk-pace.ts)
          if (next !== dir || (next !== 0 && now - sentAt >= 1040)) {
            sentAt = now;
            dir = next;
            if (!win.isDestroyed())
              win.webContents.send(
                IPC.activity,
                next === 0
                  ? { type: 'look', dir: face, ms: 1200 }
                  : { type: 'walk', dx: next * Math.max(1, Math.round(speed * 1.4)), ms: 1400, linear: true },
              );
          }
        },
        followTickMs(saverNow(), boostOn()),
      );
    });
  }

  /** 바닥에 서 있지 않으면 떨어진다 (PetWindow.land) */
  async function land(): Promise<void> {
    if (win.isDestroyed()) return;
    const area = screen.getDisplayMatching(pet).workArea;
    const floor = area.y + area.height;
    if (!perch && Math.abs(pet.y + pet.height - floor) <= 4 && !flightTimer) return;
    stopWalk();
    leavePerch();
    if (!flightTimer) startFlight(0, 0);
    const until = Date.now() + FLIGHT_MAX_MS + 500;
    while (flightTimer && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  }

  // ---- 창 위에 올라앉기 (v1) ----
  let perch: Rect | undefined;
  let perchTimer: NodeJS.Timeout | undefined;
  let hopTimer: NodeJS.Timeout | undefined;
  /** 깡충 뛰기가 끝나거나 끊기면 알린다 (jumpTo, 올라앉기). 끝까지 뛰었으면 true */
  let hopDone: ((finished: boolean) => void) | undefined;

  /** 앉을 창이 있으면 깡충 뛰어 올라간다. 올라가면 true */
  function tryPerch(): boolean {
    const list = windowLister(log);
    if (!list) return false;
    const spot = pickPerch(pet, list(), screen.getDisplayMatching(pet).workArea);
    if (!spot) return false;
    log('pet', 'perch', JSON.stringify(spot.win));
    hopTo({ x: spot.x, y: spot.y }, (finished) => {
      if (!finished) return;
      perch = spot.win;
      clearInterval(perchTimer);
      // 1초마다(배터리 절약이면 3초마다) 창이 그대로인지 본다. 옮기거나 닫으면 떨어진다.
      perchTimer = setInterval(() => {
        if (perch && !perchHolds(perch, list())) {
          log('pet', 'perch lost');
          leavePerch();
          startFlight(0, 0);
        }
      }, perchPollMs(saverNow()));
    });
    return true;
  }

  function leavePerch() {
    perch = undefined;
    clearInterval(perchTimer);
    perchTimer = undefined;
  }

  /** 깡충 뛰기를 그만둔다 (끌기). 기다리던 쪽에는 끊긴 것으로 알린다 */
  function stopHop() {
    if (!hopTimer) return;
    clearInterval(hopTimer);
    hopTimer = undefined;
    const end = hopDone;
    hopDone = undefined;
    end?.(false);
  }

  function hopTo(to: { x: number; y: number }, done: (finished: boolean) => void) {
    endPeek(true);
    clearInterval(hopTimer);
    // 뛰던 중에 다시 뛰면 앞 것은 끊긴 것으로 알린다 (기다리던 쪽이 멈추지 않게)
    const before = hopDone;
    hopDone = done;
    before?.(false);
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
        const end = hopDone;
        hopDone = undefined;
        end?.(true);
      }
    }, 16);
  }

  // ---- 던지기 (v1) ----
  let samples: { t: number; x: number; y: number }[] = [];
  let flightTimer: NodeJS.Timeout | undefined;

  function startFlight(vx0: number, vy0: number) {
    endPeek(true);
    let vx = Math.max(-THROW_MAX_SPEED, Math.min(THROW_MAX_SPEED, vx0));
    let vy = Math.max(-THROW_MAX_SPEED, Math.min(THROW_MAX_SPEED, vy0));
    let x = pet.x;
    let y = pet.y;
    let last = Date.now();
    const started = last;
    log('pet', 'throw', Math.round(vx), Math.round(vy));
    win.webContents.send(IPC.flight, true);
    // 날던 중에 다시 던지면 앞의 타이머를 멈춘다. 그대로 두면 stopFlight 가 뒤의 것만 멈춰 앞의 것이
    // 끝없이 돌며 펫을 그 자리에 붙잡았다 (걷기, 옮기기가 되돌려졌다)
    clearInterval(flightTimer);
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
      const before = { vx, vy };
      const step = bounce(
        { x, y, vx, vy },
        pet.width,
        pet.height,
        area,
        screen.getAllDisplays().map((d) => d.workArea),
      );
      ({ x, y, vx, vy } = step);
      // 부딪히면 펫 화면이 그쪽으로 잠깐 눌렸다 돌아온다 (사진, 만든 펫)
      const hit = bounceHit(before, step);
      if (hit && !win.isDestroyed()) win.webContents.send(IPC.impact, hit);
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
    // 이 말풍선이 닫히기를 기다리던 다른 펫의 말 (이슈 #65)
    roomMaybe();
    if (!current.ambient) statusSoon();
  }

  // ---- 머리 위 상태 말풍선 (진행 중, 집중 남은 시간, 이슈 #124) ----
  // 말풍선 자리 하나를 다른 말과 나눠 쓴다: 말하는 말풍선이 뜨면 비켜 주고, 닫히거나 끌기, 걷기, 숨기기가 끝나면 돌아온다.
  function statusBlocked(): boolean {
    return (
      win.isDestroyed() ||
      !win.isVisible() ||
      hideReasons.hidden ||
      screenLocked ||
      !!dragTimer ||
      !!flightTimer ||
      !!hopTimer ||
      !!doorTimer ||
      moleSize !== undefined ||
      !!looking ||
      !!peek
    );
  }

  function showStatus() {
    if (win.isDestroyed()) return;
    if (!status) {
      if (bubble?.ambient) closeBubble('status-off');
      return;
    }
    // 말하는 말풍선이 먼저
    if (bubble && !bubble.ambient) return;
    if (statusBlocked()) return;
    if (bubble?.ambient?.text === status.text) return;
    const keep = bubble?.size;
    const text = status.text;
    const id = `s${Date.now().toString(36)}${(++bubbleSeq).toString(36)}`;
    bubble = {
      id,
      ...(keep ? { size: keep } : {}),
      ambient: { text },
      done: (action) => {
        if (action !== 'dismiss') return;
        // 누르면 할 일 탭. 눌러서 사라진 말풍선은 잠시 뒤 돌아온다
        status?.onClick();
        statusSoon(900);
      },
    };
    win.webContents.send(IPC.bubble, { id, text, buttons: [], ttlMs: 0, kind: 'system', ambient: true });
  }

  /** 잠시 뒤 상태 말풍선을 다시 본다 (말하던 말풍선이 막 닫혔을 때 바로 겹쳐 깜빡이지 않게) */
  function statusSoon(ms = 700) {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(showStatus, ms);
    statusTimer.unref?.();
  }

  // ---- 꾹 눌러 커지기 (이슈 #124) ----
  // 펫을 가만히 누르고 있으면(화면이 0.5초 뒤 알려 준다) 펫 창이 아래 가운데를 기준으로 커졌다가 놓으면 돌아온다.
  // 짧게 누르면 그대로 클릭(패널), 누른 채 움직이면 끌기: 둘 다 이 보기와 겹치지 않는다.
  // 움직임 줄이기(calm)면 부드럽게 키우지 않고 바로 바꾼다. 저장하는 자리와 크기는 그대로(save 는 원래 사각형)
  const PEEK_SCALE = 1.4;
  const PEEK_EASE_MS = 160;
  /** 놓는 신호가 안 와도 이만큼 지나면 돌린다 */
  const PEEK_MAX_MS = 8000;
  const easeOut = (u: number) => 1 - (1 - u) ** 3;

  function peekRect(base: Rect, k: number): Rect {
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    return clampIntoAreas(resizeFromBottomCenter(base, Math.round(base.width * k)), areas);
  }

  /** 지금 키울 수 있는 때인지 */
  function peekReady(): boolean {
    return (
      settings.get().clickGrow &&
      !peek &&
      !win.isDestroyed() &&
      win.isVisible() &&
      !hideReasons.hidden &&
      !screenLocked &&
      !dragTimer &&
      !flightTimer &&
      !hopTimer &&
      !doorTimer &&
      !perchTimer &&
      !carrying &&
      moleSize === undefined &&
      !looking
    );
  }

  function animatePeek(from: number, to: number, ms: number, done?: () => void) {
    const state = peek;
    if (!state) return;
    clearInterval(state.timer);
    const start = Date.now();
    state.timer = setInterval(() => {
      if (peek !== state || win.isDestroyed()) return;
      const u = Math.min(1, (Date.now() - start) / ms);
      state.k = from + (to - from) * easeOut(u);
      pet = peekRect(state.base, state.k);
      applyLayout();
      if (u >= 1) {
        clearInterval(state.timer);
        state.timer = undefined;
        done?.();
      }
    }, 16);
  }

  function startPeek(calm: boolean): boolean {
    if (!peekReady()) return false;
    stopWalk();
    const base = { ...pet };
    const state = {
      base,
      calm,
      k: 1,
      guard: setTimeout(() => endPeek(false), PEEK_MAX_MS),
    };
    peek = state;
    log('pet', 'peek', calm ? 'calm' : 'ease');
    if (calm) {
      state.k = PEEK_SCALE;
      pet = peekRect(base, PEEK_SCALE);
      applyLayout();
    } else animatePeek(1, PEEK_SCALE, PEEK_EASE_MS);
    return true;
  }

  /** 원래 크기로. instant 면 바로 (끌기 시작, 숨기기). 아니면 부드럽게 (움직임 줄이기면 바로) */
  function endPeek(instant: boolean) {
    const state = peek;
    if (!state) return;
    clearTimeout(state.guard);
    clearInterval(state.timer);
    state.timer = undefined;
    const restore = () => {
      if (peek !== state) return;
      peek = undefined;
      pet = { ...state.base };
      if (!win.isDestroyed()) keepOnScreen();
      statusSoon(500);
    };
    if (instant || state.calm || win.isDestroyed()) {
      restore();
      return;
    }
    animatePeek(state.k, 1, PEEK_EASE_MS, restore);
  }

  // invoke 길은 채널 하나에 처리기 하나만 걸 수 있어, 펫 창(친구 펫 포함)마다 걸지 못한다. 창 번호로 나눠 준다
  const peekKey = win.webContents.id;
  peekHandlers.set(peekKey, (on, calm) => {
    if (on) return startPeek(calm);
    endPeek(false);
    return false;
  });
  registerPeekHandler();

  /**
   * 숨기기는 바로 한다 (예전엔 말풍선 안내 2.5초를 보이고 숨어 굼떴고, 그사이 또 누르면 두 번 숨었다).
   * 다시 부르는 법은 운영체제 알림으로 알린다. 알림을 끈 경우엔 첫 숨김에 트레이에서 한 번 안내한다.
   * 단축키를 꺼 두었어도 앱을 다시 열면 돌아오니 안내는 나온다 (hide-hint.ts)
   */
  function hideWithHint() {
    const shown = settings.get().hideHints;
    setHidden('user', true, false);
    const accel = hideShortcut();
    const keys = accel ? acceleratorLabel(accel, process.platform === 'darwin').join('+') : '';
    const delivery = hideHintDelivery(shown, settings.get().osNotify, Notification.isSupported());
    if (delivery === 'none') return;
    const hint = hideHintFor({
      shown,
      keys,
      // 안내 문구 생성과 전달 경로를 나눈다.
      osNotify: true,
      supported: true,
    });
    if (!hint) return;
    const body = hint.key === 'pet.hideHint' ? voiced(hint.key, { keys: hint.keys }) : voiced(hint.key);
    if (delivery === 'notification') {
      settings.set({ hideHints: shown + 1 });
      new Notification({ title: petName(), body, silent: true }).show();
      return;
    }
    settings.set({ hideHints: 1 });
    onHideHint?.(body, keys ? t('tray.hiddenKeys', { keys }) : t('tray.hiddenNoKey'));
  }

  function setHidden(reason: HideReason, on: boolean, hint = true) {
    if (reason === 'user' && on && hint && !hideReasons.has('user')) {
      hideWithHint();
      return;
    }
    if (win.isDestroyed() || !hideReasons.set(reason, on)) return;
    log('pet', hideReasons.hidden ? 'hidden' : 'shown', reason);
    if (hideReasons.hidden) {
      endPeek(true);
      closeBubble('cleared');
      stopWalk();
      stopHop();
      leavePerch();
      // 커서가 펫 위에 있던 채로 숨으면 hover 끝 알림이 안 와 전역 크기 단축키가 남는다
      overPet = false;
      setShortcuts(false);
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
    for (const e of missedEntries(h)) missed.add({ ...e, at: h.at });
    if (!id) writeJson(MISSED_FILE, missed.items);
    onMissed?.();
  }

  function keep(items: readonly HeldBubble[]) {
    for (const h of items) for (const out of held.hold(h)) addMissed(out);
  }

  /** 띄운 시스템 알림 (가비지 수집되면 눌러도 click 이 안 온다. 닫히거나 누르면 뺀다) */
  const notices = new Set<Notification>();
  /**
   * 펫이 안 보이는 곳에 있을 때 일정 알림을 운영체제 알림으로 한 번 (osNotifyFor). h 에 알렸다고 적는다.
   * 누르면 말풍선 단추와 같은 일(회의 열기, 할 일 보기)을 하고, 모아 둔 것을 꺼내 본다.
   * 끄는 중(끌기)은 사용자가 펫을 들고 있는 것이고, 집에서 쉬는 중이면 펫이 나와서 말하니(tellResting) 돌리지 않는다
   */
  function osNotify(h: HeldBubble, action: string | undefined) {
    if (!h.osNotify) return;
    const notify = osNotifyFor({
      kind: h.kind,
      blocked: blocked() && !dragTimer && !resting(),
      // 말풍선 쪽 20초가 아니라 더 길게 본다 (전체 화면으로 영상을 보는 사람도 자리에 있다)
      away: powerMonitor.getSystemIdleTime() >= OS_AWAY_SEC,
      locked: screenLocked,
      presenting: hideReasons.has('presentation'),
      setting: settings.get().osNotify,
      alreadyNotified: !!h.osNotified,
      action,
    });
    if (!notify || !Notification.isSupported()) return;
    h.osNotified = true;
    const lines = h.render?.(Date.now()) ?? h.lines ?? [h.text];
    // 미루기 단추 (맥, 윈도우만 단추를 단다. 리눅스는 누르면 오늘 탭에서 고른다)
    const actions = process.platform === 'darwin' || process.platform === 'win32' ? (h.osActions ?? []) : [];
    const n = new Notification({
      title: petName(),
      body: lines.join('\n'),
      silent: false,
      ...(actions.length
        ? { actions: actions.map((a) => ({ type: 'button' as const, text: a.label })) }
        : {}),
    });
    const click = osClickAction(h.buttons);
    notices.add(n);
    n.on('action', (ev) => {
      const picked = actions[ev.actionIndex];
      notices.delete(n);
      if (!picked) return;
      log('bubble', 'os-notice action', picked.id);
      held.remove(h);
      h.onAction?.(picked.id);
      releaseHeld();
    });
    n.on('click', () => {
      notices.delete(n);
      log('bubble', 'os-notice click', click ?? 'pet');
      // 눌러서 처리한 것은 모아 둔 데서 뺀다 (안 빼면 펫이 나올 때 같은 알림이 또 뜬다)
      held.remove(h);
      if (click) h.onAction?.(click);
      releaseHeld();
    });
    n.on('close', () => notices.delete(n));
    n.show();
    log('bubble', 'os-notice', action ?? 'blocked');
  }

  /** 놓치면 안 되는 말이 닫혔거나 못 떴다: 봤으면 끝, 아니면 다시 모으거나 놓친 알림으로 (fateOf) */
  function unseen(items: readonly HeldBubble[], action: string | undefined) {
    for (const h of items) {
      osNotify(h, action);
      const fate = fateOf(action, { blocked: blocked(), away: away(), shown: h.shown ?? 0 });
      if (fate === 'hold') keep([h]);
      else if (fate === 'missed') addMissed(h);
    }
  }

  /** 모아 둔 것을 꺼낸다: 시작이 한참 지난 일정은 놓친 알림에만, 나머지는 말풍선 하나로 */
  function releaseHeld() {
    // 집 문을 드나드는 중(작은 펫)에는 꺼내지 않는다. 2초마다 다시 본다
    if (held.size === 0 || blocked() || away() || (bubble && !bubble.ambient) || doorTimer) return;
    const { fresh, stale } = held.flush(Date.now());
    for (const h of stale) addMissed(h);
    if (fresh.length === 0) return;
    const now = Date.now();
    const shown = fresh.map((h) => ({ ...h, lines: h.render?.(now) ?? h.lines, shown: (h.shown ?? 0) + 1 }));
    const only = shown.length === 1 ? shown[0] : undefined;
    void say({
      kind: 'schedule',
      text: bundleText(shown),
      buttons: heldButtons(shown, [{ id: 'ok', label: t('panel.remind.ok') }]),
      ttlMs: 30_000,
    }).then((action) => {
      if (only?.buttons?.length && action) only.onAction?.(action);
      unseen(shown, action);
    });
  }
  // 끌기가 끝나거나 화면 잠금이 풀리거나 자리로 돌아오면 2초 안에 꺼낸다
  const releaseTimer = setInterval(() => {
    releaseDragAnswer();
    releaseHeld();
    showStatus();
  }, 2000);

  /** 끄는 동안 온 답 알림을 놓고(던졌으면 다 떨어지고) 나서 띄운다. 숨은 동안 붙잡은 것은 다시 나올 때 setHidden 이 띄운다 */
  function releaseDragAnswer() {
    if (!heldAnswer || hideReasons.hidden || dragTimer || flightTimer || win.isDestroyed()) return;
    const answer = heldAnswer;
    heldAnswer = undefined;
    void say(answer.options).then(answer.resolve);
  }

  function say(options: SayOptions): Promise<string | undefined> {
    return speak(options, Date.now() + BUBBLE_WAIT_MAX_MS);
  }

  /** until: 다른 펫 말풍선이 닫히기를 이때까지 기다린다 (이슈 #65) */
  function speak(options: SayOptions, until: number): Promise<string | undefined> {
    const { kind, text, buttons = [], ttlMs = BUBBLE_TTL_MS, image, hold, signal, paper } = options;
    if (signal?.aborted) return Promise.resolve(undefined);
    // 숨은 동안, 펫을 끄는 동안 온 답 알림은 붙잡아 둔다. 끄는 중에는 예전에 그냥 버려서 답이 왔다는 말이 사라졌다
    if ((hideReasons.hidden || dragTimer) && kind === 'answer') {
      // 앞에 기다리던 알림은 새 것으로 바꾼다 (가장 최근 답 하나만).
      heldAnswer?.resolve(undefined);
      if (hideReasons.hidden) tellResting(kind, !!hold);
      return new Promise((resolve) => {
        const held = { options, resolve };
        heldAnswer = held;
        signal?.addEventListener(
          'abort',
          () => {
            if (heldAnswer !== held) return;
            heldAnswer = undefined;
            resolve(undefined);
          },
          { once: true },
        );
      });
    }
    const item: HeldBubble | undefined = hold
      ? { ...hold, text, kind, at: Date.now(), shown: 1, ...(buttons.length ? { buttons } : {}) }
      : undefined;
    if (item && !win.isDestroyed()) {
      // 이 수다 빈도에서 안 하는 말은 모으지도 않는다
      if (!gate.allows(kind)) return Promise.resolve(undefined);
      if (blocked()) {
        const h = { ...item, shown: 0 };
        osNotify(h, undefined);
        keep([h]);
        tellResting(kind, true);
        return Promise.resolve(undefined);
      }
    }
    // 혼잣말은 떠 있는 다른 말을 밀어내지 않는다
    if (kind === 'idle-talk' && bubble && !bubble.ambient) return Promise.resolve(undefined);
    // 옆 펫이 말하는 중이라 말풍선이 포개질 자리면: 혼잣말은 건너뛰고, 다른 말은 그 말풍선이 닫힐 때까지 미룬다
    if (!win.isDestroyed() && win.isVisible() && clashing()) {
      if (kind === 'idle-talk') return Promise.resolve(undefined);
      if (Date.now() < until)
        return waitForRoom(until, signal).then(() => (signal?.aborted ? undefined : speak(options, until)));
    }
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
      win.webContents.send(IPC.bubble, {
        id,
        text,
        buttons,
        ttlMs,
        image,
        kind,
        ...(paper ? { paper } : {}),
      });
      signal?.addEventListener(
        'abort',
        () => {
          if (bubble?.id === id && !win.isDestroyed()) closeBubble('cleared');
        },
        { once: true },
      );
    });
  }

  /** 집에서 쉬는 것만으로 숨어 있다 (사용자가 숨겼거나 발표 중이 아님) */
  const resting = () =>
    hideReasons.has('house') && !hideReasons.has('user') && !hideReasons.has('presentation');

  /** 집에서 쉬는 중에만 (사용자가 숨겼거나 발표 중이면 그쪽 규칙대로 모으기만). 모아 둔 뒤에 알린다 */
  function tellResting(kind: BubbleKind, important: boolean) {
    if (!resting()) return;
    setTimeout(() => onRestHeld?.(kind, important), 0);
  }

  // ---- 집 문 드나들기 (집에서 쉬기) ----
  let doorTimer: NodeJS.Timeout | undefined;
  let doorDone: ((finished: boolean) => void) | undefined;

  function stopDoor(finished = false) {
    if (!doorTimer) return;
    clearInterval(doorTimer);
    doorTimer = undefined;
    const done = doorDone;
    doorDone = undefined;
    done?.(finished);
  }

  /**
   * stand(문간에 선 펫)와 end(문 안 펫 그림 자리) 사이를 걸으며 줄어들거나(inward) 커지며 오간다. 끝까지 했으면 true.
   * 걷는 모습은 펫 화면이 그리고 창은 여기서 옮긴다
   */
  function animateDoor(stand: Rect, end: Rect, inward: boolean, ms: number): Promise<boolean> {
    endPeek(true);
    stopDoor();
    stopWalk();
    leavePerch();
    // 운영체제 동작 줄이기: 걷고 줄어들지 않고 바로 문 안(나올 때는 문간)에 선다
    if (motionCalm()) {
      pet = doorFrame(stand, end, inward ? 1 : 0);
      applyLayout();
      return Promise.resolve(true);
    }
    const started = Date.now();
    // 문 쪽(나올 때는 문 반대쪽)을 보고 걷는다. 문간 바로 앞이면 들어갈 땐 왼쪽, 나올 땐 오른쪽을 본다
    const toDoor = Math.round(end.x + end.width / 2 - (stand.x + stand.width / 2)) || -1;
    if (!win.isDestroyed())
      win.webContents.send(IPC.activity, {
        type: 'walk',
        dx: inward ? toDoor : -toDoor,
        ms,
        facing: inward ? 'away' : 'toward',
      });
    return new Promise((resolve) => {
      doorDone = resolve;
      doorTimer = setInterval(() => {
        if (win.isDestroyed()) return stopDoor();
        const u = Math.min(1, (Date.now() - started) / ms);
        pet = doorFrame(stand, end, inward ? u : 1 - u);
        applyLayout();
        if (u >= 1) stopDoor(true);
      }, 16);
    });
  }

  async function enterDoor(to: Rect, handoff: () => Promise<void>): Promise<boolean> {
    if (win.isDestroyed() || !win.isVisible() || dragTimer) return false;
    closeBubble('replaced');
    stopFlight();
    const stand = { ...pet };
    let done = await animateDoor(stand, to, true, approachMs(stand, to));
    // 집 창이 같은 자리에 펫 그림을 띄운 뒤에 숨는다 (사이에 펫이 깜빡 사라지지 않게). 그사이 잡혔으면 안 들어간다
    if (done) {
      await handoff();
      done = !dragTimer && !win.isDestroyed();
    }
    // 끌려 나왔으면 끌기가 펫 자리를 맡는다. 크기만 원래대로. 가다가 불렸으면 그 자리 바닥(문간 높이)에 원래 크기로 선다
    pet = done
      ? stand
      : dragTimer
        ? resizeFromBottomCenter(pet, stand.width)
        : { ...resizeFromBottomCenter(pet, stand.width), y: stand.y };
    if (done) setHidden('house', true);
    applyLayout();
    if (!done) keepOnScreen();
    save();
    return done;
  }

  async function leaveDoor(from: Rect, at: { x: number; y: number }, handoff: () => void): Promise<void> {
    if (win.isDestroyed()) return;
    const areas = screen.getAllDisplays().map((d) => d.workArea);
    const stand = clampIntoAreas({ ...pet, x: Math.round(at.x), y: Math.round(at.y) }, areas);
    // 숨은 채로 문간 그림 크기로 줄여 두고 보이게 한 뒤(집 창 그림과 같은 자리) 커진다
    pet = { ...from };
    applyLayout();
    setHidden('house', false);
    // 펫 창이 그려진 뒤 집 창 그림을 거둔다
    setTimeout(handoff, 40);
    const done = await animateDoor(stand, from, false, OUT_MS);
    if (!done && !dragTimer) pet = stand;
    if (!dragTimer) {
      applyLayout();
      keepOnScreen();
      save();
    }
    if (!done || win.isDestroyed()) return;
    // 잘 잤다: 기지개를 켜고 좋아한다. 그사이 말풍선이 뜨거나 잡히면 기지개는 거기서 끝
    win.webContents.send(IPC.activity, { type: 'stretch', ms: STRETCH_MS });
    if ((await pause(STRETCH_MS)) && !win.isDestroyed()) win.webContents.send(IPC.react, 'happy');
  }

  // ---- 잠깐 안 보이게 (두더지 구멍 속, 같이 보기 찍는 순간) ----
  // 까닭이 하나라도 있으면 불투명도 0, 다 풀리면 처음 가리기 전 값으로 (shared/conceal.ts).
  // 예전에는 까닭마다 원래 값을 따로 기억해 겹치면 상대가 만든 0 을 원래 값으로 잡아 펫이 투명한 채 남았다.
  // 사용자 숨기기, 발표, 집 안(문 드나들기)은 창을 숨기는 다른 축(hideReasons)이라 서로 덮지 않는다
  const conceal = new Conceal();
  let revealTimer: NodeJS.Timeout | undefined;
  let revealDone: (() => void) | undefined;
  /** 리눅스는 창 불투명도를 못 바꿔 숨긴다 */
  const noOpacity = process.platform === 'linux';

  function stopReveal() {
    clearInterval(revealTimer);
    revealTimer = undefined;
    const done = revealDone;
    revealDone = undefined;
    done?.();
  }

  function setConcealed(reason: ConcealReason, on: boolean, revealMs = 0): Promise<void> {
    if (win.isDestroyed()) return Promise.resolve();
    const step = conceal.set(reason, on, () => (noOpacity ? 1 : win.getOpacity()));
    if (!step) return Promise.resolve();
    stopReveal();
    if (step.kind === 'hide') {
      if (noOpacity) win.hide();
      else win.setOpacity(0);
      return Promise.resolve();
    }
    const to = step.to;
    if (noOpacity || revealMs <= 0 || to <= 0) {
      if (noOpacity) {
        if (!hideReasons.hidden) win.showInactive();
      } else win.setOpacity(to);
      conceal.settled();
      return Promise.resolve();
    }
    // 툭 나타나지 않게 revealMs 동안 차오른다 (찾았다 동작이 같이 시작한다). 그사이 다시 가리면 거기서 멈춘다
    const started = Date.now();
    return new Promise((resolve) => {
      revealDone = resolve;
      revealTimer = setInterval(() => {
        const k = Math.min(1, (Date.now() - started) / revealMs);
        if (!win.isDestroyed()) win.setOpacity(to * k);
        if (k >= 1 || win.isDestroyed()) {
          conceal.settled();
          stopReveal();
        }
      }, 16);
    });
  }

  // ---- 두더지 잡기: 구멍에서 솟고 들어가기 ----
  /** 두더지 놀이 중 원래 펫 크기 (아니면 undefined). 그동안 혼자 걷거나 몸짓하지 않는다 */
  let moleSize: number | undefined;
  /** 구멍 속이라 안 보이게 한다 (같이 보기 가리기와 한곳에서 정한다: setConcealed) */
  function moleConceal(on: boolean) {
    void setConcealed('mole', on);
  }

  async function burrow(foot: Point, up: boolean, ms: number): Promise<boolean> {
    if (win.isDestroyed() || dragTimer || flightTimer) return false;
    if (moleSize === undefined) {
      moleSize = pet.width;
      stopWalk();
      leavePerch();
    }
    stopDoor();
    const size = moleSize;
    const stand = {
      x: Math.round(foot.x - size / 2),
      y: Math.round(foot.y - size),
      width: size,
      height: size,
    };
    if (up) {
      // 구멍 크기로 줄여 두고 보이게 한 뒤 솟는다 (큰 펫이 번쩍하지 않게)
      pet = burrowFrame(stand, 0);
      applyLayout();
      moleConceal(false);
    }
    if (ms <= 0) {
      pet = up ? stand : burrowFrame(stand, 0);
      applyLayout();
      if (!up) moleConceal(true);
      return true;
    }
    const started = Date.now();
    const done = await new Promise<boolean>((resolve) => {
      doorDone = resolve;
      doorTimer = setInterval(() => {
        if (win.isDestroyed()) return stopDoor();
        const u = Math.min(1, (Date.now() - started) / ms);
        pet = burrowFrame(stand, up ? u : 1 - u);
        applyLayout();
        if (u >= 1) stopDoor(true);
      }, 16);
    });
    if (done && !up) moleConceal(true);
    return done;
  }

  function unburrow(at?: Point) {
    endPeek(true);
    if (moleSize === undefined) return;
    stopDoor();
    const size = moleSize;
    moleSize = undefined;
    pet = at
      ? { x: Math.round(at.x), y: Math.round(at.y), width: size, height: size }
      : resizeFromBottomCenter(pet, size);
    keepOnScreen();
    moleConceal(false);
    save();
  }

  async function askQuieter() {
    const answer = await say({
      kind: 'answer',
      text: voiced('pet.tooChatty'),
      buttons: [
        { id: 'yes', label: t('pet.tooChattyYes') },
        { id: 'no', label: t('pet.tooChattyNo') },
      ],
      ttlMs: 15_000,
    });
    if (answer === 'yes') setChatter(quieter(gate.level));
  }

  const onBubbleAnchor = (e: IpcMainEvent, raw: unknown) => {
    if (!fromThisWindow(e)) return;
    const next = parseBubbleAnchor(raw);
    if (!next || (next.top === bubbleAnchor?.top && next.bottom === bubbleAnchor?.bottom)) return;
    bubbleAnchor = next;
    applyLayout();
  };
  const onBubbleSize = (e: IpcMainEvent, id: unknown, width: unknown, height: unknown) => {
    if (!fromThisWindow(e) || typeof id !== 'string' || bubble?.id !== id) return;
    if (!isSize(width) || !isSize(height)) return;
    bubble.size = { width, height };
    applyLayout();
  };

  const onBubbleClosed = (e: IpcMainEvent, id: unknown, action: unknown) => {
    if (!fromThisWindow(e) || bubble?.id !== id || typeof action !== 'string') return;
    closeBubble(action);
  };

  // 값이 실제로 바뀐 때만 온다. 맥이 변화 없이 몰아 보내는 알림은 display-watch.ts 가 거른다 (2026-10-08 로그 폭주)
  const stopDisplayWatch = watchDisplays((displays) => {
    // 커진 동안 모니터가 바뀌면 옛 자리는 화면 밖일 수 있다: 먼저 돌려 놓고 화면 안으로
    endPeek(true);
    keepOnScreen();
    const areas = displays.map((d) => d.workArea);
    log('display', 'changed', JSON.stringify({ areas, pet: win.getBounds() }));
  });

  // ---- 키보드로 펫 다루기 (접근성) ----
  // 펫 창은 평소 키보드를 받지 않는다(focusable false: 누르기만 해도 다른 앱의 입력을 뺏지 않게). 펫 고르기 단축키를
  // 누를 때만 받을 수 있게 바꾸고 앞으로 부른다. 시험 인스턴스(JJ_NO_FOCUS)는 앞으로 부르지 않는다 (focus.ts)
  let keyMode = false;
  function setKeyMode(on: boolean) {
    if (on === keyMode || win.isDestroyed()) return;
    keyMode = on;
    win.setFocusable(on);
    if (on) {
      focusWindow(win);
      stealFocus();
    } else if (win.isFocused()) win.blur();
    win.webContents.send(IPC.keys, on ? petName() : null);
    log('pet', 'keyboard', on);
  }
  win.on('blur', () => setKeyMode(false));
  /** 창 안 좌표로 본 펫 가운데 (메뉴를 펫 위에 연다) */
  const petCenterInWindow = () => {
    const b = win.getBounds();
    return { x: Math.round(pet.x - b.x + pet.width / 2), y: Math.round(pet.y - b.y + pet.height / 2) };
  };
  function nudge(dx: number, dy: number) {
    stopWalk();
    leavePerch();
    pet = { ...pet, x: pet.x + dx, y: pet.y + dy };
    keepOnScreen();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }
  function onKey(key: PetKey) {
    switch (key) {
      case 'open':
        actions.click(pet);
        return;
      case 'menu':
        showMenu(petCenterInWindow());
        return;
      case 'left':
      case 'right': {
        const area = screen.getDisplayMatching(pet).workArea;
        const step = Math.round(pet.width * KEY_WALK) * (key === 'left' ? -1 : 1);
        const x = Math.max(area.x, Math.min(area.x + area.width - pet.width, pet.x + step));
        leavePerch();
        void walkTo(x, WALK_SPEED * 2).then(() => save());
        return;
      }
      case 'nudgeLeft':
        return nudge(-KEY_NUDGE, 0);
      case 'nudgeRight':
        return nudge(KEY_NUDGE, 0);
      case 'nudgeUp':
        return nudge(0, -KEY_NUDGE);
      case 'nudgeDown':
        return nudge(0, KEY_NUDGE);
      case 'leave':
        setKeyMode(false);
        return;
    }
  }
  const onPetKey = (e: IpcMainEvent, key: unknown) => {
    if (!fromThisWindow(e) || !keyMode || !isPetKey(key)) return;
    onKey(key);
  };

  ipcMain.on(IPC.petKey, onPetKey);
  ipcMain.on(IPC.hover, onHover);
  ipcMain.on(IPC.gesture, onGesture);
  ipcMain.on(IPC.contextMenu, onContextMenu);
  ipcMain.on(IPC.wheel, onWheel);
  ipcMain.on(IPC.bubbleSize, onBubbleSize);
  ipcMain.on(IPC.bubbleAnchor, onBubbleAnchor);
  ipcMain.on(IPC.activityRequest, onActivityRequest);
  ipcMain.on(IPC.activityStop, onActivityStop);
  ipcMain.on(IPC.petted, onPetted);
  ipcMain.on(IPC.bubbleClosed, onBubbleClosed);
  ipcMain.on(IPC.body, onBody);
  ipcMain.on(IPC.sprites, onSprites);
  ipcMain.on(IPC.carried, onCarried);
  // 설계도 정면 그림 (shot): 부탁 번호마다 기다린다
  const shots = new Map<number, (png: string | undefined) => void>();
  let shotSeq = 0;
  const onShotGot = (e: IpcMainEvent, id: unknown, png: unknown) => {
    if (!fromThisWindow(e) || typeof id !== 'number') return;
    const done = shots.get(id);
    shots.delete(id);
    done?.(typeof png === 'string' ? png : undefined);
  };
  ipcMain.on(IPC.shotGot, onShotGot);

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
        !looking &&
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
    // 손님(ghost)은 말을 걸지 않는다: 컴퓨터가 바쁘면 조용히 있는다
    if (env.systemBusy && !wasBusy && !ghost) void say({ kind: 'system', text: voiced('pet.busyCpu') });
    wasBusy = env.systemBusy;
  }, log);
  win.webContents.on('did-finish-load', () => applyLayout());

  // ---- 같이 보기 돋보기 (shared/look-motion.ts) ----
  // 같이 보기 동안 펫은 영역 고르기 오버레이(screen-saver) 바로 위에 떠서 고르는 쪽을 들여다본다.
  // 마우스는 모두 통과시켜 펫 자리도 고를 수 있다. 화면을 찍는 순간에는 veil 로 창째 가린다 (look-together.ts)
  let looking: { phase: LookPhase; dir: Gaze } | undefined;
  let lookPoll: NodeJS.Timeout | undefined;
  let lookDone: NodeJS.Timeout | undefined;

  function sendLook() {
    if (!win.isDestroyed()) win.webContents.send(IPC.look, looking ? { ...looking, tool: !id } : null);
  }

  function setLooking(state: 'aim' | { found: Point } | null) {
    clearInterval(lookPoll);
    lookPoll = undefined;
    clearTimeout(lookDone);
    lookDone = undefined;
    if (win.isDestroyed()) return;
    if (!state) {
      if (!looking) return;
      looking = undefined;
      win.setAlwaysOnTop(true, 'floating');
      // 커서가 어디 있는지는 화면이 다음 움직임 때 다시 알려 준다
      overPet = false;
      win.setIgnoreMouseEvents(true, { forward: true });
      sendLook();
      return;
    }
    if (!looking) {
      // 하던 것을 멈춘다: 끌기(그 자리에 놓는다), 걷기, 날기. 말풍선은 둔다 (찍을 때 창째 가린다)
      if (dragTimer) {
        clearInterval(dragTimer);
        dragTimer = undefined;
        keepOnScreen();
        save();
      }
      stopWalk();
      stopFlight();
      setShortcuts(false);
      win.setIgnoreMouseEvents(true);
      win.setAlwaysOnTop(true, 'screen-saver', 1);
    }
    if (state === 'aim') {
      const dir = lookDir(pet, screen.getCursorScreenPoint());
      const changed = looking?.phase !== 'aim' || !sameDir(dir, looking.dir);
      looking = { phase: 'aim', dir };
      if (changed) sendLook();
      // 오버레이가 늦게 떠도 펫이 위에 있게 (윈도우는 같은 층 안에서 나중에 뜬 창이 위로 간다)
      // (숨어 있는 창에 부르면 맥에서 창이 나타난다)
      if (win.isVisible()) win.moveTop();
      lookPoll = setInterval(() => {
        if (win.isDestroyed() || looking?.phase !== 'aim') return;
        const next = lookDir(pet, screen.getCursorScreenPoint());
        if (sameDir(next, looking.dir)) return;
        looking = { phase: 'aim', dir: next };
        sendLook();
      }, LOOK_POLL_MS);
      return;
    }
    looking = { phase: 'found', dir: lookDir(pet, state.found) };
    sendLook();
    lookDone = setTimeout(() => setLooking(null), FOUND_MS);
  }

  /** 찍는 순간 가린다(true), 다시 보인다(false, REVEAL_MS 동안 차오른다) */
  function veil(on: boolean): Promise<void> {
    return setConcealed('veil', on, REVEAL_MS);
  }

  // 펫 화면을 다시 불러오면(새로고침, 죽었다 살아남) 같이 보기 상태를 다시 알린다
  win.webContents.on('did-finish-load', () => {
    if (looking) sendLook();
  });

  win.on('closed', () => {
    // 기다리던 걷기, 문, 구멍, 깡충, 말풍선, 차오르기를 끊긴 것으로 끝낸다. 안 하면 await 하던 쪽이
    // 영영 멈춘다 (예: 친구 펫을 걷는 중에 지우면 만남이 끝나지 않는다). 닫힌 창에는 보내지 않는다.
    // 말풍선을 먼저 닫아야 못 본 놓치면 안 되는 말이 아래 flush 로 놓친 알림에 들어간다
    clearInterval(walkTimer);
    walkTimer = undefined;
    clearInterval(doorTimer);
    doorTimer = undefined;
    clearInterval(hopTimer);
    hopTimer = undefined;
    for (const done of [walkDone, doorDone, hopDone]) done?.(false);
    walkDone = doorDone = hopDone = undefined;
    const shown = bubble;
    bubble = undefined;
    shown?.done('cleared');
    talkers.delete(bubbleRect);
    roomMaybe();
    heldAnswer?.resolve(undefined);
    heldAnswer = undefined;
    stopReveal();
    stopGaze();
    clearInterval(lookPoll);
    clearTimeout(lookDone);
    clearInterval(revealTimer);
    clearInterval(releaseTimer);
    powerMonitor.off('lock-screen', onLock);
    powerMonitor.off('unlock-screen', onUnlock);
    // 끄는 동안 모아 둔 것은 놓친 알림으로 남긴다 (다시 켜면 패널 오늘 탭에)
    const { fresh, stale } = held.flush(Date.now());
    for (const h of [...stale, ...fresh]) for (const e of missedEntries(h)) missed.add({ ...e, at: h.at });
    if (!id && fresh.length + stale.length > 0) writeJson(MISSED_FILE, missed.items);
    stopSettings();
    stopWatching();
    clearInterval(dragTimer);
    clearTimeout(saveTimer);
    setShortcuts(false);
    ipcMain.off(IPC.wheel, onWheel);
    ipcMain.off(IPC.bubbleSize, onBubbleSize);
    ipcMain.off(IPC.bubbleAnchor, onBubbleAnchor);
    ipcMain.off(IPC.activityRequest, onActivityRequest);
    ipcMain.off(IPC.activityStop, onActivityStop);
    ipcMain.off(IPC.petted, onPetted);
    ipcMain.off(IPC.body, onBody);
    ipcMain.off(IPC.sprites, onSprites);
    ipcMain.off(IPC.carried, onCarried);
    ipcMain.off(IPC.shotGot, onShotGot);
    for (const done of shots.values()) done(undefined);
    shots.clear();
    carriedWait?.(null);
    clearInterval(walkTimer);
    clearInterval(flightTimer);
    clearInterval(perchTimer);
    clearInterval(hopTimer);
    clearInterval(doorTimer);
    ipcMain.off(IPC.bubbleClosed, onBubbleClosed);
    ipcMain.off(IPC.hover, onHover);
    ipcMain.off(IPC.gesture, onGesture);
    ipcMain.off(IPC.contextMenu, onContextMenu);
    peekHandlers.delete(peekKey);
    clearTimeout(statusTimer);
    if (peek) {
      clearTimeout(peek.guard);
      clearInterval(peek.timer);
    }
    ipcMain.off(IPC.petKey, onPetKey);
    stopDisplayWatch();
  });

  return {
    win,
    reload,
    setStatus(next) {
      const same = next?.text === status?.text;
      status = next ?? undefined;
      if (!same || !status) showStatus();
    },
    bounds: () => ({ ...pet }),
    say,
    setHidden: (reason: HideReason, on: boolean, hint?: boolean) => setHidden(reason, on, hint),
    scale: () => clampScale(scale),
    react: (kind: ReactKind = 'happy') => {
      if (!win.isDestroyed()) win.webContents.send(IPC.react, kind);
    },
    setScale: (next: number) => resize(clampScale(next)),
    isHidden: (reason?: HideReason) => (reason ? hideReasons.has(reason) : hideReasons.hidden),
    // 개발용: 디자인 점검 때 위치와 크기를 바로 바꾼다 (메인 디버거의 __jj 에서만 부른다).
    debugMoveTo(x: number, y: number) {
      endPeek(true);
      pet = { ...pet, x, y };
      keepOnScreen();
    },
    debugScale: (next: number) => resize(next),
    /** 개발용: 던지기 (실제 던지기는 운영체제 커서 속도가 필요하다) */
    debugThrow: (vx: number, vy: number) => startFlight(vx, vy),
    /** 개발용: 창 위에 올라앉기 */
    debugPerch: () => tryPerch(),
    shot: (model) =>
      new Promise((resolve) => {
        if (win.isDestroyed()) return resolve(undefined);
        const id = ++shotSeq;
        const timer = setTimeout(() => {
          shots.delete(id);
          resolve(undefined);
        }, SHOT_WAIT_MS);
        shots.set(id, (png) => {
          clearTimeout(timer);
          resolve(png);
        });
        win.webContents.send(IPC.shotAsk, id, model);
      }),
    walkTo,
    keyboard: () => {
      if (win.isDestroyed() || hideReasons.hidden) return;
      setKeyMode(!keyMode);
    },
    stroll,
    follow,
    land,
    body: () => body,
    sprites: () => sprites,
    carry,
    carriedAt,
    pause,
    halt() {
      haltedAt = Date.now();
      stopWalk();
    },
    held: () => !!dragTimer || !!flightTimer,
    sound(kind: SoundKind) {
      if (!win.isDestroyed()) win.webContents.send(IPC.sound, kind);
    },
    jumpTo(x: number, y: number) {
      stopWalk();
      stopFlight();
      leavePerch();
      if (win.isDestroyed() || !win.isVisible()) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => hopTo({ x: Math.round(x), y: Math.round(y) }, resolve));
    },
    enterDoor,
    leaveDoor,
    cancelDoor: () => stopDoor(false),
    burrow,
    unburrow,
    /** 숨바꼭질 (v2): 화면 가장자리 밖으로 반쯤 나간 자리로 순간이동 (안 보이게 숨겼다가 나타난다) */
    peekAt(x: number, y: number) {
      endPeek(true);
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
      endPeek(true);
      pet = { ...pet, x: to.x, y: to.y };
      keepOnScreen();
      save();
    },
    isIdle: () =>
      !win.isDestroyed() &&
      win.isVisible() &&
      !hideReasons.hidden &&
      !dragTimer &&
      !doorTimer &&
      moleSize === undefined &&
      !flightTimer &&
      !walkTimer &&
      !hopTimer &&
      !perch &&
      !looking &&
      !peek &&
      !(bubble && !bubble.ambient),
    look: setLooking,
    veil,
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
