// 메인과 화면(펫, 채팅) 사이 IPC 채널 이름과 실어 보내는 값.

import type { Catalog } from './ai/catalog.ts';
import type { CustomProviderInput } from './ai/providers.ts';
import type { AiProvider, AiStatus, ImageAttachment } from './ai/types.ts';
import type { Activity } from './behavior.ts';
import type { BetaReport } from './beta-stats.ts';
import type { BubbleLayout } from './bubble-layout.ts';
import type { ChatImage, ChatState } from './chat-state.ts';
import type { BubbleKind } from './chatter.ts';
import type { EnergyLook } from './energy.ts';
import type { CalEvent } from './event-store.ts';
import type { CarryToy } from './fetch.ts';
import type { FocusState } from './focus.ts';
import type { GalleryList } from './gallery.ts';
import type { Gaze } from './gaze.ts';
import type { Point } from './geometry.ts';
import type { GestureEvent } from './gesture.ts';
import type { HouseStyle } from './house-art.ts';
import type { HouseSprites } from './house-room.ts';
import type { AgeStage } from './illustrate.ts';
import type { IllustEngine, LocalDrawInfo } from './local-draw.ts';
import type { LookMotion } from './look-motion.ts';
import type { MiniGame } from './minigames.ts';
import type { MoveAsk } from './moves.ts';
import type { PolishReply } from './note-polish.ts';
import type { Note, NoteSource } from './note-store.ts';
import type { PetKey } from './pet-keys.ts';
import type { PetLicense } from './pet-share.ts';
import type { Blueprint, Gait } from './pet3d/blueprint.ts';
import type { PetKind, PetStyle, PoseKind, Settings } from './settings.ts';
import type { SettingsTab } from './settings-tabs.ts';
import type { BuyResult, ShopState } from './shop.ts';
import type { SoundKind } from './sound.ts';
import type { PetChoice, StarterId } from './starter-pets.ts';
import type { Repeat, Todo } from './todo-store.ts';
import type { WearLook } from './wear.ts';
import type { WeekSummary } from './week.ts';

/** 업데이트 확인 결과. tone 은 글 색: ok 초록, info 회색(확인할 수 없음, 꺼짐), error 빨강 */
export interface UpdateStatus {
  text: string;
  tone: 'ok' | 'info' | 'error';
}

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
  /** 메인 → 펫 화면: 커서 쪽 방향 칸 (null 이면 앞). 칸이 바뀔 때만 */
  gaze: 'pet:gaze',
  /** 메인 → 펫 화면: 같이 보기 돋보기 모션 (shared/look-motion.ts). null 이면 끝 */
  look: 'pet:look',
  /** 메인 → 펫 화면: 효과음 하나 (놀이). 설정과 상태는 화면이 본다 */
  sound: 'pet:sound',
  /** 펫 화면 → 메인: 그리는 몸 (네 발로 걷는지, 흔들 꼬리가 있는지). 바뀔 때만 (공 물어 오기) */
  body: 'pet:body',
  /** 메인 → 펫 화면: 공을 입에 문다, 지금 문 자리를 알려 달라, 내려놓았다 (CarryMessage) */
  carry: 'pet:carry',
  /** 펫 화면 → 메인: 문 공 가운데 (펫 사각형 안 비율). 그리고 있지 않으면 null */
  carried: 'pet:carried',
  /** 펫 화면 → 메인: 집 안 그림 (깬 몸, 자는 얼굴, shared/house-room.ts HouseSprites). 모습이 바뀔 때만 */
  sprites: 'pet:sprites',
  /** 메인 → 펫 화면: 키보드로 펫 다루기를 켜고 끈다 (펫 고르기 단축키, 접근성) */
  keys: 'pet:keys',
  /** 펫 화면 → 메인: 키보드 명령 (shared/pet-keys.ts) */
  petKey: 'pet:key',
} as const;

/** 펫 얼굴 그림 (shared/face.ts). 펫 화면이 그려 메인에 주고, 메인이 얼굴을 쓰는 창에 나눠 준다 */
export const FACE = {
  /** 펫 화면 → 메인: 지금 모습의 얼굴 (PNG data URL) */
  set: 'face:set',
  /** 창 → 메인: 지금 얼굴 (아직 없으면 null) */
  get: 'face:get',
  /** 메인 → 창: 얼굴이 바뀌었다 */
  changed: 'face:changed',
} as const;

/** 얼굴을 쓰는 창(채팅, 패널, 빠른 입력, 시작 안내, 설정)에 preload 가 열어 주는 기능 */
export interface FaceBridge {
  get(): Promise<string | null>;
  onChange(listener: (face: string) => void): void;
}

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
  /** 말풍선 종류 (일정 알림이면 효과음을 켰을 때 종소리) */
  kind?: BubbleKind;
}

export interface PetAiState {
  thinking: boolean;
  /** 답이 막 끝났다 (말하기 동작을 잠깐 보인다). */
  answered: boolean;
  /** 그림이 붙은 질문이다 (생각하는 동안 돋보기로 그림을 훑는다) */
  withImage?: boolean;
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
  /** 새 대화 되돌리기 (잠깐 동안). 되돌렸으면 true */
  undoReset: 'chat:undo-reset',
  /** 답 속 주소를 기본 브라우저로 (http, https 만) */
  openLink: 'chat:open-link',
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
  // v2 무료 AI
  downloadModel: 'chat:download-model',
} as const;

export const ONBOARD = {
  get: 'onboard:get',
  set: 'onboard:set',
  openMaker: 'onboard:open-maker',
  openScreenSettings: 'onboard:open-screen-settings',
  finish: 'onboard:finish',
  /** AI 준비 상태. 설치된 AI 를 확인하는 데 몇 초 걸릴 수 있어 화면을 먼저 그리고 따로 묻는다 */
  ai: 'onboard:ai',
  /** 그림으로 들어 있는 기본 캐릭터(밀크, 초코) 고르기. 바뀐 설정을 돌려준다 */
  pickStarter: 'onboard:pick-starter',
} as const;

export interface OnboardAi {
  /** 설치되고 로그인된 AI 프로그램(Claude Code, Codex 등)이 있다 */
  hasCli: boolean;
  /** 무료 AI 가 처음 한 번 받는 모델 크기 (모델 목록의 기본 모델) */
  freeModelBytes: number;
}

export interface OnboardSnapshot {
  settings: Settings;
  platform: NodeJS.Platform;
  /** 화면 기록 권한 (맥). 윈도우는 늘 granted */
  screen: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
  /** 그림으로 들어 있는 기본 캐릭터 (밀크, 초코) */
  starters: StarterView[];
  /** 지금 사진 펫의 몸 전체 그림 (긴 변 160px data URL). 기본 펫이면 null. 첫 화면에 얼굴만 잘라 보이지 않게 */
  photo: string | null;
}

export interface OnboardBridge {
  get(): Promise<OnboardSnapshot>;
  set(patch: Partial<Settings>): Promise<Settings>;
  openMaker(): void;
  openScreenSettings(): void;
  finish(): void;
  ai(): Promise<OnboardAi>;
  pickStarter(id: StarterId): Promise<Settings>;
}

export const SETTINGS = {
  get: 'settings:get',
  set: 'settings:set',
  setScale: 'settings:set-scale',
  openMaker: 'settings:open-maker',
  /** 베타 기록 (P4-04) */
  stats: 'settings:stats',
  copyStats: 'settings:copy-stats',
  /** 의견 보내기: 가린 진단 기록 미리 보기, 그 글 그대로 복사, 파일로 저장, GitHub 문제 알리기 */
  diagnostics: 'settings:diagnostics',
  copyDiagnostics: 'settings:copy-diagnostics',
  saveDiagnostics: 'settings:save-diagnostics',
  reportIssue: 'settings:report-issue',
  /** 오픈소스 고지(THIRD_PARTY_NOTICES.txt)를 연다. 못 열면 false */
  openNotices: 'settings:open-notices',
  /** 새 버전 확인 (v1). 결과 글 */
  checkUpdate: 'settings:check-update',
  openOnboarding: 'settings:open-onboarding',
  // v2
  exportData: 'settings:export-data',
  importData: 'settings:import-data',
  exportPet: 'settings:export-pet',
  /** 방금 내보낸 파일이나 폴더를 파일 관리자에서 보인다 */
  reveal: 'settings:reveal',
  importPet: 'settings:import-pet',
  importFriend: 'settings:import-friend',
  /** 펫 갤러리 (P1 #11): 공식 펫 목록 받기, 고른 펫 데려오기, 친구에게 보낼 펫 파일 저장 */
  galleryList: 'settings:gallery-list',
  galleryAdopt: 'settings:gallery-adopt',
  galleryShare: 'settings:gallery-share',
  syncCalendar: 'settings:sync-calendar',
  refreshMcp: 'settings:refresh-mcp',
  /** 앱을 다시 켠다 (말을 바꾼 뒤) */
  relaunch: 'settings:relaunch',
  // 6단계
  /** 펫 고르기: 기본 펫(kind) 또는 보관한 펫(id). 지금 사진 펫은 보관함으로 */
  choosePet: 'settings:use-pet',
  removeSavedPet: 'settings:remove-saved-pet',
  /** 받은 모델 지우기. 새 목록을 돌려준다 */
  deleteModel: 'settings:delete-model',
  /** AI 기록 지우기: AI CLI 가 짝꿍 대화를 저장한 짝꿍 전용 폴더만 (ai-history.ts). 남은 크기를 돌려준다 */
  clearAiHistory: 'settings:clear-ai-history',
  /** 지금 사진 펫의 몸을 고른 걸음새에 맞게 다시 만든다 (같은 사진, 같은 요청사항). 그만두기는 cancelRemake */
  remakeBody: 'settings:remake-body',
  cancelRemake: 'settings:cancel-remake',
  /** 설정 창 → 메인: 지금 보는 탭. 앱이 켜져 있는 동안 기억해 다음에 창을 열면 그 탭으로 (설정 창 재구성) */
  tab: 'settings:tab',
  /** 메인 → 설정 창: 설정이 바뀌었다 */
  changed: 'settings:changed',
  /** 메인 → 설정 창: 이 칸을 보여 줘 (메뉴 막대 "의견 보내기") */
  focus: 'settings:focus',
  /** 메인 → 설정 창: 배터리로 도는지 바뀌었다 (부스트가 쉬는지 보여 준다) */
  power: 'settings:power',
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
  /** 모델 목록 (v2)과 무료 AI 모델을 받았는지 (id 별) */
  models: { catalog: Catalog; localReady: Record<string, boolean> };
  /** 만든 펫 보관함 (6단계). thumb 는 그림 data URL */
  library: SavedPetView[];
  /** 지금 사진 펫 (작게 줄인 그림과 입체 모습). 기본 펫이면 null */
  current: PetLookView | null;
  /** 그림으로 들어 있는 기본 캐릭터 (밀크, 초코) */
  starters: StarterView[];
  /** 받은 모델과 크기 (6단계) */
  storage: StoredModel[];
  /** AI CLI 가 짝꿍 대화를 저장한 크기 (AI 기록 지우기) */
  aiHistoryBytes: number;
  /** 배터리로 도는지 (부스트 모드는 이때 쉰다) */
  onBattery: boolean;
}

/**
 * 설정 창 펫 카드 그림 재료. 입체로 보기면 펫 화면처럼 figure 는 설계도로, relief 는 사진과 깊이 그림으로
 * 3D 썸네일을 그린다. key 는 파일 이름을 이은 것이라 내용이 바뀌면 같이 바뀐다 (그린 썸네일을 기억하는 열쇠)
 */
export interface PetLookView {
  key: string;
  /** 사진 그림 (긴 변 160px data URL) */
  thumb: string;
  look: 'photo' | 'figure' | 'relief';
  model?: Blueprint;
  /** 깊이 그림 (작게 줄인 회색 PNG data URL) */
  depth?: string;
  /** AI 일러스트 나이 단계 (카드에 작은 표시) */
  age?: AgeStage;
}

export interface SavedPetView extends PetLookView {
  id: string;
  name: string;
}

/** 그림으로 들어 있는 기본 캐릭터 고르기 칸 (shared/starter-pets.ts). thumb 는 긴 변 160px data URL */
export interface StarterView {
  id: StarterId;
  name: string;
  /** 화면 읽기용 설명 (긴 털 흰 고양이) */
  desc: string;
  thumb: string;
}

export interface StoredModel {
  id: string;
  label: string;
  /** draw: 내 컴퓨터에서 그리기 (엔진마다 도구와 모델이 든 폴더 통째). copy: 안전 복사본 (keep-copies.ts) */
  kind: 'llm' | 'bg' | 'depth' | 'draw' | 'copy';
  bytes: number;
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
  /** 베타 기록 + 가린 진단 기록 (메인이 가린다). 읽지 못하면 undefined */
  diagnostics(): Promise<{ text: string; lines: number; hidden: number } | undefined>;
  /** 마지막 diagnostics() 글 그대로 복사 */
  copyDiagnostics(): Promise<boolean>;
  /** 마지막 diagnostics() 글 그대로 파일로. 그만두면 ok false, 빈 message */
  saveDiagnostics(): Promise<{ ok: boolean; message: string }>;
  /** GitHub 새 이슈 (판, 운영체제만 채움) */
  reportIssue(): void;
  openNotices(): Promise<boolean>;
  checkUpdate(): Promise<UpdateStatus>;
  openOnboarding(): void;
  /** 백업 폴더 만들기. 만든 경로 (그만두면 빈 글) */
  exportData(): Promise<string>;
  importData(): Promise<string>;
  exportPet(): Promise<string>;
  reveal(path: string): void;
  importPet(): Promise<{ ok: boolean; message: string }>;
  importFriend(): Promise<{ ok: boolean; message: string }>;
  /** 펫 갤러리 목록 (메인이 raw.githubusercontent.com 에서 받아 검사한 것) */
  galleryList(): Promise<GalleryList>;
  /** 목록의 펫을 받아 데려온다 (asFriend 면 친구 펫으로). 그만두면 빈 message */
  galleryAdopt(id: string, asFriend: boolean): Promise<{ ok: boolean; message: string }>;
  /** 지금 펫을 친구에게 보낼 판 2 .jjpet 으로 저장한다 (만든 사람은 선택). 그만두면 빈 message */
  galleryShare(meta: { author?: string; license: PetLicense }): Promise<{ ok: boolean; message: string }>;
  syncCalendar(): Promise<string>;
  refreshMcp(): Promise<string[]>;
  /** 앱을 다시 켠다. 창은 열릴 때 말을 읽어서 말을 바꾸면 다시 켜야 한다 */
  relaunch(): void;
  choosePet(choice: PetChoice): Promise<SavedPetView[]>;
  removeSavedPet(id: string): Promise<SavedPetView[]>;
  deleteModel(
    id: string,
  ): Promise<{ ok: boolean; storage: StoredModel[]; localReady: Record<string, boolean> }>;
  /** AI 기록 지우기. 지운 뒤 남은 크기 */
  clearAiHistory(): Promise<{ ok: boolean; bytes: number }>;
  /** 몸 다시 만들기. 끝나면(성공이면 설정이 바뀐 뒤) 결과. AI 가 없으면 noAi */
  remakeBody(gait: Gait): Promise<{ ok: true } | { ok: false; error: string; noAi?: boolean }>;
  cancelRemake(): void;
  /** 지금 보는 탭을 메인에 알린다 (다음에 열 때 그 탭으로) */
  rememberTab(tab: SettingsTab): void;
  onChanged(listener: (settings: Settings) => void): void;
  onFocus(listener: (section: SettingsSection) => void): void;
  onPower(listener: (onBattery: boolean) => void): void;
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
  /** 방금 새 대화로 지운 대화를 되살린다. 그 사이 새로 물었거나 시간이 지났으면 false */
  undoReset(): Promise<boolean>;
  /** 답 속 주소를 기본 브라우저로 연다 (메인이 http, https 인지 다시 본다) */
  openLink(url: string): void;
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
  /** 무료 AI 모델 받기 (v2). 다 받으면 마지막 질문을 무료 AI 로 다시 묻는다 */
  downloadModel(): void;
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
  /** 한가하니 행동을 골라 달라. ask 는 펫 몸과 상태 (제자리 몸짓 고르기, shared/moves.ts) */
  activityRequest(ask?: MoveAsk): void;
  activityStop(): void;
  onActivity(listener: (activity: Activity) => void): void;
  onStatus(listener: (status: PetStatus) => void): void;
  onReact(listener: (kind: ReactKind) => void): void;
  petted(): void;
  onFlight(listener: (flying: boolean) => void): void;
  /** 커서 바라보기: 방향 칸 (null 이면 앞을 본다) */
  onGaze(listener: (gaze: Gaze | null) => void): void;
  /** 같이 보기 돋보기 모션. null 이면 끝 */
  onLook(listener: (motion: LookMotion | null) => void): void;
  /** 효과음 (놀이: 방울 터짐, 간식) */
  onSound(listener: (kind: SoundKind) => void): void;
  /** 사진 펫 그림 (PNG data URL). null 이면 기본 펫 */
  onImage(listener: (images: PetImages) => void): void;
  /** 지금 모습의 얼굴 그림을 메인에 준다 (PetStatus.face 일 때만) */
  face(url: string): void;
  /** 그리는 몸이 바뀌었다 (공 물어 오기) */
  body(body: PetBody): void;
  onCarry(listener: (message: CarryMessage) => void): void;
  /** 문 공 가운데 (펫 사각형 안 비율). 안 물고 있으면 null */
  carried(at: Point | null): void;
  /** 집 안 그림 (집에서 쉬기: 문 드나드는 깬 몸, 침대의 자는 얼굴). PetStatus.face 일 때만 */
  sprites(sprites: HouseSprites): void;
  /** 키보드로 펫 다루기 켬(펫 이름, 읽어 줄 안내에 쓴다), 끔(null) (접근성) */
  onKeys(listener: (name: string | null) => void): void;
  /** 키보드 명령 (shared/pet-keys.ts) */
  petKey(key: PetKey): void;
}

/** 펫 화면이 그리는 몸. 네 발로 걷는 펫은 공을 입에 물어 온다 */
export interface PetBody {
  quad: boolean;
  /** 흔들 꼬리가 있다 (shared/moves.ts MoveAsk.tail 과 같다) */
  tail: boolean;
}

/**
 * 공 물어 오기 (shared/fetch.ts). pick 은 고개를 숙여 from(펫 사각형 안 비율)에 있는 공을 문다.
 * size 는 공 지름 / 펫 너비. where 는 지금 문 공 자리를 carried 로 알려 달라 (그리기는 계속). null 은 내려놓았다
 */
export type CarryMessage =
  | { kind: 'pick'; toy: CarryToy; from: Point; size: number }
  | { kind: 'where' }
  | null;

/**
 * 펫 반응: 신남(통통), 밥 먹음(신남과 같은 모습, 소리만 다름), 손 흔들기(친밀도 100), 빙글 춤(친밀도 300), 친구와 만남(하트),
 * 개운함(지쳤다가 쉬고 왔다, 휴식 권유대로 쉬고 왔다: 반짝이며 기지개. shared/energy.ts)
 */
/** cheer: 큰 축하 (오늘 할 일 다 끝냄, 만난 날 기념). 머리 위로 색종이가 터져 흩날린다 */
export type ReactKind = 'happy' | 'fed' | 'wave' | 'dance' | 'love' | 'fresh' | 'cheer';

export interface PetStatus {
  hungry: boolean;
  /** 집중 타이머 중 (펫이 잔다) */
  focus: boolean;
  /** 삐짐 칸 수 (v1) */
  sulk: number;
  /** 매운맛 토라짐 단계 0~3 (shared/pout.ts). 1 고개 돌리기, 2 흥, 3 등 돌리고 앉기. 없으면 0 */
  pout?: number;
  /** 쿠션이 있으면 앉을 때 쿠션 위에 (v1 장난감) */
  cushion: boolean;
  /** 기본 펫 모양 (v1) */
  kind: PetKind;
  /** 입체로 그리기 (6단계) */
  pet3d: boolean;
  /** 입체 모습 (피규어, 게임, 실사). pet3d 일 때만. 없으면 피규어 */
  style?: PetStyle;
  /** 머리에 꽃 (친밀도 600) */
  flower: boolean;
  /** 효과음 (설정). 친구 펫은 늘 끔 */
  sounds: boolean;
  /** 부스트 모드가 지금 켜져 있는지 (설정에서 켰고 배터리가 아닐 때). 켜지면 움직임을 더 촘촘히 그린다 */
  boost: boolean;
  /** 얼굴 그림을 그려 보낼지. 내 펫 화면만 (친구 펫은 안 그린다) */
  face?: boolean;
  /** 사용자가 고른 걸음새 (설정). 없으면 자동: 설계도 gait, 없으면 다리 모양으로 짐작 */
  gait?: Gait;
  /** 기운 (하루 리듬과 연속 작업 피로, shared/energy.ts). 설정 "하루 리듬"이 꺼졌거나 친구 펫이면 없다 (예전 모습) */
  energy?: EnergyLook;
  /** 배터리 절약 중 (shared/battery.ts): 그리기 15fps 상한, 한가한 행동을 드물게. 없으면 끔 */
  saver?: boolean;
  /** 말풍선을 화면 읽기 프로그램에 읽어 준다 (설정 읽어 주기). 친구 펫은 끔 (같은 말을 두 번 읽지 않게) */
  readAloud?: boolean;
  /** 성장 단계와 오늘 옷 (기본 펫만 그린다, shared/wear.ts). 없으면 예전 모습 그대로 */
  wear?: WearLook;
}

/** 펫 그림들 (data URL). 없으면 기본 펫. 포즈는 상태별 그림 (v1) */
export interface PetImages {
  main: string | null;
  /** AI 가 만든 입체 설계도 (6단계). 있으면 입체로 보기일 때 사진 대신 */
  model: Blueprint | null;
  /** 2.5D 깊이 그림 (6단계, 회색 PNG data URL). 있으면 사진을 입체 판으로 */
  depth: string | null;
  poses: Partial<Record<PoseKind, string>>;
  /** AI 일러스트 나이 단계 (아기, 청소년은 작게 그린다, illustrate.ts ageScale). 없으면 그대로 */
  age?: AgeStage;
}

export const MAKER = {
  modelReady: 'maker:model-ready',
  /** 모델 준비 (없으면 받음). 진행률은 progress 로 */
  ensureModel: 'maker:ensure-model',
  /** 메인 → 펫 만들기 창: 모델 받기 진행률 0~1 */
  progress: 'maker:progress',
  save: 'maker:save',
  /** 다듬은 사진을 AI 에 보내 입체 설계도를 받는다 (6단계) */
  shape3d: 'maker:shape3d',
  /** 사진과 앱이 그린 설계도 그림을 AI 에 같이 보여 주고 설계도를 한 번 고친다 (선택, 6단계 v2) */
  refine3d: 'maker:refine3d',
  /** 깊이 모델 준비 (없으면 받음, 2.5D). 진행률은 progress 로 */
  ensureDepth: 'maker:ensure-depth',
  /** 사진을 볼 AI 가 있는지 (CLI 확인이 느릴 수 있어 info 와 따로) */
  visionAi: 'maker:vision-ai',
  /** 사진을 Hugging Face 무료 Space 에 보내 AI 일러스트로 다시 그린다 (사용자가 고를 때만) */
  illustrate: 'maker:illustrate',
  /** 무료 Hugging Face 토큰 넣기, 지우기 (메인에만 둔다. 창은 있는지만 안다) */
  setHfToken: 'maker:set-hf-token',
  /** 내 Mac에서 그리기 준비 (처음 한 번 도구와 모델 받기). 진행률은 progress 로, 그만두기는 cancel */
  setupLocalDraw: 'maker:setup-local-draw',
  /** AI 일러스트 그리는 곳 고르기 (설정에 남긴다) */
  setIllustEngine: 'maker:set-illust-engine',
  /** Gemini 앱(무료)에서 만들기: 요청문을 클립보드에 넣고 Gemini 를 기본 브라우저로 연다 */
  openGemini: 'maker:open-gemini',
  /** Gemini 에 올릴 사진(창이 보낸 JPEG)을 임시 폴더에 두고 Finder, 탐색기로 보여 준다 */
  revealGeminiPhoto: 'maker:reveal-gemini-photo',
  /** 받기(모델), 입체 만들기(AI), 일러스트 그리기를 멈춘다 (진행 표시의 그만두기) */
  cancel: 'maker:cancel',
  close: 'maker:close',
} as const;

/**
 * 배경 제거 모델 파일 주소. 메인이 디스크 파일을 그대로 흘려 보낸다(protocol.handle).
 * 예전처럼 IPC 로 넘기면 메인이 170MB 를 두 벌 들고 있다가 GC 때까지 안 놓았다 (2026-10-06 측정, 343MB).
 */
export const MODEL_SCHEME = 'jj-model';
export const MODEL_URL = `${MODEL_SCHEME}://bg/model.onnx`;
/** 깊이 모델 파일 주소 (2.5D) */
export const DEPTH_URL = `${MODEL_SCHEME}://depth/model.onnx`;
/** 사진 AI 엔진 wasm 주소 (설치 파일에 없고 처음 쓸 때 받는다, src/shared/ort-wasm.ts) */
export const ORT_WASM_URL = `${MODEL_SCHEME}://ort/engine.wasm`;

/** 사진 펫의 입체 모습: AI 설계도(model), 또는 2.5D 깊이 그림(depth, 회색 PNG data URL) */
export interface PetLook {
  model?: Blueprint;
  depth?: string;
  /** 설계도를 만든 요청사항 (걸음새에 맞게 다시 만들 때 같은 글로) */
  wish?: string;
  /** AI 일러스트로 다시 그린 펫의 나이 단계 */
  age?: AgeStage;
}

/** 펫 만들기 창이 만드는 것: 펫 본 그림, 또는 상태별 포즈 (v1) */
export type MakerTarget = 'main' | PoseKind | 'food';

export interface MakerInfo {
  target: MakerTarget;
  petName: string;
  /** 사진 펫을 이름 없이 만들면 붙는 이름 (이름 칸의 예시로도 보인다) */
  newPetName: string;
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
  /** 사진을 볼 수 있는 AI(claude, codex)가 있는지. 처음엔 false, visionAi() 로 따로 받는다 */
  visionAi: boolean;
  depth: { ready: boolean; mb: number; size: number; mean: readonly number[]; std: readonly number[] };
  /** 무료 Hugging Face 토큰을 넣었는지 (토큰 글은 창에 주지 않는다) */
  hfToken: boolean;
  /** 내 Mac에서 그리기: 이 컴퓨터가 되는지, 준비됐는지 */
  localDraw: LocalDrawInfo;
  /** 마지막으로 고른 그리는 곳 (설정) */
  illustEngine: IllustEngine;
}

export interface MakerBridge {
  platform: NodeJS.Platform;
  info(): Promise<MakerInfo>;
  visionAi(): Promise<boolean>;
  ensureModel(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 다듬은 그림(PNG data URL, 움직이는 그림은 gif, webp 그대로)과 이름을 저장하고 펫을 바꾼다. 입체 설계도가 있으면 같이 */
  save(png: string, name: string, look?: PetLook): Promise<{ ok: boolean; error?: string }>;
  ensureDepth(): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * AI 가 사진을 보고 입체 설계도를 만든다. wish 는 사용자 요청사항(선택, 200자, 메인이 다시 자른다).
   * 쓸 AI 가 없으면 noAi. 창을 닫으면 멈춘다
   */
  shape3d(
    png: string,
    wish?: string,
    /** 고른 걸음새. 없으면 자동(AI 가 사진을 보고 정한다) */
    gait?: Gait,
  ): Promise<{ ok: true; model: Blueprint } | { ok: false; error: string; noAi?: boolean }>;
  /**
   * 두 번째 보기: 사진(PNG data URL)과 창이 그린 설계도 그림(PNG data URL)을 같이 보여 주고 설계도를 한 번 고친다.
   * 실패하면 창이 처음 설계도를 그대로 쓴다
   */
  refine3d(
    photo: string,
    render: string,
    model: Blueprint,
    wish?: string,
    gait?: Gait,
  ): Promise<{ ok: true; model: Blueprint } | { ok: false; error: string; noAi?: boolean }>;
  /**
   * 사진(JPEG data URL)을 Hugging Face 무료 Space 로 보내 고른 나이의 일러스트로 받는다 (1분쯤).
   * 성공이면 그림 data URL (webp, png, jpeg). 그만두기와 창 닫기로 멈춘다
   */
  illustrate(
    photo: string,
    age: AgeStage,
    wish?: string,
    /** 어디서 그릴지. 없으면 무료 서버 */
    engine?: IllustEngine,
  ): Promise<
    | {
        ok: true;
        image: string;
        /** 털 다듬기 전 그림 (털 다듬기를 했을 때만, 클라우드만). 털색이 바뀌었으면 창이 이것으로 되돌리거나 색을 맞춘다 */
        before?: string;
        /** 이 컴퓨터에서 그렸으면 그 뒤의 상태 (CPU 로 되돌렸으면 시간 안내가 바뀐다) */
        localDraw?: LocalDrawInfo;
      }
    | { ok: false; error: string; kind: string; localDraw?: LocalDrawInfo }
  >;
  /** 내 컴퓨터에서 그리기 준비. 진행률은 onProgress, 그만두기는 cancel. 끝난 뒤 상태도 준다 */
  setupLocalDraw(): Promise<
    | { ok: true; localDraw?: LocalDrawInfo }
    | { ok: false; error: string; kind: string; localDraw?: LocalDrawInfo }
  >;
  /** 그리는 곳을 고른다 (설정에 남긴다). 결과는 저장된 값 */
  setIllustEngine(engine: IllustEngine): Promise<IllustEngine>;
  /** 요청문(모양, 나이, 바람으로 메인이 만든다)을 클립보드에 넣고 Gemini 앱을 연다. 못 열었으면 opened false */
  openGemini(style: string, age: string, wish?: string): Promise<{ copied: boolean; opened: boolean }>;
  /** 사진(JPEG data URL)을 임시 폴더에 두고 파일 관리자로 보여 준다 */
  revealGeminiPhoto(photo: string): Promise<boolean>;
  /** 토큰 넣기 (null 이면 지우기). 결과는 지금 토큰이 있는지 */
  setHfToken(token: string | null): Promise<{ ok: boolean; has: boolean; error?: string }>;
  /** 기본 펫으로 돌아가기 */
  resetToDefault(): Promise<void>;
  /** 받는 중인 모델과 만드는 중인 입체를 멈춘다. 멈춘 일은 실패로 끝난다 */
  cancel(): void;
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
  /** 지운 할 일 되살리기 (되돌리기) */
  restore: 'panel:restore',
  /** 한 줄 입력이 일정으로 들어간 것을 할 일로 옮기기 */
  eventToTodo: 'panel:event-to-todo',
  feed: 'panel:feed',
  openChat: 'panel:open-chat',
  /** 패널 머리의 톱니바퀴: 설정 창 열기 */
  openSettings: 'panel:open-settings',
  lookTogether: 'panel:look-together',
  close: 'panel:close',
  // 메모 (v1)
  noteGet: 'panel:note-get',
  noteAdd: 'panel:note-add',
  noteUpdate: 'panel:note-update',
  noteRemove: 'panel:note-remove',
  noteRestore: 'panel:note-restore',
  /** 메모 찾기 (본문 전체) */
  noteSearch: 'panel:note-search',
  /** 메모를 AI 로 정리 (할 일로 쪼개기, 요약). 채팅 창에서 묻는다 */
  noteAi: 'panel:note-ai',
  notePolish: 'panel:note-polish',
  notePolishInfo: 'panel:note-polish-info',
  notePolishTaken: 'panel:note-polish-taken',
  // 일정 (v1)
  eventAdd: 'panel:event-add',
  eventUpdate: 'panel:event-update',
  eventRemove: 'panel:event-remove',
  eventRestore: 'panel:event-restore',
  // 집중 타이머 (v1)
  focusStart: 'panel:focus-start',
  focusStop: 'panel:focus-stop',
  /** 놓친 알림 지우기 */
  missedClear: 'panel:missed-clear',
  // 상점과 놀이 (v1)
  buyToy: 'panel:buy-toy',
  buyHouse: 'panel:buy-house',
  buyHouseStyle: 'panel:buy-house-style',
  feedWith: 'panel:feed-with',
  makeFood: 'panel:make-food',
  removeFood: 'panel:remove-food',
  play: 'panel:play',
  // 할 일 단계 (9판 체크리스트)
  stepAdd: 'panel:step-add',
  stepToggle: 'panel:step-toggle',
  stepRename: 'panel:step-rename',
  stepRemove: 'panel:step-remove',
  /** 지난 마감을 오늘로 */
  moveOverdue: 'panel:move-overdue',
  undoMoveOverdue: 'panel:undo-move-overdue',
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
  /**
   * 안 끝난 일정 가운데 다른 일정과 시간이 겹치는 것의 id. events 에 없는 어제 시작한 긴 시각 일정과 겹치는 것도 넣는다
   * (events 는 오늘 0시 뒤에 시작한 것만이라 패널에서 셈하면 놓쳤다)
   */
  eventClash: number[];
  focus: FocusState;
  /** 집중 코인과 오늘 받은 집중 횟수 */
  focusCoins: number;
  /** 고른 집중 길이 (15, 25, 50분) */
  focusMin: number;
  /** 펫의 하루 (v1): 삐짐 칸, 기분, 친밀도 */
  /** poutWhy: 매운맛으로 토라진 까닭 (토라졌을 때만) */
  life: { sulk: number; mood: number; affection: number; poutWhy?: string };
  /** 연속 기록과 업적 (v2) */
  achieve: {
    streak: number;
    got: { key: string; name: string; hint: string }[];
    total: number;
    next?: { name: string; hint: string };
  };
  /** 오늘 놓친 알림 (최근 것이 위로) */
  missed: { text: string; at: number }[];
  /** 짝꿍 일기 (최근 것부터, 기록 있는 날만) */
  diary: DiaryEntry[];
  /** 상점 (v1). 커스텀 먹이 그림은 data URL 로 */
  shop: ShopState & { foodImages: Record<string, string> };
  /** 이번 주 돌아보기 (shared/week.ts). 기록을 못 읽으면 없다 */
  week?: WeekSummary;
}

/** 짝꿍 일기 한 날 */
export interface DiaryEntry {
  day: string;
  text: string;
  /** 오늘 (아직 쓰는 중) */
  today: boolean;
  /** AI 로 다듬은 글 */
  ai: boolean;
}

export interface NoteSummary {
  id: number;
  title: string;
  preview: string;
  source: NoteSource;
  updatedAt: number;
}

/** 한 줄 입력(PANEL.add) 결과. 어디에 언제로 넣었는지 알려 준다 */
export type PanelAddResult =
  | { ok: false; error?: string }
  /**
   * clash: 시간이 겹치는 다른 일정 (첫 것). am: 오전, 오후 없는 1~7시를 오후로 읽었을 때 오전으로 읽은 시각
   * (알림의 "오전으로" 단추가 일정을 이리로 옮긴다)
   */
  | {
      ok: true;
      kind: 'event';
      id: number;
      startAt: number;
      clash?: EventClash;
      am?: { startAt: number; endAt: number | null };
    }
  /** remindAt: "30분 뒤 알려 줘"로 넣은 알림이 울릴 때 (snooze.ts) */
  | { ok: true; kind: 'todo'; id: number; due: string | null; remindAt?: number }
  /** 여러 줄을 붙여 넣어 줄마다 넣었다 */
  | { ok: true; kind: 'many'; todos: number; events: number };

/** 새 일정과 시간이 겹치는 일정 (shared/event-overlap.ts) */
export interface EventClash {
  title: string;
  startAt: number;
}

/** 메모 찾기 결과 한 줄. 본문에서 찾았으면 찾은 곳 둘레 글(snippet)과 그 안에서 찾은 부분(mark) */
export interface NoteHit {
  id: number;
  snippet?: string;
  mark?: [number, number];
}

export type PanelTab = 'today' | 'todo' | 'note' | 'event' | 'shop';

/** 놀이: 공, 산책, 숨바꼭질과 짧은 놀이 (shared/minigames.ts) */
export type PlayKind = 'ball' | 'walk' | 'seek' | MiniGame;

export type NoteAiKind = 'todos' | 'summary';

export interface PanelBridge {
  platform: NodeJS.Platform;
  snapshot(): Promise<PanelState>;
  /** 한 줄 입력(빠른 입력과 같은 규칙)으로 할 일을 더한다 */
  add(text: string): Promise<PanelAddResult>;
  complete(id: number): Promise<number>;
  undo(id: number): Promise<number>;
  update(
    id: number,
    patch: {
      title?: string;
      due?: string | null;
      important?: boolean;
      repeat?: Repeat | null;
      /** 마감 시각 (하루 안의 분, 8판) */
      dueMin?: number | null;
      /** 미리 알림 (8판, shared/remind.ts) */
      reminds?: number[];
    },
  ): void;
  remove(id: number): void;
  /** 지운 할 일 되살리기 */
  restore(id: number): void;
  /** 한 줄 입력이 일정(id)으로 들어간 것을 지우고 같은 글(text)을 할 일로 넣는다 */
  eventToTodo(id: number, text: string): Promise<PanelAddResult>;
  feed(): Promise<{ ok: boolean }>;
  openChat(): void;
  openSettings(): void;
  lookTogether(): void;
  close(): void;
  onState(listener: (state: PanelState) => void): void;
  noteGet(id: number): Promise<Note | undefined>;
  /** 새 메모. 만든 메모를 돌려준다 */
  noteAdd(): Promise<Note>;
  noteUpdate(id: number, patch: { title?: string; body?: string }): void;
  noteRemove(id: number): void;
  noteRestore(id: number): void;
  /** 메모 찾기: 제목과 본문 전체. composing 이면 마지막 글자는 아직 조합 중이라 넓게 찾는다 */
  noteSearch(query: string, composing: boolean): Promise<NoteHit[]>;
  noteAi(id: number, kind: NoteAiKind): Promise<boolean>;
  /**
   * 메모를 AI 로 다듬는다 (전체나 고른 start~end). 채팅 창 없이 답만 받는다. 메모마다 하나만 돌고,
   * 이미 돌고 있거나 받아 둔 답이 있으면 req 없이 불러 그것을 받는다
   */
  notePolish(id: number, req?: { body: string; start: number; end: number }): Promise<PolishReply>;
  /** 지금 AI 이름과 이 메모의 다듬기 상태 (돌고 있음, 받아 둔 답 있음) */
  notePolishInfo(id: number): Promise<{ ai?: string; job: 'none' | 'busy' | 'ready' }>;
  /** 다듬은 글을 받아 띄웠다 (메인이 들고 있던 답을 지운다) */
  notePolishTaken(id: number): void;
  /** 한 줄("내일 3시 회의")로 일정 넣기 */
  eventAdd(text: string): Promise<{ ok: boolean; error?: string; event?: CalEvent; clash?: EventClash }>;
  eventUpdate(
    id: number,
    patch: {
      title?: string;
      startAt?: number;
      endAt?: number | null;
      remindMin?: number;
      /** 미리 알림 (8판, shared/remind.ts) */
      reminds?: number[];
      allDay?: boolean;
    },
  ): void;
  eventRemove(id: number): void;
  eventRestore(id: number): void;
  /** 할 일에 단계 더하기 (9판). 꽉 찼거나 끝난 할 일이면 오류 */
  /** 단계 넣기 (여러 줄이면 한 번에) */
  stepAdd(todoId: number, title: string | string[]): Promise<{ ok: boolean; error?: string }>;
  /** 단계 체크와 해제. done 이 없으면 뒤집는다 */
  stepToggle(stepId: number, done?: boolean): void;
  stepRename(stepId: number, title: string): void;
  stepRemove(stepId: number): void;
  /** 지난 마감을 오늘로. 옮긴 것과 원래 마감 (되돌리기는 update 로) */
  moveOverdue(): Promise<{ id: number; due: string | null }[]>;
  /** 방금 한 지난 마감 오늘로 되돌리기 */
  undoMoveOverdue(): void;
  /** 길이(15, 25, 50분)를 주면 그 길이로, 아니면 마지막에 고른 길이로. todoId 를 주면 그 할 일을 하는 집중 */
  focusStart(minutes?: number, todoId?: number): void;
  focusStop(): void;
  missedClear(): void;
  buyToy(key: string): Promise<BuyResult>;
  /** 지금 보고 있는 단계(level)에서 다음 단계를 산다. 그새 바뀌었으면 사지 않는다 */
  buyHouse(level: number): Promise<BuyResult>;
  /** 집 모양: 없으면 사고, 있으면 공짜로 바꾼다 */
  buyHouseStyle(style: HouseStyle): Promise<BuyResult>;
  /** 이 먹이를 준다 (기본, 간식, 케이크, 커스텀) */
  feedWith(key: string): Promise<{ ok: boolean; error?: string }>;
  /** 커스텀 먹이 만들기 창을 연다. 코인이 모자라면 오류 */
  makeFood(): Promise<BuyResult>;
  removeFood(key: string): void;
  play(kind: PlayKind): void;
  onTab(listener: (tab: PanelTab) => void): void;
}
