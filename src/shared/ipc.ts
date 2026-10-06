// 메인과 화면(펫, 채팅) 사이 IPC 채널 이름과 실어 보내는 값.
import type { CustomProviderInput } from './ai/providers.ts';
import type { AiProvider, AiStatus, ImageAttachment } from './ai/types.ts';
import type { Activity } from './behavior.ts';
import type { BetaReport } from './beta-stats.ts';
import type { BubbleLayout } from './bubble-layout.ts';
import type { ChatImage, ChatState } from './chat-state.ts';
import type { CalEvent } from './event-store.ts';
import type { FocusState } from './focus.ts';
import type { GestureEvent } from './gesture.ts';
import type { Note, NoteSource } from './note-store.ts';
import type { PetKind, PoseKind, Settings } from './settings.ts';
import type { BuyResult, ShopState } from './shop.ts';
import type { Repeat, Todo } from './todo-store.ts';

export const IPC = {
  /** 펫 화면 → 메인: 커서가 펫 위에 있는지 (클릭 통과를 켜고 끈다). */
  hover: 'pet:hover',
  /** 펫 화면 → 메인: 클릭, 드래그 시작과 끝. */
  gesture: 'pet:gesture',
  /** 펫 화면 → 메인: 우클릭. */
  contextMenu: 'pet:context-menu',
  /** 펫 화면 → 메인: 펫 위 휠. zoom 이면 크기 조절, 아니면 아래 창으로 넘긴다. */
  wheel: 'pet:wheel',
  /** 메인 → 펫 화면: 컴퓨터가 바쁜지, 사용자가 자리를 비웠는지. 바뀔 때만 보낸다. */
  env: 'pet:env',
  /** 메인 → 펫 화면: AI 답을 기다리는 중인지, 방금 답했는지. */
  ai: 'pet:ai',
  /** 메인 → 펫 화면: 말풍선을 띄워라 */
  bubble: 'pet:bubble',
  /** 펫 화면 → 메인: 말풍선을 재 보니 이 크기다 (창을 키워 달라) */
  bubbleSize: 'pet:bubble-size',
  /** 펫 화면 → 메인: 말풍선이 닫혔다 (버튼 id, 'timeout', 'dismiss') */
  bubbleClosed: 'pet:bubble-closed',
  /** 메인 → 펫 화면: 창 안에서 펫과 말풍선 자리 */
  layout: 'pet:layout',
  /** 펫 화면 → 메인: 한가하니 행동을 하나 골라 달라 (P1-06) */
  activityRequest: 'pet:activity-request',
  /** 펫 화면 → 메인: 행동을 멈춘다 (잡힘, 상태 바뀜) */
  activityStop: 'pet:activity-stop',
  /** 메인 → 펫 화면: 이 행동을 해라 */
  activity: 'pet:activity',
  /** 메인 → 펫 화면: 배고픔 같은 펫 상태 (2단계) */
  status: 'pet:status',
  /** 메인 → 펫 화면: 반응 (할 일 끝냄, 밥 먹음) */
  react: 'pet:react',
  /** 펫 화면 → 메인: 쓰다듬었다 (v1) */
  petted: 'pet:petted',
  /** 메인 → 펫 화면: 던져져 날아가는 중 (v1) */
  flight: 'pet:flight',
  /** 메인 → 펫 화면: 사진 펫 그림 */
  image: 'pet:image',
} as const;

export interface BubbleButton {
  id: string;
  label: string;
}

export interface BubbleMessage {
  id: string;
  text: string;
  /** 글 옆 작은 그림 (커스텀 먹이 등, data URL) */
  image?: string;
  buttons: BubbleButton[];
  /** 이 시간이 지나면 저절로 닫힌다 (마우스를 올리면 멈춤) */
  ttlMs: number;
}

export interface PetAiState {
  thinking: boolean;
  /** 답이 막 끝났다 (말하기 동작을 잠깐 보인다). */
  answered: boolean;
}

export const LOOK = {
  /** 오버레이 → 메인: 고른 영역(모니터 기준 DIP). null 이면 취소. */
  select: 'look:select',
} as const;

export interface OverlayBridge {
  select(rect: { x: number; y: number; width: number; height: number } | null): void;
}

export const CHAT = {
  snapshot: 'chat:snapshot',
  status: 'chat:status',
  send: 'chat:send',
  cancel: 'chat:cancel',
  reset: 'chat:reset',
  provider: 'chat:provider',
  providers: 'chat:providers',
  addProvider: 'chat:add-provider',
  removeProvider: 'chat:remove-provider',
  /** 메인 → 채팅 창 */
  state: 'chat:state',
  delta: 'chat:delta',
  attach: 'chat:attach',
  petName: 'chat:pet-name',
  // v1
  setEphemeral: 'chat:set-ephemeral',
  setKnowsTodos: 'chat:set-knows-todos',
  toNote: 'chat:to-note',
  toTodos: 'chat:to-todos',
  retryWith: 'chat:retry-with',
} as const;

export const ONBOARD = {
  get: 'onboard:get',
  set: 'onboard:set',
  openMaker: 'onboard:open-maker',
  openScreenSettings: 'onboard:open-screen-settings',
  finish: 'onboard:finish',
} as const;

export interface OnboardSnapshot {
  settings: Settings;
  platform: NodeJS.Platform;
  /** 화면 기록 권한 (맥). 윈도우는 늘 granted */
  screen: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
}

export interface OnboardBridge {
  get(): Promise<OnboardSnapshot>;
  set(patch: Partial<Settings>): Promise<Settings>;
  openMaker(): void;
  openScreenSettings(): void;
  finish(): void;
}

export const SETTINGS = {
  get: 'settings:get',
  set: 'settings:set',
  setScale: 'settings:set-scale',
  openMaker: 'settings:open-maker',
  /** 베타 기록 (P4-04) */
  stats: 'settings:stats',
  copyStats: 'settings:copy-stats',
  /** 새 버전 확인 (v1). 결과 글 */
  checkUpdate: 'settings:check-update',
  openOnboarding: 'settings:open-onboarding',
  // v2
  exportData: 'settings:export-data',
  importData: 'settings:import-data',
  exportPet: 'settings:export-pet',
  importPet: 'settings:import-pet',
  importFriend: 'settings:import-friend',
  syncCalendar: 'settings:sync-calendar',
  refreshMcp: 'settings:refresh-mcp',
  /** 앱을 다시 켠다 (말을 바꾼 뒤) */
  relaunch: 'settings:relaunch',
  /** 메인 → 설정 창: 설정이 바뀌었다 */
  changed: 'settings:changed',
  /** 메인 → 설정 창: 이 칸을 보여 줘 (메뉴 막대 "의견 보내기") */
  focus: 'settings:focus',
} as const;

export interface SettingsSnapshot {
  settings: Settings;
  scale: number;
  /** 설치한 앱인지 (개발 중에는 로그인 때 켜기를 못 쓴다) */
  packaged: boolean;
  platform: NodeJS.Platform;
  version: string;
  /** 펫 MCP 서버를 AI 도구에 등록할 때 쓸 실행 파일과 스크립트 경로 (v1) */
  mcp: { exec: string; script: string };
  /** 내 claude 에 연결된 MCP 서버 (v2, 하루 한 번 읽어 둔 것) */
  myMcpServers: string[];
  /** 마지막 캘린더 가져오기 결과 */
  calendarLast: string;
}

/** 설정 창에서 바로 보여 줄 칸 */
export type SettingsSection = 'stats';

export interface SettingsBridge {
  get(): Promise<SettingsSnapshot>;
  set(patch: Partial<Settings>): Promise<Settings>;
  setScale(scale: number): void;
  /** 사진 펫 만들기 (target 을 주면 상태별 포즈) */
  openMaker(target?: MakerTarget): void;
  stats(): Promise<BetaReport>;
  /** 베타 기록 글을 클립보드에 복사한다 */
  copyStats(): Promise<boolean>;
  checkUpdate(): Promise<string>;
  openOnboarding(): void;
  /** 백업 폴더 만들기. 만든 경로 (그만두면 빈 글) */
  exportData(): Promise<string>;
  importData(): Promise<string>;
  exportPet(): Promise<string>;
  importPet(): Promise<{ ok: boolean; message: string }>;
  importFriend(): Promise<{ ok: boolean; message: string }>;
  syncCalendar(): Promise<string>;
  refreshMcp(): Promise<string[]>;
  /** 앱을 다시 켠다. 창은 열릴 때 말을 읽어서 말을 바꾸면 다시 켜야 한다 */
  relaunch(): void;
  onChanged(listener: (settings: Settings) => void): void;
  onFocus(listener: (section: SettingsSection) => void): void;
}

/** 보낼 그림: 원본은 AI 로, 작은 그림은 대화 기록으로. */
export interface OutgoingImage {
  full: ImageAttachment;
  thumb: ChatImage;
}

/** 화면에 보일 AI 정보 (실행 방법은 메인만 안다). */
export interface ProviderView {
  id: AiProvider;
  label: string;
  images: boolean;
  verified: boolean;
  usage: boolean;
  custom: boolean;
  installHint: string;
  loginHint?: string;
  /** 사용자 추가 AI 의 명령 한 줄 (보여 주기용) */
  command?: string;
  /** 기록 남기지 않기를 할 수 있는지 (claude, codex) */
  ephemeral: boolean;
}

export interface ChatSnapshot {
  petName: string;
  state: ChatState;
  /** 같이 보기로 들어와 아직 입력칸에 안 붙은 그림. */
  draft: OutgoingImage[];
}

export interface ChatBridge {
  platform: NodeJS.Platform;
  snapshot(): Promise<ChatSnapshot>;
  status(refresh: boolean): Promise<AiStatus[]>;
  send(text: string, images: OutgoingImage[]): void;
  cancel(): void;
  reset(): void;
  setProvider(provider: AiProvider): void;
  providers(): Promise<ProviderView[]>;
  addProvider(input: CustomProviderInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  removeProvider(id: AiProvider): Promise<void>;
  onState(listener: (state: ChatState) => void): void;
  onDelta(listener: (id: string, text: string) => void): void;
  onAttach(listener: (image: OutgoingImage) => void): void;
  onPetName(listener: (name: string) => void): void;
  setEphemeral(on: boolean): void;
  setKnowsTodos(on: boolean): void;
  /** 답을 메모로. 성공하면 true */
  toNote(messageId: string): Promise<boolean>;
  /** 답을 할 일로. 넣은 개수 */
  toTodos(messageId: string): Promise<number>;
  /** 마지막 질문을 다른 AI 로 다시 (한도에 걸렸을 때) */
  retryWith(provider: AiProvider): void;
}

export interface PetEnv {
  systemBusy: boolean;
  /** 사용자가 키보드, 마우스를 안 만진 시간(ms). */
  userIdleMs: number;
}

export type { GestureEvent };

/** preload 가 펫 화면에 열어 주는 기능. */
export interface PetBridge {
  platform: NodeJS.Platform;
  hover(overPet: boolean): void;
  gesture(event: GestureEvent): void;
  contextMenu(): void;
  wheel(deltaY: number, zoom: boolean): void;
  onEnv(listener: (env: PetEnv) => void): void;
  onAi(listener: (state: PetAiState) => void): void;
  /** null 이면 닫아라 */
  onBubble(listener: (bubble: BubbleMessage | null) => void): void;
  onLayout(listener: (layout: BubbleLayout) => void): void;
  bubbleSize(id: string, width: number, height: number): void;
  bubbleClosed(id: string, action: string): void;
  activityRequest(): void;
  activityStop(): void;
  onActivity(listener: (activity: Activity) => void): void;
  onStatus(listener: (status: PetStatus) => void): void;
  onReact(listener: (kind: 'happy') => void): void;
  petted(): void;
  onFlight(listener: (flying: boolean) => void): void;
  /** 사진 펫 그림 (PNG data URL). null 이면 기본 펫 */
  onImage(listener: (images: PetImages) => void): void;
}

export interface PetStatus {
  hungry: boolean;
  /** 집중 타이머 중 (펫이 잔다) */
  focus: boolean;
  /** 삐짐 칸 수 (v1) */
  sulk: number;
  /** 쿠션이 있으면 앉을 때 쿠션 위에 (v1 장난감) */
  cushion: boolean;
  /** 기본 펫 모양 (v1) */
  kind: PetKind;
}

/** 펫 그림들 (data URL). 없으면 기본 펫. 포즈는 상태별 그림 (v1) */
export interface PetImages {
  main: string | null;
  poses: Partial<Record<PoseKind, string>>;
}

export const MAKER = {
  modelReady: 'maker:model-ready',
  /** 모델 준비 (없으면 받음). 진행률은 progress 로 */
  ensureModel: 'maker:ensure-model',
  /** 메인 → 펫 만들기 창: 모델 받기 진행률 0~1 */
  progress: 'maker:progress',
  save: 'maker:save',
  close: 'maker:close',
} as const;

/**
 * 배경 제거 모델 파일 주소. 메인이 디스크 파일을 그대로 흘려 보낸다(protocol.handle).
 * 예전처럼 IPC 로 넘기면 메인이 170MB 를 두 벌 들고 있다가 GC 때까지 안 놓았다 (2026-10-06 측정, 343MB).
 */
export const MODEL_SCHEME = 'jj-model';
export const MODEL_URL = `${MODEL_SCHEME}://bg/model.onnx`;

/** 펫 만들기 창이 만드는 것: 펫 본 그림, 또는 상태별 포즈 (v1) */
export type MakerTarget = 'main' | PoseKind | 'food';

export interface MakerInfo {
  target: MakerTarget;
  petName: string;
  hasPhotoPet: boolean;
  /** 이 포즈 그림이 이미 있는지 (포즈를 만들 때) */
  hasPose: boolean;
  /** 커스텀 먹이 만들기 값 (먹이를 만들 때) */
  foodCost: number;
  modelReady: boolean;
  modelMB: number;
  size: number;
  mean: readonly number[];
  std: readonly number[];
}

export interface MakerBridge {
  platform: NodeJS.Platform;
  info(): Promise<MakerInfo>;
  ensureModel(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 다듬은 그림(PNG data URL, 움직이는 그림은 gif, webp 그대로)과 이름을 저장하고 펫을 바꾼다 */
  save(png: string, name: string): Promise<{ ok: boolean; error?: string }>;
  /** 기본 펫으로 돌아가기 */
  resetToDefault(): Promise<void>;
  close(): void;
  onProgress(listener: (ratio: number) => void): void;
}

export const PANEL = {
  snapshot: 'panel:snapshot',
  add: 'panel:add',
  complete: 'panel:complete',
  undo: 'panel:undo',
  update: 'panel:update',
  remove: 'panel:remove',
  feed: 'panel:feed',
  openChat: 'panel:open-chat',
  lookTogether: 'panel:look-together',
  close: 'panel:close',
  // 메모 (v1)
  noteGet: 'panel:note-get',
  noteAdd: 'panel:note-add',
  noteUpdate: 'panel:note-update',
  noteRemove: 'panel:note-remove',
  noteRestore: 'panel:note-restore',
  /** 메모를 AI 로 정리 (할 일로 쪼개기, 요약). 채팅 창에서 묻는다 */
  noteAi: 'panel:note-ai',
  // 일정 (v1)
  eventAdd: 'panel:event-add',
  eventUpdate: 'panel:event-update',
  eventRemove: 'panel:event-remove',
  eventRestore: 'panel:event-restore',
  // 집중 타이머 (v1)
  focusStart: 'panel:focus-start',
  focusStop: 'panel:focus-stop',
  // 상점과 놀이 (v1)
  buyToy: 'panel:buy-toy',
  buyHouse: 'panel:buy-house',
  feedWith: 'panel:feed-with',
  makeFood: 'panel:make-food',
  removeFood: 'panel:remove-food',
  play: 'panel:play',
  /** 메인 → 패널, 빠른 입력: 바뀐 상태 */
  state: 'panel:state',
  /** 메인 → 패널: 이 탭을 보여 줘 (펫 메뉴 "상점") */
  tab: 'panel:tab',
} as const;

export interface PanelState {
  petName: string;
  /** 현지 날짜 YYYY-MM-DD */
  today: string;
  open: Todo[];
  doneToday: Todo[];
  balance: number;
  fullness: number;
  hungryBelow: number;
  foodCost: number;
  /** 메모 목록 (본문은 열 때 따로 읽는다) */
  notes: NoteSummary[];
  /** 오늘 0시부터 14일 안의 일정 */
  events: CalEvent[];
  focus: FocusState;
  /** 집중 코인과 오늘 받은 집중 횟수 */
  focusCoins: number;
  /** 펫의 하루 (v1): 삐짐 칸, 기분, 친밀도 */
  life: { sulk: number; mood: number; affection: number };
  /** 연속 기록과 업적 (v2) */
  achieve: {
    streak: number;
    got: { key: string; name: string; hint: string }[];
    total: number;
    next?: { name: string; hint: string };
  };
  /** 상점 (v1). 커스텀 먹이 그림은 data URL 로 */
  shop: ShopState & { foodImages: Record<string, string> };
}

export interface NoteSummary {
  id: number;
  title: string;
  preview: string;
  source: NoteSource;
  updatedAt: number;
}

export type PanelTab = 'today' | 'todo' | 'note' | 'event' | 'shop';

export type PlayKind = 'ball' | 'walk' | 'seek';

export type NoteAiKind = 'todos' | 'summary';

export interface PanelBridge {
  platform: NodeJS.Platform;
  snapshot(): Promise<PanelState>;
  /** 한 줄 입력(빠른 입력과 같은 규칙)으로 할 일을 더한다 */
  add(text: string): Promise<{ ok: boolean; error?: string; kind?: 'todo' | 'event' }>;
  complete(id: number): Promise<number>;
  undo(id: number): Promise<number>;
  update(
    id: number,
    patch: { title?: string; due?: string | null; important?: boolean; repeat?: Repeat | null },
  ): void;
  remove(id: number): void;
  feed(): Promise<{ ok: boolean }>;
  openChat(): void;
  lookTogether(): void;
  close(): void;
  onState(listener: (state: PanelState) => void): void;
  noteGet(id: number): Promise<Note | undefined>;
  /** 새 메모. 만든 메모를 돌려준다 */
  noteAdd(): Promise<Note>;
  noteUpdate(id: number, patch: { title?: string; body?: string }): void;
  noteRemove(id: number): void;
  noteRestore(id: number): void;
  noteAi(id: number, kind: NoteAiKind): Promise<boolean>;
  /** 한 줄("내일 3시 회의")로 일정 넣기 */
  eventAdd(text: string): Promise<{ ok: boolean; error?: string; event?: CalEvent }>;
  eventUpdate(
    id: number,
    patch: { title?: string; startAt?: number; endAt?: number | null; remindMin?: number },
  ): void;
  eventRemove(id: number): void;
  eventRestore(id: number): void;
  focusStart(): void;
  focusStop(): void;
  buyToy(key: string): Promise<BuyResult>;
  buyHouse(): Promise<BuyResult>;
  /** 이 먹이를 준다 (기본, 간식, 케이크, 커스텀) */
  feedWith(key: string): Promise<{ ok: boolean; error?: string }>;
  /** 커스텀 먹이 만들기 창을 연다. 코인이 모자라면 오류 */
  makeFood(): Promise<BuyResult>;
  removeFood(key: string): void;
  play(kind: PlayKind): void;
  onTab(listener: (tab: PanelTab) => void): void;
}
