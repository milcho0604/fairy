// 메인과 화면(펫, 채팅) 사이 IPC 채널 이름과 실어 보내는 값.
import type { CustomProviderInput } from './ai/providers.ts';
import type { AiProvider, AiStatus, ImageAttachment } from './ai/types.ts';
import type { Activity } from './behavior.ts';
import type { BetaReport } from './beta-stats.ts';
import type { BubbleLayout } from './bubble-layout.ts';
import type { ChatImage, ChatState } from './chat-state.ts';
import type { GestureEvent } from './gesture.ts';
import type { Settings } from './settings.ts';
import type { Todo } from './todo-store.ts';

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
} as const;

export const SETTINGS = {
  get: 'settings:get',
  set: 'settings:set',
  setScale: 'settings:set-scale',
  openMaker: 'settings:open-maker',
  /** 베타 기록 (P4-04) */
  stats: 'settings:stats',
  copyStats: 'settings:copy-stats',
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
}

/** 설정 창에서 바로 보여 줄 칸 */
export type SettingsSection = 'stats';

export interface SettingsBridge {
  get(): Promise<SettingsSnapshot>;
  set(patch: Partial<Settings>): Promise<Settings>;
  setScale(scale: number): void;
  openMaker(): void;
  stats(): Promise<BetaReport>;
  /** 베타 기록 글을 클립보드에 복사한다 */
  copyStats(): Promise<boolean>;
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
  /** 사진 펫 그림 (PNG data URL). null 이면 기본 펫 */
  onImage(listener: (dataUrl: string | null) => void): void;
}

export interface PetStatus {
  hungry: boolean;
}

export const MAKER = {
  modelReady: 'maker:model-ready',
  /** 모델 준비 (없으면 받음). 진행률은 progress 로 */
  ensureModel: 'maker:ensure-model',
  modelBytes: 'maker:model-bytes',
  /** 메인 → 펫 만들기 창: 모델 받기 진행률 0~1 */
  progress: 'maker:progress',
  save: 'maker:save',
  close: 'maker:close',
} as const;

export interface MakerInfo {
  petName: string;
  hasPhotoPet: boolean;
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
  modelBytes(): Promise<ArrayBuffer>;
  /** 다듬은 그림(PNG data URL)과 이름을 저장하고 펫을 바꾼다 */
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
  /** 메인 → 패널, 빠른 입력: 바뀐 상태 */
  state: 'panel:state',
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
}

export interface PanelBridge {
  platform: NodeJS.Platform;
  snapshot(): Promise<PanelState>;
  /** 한 줄 입력(빠른 입력과 같은 규칙)으로 할 일을 더한다 */
  add(text: string): Promise<{ ok: boolean; error?: string }>;
  complete(id: number): Promise<number>;
  undo(id: number): Promise<number>;
  update(id: number, patch: { title?: string; due?: string | null; important?: boolean }): void;
  remove(id: number): void;
  feed(): Promise<{ ok: boolean }>;
  openChat(): void;
  lookTogether(): void;
  close(): void;
  onState(listener: (state: PanelState) => void): void;
}
