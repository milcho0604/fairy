import { contextBridge, ipcRenderer } from 'electron';
import type { AiProvider } from '../shared/ai/types.ts';
import type { Activity } from '../shared/behavior.ts';
import { BOND, type BondBridge } from '../shared/bond-ipc.ts';
import type { BubbleLayout } from '../shared/bubble-layout.ts';
import type { ChatState } from '../shared/chat-state.ts';
import { DATA_EXPORT, DAY, type DayBridge, type ExportBridge } from '../shared/day-ipc.ts';
import { EVENTS, type EventList, type EventsBridge } from '../shared/events-ipc.ts';
import type { Gaze } from '../shared/gaze.ts';
import { GCAL, type GcalBridge, type GcalStatus } from '../shared/gcal.ts';
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
  type RestoreState,
  SETTINGS,
  type SettingsBridge,
  type SettingsSection,
} from '../shared/ipc.ts';
import { LINES, type LinesBridge } from '../shared/lines-ipc.ts';
import type { LookMotion } from '../shared/look-motion.ts';
import type { MoveAsk } from '../shared/moves.ts';
import { NOTES, type NoteBox, type NoteBridge } from '../shared/note-ipc.ts';
import { NOTICE, type NoticeBridge, type NoticeView } from '../shared/notice-ipc.ts';
import { SERVER, type ServerBridge, type ServerStatus } from '../shared/server-account.ts';
import type { Settings } from '../shared/settings.ts';
import type { SoundKind } from '../shared/sound.ts';
import type { TogetherLook } from '../shared/together.ts';

// 샌드박스 preload 는 다른 파일을 require 할 수 없어 한 파일로 묶는다.
// 창마다 자기 기능만 열어 준다: 메인이 창을 만들 때 `--jj-window=<이름>` 을 넘긴다.
const kind = process.argv.find((a) => a.startsWith('--jj-window='))?.split('=')[1];
// 화면 말 (v2 다국어). 모든 창이 같은 이름으로 읽는다. 모르는 값이면 한국어
const lang = process.argv.find((a) => a.startsWith('--jj-lang='))?.split('=')[1] === 'en' ? 'en' : 'ko';
contextBridge.exposeInMainWorld('jjakkungLang', lang);
// 사용자가 고친 펫 대사 (#125): 화면의 t() 도 같은 글을 쓰게 창이 뜰 때 받는다. 못 받으면 기본 대사
let lineOverrides: unknown;
try {
  lineOverrides = ipcRenderer.sendSync(LINES.sync);
} catch {
  lineOverrides = undefined;
}
contextBridge.exposeInMainWorld('jjakkungLineOverrides', lineOverrides);

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
    onShotAsk: (listener) => {
      ipcRenderer.on(IPC.shotAsk, (_e, id: number, model: unknown) => listener(id, model));
    },
    shotGot: (id: number, png: string | null) => ipcRenderer.send(IPC.shotGot, id, png),
    onImpact: (listener) => {
      ipcRenderer.on(IPC.impact, (_e, hit: { axis: 'x' | 'y'; k: number }) => listener(hit));
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
    onKeys: (listener) => {
      ipcRenderer.on(IPC.keys, (_e, name: unknown) => listener(typeof name === 'string' ? name : null));
    },
    petKey: (key) => ipcRenderer.send(IPC.petKey, key),
    onTogether: (listener) => {
      ipcRenderer.on(IPC.together, (_e, look: TogetherLook) => listener(look));
    },
  };
  contextBridge.exposeInMainWorld('jjakkung', pet);
}

// 이름 옆 펫 얼굴 (shared/face.ts). 펫 화면이 그린 지금 모습을 받는다
if (
  kind === 'chat' ||
  kind === 'panel' ||
  kind === 'quick' ||
  kind === 'onboarding' ||
  kind === 'settings' ||
  kind === 'knows'
) {
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
    agreeTicket: () => ipcRenderer.send(CHAT.agreeTicket),
    reportTicket: (id) => ipcRenderer.invoke(CHAT.reportTicket, id),
    planAction: (kind, todoId) => ipcRenderer.send(CHAT.planAction, kind, todoId),
    downloadModel: () => ipcRenderer.send(CHAT.downloadModel),
    threads: (query) => ipcRenderer.invoke(CHAT.threads, query ?? ''),
    openThread: (id) => ipcRenderer.invoke(CHAT.openThread, id),
    renameThread: (id, title) => ipcRenderer.invoke(CHAT.renameThread, id, title),
    deleteThread: (id) => ipcRenderer.invoke(CHAT.deleteThread, id),
    look: () => ipcRenderer.invoke(CHAT.look),
    setLook: (on, agree) => ipcRenderer.send(CHAT.setLook, on, agree),
    lookShot: () => ipcRenderer.invoke(CHAT.lookShot),
    lookPick: () => ipcRenderer.send(CHAT.lookPick),
    lookSettings: () => ipcRenderer.send(CHAT.lookSettings),
    onLook: (listener) => {
      ipcRenderer.on(CHAT.lookState, (_e, view) => listener(view));
    },
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
    pickStarter: (id) => ipcRenderer.invoke(ONBOARD.pickStarter, id),
  };
  contextBridge.exposeInMainWorld('jjakkungOnboard', onboard);
}

// 공지 창 (main/notice-window.ts): 보일 공지를 받고 단추 id 만 돌려준다
if (kind === 'notice') {
  const notice: NoticeBridge = {
    get: () => ipcRenderer.invoke(NOTICE.get),
    onChange: (listener) => {
      ipcRenderer.on(NOTICE.changed, (_e, view: NoticeView) => listener(view));
    },
    act: (id: string) => ipcRenderer.send(NOTICE.act, id),
    size: (height: number) => ipcRenderer.send(NOTICE.size, height),
  };
  contextBridge.exposeInMainWorld('jjakkungNotice', notice);
}

if (kind === 'settings') {
  const bridge: SettingsBridge = {
    get: () => ipcRenderer.invoke(SETTINGS.get),
    set: (patch) => ipcRenderer.invoke(SETTINGS.set, patch),
    setScale: (scale: number) => ipcRenderer.send(SETTINGS.setScale, scale),
    openMaker: (target) => ipcRenderer.send(SETTINGS.openMaker, target),
    stats: () => ipcRenderer.invoke(SETTINGS.stats),
    copyStats: () => ipcRenderer.invoke(SETTINGS.copyStats),
    diagnostics: () => ipcRenderer.invoke(SETTINGS.diagnostics),
    copyDiagnostics: () => ipcRenderer.invoke(SETTINGS.copyDiagnostics),
    saveDiagnostics: () => ipcRenderer.invoke(SETTINGS.saveDiagnostics),
    aiDetect: (refresh) => ipcRenderer.invoke(SETTINGS.aiDetect, refresh === true),
    reportIssue: () => ipcRenderer.send(SETTINGS.reportIssue),
    openNotices: () => ipcRenderer.invoke(SETTINGS.openNotices),
    checkUpdate: () => ipcRenderer.invoke(SETTINGS.checkUpdate),
    openOnboarding: () => ipcRenderer.send(SETTINGS.openOnboarding),
    exportData: () => ipcRenderer.invoke(SETTINGS.exportData),
    importData: (kind) => ipcRenderer.invoke(SETTINGS.importData, kind),
    restoreState: () => ipcRenderer.invoke(SETTINGS.restoreState),
    restoreUndo: () => ipcRenderer.invoke(SETTINGS.restoreUndo),
    restoreConfirm: (id) => ipcRenderer.invoke(SETTINGS.restoreConfirm, id),
    restoreCancel: (id) => ipcRenderer.send(SETTINGS.restoreCancel, id),
    onRestoreChanged: (listener) => {
      const on = (_e: unknown, state: RestoreState) => listener(state);
      ipcRenderer.on(SETTINGS.restoreChanged, on);
      return () => {
        ipcRenderer.removeListener(SETTINGS.restoreChanged, on);
      };
    },
    exportPet: () => ipcRenderer.invoke(SETTINGS.exportPet),
    reveal: (path: string) => ipcRenderer.send(SETTINGS.reveal, path),
    importPet: () => ipcRenderer.invoke(SETTINGS.importPet),
    importFriend: () => ipcRenderer.invoke(SETTINGS.importFriend),
    importPetDrop: (name, bytes) => ipcRenderer.invoke(SETTINGS.importPetDrop, name, bytes),
    galleryList: () => ipcRenderer.invoke(SETTINGS.galleryList),
    galleryAdopt: (id, asFriend) => ipcRenderer.invoke(SETTINGS.galleryAdopt, id, asFriend),
    galleryShare: (meta) => ipcRenderer.invoke(SETTINGS.galleryShare, meta),
    syncCalendar: () => ipcRenderer.invoke(SETTINGS.syncCalendar),
    refreshMcp: () => ipcRenderer.invoke(SETTINGS.refreshMcp),
    relaunch: () => ipcRenderer.send(SETTINGS.relaunch),
    choosePet: (choice) => ipcRenderer.invoke(SETTINGS.choosePet, choice),
    removeSavedPet: (id: string) => ipcRenderer.invoke(SETTINGS.removeSavedPet, id),
    deleteModel: (id: string) => ipcRenderer.invoke(SETTINGS.deleteModel, id),
    clearAiHistory: () => ipcRenderer.invoke(SETTINGS.clearAiHistory),
    coinState: () => ipcRenderer.invoke(SETTINGS.coinState),
    resetCoins: (scope, expect) => ipcRenderer.invoke(SETTINGS.resetCoins, scope, expect),
    remakeBody: (gait) => ipcRenderer.invoke(SETTINGS.remakeBody, gait),
    cancelRemake: () => ipcRenderer.send(SETTINGS.cancelRemake),
    rememberTab: (tab) => ipcRenderer.send(SETTINGS.tab, tab),
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
  // 구글 캘린더에 쓰기 (6단계): 상태만 오간다. 토큰은 메인에만 있다
  const gcal: GcalBridge = {
    status: () => ipcRenderer.invoke(GCAL.status),
    connect: () => ipcRenderer.invoke(GCAL.connect),
    cancel: () => ipcRenderer.send(GCAL.cancel),
    disconnect: () => ipcRenderer.invoke(GCAL.disconnect),
    setPush: (on: boolean) => ipcRenderer.invoke(GCAL.setPush, on),
    setPull: (on: boolean) => ipcRenderer.invoke(GCAL.setPull, on),
    setAi: (on: boolean) => ipcRenderer.invoke(GCAL.setAi, on),
    setCalendars: (c) => ipcRenderer.invoke(GCAL.setCalendars, c),
    listCalendars: () => ipcRenderer.invoke(GCAL.listCalendars),
    syncNow: () => ipcRenderer.invoke(GCAL.syncNow),
    onChanged: (listener) => {
      const h = (_e: unknown, s: GcalStatus) => listener(s);
      ipcRenderer.on(GCAL.changed, h);
      return () => {
        ipcRenderer.removeListener(GCAL.changed, h);
      };
    },
  };
  contextBridge.exposeInMainWorld('jjakkungGcal', gcal);
  // 페어리 서버 계정 (이슈 #99): 상태만 오간다. 토큰은 메인에만 있다
  const server: ServerBridge = {
    status: () => ipcRenderer.invoke(SERVER.status),
    setAge: (age, nickname) => ipcRenderer.invoke(SERVER.setAge, age, nickname),
    setNickname: (nickname) => ipcRenderer.invoke(SERVER.setNickname, nickname),
    copyCode: () => ipcRenderer.invoke(SERVER.copyCode),
    claim: (eventId) => ipcRenderer.invoke(SERVER.claim, eventId),
    coupon: (code) => ipcRenderer.invoke(SERVER.coupon, code),
    // 운영자 칸 (#101): 메인이 운영자 계정인지 다시 보고, 서버도 요청마다 본다. 세션 토큰은 화면에 오지 않는다
    adminOverview: (q) => ipcRenderer.invoke(SERVER.adminOverview, q),
    adminAction: (action, fields) => ipcRenderer.invoke(SERVER.adminAction, action, fields),
    turnOn: () => ipcRenderer.invoke(SERVER.turnOn),
    updateNow: () => ipcRenderer.invoke(SERVER.updateNow),
    syncNow: () => ipcRenderer.invoke(SERVER.syncNow),
    login: (service) => ipcRenderer.invoke(SERVER.login, service),
    cancelLogin: () => ipcRenderer.send(SERVER.cancelLogin),
    logout: () => ipcRenderer.invoke(SERVER.logout),
    merge: (yes) => ipcRenderer.invoke(SERVER.merge, yes),
    remove: () => ipcRenderer.invoke(SERVER.remove),
    onChanged: (listener) => {
      const h = (_e: unknown, s: ServerStatus) => listener(s);
      ipcRenderer.on(SERVER.changed, h);
      return () => {
        ipcRenderer.removeListener(SERVER.changed, h);
      };
    },
    // 서버 백업 (#102)
    backupList: () => ipcRenderer.invoke(SERVER.backupList),
    backupAgree: (yes) => ipcRenderer.invoke(SERVER.backupAgree, yes),
    backupUpload: () => ipcRenderer.invoke(SERVER.backupUpload),
    backupDownload: (id) => ipcRenderer.invoke(SERVER.backupDownload, id),
    backupDelete: (id) => ipcRenderer.invoke(SERVER.backupDelete, id),
    calendarHintNo: () => ipcRenderer.invoke(SERVER.calendarHintNo),
  };
  contextBridge.exposeInMainWorld('jjakkungServer', server);
  // 이벤트 목록 (#101): 홈페이지 정적 파일이라 서버 없이도 보인다
  const siteEvents: EventsBridge = {
    list: () => ipcRenderer.invoke(EVENTS.list),
    onChanged: (listener) => {
      const h = (_e: unknown, l: EventList) => listener(l);
      ipcRenderer.on(EVENTS.changed, h);
      return () => {
        ipcRenderer.removeListener(EVENTS.changed, h);
      };
    },
  };
  contextBridge.exposeInMainWorld('jjakkungEvents', siteEvents);
  // 내보내기 (메모 .md, 할 일 .csv/.md, 일정 .ics). 저장 대화상자와 쓰기는 메인이 한다
  const exporter: ExportBridge = { run: (kind) => ipcRenderer.invoke(DATA_EXPORT.run, kind) };
  contextBridge.exposeInMainWorld('jjakkungExport', exporter);
  // 펫 대사 고치기 (#125)
  const lines: LinesBridge = {
    state: (lang) => ipcRenderer.invoke(LINES.state, lang),
    save: (lang, key, text) => ipcRenderer.invoke(LINES.save, lang, key, text),
    reset: (lang, key) => ipcRenderer.invoke(LINES.reset, lang, key),
  };
  contextBridge.exposeInMainWorld('jjakkungLines', lines);
}

// 짝꿍이 아는 것, 첫 7일 여정, 성장과 옷, 주간 회고 카드 (shared/bond-ipc.ts). 메인이 창마다 보낸 곳을 본다
if (kind === 'panel' || kind === 'settings' || kind === 'knows') {
  const bond: BondBridge = {
    openKnows: () => ipcRenderer.send(BOND.openKnows),
    knowsGet: () => ipcRenderer.invoke(BOND.knowsGet),
    knowsSet: (patch) => ipcRenderer.invoke(BOND.knowsSet, patch),
    onKnowsChanged: (listener) => {
      ipcRenderer.on(BOND.knowsChanged, (_e, next) => listener(next));
    },
    journeyGet: () => ipcRenderer.invoke(BOND.journeyGet),
    journeyGo: (step) => ipcRenderer.send(BOND.journeyGo, step),
    journeyTried: (step) => ipcRenderer.send(BOND.journeyTried, step),
    journeySkip: () => ipcRenderer.send(BOND.journeySkip),
    onJourney: (listener) => {
      ipcRenderer.on(BOND.journeyChanged, (_e, view) => listener(view));
    },
    weekTitles: () => ipcRenderer.invoke(BOND.weekTitles),
    weekSave: (png) => ipcRenderer.invoke(BOND.weekSave, png),
    growGet: () => ipcRenderer.invoke(BOND.growGet),
  };
  contextBridge.exposeInMainWorld('jjakkungBond', bond);
}

// 매일 쪽지함 (shared/daily-note.ts). 패널 오늘 탭만
if (kind === 'panel') {
  const notes: NoteBridge = {
    list: () => ipcRenderer.invoke(NOTES.list),
    read: (day) => ipcRenderer.send(NOTES.read, day),
    onChange: (listener) => {
      ipcRenderer.on(NOTES.changed, (_e, box: NoteBox) => listener(box));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungNotes', notes);
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
    trashList: () => ipcRenderer.invoke(PANEL.trashList),
    trashRestore: (id: number) => ipcRenderer.invoke(PANEL.trashRestore, id),
    trashPurge: (id: number) => ipcRenderer.invoke(PANEL.trashPurge, id),
    trashEmpty: () => ipcRenderer.invoke(PANEL.trashEmpty),
    focusMonth: (month: string) => ipcRenderer.invoke(PANEL.focusMonth, month),
    eventToTodo: (id: number, text: string) => ipcRenderer.invoke(PANEL.eventToTodo, id, text),
    feed: () => ipcRenderer.invoke(PANEL.feed),
    openChat: () => ipcRenderer.send(PANEL.openChat),
    openSettings: () => ipcRenderer.send(PANEL.openSettings),
    lookTogether: () => ipcRenderer.send(PANEL.lookTogether),
    close: () => ipcRenderer.send(PANEL.close),
    quickFit: (contentCss: number) => ipcRenderer.send(PANEL.quickFit, contentCss),
    onState: (listener) => {
      ipcRenderer.on(PANEL.state, (_e, state: PanelState) => listener(state));
    },
    noteGet: (id: number) => ipcRenderer.invoke(PANEL.noteGet, id),
    noteAdd: (text?: string) => ipcRenderer.invoke(PANEL.noteAdd, text),
    noteUpdate: (id, patch, base) => ipcRenderer.invoke(PANEL.noteUpdate, id, patch, base),
    noteRemove: (id: number) => ipcRenderer.send(PANEL.noteRemove, id),
    noteRestore: (id: number) => ipcRenderer.send(PANEL.noteRestore, id),
    noteSearch: (query: string, composing: boolean) => ipcRenderer.invoke(PANEL.noteSearch, query, composing),
    noteAi: (id, kind) => ipcRenderer.invoke(PANEL.noteAi, id, kind),
    notePolish: (id, req) => ipcRenderer.invoke(PANEL.notePolish, id, req),
    notePolishInfo: (id) => ipcRenderer.invoke(PANEL.notePolishInfo, id),
    notePolishTaken: (id) => ipcRenderer.send(PANEL.notePolishTaken, id),
    eventAdd: (text: string, day?: string) => ipcRenderer.invoke(PANEL.eventAdd, text, day),
    eventsBetween: (from: number, to: number) => ipcRenderer.invoke(PANEL.eventsBetween, from, to),
    eventUpdate: (id, patch) => ipcRenderer.send(PANEL.eventUpdate, id, patch),
    eventRemove: (id: number) => ipcRenderer.send(PANEL.eventRemove, id),
    eventRestore: (id: number) => ipcRenderer.send(PANEL.eventRestore, id),
    stepAdd: (todoId: number, title: string | string[]) => ipcRenderer.invoke(PANEL.stepAdd, todoId, title),
    stepToggle: (stepId: number, done?: boolean) => ipcRenderer.send(PANEL.stepToggle, stepId, done),
    stepRename: (stepId: number, title: string) => ipcRenderer.send(PANEL.stepRename, stepId, title),
    stepRemove: (stepId: number) => ipcRenderer.send(PANEL.stepRemove, stepId),
    pin: (kind, id, on) => ipcRenderer.send(PANEL.pin, kind, id, on),
    moveOverdue: () => ipcRenderer.invoke(PANEL.moveOverdue),
    undoMoveOverdue: () => ipcRenderer.send(PANEL.undoMoveOverdue),
    focusStart: (minutes?: number, todoId?: number) => ipcRenderer.send(PANEL.focusStart, minutes, todoId),
    focusStop: () => ipcRenderer.send(PANEL.focusStop),
    missedClear: () => ipcRenderer.send(PANEL.missedClear),
    buyToy: (key: string) => ipcRenderer.invoke(PANEL.buyToy, key),
    buyHouse: (level: number) => ipcRenderer.invoke(PANEL.buyHouse, level),
    buyHouseStyle: (style: string) => ipcRenderer.invoke(PANEL.buyHouseStyle, style),
    setHouseHidden: (on: boolean) => ipcRenderer.send(PANEL.setHouseHidden, on),
    feedWith: (key: string) => ipcRenderer.invoke(PANEL.feedWith, key),
    makeFood: () => ipcRenderer.invoke(PANEL.makeFood),
    removeFood: (key: string) => ipcRenderer.send(PANEL.removeFood, key),
    play: (kind) => ipcRenderer.send(PANEL.play, kind),
    onTab: (listener) => {
      ipcRenderer.on(PANEL.tab, (_e, tab: PanelTab) => listener(tab));
    },
  };
  contextBridge.exposeInMainWorld('jjakkungPanel', panel);
  // 하루 도구 (습관, 아침 계획, 방금 울린 알림 미루기, shared/day-ipc.ts)
  const day: DayBridge = {
    habits: () => ipcRenderer.invoke(DAY.habits),
    plan: (auto) => ipcRenderer.invoke(DAY.plan, auto === true),
    planSave: (picks, note) => ipcRenderer.invoke(DAY.planSave, picks, note),
    planPolish: (picks) => ipcRenderer.invoke(DAY.planPolish, picks),
    planPrefs: (prefs) => ipcRenderer.invoke(DAY.planPrefs, prefs),
    planShown: () => ipcRenderer.send(DAY.planShown),
    onOpenPlan: (listener) => {
      ipcRenderer.on(DAY.openPlan, () => listener());
    },
    remind: () => ipcRenderer.invoke(DAY.remind),
    remindSnooze: (choice) => ipcRenderer.invoke(DAY.remindSnooze, choice),
    remindDismiss: () => ipcRenderer.send(DAY.remindDismiss),
  };
  contextBridge.exposeInMainWorld('jjakkungDay', day);
}

if (kind === 'maker') {
  const maker: MakerBridge = {
    platform: process.platform,
    info: () => ipcRenderer.invoke(MAKER.modelReady),
    visionAi: () => ipcRenderer.invoke(MAKER.visionAi),
    textAi: () => ipcRenderer.invoke(MAKER.textAi),
    describe: (text: string) => ipcRenderer.invoke(MAKER.describe, text),
    tweak: (model: unknown, instruction: string, original: string, named: boolean) =>
      ipcRenderer.invoke(MAKER.tweak, model, instruction, original, named),
    ensureModel: () => ipcRenderer.invoke(MAKER.ensureModel),
    save: (png: string, name: string, look?: unknown) => ipcRenderer.invoke(MAKER.save, png, name, look),
    ensureDepth: () => ipcRenderer.invoke(MAKER.ensureDepth),
    shape3d: (png: string, wish?: string, gait?: string) =>
      ipcRenderer.invoke(MAKER.shape3d, png, wish, gait),
    refine3d: (photo: string, render: string, model: unknown, wish?: string, gait?: string) =>
      ipcRenderer.invoke(MAKER.refine3d, photo, render, model, wish, gait),
    illustrate: (photo: string, age: string, wish?: string, engine?: string) =>
      ipcRenderer.invoke(MAKER.illustrate, photo, age, wish, engine),
    setHfToken: (token: string | null) => ipcRenderer.invoke(MAKER.setHfToken, token),
    setupLocalDraw: () => ipcRenderer.invoke(MAKER.setupLocalDraw),
    setIllustEngine: (engine: string) => ipcRenderer.invoke(MAKER.setIllustEngine, engine),
    openGemini: (style: string, age: string, wish?: string) =>
      ipcRenderer.invoke(MAKER.openGemini, style, age, wish),
    revealGeminiPhoto: (photo: string) => ipcRenderer.invoke(MAKER.revealGeminiPhoto, photo),
    resetToDefault: () => ipcRenderer.invoke(MAKER.save, null, ''),
    cancel: () => ipcRenderer.send(MAKER.cancel),
    close: () => ipcRenderer.send(MAKER.close),
    onProgress: (listener) => {
      ipcRenderer.on(MAKER.progress, (_e, ratio: number) => listener(ratio));
    },
    spriteSource: () => ipcRenderer.invoke(MAKER.spriteSource),
    spriteRow: (row: string, reference: string, key: string, engine?: string) =>
      ipcRenderer.invoke(MAKER.spriteRow, row, reference, key, engine),
    spriteGemini: (row: string, key: string) => ipcRenderer.invoke(MAKER.spriteGemini, row, key),
    revealSpriteRef: (reference: string) => ipcRenderer.invoke(MAKER.revealSpriteRef, reference),
    saveSprites: (sprites: Record<string, string>) => ipcRenderer.invoke(MAKER.saveSprites, sprites),
    openSprites: () => ipcRenderer.send(MAKER.openSprites),
  };
  contextBridge.exposeInMainWorld('jjakkungMaker', maker);
}
