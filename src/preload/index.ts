import { contextBridge, ipcRenderer } from 'electron';
import type { AiProvider } from '../shared/ai/types.ts';
import type { Activity } from '../shared/behavior.ts';
import type { BubbleLayout } from '../shared/bubble-layout.ts';
import type { ChatState } from '../shared/chat-state.ts';
import type { Gaze } from '../shared/gaze.ts';
import type { Point } from '../shared/geometry.ts';
import type { HouseSprites } from '../shared/house-room.ts';
import {
  type BubbleMessage,
  type CarryMessage,
  CHAT,
  type ChatBridge,
  FACE,
  type FaceBridge,
  type GestureEvent,
  IPC,
  LOOK,
  MAKER,
  type MakerBridge,
  ONBOARD,
  type OnboardBridge,
  type OutgoingImage,
  type OverlayBridge,
  PANEL,
  type PanelBridge,
  type PanelState,
  type PanelTab,
  type PetAiState,
  type PetBody,
  type PetBridge,
  type PetEnv,
  type PetImages,
  type PetStatus,
  type ReactKind,
  SETTINGS,
  type SettingsBridge,
  type SettingsSection,
} from '../shared/ipc.ts';
import type { LookMotion } from '../shared/look-motion.ts';
import type { MoveAsk } from '../shared/moves.ts';
import type { Settings } from '../shared/settings.ts';
import type { SoundKind } from '../shared/sound.ts';

// 샌드박스 preload 는 다른 파일을 require 할 수 없어 한 파일로 묶는다.
// 창마다 자기 기능만 열어 준다: 메인이 창을 만들 때 `--jj-window=<이름>` 을 넘긴다.
const kind = process.argv.find((a) => a.startsWith('--jj-window='))?.split('=')[1];
// 화면 말 (v2 다국어). 모든 창이 같은 이름으로 읽는다. 모르는 값이면 한국어
const lang = process.argv.find((a) => a.startsWith('--jj-lang='))?.split('=')[1] === 'en' ? 'en' : 'ko';
contextBridge.exposeInMainWorld('jjakkungLang', lang);

if (kind === 'pet') {
  const pet: PetBridge = {
    platform: process.platform,
    hover: (overPet: boolean) => ipcRenderer.send(IPC.hover, overPet),
    gesture: (event: GestureEvent) => ipcRenderer.send(IPC.gesture, event),
    contextMenu: () => ipcRenderer.send(IPC.contextMenu),
    wheel: (deltaY: number, zoom: boolean) => ipcRenderer.send(IPC.wheel, deltaY, zoom),
    onEnv: (listener: (env: PetEnv) => void) => {
      ipcRenderer.on(IPC.env, (_e, env: PetEnv) => listener(env));
    },
    onAi: (listener: (state: PetAiState) => void) => {
      ipcRenderer.on(IPC.ai, (_e, state: PetAiState) => listener(state));
    },
    onBubble: (listener) => {
      ipcRenderer.on(IPC.bubble, (_e, bubble: BubbleMessage | null) => listener(bubble));
    },
    onLayout: (listener) => {
      ipcRenderer.on(IPC.layout, (_e, layout: BubbleLayout) => listener(layout));
    },
    bubbleSize: (id: string, width: number, height: number) =>
      ipcRenderer.send(IPC.bubbleSize, id, width, height),
    bubbleClosed: (id: string, action: string) => ipcRenderer.send(IPC.bubbleClosed, id, action),
    activityRequest: (ask?: MoveAsk) => ipcRenderer.send(IPC.activityRequest, ask),
    activityStop: () => ipcRenderer.send(IPC.activityStop),
    onActivity: (listener) => {
      ipcRenderer.on(IPC.activity, (_e, activity: Activity) => listener(activity));
    },
    onStatus: (listener) => {
      ipcRenderer.on(IPC.status, (_e, status: PetStatus) => listener(status));
    },
    onReact: (listener) => {
      ipcRenderer.on(IPC.react, (_e, kind: ReactKind) => listener(kind));
    },
    onImage: (listener) => {
      ipcRenderer.on(IPC.image, (_e, images: PetImages) => listener(images));
    },
    petted: () => ipcRenderer.send(IPC.petted),
    onFlight: (listener) => {
      ipcRenderer.on(IPC.flight, (_e, flying: boolean) => listener(flying));
    },
    onGaze: (listener) => {
      ipcRenderer.on(IPC.gaze, (_e, gaze: Gaze | null) => listener(gaze));
    },
    onLook: (listener) => {
      ipcRenderer.on(IPC.look, (_e, motion: LookMotion | null) => listener(motion));
    },
    onSound: (listener) => {
      ipcRenderer.on(IPC.sound, (_e, kind: SoundKind) => listener(kind));
    },
    face: (url: string) => ipcRenderer.send(FACE.set, url),
    body: (body: PetBody) => ipcRenderer.send(IPC.body, body),
    onCarry: (listener) => {
      ipcRenderer.on(IPC.carry, (_e, message: CarryMessage) => listener(message));
    },
    carried: (at: Point | null) => ipcRenderer.send(IPC.carried, at),
    sprites: (sprites: HouseSprites) => ipcRenderer.send(IPC.sprites, sprites),
  };
  contextBridge.exposeInMainWorld('jjakkung', pet);
}

// 이름 옆 펫 얼굴 (shared/face.ts). 펫 화면이 그린 지금 모습을 받는다
if (kind === 'chat' || kind === 'panel' || kind === 'quick' || kind === 'onboarding' || kind === 'settings') {
  const face: FaceBridge = {
    get: () => ipcRenderer.invoke(FACE.get),
    onChange: (listener) => {
      ipcRenderer.on(FACE.changed, (_e, url: string) => listener(url));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungFace', face);
}

if (kind === 'chat') {
  const chat: ChatBridge = {
    platform: process.platform,
    snapshot: () => ipcRenderer.invoke(CHAT.snapshot),
    status: (refresh: boolean) => ipcRenderer.invoke(CHAT.status, refresh),
    send: (text: string, images: OutgoingImage[]) => ipcRenderer.send(CHAT.send, text, images),
    cancel: () => ipcRenderer.send(CHAT.cancel),
    reset: () => ipcRenderer.send(CHAT.reset),
    undoReset: () => ipcRenderer.invoke(CHAT.undoReset),
    openLink: (url: string) => ipcRenderer.send(CHAT.openLink, url),
    setProvider: (provider: AiProvider) => ipcRenderer.send(CHAT.provider, provider),
    providers: () => ipcRenderer.invoke(CHAT.providers),
    addProvider: (input) => ipcRenderer.invoke(CHAT.addProvider, input),
    removeProvider: (id: AiProvider) => ipcRenderer.invoke(CHAT.removeProvider, id),
    onState: (listener) => {
      ipcRenderer.on(CHAT.state, (_e, state: ChatState) => listener(state));
    },
    onDelta: (listener) => {
      ipcRenderer.on(CHAT.delta, (_e, id: string, text: string) => listener(id, text));
    },
    onAttach: (listener) => {
      ipcRenderer.on(CHAT.attach, (_e, image: OutgoingImage) => listener(image));
    },
    onPetName: (listener) => {
      ipcRenderer.on(CHAT.petName, (_e, name: string) => listener(name));
    },
    setEphemeral: (on: boolean) => ipcRenderer.send(CHAT.setEphemeral, on),
    setKnowsTodos: (on: boolean) => ipcRenderer.send(CHAT.setKnowsTodos, on),
    toNote: (id: string) => ipcRenderer.invoke(CHAT.toNote, id),
    toTodos: (id: string) => ipcRenderer.invoke(CHAT.toTodos, id),
    retryWith: (provider) => ipcRenderer.send(CHAT.retryWith, provider),
    downloadModel: () => ipcRenderer.send(CHAT.downloadModel),
  };
  contextBridge.exposeInMainWorld('jjakkungChat', chat);
}

if (kind === 'overlay') {
  const overlay: OverlayBridge = {
    select: (rect) => ipcRenderer.send(LOOK.select, rect),
  };
  contextBridge.exposeInMainWorld('jjakkungOverlay', overlay);
}

if (kind === 'onboarding') {
  const onboard: OnboardBridge = {
    get: () => ipcRenderer.invoke(ONBOARD.get),
    set: (patch) => ipcRenderer.invoke(ONBOARD.set, patch),
    openMaker: () => ipcRenderer.send(ONBOARD.openMaker),
    openScreenSettings: () => ipcRenderer.send(ONBOARD.openScreenSettings),
    finish: () => ipcRenderer.send(ONBOARD.finish),
    ai: () => ipcRenderer.invoke(ONBOARD.ai),
  };
  contextBridge.exposeInMainWorld('jjakkungOnboard', onboard);
}

if (kind === 'settings') {
  const bridge: SettingsBridge = {
    get: () => ipcRenderer.invoke(SETTINGS.get),
    set: (patch) => ipcRenderer.invoke(SETTINGS.set, patch),
    setScale: (scale: number) => ipcRenderer.send(SETTINGS.setScale, scale),
    openMaker: (target) => ipcRenderer.send(SETTINGS.openMaker, target),
    stats: () => ipcRenderer.invoke(SETTINGS.stats),
    copyStats: () => ipcRenderer.invoke(SETTINGS.copyStats),
    checkUpdate: () => ipcRenderer.invoke(SETTINGS.checkUpdate),
    openOnboarding: () => ipcRenderer.send(SETTINGS.openOnboarding),
    exportData: () => ipcRenderer.invoke(SETTINGS.exportData),
    importData: () => ipcRenderer.invoke(SETTINGS.importData),
    exportPet: () => ipcRenderer.invoke(SETTINGS.exportPet),
    importPet: () => ipcRenderer.invoke(SETTINGS.importPet),
    importFriend: () => ipcRenderer.invoke(SETTINGS.importFriend),
    syncCalendar: () => ipcRenderer.invoke(SETTINGS.syncCalendar),
    refreshMcp: () => ipcRenderer.invoke(SETTINGS.refreshMcp),
    relaunch: () => ipcRenderer.send(SETTINGS.relaunch),
    choosePet: (choice) => ipcRenderer.invoke(SETTINGS.choosePet, choice),
    removeSavedPet: (id: string) => ipcRenderer.invoke(SETTINGS.removeSavedPet, id),
    deleteModel: (id: string) => ipcRenderer.invoke(SETTINGS.deleteModel, id),
    remakeBody: (gait) => ipcRenderer.invoke(SETTINGS.remakeBody, gait),
    cancelRemake: () => ipcRenderer.send(SETTINGS.cancelRemake),
    onChanged: (listener) => {
      ipcRenderer.on(SETTINGS.changed, (_e, next: Settings) => listener(next));
    },
    onFocus: (listener) => {
      ipcRenderer.on(SETTINGS.focus, (_e, section: SettingsSection) => listener(section));
    },
    onPower: (listener) => {
      ipcRenderer.on(SETTINGS.power, (_e, onBattery: boolean) => listener(onBattery === true));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungSettings', bridge);
}

// 패널과 빠른 입력 창은 같은 기능을 쓴다.
if (kind === 'panel' || kind === 'quick') {
  const panel: PanelBridge = {
    platform: process.platform,
    snapshot: () => ipcRenderer.invoke(PANEL.snapshot),
    add: (text: string) => ipcRenderer.invoke(PANEL.add, text),
    complete: (id: number) => ipcRenderer.invoke(PANEL.complete, id),
    undo: (id: number) => ipcRenderer.invoke(PANEL.undo, id),
    update: (id, patch) => ipcRenderer.send(PANEL.update, id, patch),
    remove: (id: number) => ipcRenderer.send(PANEL.remove, id),
    restore: (id: number) => ipcRenderer.send(PANEL.restore, id),
    eventToTodo: (id: number, text: string) => ipcRenderer.invoke(PANEL.eventToTodo, id, text),
    feed: () => ipcRenderer.invoke(PANEL.feed),
    openChat: () => ipcRenderer.send(PANEL.openChat),
    openSettings: () => ipcRenderer.send(PANEL.openSettings),
    lookTogether: () => ipcRenderer.send(PANEL.lookTogether),
    close: () => ipcRenderer.send(PANEL.close),
    onState: (listener) => {
      ipcRenderer.on(PANEL.state, (_e, state: PanelState) => listener(state));
    },
    noteGet: (id: number) => ipcRenderer.invoke(PANEL.noteGet, id),
    noteAdd: () => ipcRenderer.invoke(PANEL.noteAdd),
    noteUpdate: (id, patch) => ipcRenderer.send(PANEL.noteUpdate, id, patch),
    noteRemove: (id: number) => ipcRenderer.send(PANEL.noteRemove, id),
    noteRestore: (id: number) => ipcRenderer.send(PANEL.noteRestore, id),
    noteSearch: (query: string, composing: boolean) => ipcRenderer.invoke(PANEL.noteSearch, query, composing),
    noteAi: (id, kind) => ipcRenderer.invoke(PANEL.noteAi, id, kind),
    notePolish: (id, req) => ipcRenderer.invoke(PANEL.notePolish, id, req),
    notePolishInfo: (id) => ipcRenderer.invoke(PANEL.notePolishInfo, id),
    notePolishTaken: (id) => ipcRenderer.send(PANEL.notePolishTaken, id),
    eventAdd: (text: string) => ipcRenderer.invoke(PANEL.eventAdd, text),
    eventUpdate: (id, patch) => ipcRenderer.send(PANEL.eventUpdate, id, patch),
    eventRemove: (id: number) => ipcRenderer.send(PANEL.eventRemove, id),
    eventRestore: (id: number) => ipcRenderer.send(PANEL.eventRestore, id),
    stepAdd: (todoId: number, title: string | string[]) => ipcRenderer.invoke(PANEL.stepAdd, todoId, title),
    stepToggle: (stepId: number, done?: boolean) => ipcRenderer.send(PANEL.stepToggle, stepId, done),
    stepRename: (stepId: number, title: string) => ipcRenderer.send(PANEL.stepRename, stepId, title),
    stepRemove: (stepId: number) => ipcRenderer.send(PANEL.stepRemove, stepId),
    moveOverdue: () => ipcRenderer.invoke(PANEL.moveOverdue),
    undoMoveOverdue: () => ipcRenderer.send(PANEL.undoMoveOverdue),
    focusStart: (minutes?: number, todoId?: number) => ipcRenderer.send(PANEL.focusStart, minutes, todoId),
    focusStop: () => ipcRenderer.send(PANEL.focusStop),
    missedClear: () => ipcRenderer.send(PANEL.missedClear),
    buyToy: (key: string) => ipcRenderer.invoke(PANEL.buyToy, key),
    buyHouse: (level: number) => ipcRenderer.invoke(PANEL.buyHouse, level),
    buyHouseStyle: (style: string) => ipcRenderer.invoke(PANEL.buyHouseStyle, style),
    feedWith: (key: string) => ipcRenderer.invoke(PANEL.feedWith, key),
    makeFood: () => ipcRenderer.invoke(PANEL.makeFood),
    removeFood: (key: string) => ipcRenderer.send(PANEL.removeFood, key),
    play: (kind) => ipcRenderer.send(PANEL.play, kind),
    onTab: (listener) => {
      ipcRenderer.on(PANEL.tab, (_e, tab: PanelTab) => listener(tab));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungPanel', panel);
}

if (kind === 'maker') {
  const maker: MakerBridge = {
    platform: process.platform,
    info: () => ipcRenderer.invoke(MAKER.modelReady),
    visionAi: () => ipcRenderer.invoke(MAKER.visionAi),
    ensureModel: () => ipcRenderer.invoke(MAKER.ensureModel),
    save: (png: string, name: string, look?: unknown) => ipcRenderer.invoke(MAKER.save, png, name, look),
    ensureDepth: () => ipcRenderer.invoke(MAKER.ensureDepth),
    shape3d: (png: string, wish?: string, gait?: string) =>
      ipcRenderer.invoke(MAKER.shape3d, png, wish, gait),
    illustrate: (photo: string, age: string, wish?: string, engine?: string) =>
      ipcRenderer.invoke(MAKER.illustrate, photo, age, wish, engine),
    setHfToken: (token: string | null) => ipcRenderer.invoke(MAKER.setHfToken, token),
    setupLocalDraw: () => ipcRenderer.invoke(MAKER.setupLocalDraw),
    setIllustEngine: (engine: string) => ipcRenderer.invoke(MAKER.setIllustEngine, engine),
    resetToDefault: () => ipcRenderer.invoke(MAKER.save, null, ''),
    cancel: () => ipcRenderer.send(MAKER.cancel),
    close: () => ipcRenderer.send(MAKER.close),
    onProgress: (listener) => {
      ipcRenderer.on(MAKER.progress, (_e, ratio: number) => listener(ratio));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungMaker', maker);
}
