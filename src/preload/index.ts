import { contextBridge, ipcRenderer } from 'electron';
import type { AiProvider } from '../shared/ai/types.ts';
import type { Activity } from '../shared/behavior.ts';
import type { BubbleLayout } from '../shared/bubble-layout.ts';
import type { ChatState } from '../shared/chat-state.ts';
import {
  type BubbleMessage,
  CHAT,
  type ChatBridge,
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
  type PetBridge,
  type PetEnv,
  type PetImages,
  type PetStatus,
  SETTINGS,
  type SettingsBridge,
  type SettingsSection,
} from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';

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
    activityRequest: () => ipcRenderer.send(IPC.activityRequest),
    activityStop: () => ipcRenderer.send(IPC.activityStop),
    onActivity: (listener) => {
      ipcRenderer.on(IPC.activity, (_e, activity: Activity) => listener(activity));
    },
    onStatus: (listener) => {
      ipcRenderer.on(IPC.status, (_e, status: PetStatus) => listener(status));
    },
    onReact: (listener) => {
      ipcRenderer.on(IPC.react, (_e, kind: 'happy') => listener(kind));
    },
    onImage: (listener) => {
      ipcRenderer.on(IPC.image, (_e, images: PetImages) => listener(images));
    },
    petted: () => ipcRenderer.send(IPC.petted),
    onFlight: (listener) => {
      ipcRenderer.on(IPC.flight, (_e, flying: boolean) => listener(flying));
    },
  };
  contextBridge.exposeInMainWorld('jjakkung', pet);
}

if (kind === 'chat') {
  const chat: ChatBridge = {
    platform: process.platform,
    snapshot: () => ipcRenderer.invoke(CHAT.snapshot),
    status: (refresh: boolean) => ipcRenderer.invoke(CHAT.status, refresh),
    send: (text: string, images: OutgoingImage[]) => ipcRenderer.send(CHAT.send, text, images),
    cancel: () => ipcRenderer.send(CHAT.cancel),
    reset: () => ipcRenderer.send(CHAT.reset),
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
    onChanged: (listener) => {
      ipcRenderer.on(SETTINGS.changed, (_e, next: Settings) => listener(next));
    },
    onFocus: (listener) => {
      ipcRenderer.on(SETTINGS.focus, (_e, section: SettingsSection) => listener(section));
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
    feed: () => ipcRenderer.invoke(PANEL.feed),
    openChat: () => ipcRenderer.send(PANEL.openChat),
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
    noteAi: (id, kind) => ipcRenderer.invoke(PANEL.noteAi, id, kind),
    eventAdd: (text: string) => ipcRenderer.invoke(PANEL.eventAdd, text),
    eventUpdate: (id, patch) => ipcRenderer.send(PANEL.eventUpdate, id, patch),
    eventRemove: (id: number) => ipcRenderer.send(PANEL.eventRemove, id),
    eventRestore: (id: number) => ipcRenderer.send(PANEL.eventRestore, id),
    focusStart: () => ipcRenderer.send(PANEL.focusStart),
    focusStop: () => ipcRenderer.send(PANEL.focusStop),
    buyToy: (key: string) => ipcRenderer.invoke(PANEL.buyToy, key),
    buyHouse: () => ipcRenderer.invoke(PANEL.buyHouse),
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
    ensureModel: () => ipcRenderer.invoke(MAKER.ensureModel),
    save: (png: string, name: string) => ipcRenderer.invoke(MAKER.save, png, name),
    resetToDefault: () => ipcRenderer.invoke(MAKER.save, null, ''),
    close: () => ipcRenderer.send(MAKER.close),
    onProgress: (listener) => {
      ipcRenderer.on(MAKER.progress, (_e, ratio: number) => listener(ratio));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungMaker', maker);
}
