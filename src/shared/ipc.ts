// 메인과 화면(펫, 채팅) 사이 IPC 채널 이름과 실어 보내는 값.

import type { DetectRow } from './ai/capability.ts';
import type { Catalog } from './ai/catalog.ts';
import type { CustomProviderInput } from './ai/providers.ts';
import type { AiProvider, AiStatus, ImageAttachment } from './ai/types.ts';
import type { Activity } from './behavior.ts';
import type { BetaReport } from './beta-stats.ts';
import type { BubbleAnchor, BubbleLayout } from './bubble-layout.ts';
import type { ChatLookView } from './chat-look.ts';
import type { ChatImage, ChatState } from './chat-state.ts';
import type { ThreadMeta } from './chat-threads.ts';
import type { BubbleKind } from './chatter.ts';
import type { PanelDraftKind } from './draft-store.ts';
import type { EnergyLook } from './energy.ts';
import type { CalEvent } from './event-store.ts';
import type { CarryToy } from './fetch.ts';
import type { FindAllResult } from './find-all.ts';
import type { FocusState } from './focus.ts';
import type { FocusDay } from './focus-month.ts';
import type { GalleryList } from './gallery.ts';
import type { Gaze } from './gaze.ts';
import type { PanelGcal } from './gcal.ts';
import type { Point } from './geometry.ts';
import type { GestureEvent } from './gesture.ts';
import type { PanelView } from './home-policy.ts';
import type { HouseStyle } from './house-art.ts';
import type { HouseSprites } from './house-room.ts';
import type { AgeStage } from './illustrate.ts';
import type { IllustEngine, LocalDrawInfo } from './local-draw.ts';
import type { LookMotion } from './look-motion.ts';
import type { MiniGame } from './minigames.ts';
import type { MoveAsk } from './moves.ts';
import type { NoteKept } from './note-keep.ts';
import type { PolishReply } from './note-polish.ts';
import type { Note, NoteSource } from './note-store.ts';
import type { PetKey } from './pet-keys.ts';
import type { PetLicense } from './pet-share.ts';
import type { PetSprites } from './pet-sprites.ts';
import type { Blueprint, Gait } from './pet3d/blueprint.ts';
import type { PinKind } from './pin.ts';
import type { PetKind, PetStyle, PoseKind, Settings } from './settings.ts';
import type { SettingsTab } from './settings-tabs.ts';
import type { BuyResult, CoinResetResult, CoinResetScope, ShopState } from './shop.ts';
import type { SoundKind } from './sound.ts';
import type { PetChoice, StarterId } from './starter-pets.ts';
import type { KeptToast } from './toast-keep.ts';
import type { Repeat, Todo } from './todo-store.ts';
import type { NoteLook, TogetherLook } from './together.ts';
import type { TrashKind, TrashRecord } from './trash.ts';
import type { ViewKeep } from './view-keep.ts';
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
  /** 펫 화면 → 메인: 꾹 누르는 동안 펫을 키워 달라 / 원래대로 (이슈 #124) */
  peek: 'pet:peek',
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
  bubbleAnchor: 'pet:bubble-anchor',
  /** 펫 화면 → 메인: 말풍선이 닫혔다 (버튼 id, 'timeout', 'dismiss') */
  bubbleClosed: 'pet:bubble-closed',
  /** 메인 → 펫 화면: 창 안에서 펫과 말풍선 자리 */
  layout: 'pet:layout',
  hoverReset: 'pet:hover-reset',
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
  /** 메인 → 펫 화면: 이 설계도를 정면에서 그려 달라 (걸음새로 몸을 다시 만든 뒤 새 펫 그림, maker.ts remake) */
  shotAsk: 'pet:shot-ask',
  /** 펫 화면 → 메인: 그린 PNG data URL (못 그렸으면 null) */
  shotGot: 'pet:shot-got',
  /** 메인 → 펫 화면: 날아가다 바닥(y)이나 벽(x)에 부딪혔다. k 는 세기 0~1 */
  impact: 'pet:impact',
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
  /** 메인 → 펫 화면: 같이 타자 치기, 같이 일하는 표정, 든 쪽지 (shared/together.ts TogetherLook). 바뀔 때만 */
  together: 'pet:together',
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
  /** 펼친 쪽지 모양 (매일 쪽지는 종이, 특별한 편지는 분홍 편지지). 없으면 보통 말풍선 */
  paper?: NoteLook;
  /** 늘 떠 있는 상태 말풍선 (진행 중, 집중 남은 시간, 이슈 #124): 효과음, 읽어 주기, 말하는 동작이 없고 저절로 닫히지 않는다 */
  ambient?: boolean;
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
  nearPet: 'chat:near-pet',
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
  /** AI 대화권 (#100): 국외 이전 안내를 읽고 쓰기로 함, 답 신고 (따로 확인한 뒤) */
  agreeTicket: 'chat:agree-ticket',
  reportTicket: 'chat:report-ticket',
  /** 규칙 답("오늘 뭐부터") 아래 단추: 'focus' | 'panel' 과 할 일 id */
  planAction: 'chat:plan-action',
  // v2 무료 AI
  downloadModel: 'chat:download-model',
  /** 지난 대화 목록 (찾는 말) → ThreadList */
  threads: 'chat:threads',
  openThread: 'chat:open-thread',
  renameThread: 'chat:rename-thread',
  deleteThread: 'chat:delete-thread',
  // 같이 보기 (shared/chat-look.ts)
  look: 'chat:look',
  setLook: 'chat:set-look',
  lookShot: 'chat:look-shot',
  lookPick: 'chat:look-pick',
  lookSettings: 'chat:look-settings',
  /** 메인 → 채팅 창: 같이 보기 상태가 바뀌었다 */
  lookState: 'chat:look-state',
  /** 쓰던 글과 붙인 그림을 메인에 맡긴다 (창을 닫았다 열어도 돌려받는다, #145) */
  draftText: 'chat:draft-text',
  draftImages: 'chat:draft-images',
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
  /** AI 마다 찾았는지 (Claude Code, Codex, Cursor, Gemini CLI, 내 컴퓨터 AI). 시작 안내가 "찾았어 ✓" 표를 그린다 (이슈 #126) */
  detect: DetectRow[];
  /** 무료 AI 가 처음 한 번 받는 모델 크기 (모델 목록의 기본 모델) */
  freeModelBytes: number;
}

export interface OnboardSnapshot {
  settings: Settings;
  platform: NodeJS.Platform;
  /** 설치판이 이 컴퓨터의 자동 실행 항목을 관리할 수 있는지. 격리 시험은 제외한다. */
  canLaunchAtLogin: boolean;
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
  reset: 'settings:reset',
  setScale: 'settings:set-scale',
  openMaker: 'settings:open-maker',
  /** 설정 창에서 큰 창의 페어리, 비서 구역을 연다 */
  openHome: 'settings:open-home',
  /** 베타 기록 (P4-04) */
  stats: 'settings:stats',
  copyStats: 'settings:copy-stats',
  /** 의견 보내기: 가린 진단 기록 미리 보기, 그 글 그대로 복사, 파일로 저장, GitHub 문제 알리기 */
  diagnostics: 'settings:diagnostics',
  copyDiagnostics: 'settings:copy-diagnostics',
  /** AI 자동 감지 (설정의 AI 탭 능력표). 인자 true 면 저장해 둔 확인을 무시하고 다시 본다 */
  aiDetect: 'settings:ai-detect',
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
  /** 백업 복원 (이슈 #90): 기다리는 복원과 되돌리기, 확인 칸의 바꾸기와 그만두기 */
  restoreState: 'settings:restore-state',
  restoreUndo: 'settings:restore-undo',
  restoreConfirm: 'settings:restore-confirm',
  restoreCancel: 'settings:restore-cancel',
  /** 메인 → 설정 창: 기다리는 복원이 바뀌었다 (두 번 눌러 연 백업 파일) */
  restoreChanged: 'settings:restore-changed',
  exportPet: 'settings:export-pet',
  /** 방금 내보낸 파일이나 폴더를 파일 관리자에서 보인다 */
  reveal: 'settings:reveal',
  importPet: 'settings:import-pet',
  importFriend: 'settings:import-friend',
  /** 설정 창에 끌어 놓은 페어리 파일, Codex 펫 파일 (이름과 바이트) */
  importPetDrop: 'settings:import-pet-drop',
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
  /** 코인 초기화 확인 화면이 보여 줄 지금 잔액과 산 물건 수 */
  coinState: 'settings:coin-state',
  /** 코인 초기화 (범위, 확인 화면이 본 잔액). 결과와 새 상태를 돌려준다 */
  resetCoins: 'settings:reset-coins',
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

/** 설정 언어가 바뀌면 이미 열린 렌더러에도 즉시 알려 준다. */
export const LANGUAGE = {
  changed: 'app:language-changed',
} as const;

export interface LanguageEventsBridge {
  onChanged(listener: (lang: 'ko' | 'en') => void): () => void;
}

/** 설정 > 데이터 > 코인 초기화가 보여 주는 지금 상태: 잔액과 되돌릴 산 물건 수 */
export interface CoinState {
  balance: number;
  items: number;
}

/** 캘린더 가져오기 결과 글과 잘 됐는지 (못 가져왔으면 설정 창이 빨간 글씨로 알린다) */
export interface CalSync {
  text: string;
  ok: boolean;
}

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
  calendarLast: CalSync;
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
  /** 펫 파일에서 데려온 펫의 만든 사람, 사용 허락, 만든 날 (카드 아래 한 줄) */
  meta?: { author?: string; license: PetLicense; created: string };
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
export type SettingsSection = 'stats' | 'restore' | 'friends';

/**
 * 확인을 기다리는 복원 (설정 > 데이터 확인 칸). file 은 백업 파일, folder 는 예전 폴더 백업,
 * undo 는 마지막 가져오기 전 보관해 둔 데이터. at 은 만든 때(ms, 모르면 0), app 은 만든 앱 판(모르면 빈 글)
 */
export interface RestoreOffer {
  id: string;
  kind: 'file' | 'folder' | 'undo';
  name: string;
  at: number;
  app: string;
  /** 백업에 있지만 옮기지 않는 사용자 AI 수 */
  customAi: number;
}

/** 설정 창이 보이는 복원 상태. undoAt 은 되돌릴 보관 데이터가 있을 때 그 때 */
export interface RestoreState {
  offer?: RestoreOffer;
  undoAt?: number;
}

export interface SettingsBridge {
  get(): Promise<SettingsSnapshot>;
  set(patch: Partial<Settings>): Promise<Settings>;
  reset(): Promise<Settings>;
  setScale(scale: number): void;
  /** 사진 펫 만들기 (target 을 주면 상태별 포즈) */
  openMaker(target?: MakerTarget): void;
  /** 큰 창의 구역(페어리, 비서)을 연다 (설정에서 꺼낸 항목으로 가는 길) */
  openHome(tab: 'pet' | 'assist'): void;
  stats(): Promise<BetaReport>;
  /** 베타 기록 글을 클립보드에 복사한다 */
  copyStats(): Promise<boolean>;
  /** 베타 기록 + 가린 진단 기록 (메인이 가린다). 읽지 못하면 undefined */
  diagnostics(): Promise<{ text: string; lines: number; hidden: number } | undefined>;
  /** 마지막 diagnostics() 글 그대로 복사 */
  copyDiagnostics(): Promise<boolean>;
  /** 마지막 diagnostics() 글 그대로 파일로. 그만두면 ok false, 빈 message */
  saveDiagnostics(): Promise<{ ok: boolean; message: string }>;
  /** AI 자동 감지: 설치, 로그인 여부와 내 컴퓨터 AI 모델 (질문은 하지 않는다) */
  aiDetect(refresh?: boolean): Promise<DetectRow[]>;
  /** GitHub 새 이슈 (판, 운영체제만 채움) */
  reportIssue(): void;
  openNotices(): Promise<boolean>;
  checkUpdate(): Promise<UpdateStatus>;
  openOnboarding(): void;
  /** 백업 파일 만들기. 만든 경로 (그만두면 빈 path, 못 만들면 ok 거짓과 까닭) */
  exportData(): Promise<{ ok: boolean; path: string; message: string }>;
  /** 백업 파일(또는 예전 폴더)을 골라 검사한다. 가져올 수 있으면 offer (확인 칸), 아니면 ok 거짓 (그만두면 빈 message) */
  importData(kind: 'file' | 'folder'): Promise<{ ok: boolean; message: string; offer?: RestoreOffer }>;
  restoreState(): Promise<RestoreState>;
  /** 마지막 가져오기 전으로 되돌리기: 보관 데이터를 확인 칸에 */
  restoreUndo(): Promise<{ ok: boolean; message: string; offer?: RestoreOffer }>;
  /** 확인 칸의 바꾸기. 되면 앱이 다시 켜진다 */
  restoreConfirm(id: string): Promise<{ ok: boolean; message: string }>;
  restoreCancel(id: string): void;
  /** 기다리는 복원이 바뀌면. 그만 들을 함수를 돌려준다 */
  onRestoreChanged(listener: (state: RestoreState) => void): () => void;
  exportPet(): Promise<string>;
  reveal(path: string): void;
  importPet(): Promise<{ ok: boolean; message: string }>;
  importFriend(): Promise<{ ok: boolean; message: string }>;
  /** 끌어 놓은 파일을 지금 페어리로 (.fairy, .jjpet, .codex-pet.zip). 크기와 형식은 메인이 다시 본다. 그만두면 빈 message */
  importPetDrop(name: string, bytes: ArrayBuffer): Promise<{ ok: boolean; message: string }>;
  /** 펫 갤러리 목록 (메인이 raw.githubusercontent.com 에서 받아 검사한 것) */
  galleryList(): Promise<GalleryList>;
  /** 목록의 펫을 받아 데려온다 (asFriend 면 친구 펫으로). 그만두면 빈 message */
  galleryAdopt(id: string, asFriend: boolean): Promise<{ ok: boolean; message: string }>;
  /** 지금 펫을 친구에게 보낼 판 2 .jjpet 으로 저장한다 (만든 사람은 선택). 그만두면 빈 message */
  galleryShare(meta: { author?: string; license: PetLicense }): Promise<{ ok: boolean; message: string }>;
  syncCalendar(): Promise<CalSync>;
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
  /** 코인 초기화 확인 화면이 보여 줄 지금 상태 */
  coinState(): Promise<CoinState>;
  /** 코인 초기화. expect 는 확인 화면이 본 잔액 (그새 바뀌었으면 하지 않고 changed) */
  resetCoins(scope: CoinResetScope, expect: number): Promise<{ result: CoinResetResult; state: CoinState }>;
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
  /** 사용자 추가 AI 의 실행 파일 (못 찾을 때 경로 찾기 안내에 쓴다). 기본 제공 AI 는 비운다 */
  bin?: string;
  /** 기록 남기지 않기를 할 수 있는지 (claude, codex) */
  ephemeral: boolean;
  /** AI 대화권 (#100): 서버가 중계하는 Claude. "AI 와 대화 중" 과 남은 수, 신고 단추를 보인다 */
  ticket?: boolean;
  /** 목록 안에서 이름 아래 작게 보이는 설명 (채팅 이용권: 어떤 AI 가 답하는지) */
  detail?: string;
}

/** 큰 창 본문 칸 안 채팅 자리 (창 안 CSS 픽셀) */
export interface HomeChatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 채팅 view 에서 큰 창 본문으로 넘기는 키 (수식키가 눌린 창 단축키만) */
export interface ChatKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

export interface ChatSnapshot {
  petName: string;
  state: ChatState;
  /** 같이 보기로 들어와 아직 입력칸에 안 붙은 그림. */
  draft: OutgoingImage[];
  /** 쓰던 글과 붙인 그림 (#145). 기록 안 남김 중에는 늘 비어 있다 */
  saved: { text: string; images: OutgoingImage[] };
}

/** 지난 대화 목록. current 는 지금 채팅 창에 열린 대화 */
export interface ThreadList {
  threads: ThreadMeta[];
  current?: string;
}

export type ChatRetryResult = 'sent' | 'missing-images' | 'unavailable';

export interface ChatBridge {
  nearPet(): void;
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
  /** 마지막 질문을 다른 AI 로 다시 (한도에 걸렸을 때). AI 를 안 주면 지금 AI 로 같은 질문을 다시 묻는다 (#145 "다시 묻기") */
  retryWith(provider?: AiProvider): Promise<ChatRetryResult>;
  /** 쓰던 글과 붙인 그림을 메인에 맡긴다 (#145) */
  draftText(text: string): void;
  draftImages(images: OutgoingImage[]): void;
  /** AI 대화권: 국외 이전 안내를 읽고 쓰기로 했다 (#100) */
  agreeTicket(): void;
  /** AI 대화권 답 신고 (화면에서 따로 확인한 뒤). 보냈으면 true */
  reportTicket(messageId: string): Promise<boolean>;
  /** 규칙 답 단추: 집중 시작(그 할 일로), 패널 열기 */
  planAction(kind: 'focus' | 'panel', todoId?: number): void;
  /** 무료 AI 모델 받기 (v2). 다 받으면 마지막 질문을 무료 AI 로 다시 묻는다 */
  downloadModel(): void;
  /** 지난 대화 목록 (최근 것부터, 찾는 말이 있으면 제목과 첫 질문에서) */
  threads(query?: string): Promise<ThreadList>;
  /** 지난 대화를 열어 이어 말한다. 답을 기다리는 중이거나 기록 안 남김 중이면 false */
  openThread(id: string): Promise<boolean>;
  /** 비우면 첫 질문 제목으로 돌아간다 */
  renameThread(id: string, title: string): Promise<boolean>;
  /** 목록과 파일에서 진짜 지운다 */
  deleteThread(id: string): Promise<boolean>;
  /** 같이 보기 상태 (권한은 물을 때마다 다시 본다) */
  look(): Promise<ChatLookView>;
  /** 같이 보기 켜기, 끄기. agree 는 처음 켤 때 안내를 보고 켰다 */
  setLook(on: boolean, agree?: boolean): void;
  /** 채팅 창이 있는 모니터 화면을 지금 찍는다 (채팅 창과 펫은 빼고). 못 찍으면 까닭 */
  lookShot(): Promise<OutgoingImage | 'denied' | 'failed'>;
  /** 화면 한 곳을 골라 찍기 (펫 메뉴의 같이 보기와 같다. 찍은 그림은 입력칸에 붙는다) */
  lookPick(): void;
  /** 화면 기록 권한 설정 열기 (맥) */
  lookSettings(): void;
  onLook(listener: (view: ChatLookView) => void): void;
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
  /** 꾹 눌러 커지기 (이슈 #124). on 이면 키워 달라(calm: 움직임 줄이기라 부드럽게 키우지 않는다), 아니면 원래대로. 키웠으면 true */
  peek(on: boolean, calm?: boolean): Promise<boolean>;
  wheel(deltaY: number, zoom: boolean): void;
  onEnv(listener: (env: PetEnv) => void): void;
  onAi(listener: (state: PetAiState) => void): void;
  /** null 이면 닫아라 */
  onBubble(listener: (bubble: BubbleMessage | null) => void): void;
  onLayout(listener: (layout: BubbleLayout) => void): void;
  /** 메인이 펫이 비켜 간 것을 알아 마우스 통과로 돌렸다: 화면도 펫 위 표시를 거둔다 (다시 펫 위에 오면 새로 알린다) */
  onHoverReset(listener: () => void): void;
  bubbleSize(id: string, width: number, height: number): void;
  bubbleAnchor(anchor: BubbleAnchor): void;
  bubbleClosed(id: string, action: string): void;
  /** 한가하니 행동을 골라 달라. ask 는 펫 몸과 상태 (제자리 몸짓 고르기, shared/moves.ts) */
  activityRequest(ask?: MoveAsk): void;
  activityStop(): void;
  onActivity(listener: (activity: Activity) => void): void;
  onStatus(listener: (status: PetStatus) => void): void;
  onReact(listener: (kind: ReactKind) => void): void;
  petted(): void;
  onFlight(listener: (flying: boolean) => void): void;
  /** 설계도 정면 그림 부탁 (걸음새로 다시 만든 몸의 펫 그림). 답은 shotGot 으로 */
  onShotAsk(listener: (id: number, model: unknown) => void): void;
  shotGot(id: number, png: string | null): void;
  onImpact(listener: (hit: { axis: 'x' | 'y'; k: number }) => void): void;
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
  /** 같이 타자 치기, 같이 일하는 표정, 든 쪽지 (shared/together.ts) */
  onTogether(listener: (look: TogetherLook) => void): void;
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
  /** 사진 동물 페어리를 네 발로 선 피규어로 본다 (설정 petStands, shared/pet3d/stand.ts) */
  stand?: boolean;
  /** 기운 (하루 리듬과 연속 작업 피로, shared/energy.ts). 설정 "하루 리듬"이 꺼졌거나 친구 펫이면 없다 (예전 모습) */
  energy?: EnergyLook;
  /** 배터리 절약 중 (shared/battery.ts): 그리기 15fps 상한, 한가한 행동을 드물게. 없으면 끔 */
  saver?: boolean;
  /** 움직임 줄이기 (설정 "움직임 줄이기"와 운영체제를 합친 판정). 없으면 화면이 운영체제 설정을 직접 본다 */
  calm?: boolean;
  /** 말풍선을 화면 읽기 프로그램에 읽어 준다 (설정 읽어 주기). 친구 펫은 끔 (같은 말을 두 번 읽지 않게) */
  readAloud?: boolean;
  /** 꾹 누르면 커지기 (설정 clickGrow, 이슈 #124). 없으면 끔 */
  clickGrow?: boolean;
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
  /** 앱에 든 캐릭터(밀크, 초코) 그림이면 그 이름. 사진에 감은 눈을 그릴 눈 자리를 안다 (starter-pets.ts STARTER_EYES) */
  starter?: StarterId;
  /** 밀크, 초코의 옆모습 걷기 그림 (오른쪽을 보는 한 주기, data URL). 있으면 사진 모습으로 걸을 때 넘겨 보인다 */
  walk?: string[];
  /**
   * 펫 파일에서 데려온 2D 그림 세트 (자세 이름 -> PNG data URL, shared/pet-sprites.ts). 서기가 꼭 있다.
   * 있으면 2D 에서 사진 대신 기본 페어리처럼 자세 그림을 바꿔 그린다 (renderer/src/sprite-geom.ts)
   */
  sprites?: PetSprites;
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
  /** 그림용 배경 제거 모델 준비 (없으면 받음). 진행률은 progress 로 */
  ensureAnime: 'maker:ensure-anime',
  /** 그림용 모델 파일이 지금 있고 해시가 맞는지만 본다 (받지 않는다. 자동 다시 지우기가 쓴다) */
  verifyAnime: 'maker:verify-anime',
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
  /** 말로 만들기를 쓸 AI 가 있는지 (없으면 탭을 보이지 않는다) */
  textAi: 'maker:text-ai',
  /** 적은 글로 AI 에게 입체 설계도를 받는다 (말로 만들기) */
  describe: 'maker:describe',
  /** 지금 설계도와 고칠 점을 AI 에게 보내 고친 설계도를 받는다 (말로 만들기) */
  tweak: 'maker:tweak',
  /** 받기(모델), 입체 만들기(AI), 일러스트 그리기를 멈춘다 (진행 표시의 그만두기) */
  cancel: 'maker:cancel',
  close: 'maker:close',
  /** 2D 그림 세트 만들기 (#89): 지금 페어리 그림과 이름 */
  spriteSource: 'maker:sprite-source',
  /** 2D 그림 세트 만들기: 기준 그림과 동작 하나로 가로 띠 한 장을 무료 그림 Space 나 내 컴퓨터에서 받는다 */
  spriteRow: 'maker:sprite-row',
  /** 2D 그림 세트 만들기: 동작 하나의 Gemini 요청문을 복사하고 Gemini 앱을 연다 (2026-10-15) */
  spriteGemini: 'maker:sprite-gemini',
  /** 2D 그림 세트 만들기: Gemini 에 올릴 기준 그림을 임시 폴더에 두고 파일 관리자로 보여 준다 */
  revealSpriteRef: 'maker:reveal-sprite-ref',
  /** 2D 그림 세트 만들기: 다 만든 그림들(PNG data URL)을 지금 페어리의 그림 세트로 저장한다 */
  saveSprites: 'maker:save-sprites',
  /** 펫을 저장한 뒤 같은 창에서 2D 그림 세트 만들기로 넘어간다 */
  openSprites: 'maker:open-sprites',
} as const;

/**
 * 배경 제거 모델 파일 주소. 메인이 디스크 파일을 그대로 흘려 보낸다(protocol.handle).
 * 예전처럼 IPC 로 넘기면 메인이 170MB 를 두 벌 들고 있다가 GC 때까지 안 놓았다 (2026-10-06 측정, 343MB).
 */
export const MODEL_SCHEME = 'jj-model';
export const MODEL_URL = `${MODEL_SCHEME}://bg/model.onnx`;
/** 깊이 모델 파일 주소 (2.5D) */
export const DEPTH_URL = `${MODEL_SCHEME}://depth/model.onnx`;
/** 그림용 배경 제거 모델 파일 주소 (사진 모델이 바탕을 못 지운 만화, 그림용) */
export const ANIME_URL = `${MODEL_SCHEME}://anime/model.onnx`;
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
  /** 이미 있는 캐릭터 이름으로 말로 만든 펫 (개인 용도, 공식 갤러리에 못 올린다) */
  personalOnly?: boolean;
  /** 네 발로 선 피규어로 보기 (말로 만든 네 발 동물, 설정 petStands) */
  stand?: boolean;
}

/** 말로 만들기 결과. namedCharacter 는 AI 가 본 "이미 있는 캐릭터 이름인지" */
export type TextShapeResult =
  | { ok: true; model: Blueprint; namedCharacter: boolean }
  | { ok: false; error: string; noAi?: boolean };

/** 펫 만들기 창이 만드는 것: 펫 본 그림, 또는 상태별 포즈 (v1) */
export type MakerTarget = 'main' | PoseKind | 'food' | 'sprites';

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
  /** 그림용 배경 제거 모델 (받아 뒀는지, 받을 크기, 입력 값) */
  anime: { ready: boolean; mb: number; size: number; mean: readonly number[]; std: readonly number[] };
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
  /** 말로 만들기를 쓸 AI 가 있는지 */
  textAi(): Promise<boolean>;
  /** 적은 글(200자, 메인이 다시 다듬는다)로 입체 설계도를 받는다 */
  describe(text: string): Promise<TextShapeResult>;
  /** 지금 설계도를 고칠 점(120자)대로 고친다. original 은 처음 적은 글, named 는 처음 결과의 캐릭터 표시 */
  tweak(model: Blueprint, instruction: string, original: string, named: boolean): Promise<TextShapeResult>;
  ensureModel(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 다듬은 그림(PNG data URL, 움직이는 그림은 gif, webp 그대로)과 이름을 저장하고 펫을 바꾼다. 입체 설계도가 있으면 같이 */
  save(png: string, name: string, look?: PetLook): Promise<{ ok: boolean; error?: string }>;
  ensureDepth(): Promise<{ ok: true } | { ok: false; error: string }>;
  ensureAnime(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 받지 않고 있는지만 (없거나 깨졌으면 false) */
  verifyAnime(): Promise<boolean>;
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
  /** 2D 그림 세트 만들기: 지금 페어리 그림(data URL). 사진 펫이 아니면 image 가 null */
  spriteSource(): Promise<SpriteSource>;
  /**
   * 2D 그림 세트 만들기: 기준 그림(PNG data URL, 배경색 위)과 동작 이름, 배경색(#RRGGBB, KEY_COLORS 중 하나)으로 띠 한 장.
   * engine 이 local 이면 내 컴퓨터에서 (준비가 끝났을 때만). 성공이면 받은 그림 data URL (webp, png, jpeg).
   * 그만두기와 창 닫기로 멈춘다
   */
  spriteRow(row: string, reference: string, key: string, engine?: IllustEngine): Promise<SpriteRowResult>;
  /** 2D 그림 세트 만들기: 동작 하나의 Gemini 요청문을 클립보드에 넣고 Gemini 앱을 연다 */
  spriteGemini(row: string, key: string): Promise<{ copied: boolean; opened: boolean }>;
  /** 2D 그림 세트 만들기: Gemini 에 올릴 기준 그림(PNG data URL)을 파일로 두고 보여 준다 */
  revealSpriteRef(reference: string): Promise<boolean>;
  /** 2D 그림 세트 저장 (이름 -> PNG data URL, 서기 꼭). 메인이 .fairy 와 같은 규칙으로 다시 본다 */
  saveSprites(sprites: Record<string, string>): Promise<{ ok: boolean; error?: string }>;
  /** 펫을 저장한 뒤 2D 그림 세트 만들기로 */
  openSprites(): void;
}

export interface SpriteSource {
  image: string | null;
  name: string;
  /** 이미 그림 세트가 있는지 (다시 만들면 바뀐다) */
  hasSprites: boolean;
  /** 무료 Hugging Face 토큰을 넣었는지 */
  hfToken: boolean;
  /** 내 컴퓨터에서 그리기: 되는 컴퓨터인지, 준비가 끝났는지 (준비는 사진으로 만들기 창에서 한다) */
  localDraw: LocalDrawInfo;
}

/**
 * kind 는 서버면 hf-illust.ts IllustErrorKind, 내 컴퓨터면 local-draw-core.ts LocalDrawErrorKind.
 * 멈출지는 sprite-strip.ts stopsQueue(kind, engine). localDraw 는 내 컴퓨터 실패 뒤 새 상태 (준비가 깨졌을 수 있다)
 */
export type SpriteRowResult =
  | { ok: true; image: string }
  | { ok: false; kind: string; error: string; localDraw?: LocalDrawInfo };

export const PANEL = {
  snapshot: 'panel:snapshot',
  /** 크기 손잡이: 끌기 시작, 바라는 크기(CSS px), 끌기 끝, 처음 크기로 */
  resizeStart: 'panel:resize-start',
  resize: 'panel:resize',
  resizeEnd: 'panel:resize-end',
  resizeReset: 'panel:resize-reset',
  add: 'panel:add',
  complete: 'panel:complete',
  undo: 'panel:undo',
  update: 'panel:update',
  remove: 'panel:remove',
  /** 지운 할 일 되살리기 (되돌리기) */
  restore: 'panel:restore',
  /** 할 일 휴지통 (#125): 목록, 되살리기, 영구 삭제, 비우기 */
  trashList: 'panel:trash-list',
  trashRestore: 'panel:trash-restore',
  trashPurge: 'panel:trash-purge',
  trashEmpty: 'panel:trash-empty',
  /** 집중 월간 잔디 (#125): 한 달의 날마다 집중 기록 */
  focusMonth: 'panel:focus-month',
  /** 한 줄 입력이 일정으로 들어간 것을 할 일로 옮기기 */
  eventToTodo: 'panel:event-to-todo',
  feed: 'panel:feed',
  openChat: 'panel:open-chat',
  /** 패널 머리의 톱니바퀴: 설정 창 열기 */
  openSettings: 'panel:open-settings',
  lookTogether: 'panel:look-together',
  close: 'panel:close',
  quickFit: 'panel:quick-fit',
  /** 쓰던 글 보관 (#145): 읽기는 창이 뜨자마자 필요해서 동기, 쓰기는 보내기만 */
  draftGet: 'panel:draft-get',
  draftSet: 'panel:draft-set',
  /** 메모 편집의 보관 글 (#160): 메모 id 마다, 메인 메모리에만. 읽기는 편집기가 뜨며 바로 필요해서 동기 */
  noteKeepGet: 'panel:note-keep-get',
  noteKeepSet: 'panel:note-keep-set',
  noteKeepLatest: 'panel:note-keep-latest',
  noteNewTake: 'panel:note-new-take',
  /** 보던 위치 보관 (#145): 할 일의 검색어와 쪽 수, 일정의 고른 날, 탭마다 스크롤 */
  viewGet: 'panel:view-get',
  viewSet: 'panel:view-set',
  /** 패널 고정 핀 켜고 끄기 (#145) */
  setKeepOpen: 'panel:set-keep-open',
  /** 패널 보기 바꾸기 (큰 창 바닥의 "펫을 누르면 이 창으로 열기", #161) */
  setPanelView: 'panel:set-panel-view',
  /** 큰 창 사이드바 "친구": 설정의 친구 칸을 연다 */
  openFriends: 'panel:open-friends',
  /** 되돌리기 알림 보관 (#145): 패널을 벗어나도 남은 시간 동안 다시 열면 보인다 */
  toastsGet: 'panel:toasts-get',
  toastsSet: 'panel:toasts-set',
  // 메모 (v1)
  noteGet: 'panel:note-get',
  noteAdd: 'panel:note-add',
  noteUpdate: 'panel:note-update',
  noteRemove: 'panel:note-remove',
  noteRestore: 'panel:note-restore',
  /** 메모 찾기 (본문 전체) */
  noteSearch: 'panel:note-search',
  findAll: 'panel:find-all',
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
  /** 달력 보기: 기간 안의 일정 */
  eventsBetween: 'panel:events-between',
  // 집중 타이머 (v1)
  focusStart: 'panel:focus-start',
  focusStop: 'panel:focus-stop',
  focusResume: 'panel:focus-resume',
  focusUndo: 'panel:focus-undo',
  /** 놓친 알림 지우기 */
  missedClear: 'panel:missed-clear',
  // 상점과 놀이 (v1)
  buyToy: 'panel:buy-toy',
  buyHouse: 'panel:buy-house',
  buyHouseStyle: 'panel:buy-house-style',
  setHouseHidden: 'panel:set-house-hidden',
  feedWith: 'panel:feed-with',
  makeFood: 'panel:make-food',
  removeFood: 'panel:remove-food',
  play: 'panel:play',
  // 할 일 단계 (9판 체크리스트)
  stepAdd: 'panel:step-add',
  stepToggle: 'panel:step-toggle',
  stepRename: 'panel:step-rename',
  stepRemove: 'panel:step-remove',
  /** 고정과 풀기 (메모, 할 일, 일정. shared/pin.ts) */
  pin: 'panel:pin',
  /** 할 일 진행 중 표시와 풀기 (펫 머리 위 말풍선, 이슈 #124) */
  doing: 'panel:doing',
  /** 할 일 순서 바꾸기 (#146) */
  place: 'panel:todo-place',
  /** 끝낸 반복 할 일의 다음 회차 (#146) */
  nextOf: 'panel:todo-next-of',
  /** 지난 마감을 오늘로 */
  moveOverdue: 'panel:move-overdue',
  undoMoveOverdue: 'panel:undo-move-overdue',
  /** 메인 → 패널, 빠른 입력: 바뀐 상태 */
  state: 'panel:state',
  /** 메인 → 패널: 이 탭을 보여 줘 (펫 메뉴 "상점") */
  tab: 'panel:tab',
  /** 큰 창 → 메인: 본문 칸 안 채팅 자리의 위치와 크기(창 안 CSS 픽셀). 메인이 그 자리에 채팅 view 를 얹는다. null 이면 채팅 구역이 아니다 (#165) */
  homeChat: 'panel:home-chat',
  /** 메인 → 큰 창: 채팅 구역을 열어(true) 달라고, 또는 닫아(false) 달라고 (채팅 열기 요청이 큰 창으로 온 때) */
  chatSection: 'panel:chat-section',
  /** 메인 → 큰 창: 채팅 view 가 받은 창 단축키(닫기, 설정, 구역 고르기)를 그대로 넘긴다. view 가 포커스를 쥐면 큰 창 본문이 키를 못 받는다 */
  chatKey: 'panel:chat-key',
  /** 메인 → 큰 창: 곧 숨긴다 (숨겨도 창은 안 닫혀 beforeunload 가 없다. 쓰던 글을 바로 저장하라는 신호) */
  hiding: 'panel:hiding',
  /** 패널 → 메인: 지금 탭 그대로 큰 창으로 넘겨 줘 (패널 머리줄 "크게 보기", 크게 볼까요? 칩). 큰 창이 보인 뒤에 패널을 닫는다 */
  expand: 'panel:expand',
  /** 큰 창 → 메인: 이 구역 그대로 작은 패널로 돌아가 (사이드바 "작게 보기"). 큰 창은 숨기고 펫 누르기도 작은 패널로 바꾼다 */
  shrink: 'panel:shrink',
  /** 메인 → 패널: 쓰던 글을 보내 놓고 큰 창으로 넘겨 달라고 요청해 (트레이, 펫 메뉴의 "큰 창 열기"가 패널이 열려 있을 때) */
  expandNow: 'panel:expand-now',
  /** 패널 → 메인(동기): 마지막으로 "크게 볼까요?" 칩을 띄운 때. 패널을 닫았다 열어도 간격이 이어지게 메인이 든다 */
  expandHintAt: 'panel:expand-hint-at',
  /** 패널 → 메인: 칩을 띄웠다 (지금 시각을 적는다) */
  expandHintShown: 'panel:expand-hint-shown',
} as const;

export interface PanelState {
  /** 메뉴에서 새 메모를 열라는 요청. 편집기가 준비되면 한 번만 가져간다 */
  newNoteRequest?: number;
  /** 같은 반복의 다른 회차 시각으로 옮기려다 막힌 횟수. 올라가면 화면이 안내 알림을 한 번 띄운다 */
  eventSlotTaken?: number;
  petName: string;
  /** 현지 날짜 YYYY-MM-DD */
  today: string;
  open: Todo[];
  doneToday: Todo[];
  /** 진행 중으로 표시한 할 일 id (열려 있는 것만, 표시한 순서. 이슈 #124) */
  doing: number[];
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
  /** 고정한 일정 가운데 안 끝난 것, 고정한 순서대로 (14일 밖도). 일정 탭 목록 맨 위 "고정" 칸 */
  pinnedEvents: CalEvent[];
  /** 일정 줄의 구글 표식. 구글 캘린더에 연결하지 않았으면 없다 */
  gcal?: PanelGcal;
  focus: FocusState;
  /** 집중을 멈춘 직후 8초 동안 되돌릴 수 있다 */
  focusUndoAvailable?: boolean;
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
  shop: ShopState & { foodImages: Record<string, string>; houseHidden: boolean };
  /** 이번 주 돌아보기 (shared/week.ts). 기록을 못 읽으면 없다 */
  week?: WeekSummary;
  /** 휴지통에 있는 할 일 수 (#125). 목록은 trashList 로 따로 묻는다 */
  trashCount: number;
  /** 패널 고정 핀이 켜져 있다 (#145): 다른 곳을 눌러도 닫히지 않는다 */
  keepOpen: boolean;
  /** 패널 보기 (#161): 펫 클릭이 여는 것. 큰 창 바닥의 체크가 같은 값을 쓴다 */
  panelView: PanelView;
  /** 친구 기능이 켜져 있다 (서버 모드, 로그인, 기능 키). 큰 창 사이드바 "친구"가 보인다 */
  friendsOn: boolean;
}

/** 월간 잔디 한 달 (#125). days 는 집중한 날만 */
export interface FocusMonthView {
  month: string;
  days: FocusDay[];
  /** 집중 기록이 처음 있는 달. 이보다 앞으로는 못 간다. 기록이 없으면 이번 달 */
  firstMonth: string;
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
  /** 고정한 시각. 고정 안 했으면 null */
  pinnedAt: number | null;
}

/** 한 줄 입력(PANEL.add) 결과. 어디에 언제로 넣었는지 알려 준다 */
/** 메모 저장 답 */
/** 메모 저장 답. body 는 저장된 본문이 보낸 것과 다를 때만 (다른 곳이 덧붙인 것과 합쳤거나 상한에서 잘랐다) */
export type NoteSaveResult =
  | { ok: true; body?: string; updatedAt?: number }
  /** stale: 다른 곳이 먼저 고쳐서 덮지 않았다 (글은 창에 남아 있다) */
  | { ok: false; error?: string; stale?: boolean };

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
  /** past: 마감이 이미 지난 날("어제 보고서"). monthly: "매달 25일" 을 매달 반복으로 넣었다 (그날, 25) */
  | {
      ok: true;
      kind: 'todo';
      id: number;
      due: string | null;
      remindAt?: number;
      past?: true;
      monthly?: number;
    }
  /** 빠른 입력의 "메모:" 머리말: 메모로 넣었다 */
  | { ok: true; kind: 'note'; id: number }
  /** 여러 줄을 붙여 넣어 줄마다 넣었다. items: 넣은 것들(전체 되돌리기), notes: 메모로 넣은 수 (빠른 입력만) */
  | {
      ok: true;
      kind: 'many';
      todos: number;
      events: number;
      notes?: number;
      items: { kind: 'todo' | 'event' | 'note'; id: number }[];
    };

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

// records 는 큰 창 사이드바에만 있다 (이슈 #166). 작은 패널의 탭 줄(renderer panel/tabs.ts)에는 없다
// mail(쪽지함)은 큰 창에서는 사이드바 구역이고, 작은 패널에서는 탭이 아니라 머리줄 봉투가 여는 덮개다 (feat/mailbox)
// pet(페어리 꾸미기)과 assist(비서)도 큰 창 전용 구역이다 (설정에서 꺼낸 것, ui/settings-slim)
export const PANEL_TABS = [
  'today',
  'todo',
  'note',
  'event',
  'shop',
  'records',
  'mail',
  'pet',
  'assist',
] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
export const isPanelTab = (v: unknown): v is PanelTab => PANEL_TABS.includes(v as PanelTab);

/** 놀이: 공, 산책, 숨바꼭질과 짧은 놀이 (shared/minigames.ts) */
/** wordchain: 끝말잇기 (채팅 창에서 AI 없이, main/fun.ts) */
export type PlayKind = 'ball' | 'walk' | 'seek' | 'wordchain' | MiniGame;

export type NoteAiKind = 'todos' | 'summary';

export interface PanelBridge {
  platform: NodeJS.Platform;
  snapshot(): Promise<PanelState>;
  /**
   * 한 줄 입력(빠른 입력과 같은 규칙)으로 할 일을 더한다.
   * opts.quick: 빠른 입력이다("메모:" 머리말은 메모로). opts.as: 'todo' 면 시각이 있어도 할 일로 (분류 바꾸기)
   */
  add(text: string, opts?: { quick?: boolean; as?: 'todo' }): Promise<PanelAddResult>;
  /** 받은 코인 수. 이미 끝냈거나 없는 할 일이면 null (빠르게 여러 번 누른 체크) */
  complete(id: number): Promise<number | null>;
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
  /** 할 일 휴지통 (#125). 30일이 지난 것은 열 때 영구 삭제된다 */
  trashList(): Promise<TrashRecord[]>;
  /** 되살리기. gone 은 이미 되살렸거나 영구 삭제됨, dup 은 같은 반복 할 일이 이미 열려 있어 되살리지 않음. 코인은 움직이지 않는다 */
  trashRestore(kind: TrashKind, id: number): Promise<'ok' | 'gone' | 'dup'>;
  /** 영구 삭제. 지운 수 */
  trashPurge(kind: TrashKind, id: number): Promise<number>;
  trashEmpty(): Promise<number>;
  /** 집중 월간 잔디. month 는 YYYY-MM */
  focusMonth(month: string): Promise<FocusMonthView>;
  /** 한 줄 입력이 일정(id)으로 들어간 것을 지우고 같은 글(text)을 할 일로 넣는다 */
  eventToTodo(id: number, text: string): Promise<PanelAddResult>;
  feed(): Promise<{ ok: boolean }>;
  openChat(): void;
  openSettings(): void;
  lookTogether(): void;
  close(): void;
  /** 패널 크기 손잡이. 끌기 시작과 끝 사이에 바라는 창 크기(CSS px, 안 바꿀 쪽은 undefined)를 보낸다 */
  resizeStart(): void;
  resize(width: number | undefined, height: number | undefined): void;
  resizeEnd(): void;
  /** 처음 크기(360x540)로 */
  resizeReset(): void;
  /** 빠른 입력 창: 내용 높이(CSS px)에 맞게 창 높이를 바꿔 달라 (큰 글씨에서 잘리지 않게, shared/quick-fit.ts) */
  quickFit(contentCss: number): void;
  /** 쓰던 글 (#145). 창을 닫았다 열어도 메인이 들고 있다가 돌려준다 */
  draftGet(kind: PanelDraftKind): string;
  draftSet(kind: PanelDraftKind, text: string): void;
  /** 메모 편집의 보관 글 (#160). 값이 null 이면 그 메모의 보관 글을 지운다 */
  noteKeepGet(id: number): NoteKept | null;
  noteKeepSet(id: number, value: NoteKept | null): void;
  /** 가장 나중에 적은 보관 글 (패널을 열 때 그 메모로 돌아간다) */
  noteKeepLatest(): NoteKept | null;
  noteNewTake(request: number): boolean;
  /** 보던 위치 (#145) */
  viewGet(): ViewKeep;
  viewSet(view: ViewKeep): void;
  /** 패널 고정 핀 (#145) */
  setKeepOpen(on: boolean): void;
  /** 패널 보기 바꾸기 (#161) */
  setPanelView(view: PanelView): void;
  /** 설정의 친구 칸 열기 (#161) */
  openFriends(): void;
  /** 되돌리기 알림 (#145) */
  toastsGet(): KeptToast[];
  toastsSet(list: KeptToast[]): void;
  onState(listener: (state: PanelState) => void): void;
  noteGet(id: number): Promise<Note | undefined>;
  /** 새 메모. 만든 메모를 돌려준다. text 를 주면 그 글로 시작한다 (찾기 칸에 적은 글로 메모 만들기) */
  noteAdd(text?: string): Promise<Note | { ok: false; error?: string }>;
  /**
   * 메모 저장. 못 저장하면(디스크 가득, 읽기 전용) ok: false 와 안내 글 (버그잡이 4: 예전에는 보내기만 해서 실패를 몰랐다)
   */
  /** base 는 메모 창이 마지막으로 받은 저장된 본문과 그 고친 시각 (그사이 다른 곳이 바꾼 것과 합치려고, 오래된 쓰기를 거절하려고) */
  noteUpdate(
    id: number,
    patch: { title?: string; body?: string },
    base?: { body: string; at?: number },
  ): Promise<NoteSaveResult>;
  noteRemove(id: number): void;
  noteRestore(id: number): void;
  /** 메모 찾기: 제목과 본문 전체. composing 이면 마지막 글자는 아직 조합 중이라 넓게 찾는다 */
  noteSearch(query: string, composing: boolean): Promise<NoteHit[]>;
  findAll(query: string, composing: boolean): Promise<FindAllResult>;
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
  /**
   * 한 줄("내일 3시 회의")로 일정 넣기. day(YYYY-MM-DD)를 주면 그날을 기준으로 읽고(달력에서 고른 날),
   * 날짜도 시각도 없으면 그날 종일 일정
   */
  eventAdd(
    text: string,
    day?: string,
  ): Promise<{ ok: boolean; error?: string; event?: CalEvent; clash?: EventClash; asTodo?: boolean }>;
  /** 달력 보기: [from, to) 와 겹치는 일정 (앞에서 시작해 이어지는 여러 날 일정도) */
  eventsBetween(from: number, to: number): Promise<CalEvent[]>;
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
  /** 고정(on)과 풀기. 메모, 할 일, 일정 (shared/pin.ts) */
  pin(kind: PinKind, id: number, on: boolean): void;
  /** 진행 중 표시(▶)와 풀기. 끝내거나 지우면 저절로 풀린다 */
  doing(id: number, on: boolean): void;
  /** 순서 바꾸기: id 를 target 줄의 앞(after 가 거짓)이나 뒤에 놓는다 (#146) */
  place(id: number, target: number, after: boolean): void;
  /** 이 할 일을 끝내며 생긴 다음 회차의 마감 (반복이 아니면 null) */
  nextOf(id: number): Promise<{ due: string | null } | null>;
  /** 지난 마감을 오늘로. 옮긴 것과 원래 마감 (되돌리기는 update 로). 'tomorrow' 면 오늘 마감과 지난 마감을 내일로 */
  moveOverdue(
    to?: 'tomorrow',
    opts?: { key?: number; today?: string; ids?: number[] },
  ): Promise<{ id: number; due: string | null }[]>;
  /** 지난 마감 오늘로, 못 한 것 내일로 되돌리기. key 는 옮길 때 준 묶음 이름 (없으면 가장 나중 묶음) */
  undoMoveOverdue(key?: number): void;
  /** 길이(15, 25, 50분)를 주면 그 길이로, 아니면 마지막에 고른 길이로. todoId 를 주면 그 할 일을 하는 집중 */
  focusStart(minutes?: number, todoId?: number): void;
  focusStop(): Promise<{ minutes: number } | null>;
  focusResume(): Promise<boolean>;
  focusUndo(): void;
  missedClear(): void;
  buyToy(key: string): Promise<BuyResult>;
  /** 지금 보고 있는 단계(level)에서 다음 단계를 산다. 그새 바뀌었으면 사지 않는다 */
  buyHouse(level: number): Promise<BuyResult>;
  /** 집 모양: 없으면 사고, 있으면 공짜로 바꾼다 */
  buyHouseStyle(style: HouseStyle): Promise<BuyResult>;
  /** 집 숨기기, 다시 보이기 (shared/house-stow.ts) */
  setHouseHidden(on: boolean): void;
  /** 이 먹이를 준다 (기본, 간식, 케이크, 커스텀) */
  feedWith(key: string): Promise<{ ok: boolean; error?: string }>;
  /** 커스텀 먹이 만들기 창을 연다. 코인이 모자라면 오류 */
  makeFood(): Promise<BuyResult>;
  removeFood(key: string): void;
  play(kind: PlayKind): void;
  onTab(listener: (tab: PanelTab) => void): void;
  /** 큰 창 본문 칸 안 채팅 자리를 메인에 알린다 (null 이면 채팅 구역이 아니다). 자리가 바뀔 때마다 부른다 */
  homeChat(rect: HomeChatRect | null): void;
  /** 메인이 채팅 구역을 열고 닫아 달라고 한다 */
  onChatSection(listener: (on: boolean) => void): void;
  /** 채팅 view 가 받은 창 단축키가 넘어온다 */
  onChatKey(listener: (key: ChatKeyEvent) => void): void;
  /** 큰 창이 곧 숨겨진다 (쓰던 글을 바로 저장한다). 돌려주는 함수로 듣기를 그친다 */
  onHiding(listener: () => void): () => void;
  /** 지금 탭을 큰 창으로 넘긴다 (쓰던 글은 먼저 메인에 보낸 뒤에 부른다) */
  expand(tab: PanelTab): void;
  /** 큰 창에서 이 구역 그대로 작은 패널로 돌아간다 (큰 창은 숨고 패널 보기도 작은 패널로 바뀐다) */
  shrink(tab: PanelTab): void;
  /** 마지막 칩 시각(밀리초). 없으면 0 */
  expandHintAt(): number;
  /** 칩을 띄웠다고 메인에 적는다 */
  expandHintShown(): void;
  /** 메인이 큰 창으로 넘겨 달라고 한다 (패널이 열려 있는 채 트레이, 펫 메뉴로 큰 창을 열 때) */
  onExpandNow(listener: () => void): void;
}
