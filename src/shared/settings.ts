// 사용자 설정 (P1-12). 2단계에서 SQLite 로 옮기기 전까지 JSON 파일 하나에 둔다.
import { isPersona, type PersonaId } from './ai/persona.ts';
import { isSaverMode, type SaverMode } from './battery.ts';
import type { ChatterLevel } from './chatter.ts';
import { cutText } from './cut-text.ts';
import { type FocusLength, isFocusLength } from './focus.ts';
import { type LangPref, t } from './i18n/index.ts';
import { cleanIcsUrl } from './ics.ts';
import { type AgeStage, isAgeStage } from './illustrate.ts';
import { cleanFacts, cleanMeta, type MemMeta, type PetFact } from './knows.ts';
import { type IllustEngine, illustEngineOf } from './local-draw.ts';
import { cleanMemory, cleanPending } from './pet-memory.ts';
import { cleanPetMeta, type PetMeta } from './pet-share.ts';
import { GAITS, type Gait } from './pet3d/blueprint.ts';
import { cleanWish } from './pet3d/prompt.ts';
import { DEFAULT_ROUTINE, parseRoutine, type Routine } from './routine.ts';
import {
  isAccelerator,
  NO_SHORTCUT,
  reservedUse,
  SHORTCUT_DEFAULTS,
  type ShortcutId,
  shortcutClash,
} from './shortcut.ts';
import { DEFAULT_STYLE, parseStyle, type SpeechStyle } from './speech-style.ts';

/** 입체 펫 모습: 피규어, 게임 캐릭터, 실사처럼 */
// fluffy 복슬복슬: 부품을 녹여 붙인 한 덩어리 몸에 긴 털 (시험판, 2026-10-09)
export const PET_STYLES = ['figure', 'game', 'real', 'fluffy'] as const;
export type PetStyle = (typeof PET_STYLES)[number];

export interface Settings {
  /** 펫 이름. 메뉴, 채팅, 말풍선, AI 성격 지시에 쓰인다 */
  petName: string;
  /**
   * 사용자가 이름 칸에서 이름을 직접 바꿨는지. 안 바꿨으면 기본 펫 모습을 고를 때 이름이 그 모습의 기본 이름(콩이, 냥이 등)을 따라간다.
   * 이 칸이 생기기 전부터 쓰던 사람은 바꾼 것으로 본다 (이름이 갑자기 바뀌지 않게, main/settings.ts load)
   */
  petNameEdited: boolean;
  chatter: ChatterLevel;
  /** 가만히 있다가 가끔 걷고 앉기 (P1-06) */
  wander: boolean;
  /** AI 를 사용자 설정(훅, MCP, 스킬) 없이 부르기. 끄면 "내 AI 설정 그대로" */
  aiIsolation: boolean;
  /** 펫 성격과 말투 (v1). 프리셋 말투와 내 말투(custom)도 (2026-10-11) */
  persona: PersonaId;
  /** 내 말투 (persona 가 custom 일 때 쓴다. shared/speech-style.ts). 옛 설정은 기본값 */
  speech: SpeechStyle;
  /** 질문할 때 오늘 할 일과 일정 제목을 같이 보낸다 (v1, 기본 끔: 밖으로 나가는 정보라 사용자가 켠다) */
  aiKnowsTodos: boolean;
  /**
   * 짝꿍 도구 쓰기: 채팅의 claude, codex 가 펫 MCP 서버로 할 일, 메모, 일정을 읽고 넣는다.
   * 파일, 명령 도구는 여전히 끈다. 기본 끔: 할 일 목록을 읽는 도구라 내 할 일 같이 보내기처럼 밖으로 나가는 정보다
   */
  aiPetTools: boolean;
  /** 컴퓨터를 켜면 같이 켜기 (설치한 앱에서만 동작) */
  launchAtLogin: boolean;
  /** 숨기기 전 안내를 보여 준 횟수 (P1-10) */
  hideHints: number;
  /** 사진 펫 그림 파일 이름 (사용자 데이터 폴더의 pets/ 안). 없으면 기본 펫. gif, webp 면 움직이는 그림 (v1) */
  petImage?: string;
  /** 기본 펫 모양 (v1, D6 대신 코드로 그린 세 가지) */
  petKind: PetKind;
  /** 기본 펫을 입체(three.js)로 그린다 (6단계). 끄면 예전 2D 그림 */
  pet3d: boolean;
  /**
   * 입체 펫 모습 (사용자 요청 2026-10-08). figure 비닐 피규어, game 게임 캐릭터(셀 셰이딩과 테두리 선),
   * real 실사처럼(털, 유리 눈). 입체로 보기일 때만 쓴다
   */
  petStyle: PetStyle;
  /** 메뉴 막대에 CPU 사용률과 달리는 콩이 (사용자 요청 2026-10-08, RunCat 처럼) */
  sysMonitor: boolean;
  /** 사진 펫을 AI 가 입체로 만든 설계도 (6단계). pets/ 안 model-*.json. 있으면 입체로 보기일 때 사진 대신 이것 */
  petModel?: string;
  /** 사진 펫의 2.5D 깊이 그림 (6단계). pets/ 안 depth-*.png. 있으면 입체로 보기일 때 사진을 입체 판으로 */
  petDepth?: string;
  /** AI 일러스트로 다시 그린 사진 펫의 나이 단계 (2026-10-09). 화면 크기 배율과 보관함 표시에 쓴다. 사진 그대로면 없음 */
  petAge?: AgeStage;
  /** 펫 파일(.jjpet 판 2)에서 데려온 펫의 이름표: 만든 사람, 사용 허락, 만든 날, 앱 판. 다시 내보낼 때 그대로 넘긴다. 직접 만든 펫은 없음 */
  petMeta?: PetMeta;
  /** 상태별 포즈 그림 (v1). 기쁨, 졸림, 배고픔. pets/ 안 파일 이름 */
  petPoses: Partial<Record<PoseKind, string>>;
  /** 삐짐 게이지를 세지 않는 요일 (0 일 ~ 6 토). 기본 토, 일. 만나는 시간을 켜면 쓰지 않는다 (restDaysOf) */
  restDays: number[];
  /** 매운맛: 삐짐이 4칸에서 멈추지 않고 7칸까지 (v1) */
  spicy: boolean;
  /** 첫 실행 안내를 봤는지 (v1) */
  onboarded: boolean;
  /** 새 버전 알림 (v1, 하루 한 번 GitHub Releases 확인) */
  updateCheck: boolean;
  /** 건너뛰기로 한 버전 */
  skipVersion?: string;
  /** 하루 회고 시각 (현지, 분). 그 뒤 처음 자리에 있을 때 (v2) */
  reviewMinute: number;
  /**
   * 하루 회고 받기. 수다 빈도와 따로 켜고 끈다. 예전엔 수다 "조용히"면 말없이 안 왔다.
   * 저장 파일에 없으면(예전 판) 그때 동작대로: 조용히면 끔, 아니면 켬
   */
  review: boolean;
  /** 펫이 안 보일 때(전체 화면, 숨김, 발표) 일정 알림을 운영체제 알림으로도 한 번 */
  osNotify: boolean;
  /** 전역 단축키 (v2 단축키 바꾸기) */
  shortcuts: Record<ShortcutId, string>;
  /** 가져올 캘린더 주소 (.ics, 구글 캘린더 비공개 주소). 비밀 주소라 이 컴퓨터에만 둔다 (v2) */
  icsUrl?: string;
  /** 채팅에서 내 AI 의 MCP 도구(노션, 슬랙 등)를 쓴다 (v2 외부 MCP). 격리를 끈 claude 에서만 */
  myMcp: boolean;
  /** 친구 펫 (v2 여러 마리). 할 일, 채팅은 기본 펫이 맡고 친구는 같이 돌아다닌다 */
  friends: Friend[];
  /** AI 마다 고른 모델 (v2). 키는 AI id('claude', 'codex', 'local'), 값은 모델 목록의 id. 없으면 그 AI 의 기본 */
  aiModels: Record<string, string>;
  /** 화면 말 (v2 다국어). auto 는 운영체제 말. 창이 열릴 때 읽어서 바꾸면 다시 켠다 */
  lang: LangPref;
  /** 전에 만든 사진 펫 보관함 (6단계). 새로 만들거나 기본 펫으로 바꿔도 지우지 않고 여기 둔다 */
  petLibrary: SavedPet[];
  /** 짝꿍 규칙 (6단계). AI 에게 늘 같이 보내는 사용자의 지시 (CLAUDE.md, AGENTS.md 처럼) */
  petRules: string;
  /** 짝꿍이 기억하는 것 (오래 가는 기억). 질문마다 성격 뒤에 같이 보낸다. 30개, 하나 100자까지. 기본 비어 있음 */
  petMemory: string[];
  /** AI 도구(MCP remember)가 기억하자고 한 것. 사용자가 설정에서 허락하면 petMemory 로 간다. AI 에게 보내지 않는다 */
  petMemoryPending: string[];
  /** 기억마다 출처(대화, 직접, MCP)와 날짜 (짝꿍이 아는 것, shared/knows.ts). 열쇠는 memoryKey */
  petMemoryMeta: MemMeta;
  /** 사용자가 직접 알려 준 것: 생일, 좋아하는 간식, 좋아하는 것 (knows.ts). AI 없이도 말풍선에 쓴다 */
  petFacts: PetFact[];
  /** 기본 펫이 철마다 옷을 입는다: 봄 꽃, 여름 밀짚모자, 가을 목도리, 겨울 털모자, 명절 (shared/wear.ts). 기본 켬 */
  seasonWear: boolean;
  /** 집중 타이머 길이 (15, 25, 50분). 마지막에 고른 것 */
  focusMin: FocusLength;
  /** 한가할 때 커서 쪽을 바라본다 */
  lookAtCursor: boolean;
  /** jjakkung:// 주소로 할 일, 메모 넣기와 집중, 패널 열기 (편의, 기본 켬. shared/url-scheme.ts) */
  urlScheme: boolean;
  /** 배터리 절약 (편의): 자동(배터리, 저전력일 때), 항상, 끄기. shared/battery.ts */
  batterySaver: SaverMode;
  /** 말풍선을 화면 읽기 프로그램이 읽어 준다 (편의, 기본 켬) */
  readAloud: boolean;
  /** 맥 메뉴 막대 아이콘 옆에 다음 일정이나 집중 남은 시간 (편의, 기본 끔: 제목이 화면에 늘 보인다) */
  trayTitle: boolean;
  /** 집 숨기기 (2026-10-12, shared/house-stow.ts): 화면의 집을 숨겨 둔다. 자리, 단계, 모양은 그대로 */
  houseHidden: boolean;
  /** 배터리 절약을 펫이 한 번 알렸는지 (처음 배터리로 바뀔 때 한 번, "그대로 움직이기" 단추와 함께) */
  saverTold: boolean;
  /**
   * 하루 리듬 (기본 켬, shared/energy.ts): 사용자 컴퓨터 시각대로 아침엔 잠이 덜 깨고 낮엔 활발하고 밤엔 졸리다.
   * 쉬지 않고 오래 일하면 같이 지친다. 끄면 예전 모습 (밤에 하품이 잦은 것만 남는다). 지친 혼잣말은 수다 빈도를 따른다
   */
  dayRhythm: boolean;
  /** 짝꿍 일기를 지금 고른 AI 로 다듬기 (기본 끔. 켜도 숫자와 펫 문장만 보낸다) */
  diaryAi: boolean;
  /** 효과음 (기본 끔). 집중, 잠, 숨김 중에는 안 낸다 */
  sounds: boolean;
  /** 부스트 모드 (기본 끔): 사양 좋은 컴퓨터용. CPU, 메모리를 조금 더 써서 더 부드럽고 빠르게. 배터리일 때는 쉰다 */
  boost: boolean;
  /**
   * 사용자가 고른 걸음새 (설정 짝꿍). 키는 몸(bodyKey): 입체 사진 펫은 설계도 파일 이름, 기본 펫은 kind:<모양>.
   * 없으면 자동(설계도 gait, 없으면 다리 모양으로 짐작). 고른 값이 설계도 gait 보다 먼저다.
   * 몸마다 따로라 보관함의 펫을 바꿔 꺼내도 각자 값이 남는다
   */
  petGaits: Record<string, Gait>;
  /**
   * 입체 사진 펫을 만들 때 적은 요청사항. 키는 설계도 파일 이름. 걸음새에 맞게 몸을 다시 만들 때 같은 요청사항을 쓴다.
   * 이 칸이 생기기 전에 만든 펫은 없다(요청사항 없이 다시 만든다). 펫 파일로 내보내지 않는다
   */
  petWishes: Record<string, string>;
  /**
   * 네 발로 선 피규어로 볼 사진 동물 페어리 (밀크, 초코처럼, shared/pet3d/stand.ts). 키는 설계도 파일 이름.
   * 고른 펫만 (예전에 만든 펫은 그대로 앉은 피규어다)
   */
  petStands: Record<string, boolean>;
  /**
   * 개인 용도 페어리 (말로 만들기, 2026-10-12): 이미 있는 캐릭터 이름으로 만든 입체 펫. 키는 설계도 파일 이름.
   * 펫 파일로 내보낼 때 이름표에 personalOnly 를 적고(공식 갤러리가 받지 않는다) 내보내기 칸에 한 줄 안내를 보인다
   */
  petPersonal: Record<string, boolean>;
  /**
   * 기본 펫 모습마다 사용자가 지은 이름 (2026-10-12). 키는 몸 열쇠(bodyKey, kind:<모양>). 사진 펫(밀크, 초코)으로
   * 갔다가 돌아오면 이 이름을 되살린다 (예전에는 "모찌"로 지은 콩이가 초코를 거쳐 오면 "콩이"가 됐다).
   * 사진 펫 이름은 보관함(petLibrary)이 들고 있어 여기 없다. 손대지 않은 모습은 없다(기본 이름)
   */
  petKindNames: Record<string, string>;
  /**
   * 말로 만든 펫의 처음 글 (말로 만들기). 키는 설계도 파일 이름. 걸음새를 바꿔 몸을 다시 만들 때 사진 길(펫 그림을 AI 에
   * 보이기) 대신 이 글로 다시 만든다. 이 칸이 생기기 전에 만든 펫은 없다(사진 길로 다시 만든다). 펫 파일로 내보내지 않는다
   */
  petTexts: Record<string, string>;
  /**
   * 만나는 시간 (shared/routine.ts, 사용자 요청 2026-10-08): 요일마다 일을 시작하고 끝내는 시간. 그때 맞이하고 헤어지는 인사.
   * 기본 꺼짐(예전처럼 켤 때 브리핑). 켜 두면 만나지 않는 요일이 삐짐 쉬는 날도 된다(restDays 대신, routine.ts restDaysOf)
   */
  routine: Routine;
  /**
   * AI 일러스트를 어디서 그릴지 (2026-10-10). cloud 무료 서버(하루 몇 번), mac 이 Mac 에서(횟수 제한 없음, 처음 한 번 준비).
   * 기본 cloud: mac 은 16GB 를 받아야 해서 사용자가 고른다. 고를 수 없는 컴퓨터면 저장된 값이 mac 이어도 창이 cloud 로 쓴다
   */
  illustEngine: IllustEngine;
  /**
   * 같이 타자 치기 (2026-10-11, 기본 켬): 사용자가 입력하는 동안 펫이 작은 키보드를 같이 두드린다.
   * 키 내용은 읽지 않고 입력이 있는지만 본다 (shared/together.ts). 배터리 절약 중에는 쉰다
   */
  typeAlong: boolean;
  /** 매일 쪽지 (2026-10-11, 기본 켬): 하루 한 번 펫이 이 컴퓨터 기록으로 쓴 쪽지를 들고 온다 (shared/daily-note.ts) */
  dailyNotes: boolean;
}

/** 보관한 사진 펫. 파일은 pets/ 안 */
export interface SavedPet {
  id: string;
  name: string;
  image: string;
  model?: string;
  depth?: string;
  /** AI 일러스트 나이 단계 (없으면 사진 그대로 만든 펫) */
  age?: AgeStage;
  poses: Partial<Record<PoseKind, string>>;
  /** 펫 파일에서 데려온 펫의 이름표 (Settings.petMeta) */
  meta?: PetMeta;
}

export const LIBRARY_MAX = 12;
export const RULES_MAX = 4000;

export interface Friend {
  id: string;
  name: string;
  kind: PetKind;
  /** 사진 그림 (pets/ 안, 펫 공유 파일에서 데려왔을 때) */
  image?: string;
  /** 입체 설계도 (pets/ 안 model-*.json, 6단계) */
  model?: string;
  /** 2.5D 깊이 그림 (pets/ 안 depth-*.png, 6단계) */
  depth?: string;
  /** 고른 걸음새. 없으면 자동 (친구마다 따로) */
  gait?: Gait;
  /** AI 일러스트 나이 단계 (펫 파일에서). 아기, 청소년은 작게 */
  age?: AgeStage;
}

export const FRIENDS_MAX = 3;

/** 걸음새 고르기: 자동(몸 모양을 보고), 두 발, 네 발 */
export const GAIT_PICKS = ['auto', ...GAITS] as const;
export type GaitPick = (typeof GAIT_PICKS)[number];
export const isGait = (v: unknown): v is Gait => GAITS.includes(v as Gait);

/**
 * 지금 펫의 몸 열쇠 (petGaits 의 키). 기본 펫은 kind:<모양>(2D 와 입체가 같은 값), 입체 설계도가 있는 사진 펫은
 * 설계도 파일 이름. 설계도가 없는 사진 펫(평면 사진, 2.5D)은 다리가 따로 없어 고를 수 없다(undefined)
 */
export function bodyKey(s: Pick<Settings, 'petImage' | 'petModel' | 'petKind'>): string | undefined {
  if (!s.petImage) return `kind:${s.petKind}`;
  return s.petModel;
}

/** 밀크, 초코 그림을 복사한 파일 이름 (starter-pets.ts starterFileName). 그쪽이 이 파일을 가져다 써서 모양만 따로 둔다 */
const STARTER_IMAGE = /^pet-(milk|choco)-\d+\.png$/;
/** 밀크, 초코의 네 발로 서기 키 (petStands) */
const STARTER_STAND = /^starter:(milk|choco)$/;

/**
 * 네 발로 서기 키 (petStands). 설계도가 있는 사진 펫은 설계도 파일 이름, 설계도 없는 밀크, 초코 그림은 starter:<이름>.
 * 밀크, 초코는 기본이 사진 그대로이고 켜면 앱에 든 네 발 피규어다 (0.4.1 사용자 결정: 0.4.0 피규어가 사진과 너무 달랐다)
 */
export function standKey(
  image: string | null | undefined,
  model: string | null | undefined,
): string | undefined {
  if (!image) return undefined;
  if (model) return model;
  const m = STARTER_IMAGE.exec(image);
  return m ? `starter:${m[1]}` : undefined;
}

/** 지금 사진 펫을 네 발로 선 피규어로 보는지 (설정 petStands) */
export function pickedStand(s: Pick<Settings, 'petImage' | 'petModel' | 'petKind' | 'petStands'>): boolean {
  const key = standKey(s.petImage, s.petModel);
  return !!key && s.petStands[key] === true;
}

/** 지금 펫이 설계도 없는 밀크, 초코 그림이면 네 발 피규어를 켰는지. 아니면 undefined (설정 창 칸) */
export function starterStand(
  s: Pick<Settings, 'petImage' | 'petModel' | 'petKind' | 'petStands'>,
): boolean | undefined {
  return standKey(s.petImage, s.petModel)?.startsWith('starter:') ? pickedStand(s) : undefined;
}

/**
 * 지금 펫 모습(설정 창 snapshot.current)을 다시 받아야 하는지 가르는 열쇠. 그림, 설계도, 깊이, 보관함이 바뀌거나
 * 밀크, 초코의 네 발 피규어를 켜고 끌 때 (그때 사진이 피규어로 바뀐다, starters.ts starterFigureOf).
 * 피규어 켜기가 빠져 있어 켠 뒤에도 설정 창이 옛 사진 모습으로 걸음새 칸을 그렸다 (#28)
 */
export function lookKey(
  s: Pick<Settings, 'petImage' | 'petModel' | 'petKind' | 'petDepth' | 'petLibrary' | 'petStands'>,
): string {
  return JSON.stringify([
    s.petImage,
    s.petModel,
    s.petDepth,
    s.petLibrary.map((p) => p.id),
    starterStand(s) ?? null,
  ]);
}

/** 지금 펫이 개인 용도 페어리인지 (이미 있는 캐릭터 이름으로 말로 만들기, petPersonal) */
export function isPersonalPet(s: Pick<Settings, 'petImage' | 'petModel' | 'petPersonal'>): boolean {
  return !!s.petImage && !!s.petModel && s.petPersonal[s.petModel] === true;
}

/** 지금 사진 펫의 네 발로 서기를 바꾸는 값. 고를 수 없는 펫(설계도 없음)이면 undefined */
export function standPatch(s: Settings, on: boolean): Pick<Settings, 'petStands'> | undefined {
  const key = standKey(s.petImage, s.petModel);
  if (!key) return undefined;
  const { [key]: _, ...rest } = s.petStands;
  return { petStands: on ? { ...rest, [key]: true } : rest };
}

/** 지금 펫에 고른 걸음새. 자동이면 undefined */
export function pickedGait(
  s: Pick<Settings, 'petImage' | 'petModel' | 'petKind' | 'petGaits'>,
): Gait | undefined {
  const key = bodyKey(s);
  return key ? s.petGaits[key] : undefined;
}

/** 지금 펫의 걸음새를 바꾸는 값 (설정 바꾸기에 그대로 넣는다). 자동이면 키를 지운다. 고를 수 없는 펫이면 undefined */
export function gaitPatch(s: Settings, pick: GaitPick): Pick<Settings, 'petGaits'> | undefined {
  const key = bodyKey(s);
  if (!key) return undefined;
  const { [key]: _, ...rest } = s.petGaits;
  return { petGaits: pick === 'auto' ? rest : { ...rest, [key]: pick } };
}

export const PET_KIND_IDS = ['kong', 'cat', 'chick', 'dog', 'bunny', 'hamster', 'penguin', 'bear'] as const;
export type PetKind = (typeof PET_KIND_IDS)[number];
export const isPetKind = (v: unknown): v is PetKind => PET_KIND_IDS.includes(v as PetKind);
// 이름은 지금 말로 읽는다 (getter). 화면은 setLang 뒤에 읽는다.
export const PET_KINDS: readonly { id: PetKind; readonly label: string }[] = [
  {
    id: 'kong',
    get label() {
      return t('common.petKind.kong');
    },
  },
  {
    id: 'cat',
    get label() {
      return t('common.petKind.cat');
    },
  },
  {
    id: 'chick',
    get label() {
      return t('common.petKind.chick');
    },
  },
  {
    id: 'dog',
    get label() {
      return t('common.petKind.dog');
    },
  },
  {
    id: 'bunny',
    get label() {
      return t('common.petKind.bunny');
    },
  },
  {
    id: 'hamster',
    get label() {
      return t('common.petKind.hamster');
    },
  },
  {
    id: 'penguin',
    get label() {
      return t('common.petKind.penguin');
    },
  },
  {
    id: 'bear',
    get label() {
      return t('common.petKind.bear');
    },
  },
];
export type PoseKind = 'happy' | 'sleepy' | 'hungry';
export const POSE_KINDS: readonly { id: PoseKind; readonly label: string }[] = [
  {
    id: 'happy',
    get label() {
      return t('common.pose.happy');
    },
  },
  {
    id: 'sleepy',
    get label() {
      return t('common.pose.sleepy');
    },
  },
  {
    id: 'hungry',
    get label() {
      return t('common.pose.hungry');
    },
  },
];
const PET_FILE = /^(pet|pose)-[\w-]+\.(png|gif|webp)$/;

/** 바꿀 값만. 사진 펫은 null 이면 지운다 (기본 펫으로). */
export type SettingsPatch = Partial<
  Omit<Settings, 'petImage' | 'petPoses' | 'petModel' | 'petDepth' | 'petAge' | 'petMeta'>
> & {
  petImage?: string | null;
  petAge?: AgeStage | null;
  petMeta?: PetMeta | null;
  petModel?: string | null;
  petDepth?: string | null;
  petPoses?: Partial<Record<PoseKind, string | null>>;
};

export const DEFAULT_SETTINGS: Settings = {
  petName: '콩이',
  petNameEdited: false,
  chatter: 'normal',
  wander: true,
  aiIsolation: true,
  persona: 'friend',
  speech: DEFAULT_STYLE,
  aiKnowsTodos: false,
  aiPetTools: false,
  launchAtLogin: false,
  hideHints: 0,
  petKind: 'kong',
  pet3d: true,
  petStyle: 'figure',
  sysMonitor: true,
  petPoses: {},
  restDays: [0, 6],
  spicy: false,
  onboarded: false,
  updateCheck: true,
  reviewMinute: 18 * 60,
  review: true,
  osNotify: true,
  shortcuts: { ...SHORTCUT_DEFAULTS },
  myMcp: false,
  friends: [],
  lang: 'auto',
  aiModels: {},
  petLibrary: [],
  petRules: '',
  petMemory: [],
  petMemoryPending: [],
  petMemoryMeta: {},
  petFacts: [],
  seasonWear: true,
  focusMin: 25,
  lookAtCursor: true,
  urlScheme: true,
  batterySaver: 'auto',
  readAloud: true,
  trayTitle: false,
  houseHidden: false,
  saverTold: false,
  dayRhythm: true,
  diaryAi: false,
  sounds: false,
  boost: false,
  petGaits: {},
  petWishes: {},
  petStands: {},
  petPersonal: {},
  petKindNames: {},
  petTexts: {},
  routine: DEFAULT_ROUTINE,
  illustEngine: 'cloud',
  typeAlong: true,
  dailyNotes: true,
};

export const PET_NAME_MAX = 12;
/** 글자 하나가 지나치게 긴 조합(결합 문자를 수십 개 붙인 것)으로 이름이 커지지 않게 코드 포인트도 센다 */
const PET_NAME_MAX_CODE_POINTS = PET_NAME_MAX * 8;

/** 사람이 보는 글자 단위로 나눈다. 이모지 가족(👨‍👩‍👧), 국기, 피부색, 풀어 쓴 한글(ㅎ+ㅏ+ㄴ)도 한 글자 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text: string): string[] => Array.from(segmenter.segment(text), (g) => g.segment);

/** 이름 글자 수. 화면의 n/12 와 저장할 때 자르는 기준이 같다 */
export const petNameLength = (text: string): number => graphemes(text.normalize('NFC')).length;

/**
 * 입력 칸에서 상한을 넘은 글자를 뗀다 (앞뒤 공백은 그대로 둔다. 다듬기는 저장할 때 cleanPetName).
 * HTML maxLength 는 UTF-16 단위로 세어 이모지는 두세 칸, 한글은 한 칸이라 저장 기준과 달라 쓰지 않는다
 */
export function clipPetName(text: string): string {
  const g = graphemes(text.normalize('NFC'));
  return g.length <= PET_NAME_MAX ? text : g.slice(0, PET_NAME_MAX).join('');
}

/** 펫 이름을 다듬는다. 앞뒤 공백, 줄바꿈, 제어 문자를 빼고 12글자까지(사람이 보는 글자). 비면 undefined. */
export function cleanPetName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // 제어 문자(줄바꿈 포함)는 지운다. 정규식 대신 글자 번호로 걸러 린트 예외를 두지 않는다.
  const printable = [...raw.normalize('NFC')].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
  const name = printable.join('').replace(/\s+/g, ' ').trim();
  if (!name) return undefined;
  const cut = graphemes(name).slice(0, PET_NAME_MAX).join('');
  return [...cut].slice(0, PET_NAME_MAX_CODE_POINTS).join('').trim() || undefined;
}

/** 기본 펫 모습마다의 기본 이름 (지금 화면 말로) */
export function defaultPetName(kind: PetKind): string {
  switch (kind) {
    case 'cat':
      return t('common.petName.cat');
    case 'chick':
      return t('common.petName.chick');
    case 'dog':
      return t('common.petName.dog');
    case 'bunny':
      return t('common.petName.bunny');
    case 'hamster':
      return t('common.petName.hamster');
    case 'penguin':
      return t('common.petName.penguin');
    case 'bear':
      return t('common.petName.bear');
    default:
      return t('common.defaultPetName');
  }
}

/**
 * 이름을 손대지 않았으면 기본 펫 모습을 바꿀 때 이름도 그 모습의 기본 이름으로 (첫 안내, 설정의 모습 카드).
 * 이름을 같이 바꾸는 변경(보관한 사진 펫 꺼내기, 펫 만들기)과 사진 펫으로 바꾸는 변경은 건드리지 않는다.
 * 사진 펫(밀크, 초코 포함)에서 기본 펫으로 오면 손댄 이름 표시가 있어도 기본 이름: 사진 펫 이름은 그 펫과 함께
 * 보관함으로 간다 (표시는 예전 펫 때 남은 것이라 기본 펫이 "밀크"로 불렸다)
 */
export function followKindName(prev: Settings, next: Settings, patch: unknown): Settings {
  return rememberKindName(prev, pickKindName(prev, next, patch));
}

function pickKindName(prev: Settings, next: Settings, patch: unknown): Settings {
  if (next.petImage) return next;
  if (typeof patch === 'object' && patch !== null && 'petName' in patch) return next;
  const leftPhoto = !!prev.petImage;
  const moved = leftPhoto || prev.petKind !== next.petKind;
  // 이 모습에 지어 둔 이름이 있으면 그 이름 (초코에 갔다 와도, 다른 모습에 다른 이름을 지었어도)
  const saved = moved ? next.petKindNames[`kind:${next.petKind}`] : undefined;
  if (saved)
    return saved === next.petName && next.petNameEdited
      ? next
      : { ...next, petName: saved, petNameEdited: true };
  if (next.petNameEdited && !leftPhoto) return next;
  if (!moved) return next;
  const name = defaultPetName(next.petKind);
  if (name === next.petName && !next.petNameEdited) return next;
  return { ...next, petName: name, petNameEdited: false };
}

/**
 * 기본 펫에 지은 이름을 그 모습 열쇠에 적어 둔다 (petKindNames). 바뀌기 전 펫도 적는다: 이 칸이 생기기 전에 지은 이름도
 * 다른 펫으로 갔다 오면 되살아나게
 */
function rememberKindName(prev: Settings, next: Settings): Settings {
  let names = next.petKindNames;
  const note = (s: Settings) => {
    if (s.petImage || !s.petNameEdited) return;
    const key = `kind:${s.petKind}`;
    if (names[key] !== s.petName) names = { ...names, [key]: s.petName };
  };
  if (!prev.petKindNames[`kind:${prev.petKind}`]) note(prev);
  note(next);
  return names === next.petKindNames ? next : { ...next, petKindNames: names };
}

/**
 * 사진 펫을 이름 없이 만들 때 이름: "찰칵이", 이미 있으면 "찰칵이 2", "찰칵이 3".
 * 지금 펫 이름을 그대로 쓰면 보관함에 같은 이름이 쌓였다
 */
export function photoPetName(taken: readonly string[]): string {
  const base = t('common.petName.photo');
  const used = new Set(taken.map((n) => n.normalize('NFC')));
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const name = cleanPetName(`${base} ${i}`) ?? base;
    if (!used.has(name)) return name;
  }
  return base;
}

/** 저장 파일이나 화면에서 온 값을 설정으로 만든다. 모르는 값, 틀린 값은 기본값으로. */
export function parseSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    petName: cleanPetName(r.petName) ?? base.petName,
    petNameEdited: bool(r.petNameEdited, base.petNameEdited),
    chatter:
      r.chatter === 'quiet' || r.chatter === 'normal' || r.chatter === 'chatty' ? r.chatter : base.chatter,
    wander: bool(r.wander, base.wander),
    aiIsolation: bool(r.aiIsolation, base.aiIsolation),
    persona: isPersona(r.persona) ? r.persona : base.persona,
    speech: r.speech === undefined ? base.speech : parseStyle(r.speech),
    aiKnowsTodos: bool(r.aiKnowsTodos, base.aiKnowsTodos),
    aiPetTools: bool(r.aiPetTools, base.aiPetTools),
    launchAtLogin: bool(r.launchAtLogin, base.launchAtLogin),
    hideHints:
      typeof r.hideHints === 'number' && Number.isFinite(r.hideHints)
        ? Math.max(0, Math.floor(r.hideHints))
        : base.hideHints,
    ...petImageOf(r.petImage, base.petImage),
    petKind: isPetKind(r.petKind) ? r.petKind : base.petKind,
    pet3d: bool(r.pet3d, base.pet3d),
    petStyle: (PET_STYLES as readonly unknown[]).includes(r.petStyle)
      ? (r.petStyle as PetStyle)
      : base.petStyle,
    sysMonitor: bool(r.sysMonitor, base.sysMonitor),
    ...petModelOf(r.petModel, base.petModel),
    ...petDepthOf(r.petDepth, base.petDepth),
    ...petAgeOf(r, base),
    ...petMetaOf(r.petMeta, base.petMeta),
    petPoses: posesOf(r.petPoses, base.petPoses),
    restDays: Array.isArray(r.restDays)
      ? [...new Set(r.restDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : base.restDays,
    spicy: bool(r.spicy, base.spicy),
    onboarded: bool(r.onboarded, base.onboarded),
    updateCheck: bool(r.updateCheck, base.updateCheck),
    reviewMinute:
      typeof r.reviewMinute === 'number' &&
      Number.isInteger(r.reviewMinute) &&
      r.reviewMinute >= 0 &&
      r.reviewMinute < 1440
        ? r.reviewMinute
        : base.reviewMinute,
    review: typeof r.review === 'boolean' ? r.review : r.chatter === 'quiet' ? false : base.review,
    osNotify: bool(r.osNotify, base.osNotify),
    shortcuts: shortcutsOf(r.shortcuts, base.shortcuts),
    ...icsOf(r.icsUrl, base.icsUrl),
    myMcp: bool(r.myMcp, base.myMcp),
    friends: Array.isArray(r.friends) ? friendsOf(r.friends) : base.friends,
    lang: r.lang === 'auto' || r.lang === 'ko' || r.lang === 'en' ? r.lang : base.lang,
    aiModels: aiModelsOf(r.aiModels, base.aiModels),
    petLibrary: Array.isArray(r.petLibrary) ? libraryOf(r.petLibrary) : base.petLibrary,
    petRules:
      typeof r.petRules === 'string' ? cutText(r.petRules.replace(/\r\n/g, '\n'), RULES_MAX) : base.petRules,
    petMemory: Array.isArray(r.petMemory) ? cleanMemory(r.petMemory) : [...base.petMemory],
    petMemoryPending: Array.isArray(r.petMemoryPending)
      ? cleanPending(r.petMemoryPending)
      : [...base.petMemoryPending],
    ...memoryNotesOf(r, base),
    seasonWear: bool(r.seasonWear, base.seasonWear),
    focusMin: isFocusLength(r.focusMin) ? r.focusMin : base.focusMin,
    lookAtCursor: bool(r.lookAtCursor, base.lookAtCursor),
    urlScheme: bool(r.urlScheme, base.urlScheme),
    batterySaver: isSaverMode(r.batterySaver) ? r.batterySaver : base.batterySaver,
    readAloud: bool(r.readAloud, base.readAloud),
    trayTitle: bool(r.trayTitle, base.trayTitle),
    houseHidden: bool(r.houseHidden, base.houseHidden),
    saverTold: bool(r.saverTold, base.saverTold),
    dayRhythm: bool(r.dayRhythm, base.dayRhythm),
    diaryAi: bool(r.diaryAi, base.diaryAi),
    sounds: bool(r.sounds, base.sounds),
    boost: bool(r.boost, base.boost),
    routine: parseRoutine(r.routine, base.routine),
    // 옛 값 'mac' 은 local 로 (내 Mac에서 → 내 컴퓨터에서, 2026-10-10)
    illustEngine: illustEngineOf(r.illustEngine) ?? base.illustEngine,
    typeAlong: bool(r.typeAlong, base.typeAlong),
    dailyNotes: bool(r.dailyNotes, base.dailyNotes),
    ...bodiesOf(r, base),
    petKindNames: kindNamesOf(r.petKindNames, base.petKindNames),
    ...(typeof r.skipVersion === 'string' && /^\d+\.\d+\.\d+/.test(r.skipVersion)
      ? { skipVersion: r.skipVersion.slice(0, 32) }
      : base.skipVersion
        ? { skipVersion: base.skipVersion }
        : {}),
  };
}

/** 기억 출처 표와 알려 준 것 (knows.ts). 출처는 지금 기억하거나 기다리는 글의 것만 남긴다 */
function memoryNotesOf(
  r: Record<string, unknown>,
  base: Settings,
): Pick<Settings, 'petMemoryMeta' | 'petFacts'> {
  const memory = Array.isArray(r.petMemory) ? cleanMemory(r.petMemory) : base.petMemory;
  const pending = Array.isArray(r.petMemoryPending)
    ? cleanPending(r.petMemoryPending)
    : base.petMemoryPending;
  return {
    petMemoryMeta: cleanMeta(r.petMemoryMeta ?? base.petMemoryMeta, [...memory, ...pending]),
    petFacts: Array.isArray(r.petFacts) ? cleanFacts(r.petFacts) : [...base.petFacts],
  };
}

/** 몸 열쇠 모양: 설계도 파일 이름이나 kind:<기본 펫 모양> */
const KIND_KEY = /^kind:(\w+)$/;

/**
 * 걸음새와 요청사항 칸 검사. 설계도 파일 키는 지금 펫이나 보관함이 아직 쓰는 것만 남긴다
 * (펫을 지우거나 몸을 다시 만들면 옛 키가 빠진다). 기본 펫 키는 아는 모양만
 */
/** 말로 만든 처음 글 칸의 UTF-16 상한 (글은 200글자, 이모지 한 글자가 열 칸을 넘기도 한다) */
const PET_TEXT_MAX_UNITS = 3200;

function bodiesOf(
  r: Record<string, unknown>,
  base: Settings,
): Pick<Settings, 'petGaits' | 'petWishes' | 'petStands' | 'petPersonal' | 'petTexts'> {
  const models = new Set<string>();
  const image = petImageOf(r.petImage, base.petImage).petImage;
  const current = petModelOf(r.petModel, base.petModel).petModel;
  if (image && current) models.add(current);
  const lib = Array.isArray(r.petLibrary) ? libraryOf(r.petLibrary) : base.petLibrary;
  for (const p of lib) if (p.model) models.add(p.model);
  const kindKey = (k: string) => isPetKind(KIND_KEY.exec(k)?.[1]);
  const pick = <T>(
    v: unknown,
    fallback: Record<string, T>,
    keep: (k: string) => boolean,
    ok: (x: unknown) => T | undefined,
  ) => {
    const src =
      typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fallback;
    const out: Record<string, T> = {};
    for (const [k, x] of Object.entries(src).slice(0, 64)) {
      const val = ok(x);
      if (val !== undefined && keep(k)) out[k] = val;
    }
    return out;
  };
  return {
    petGaits: pick(
      r.petGaits,
      base.petGaits,
      (k) => models.has(k) || kindKey(k),
      (x) => (isGait(x) ? x : undefined),
    ),
    // 요청사항은 입체 사진 펫에만 (기본 펫은 사진이 없어 다시 만들지 않는다)
    petWishes: pick(
      r.petWishes,
      base.petWishes,
      (k) => models.has(k),
      (x) => cleanWish(x) || undefined,
    ),
    // 네 발로 서기는 입체 사진 펫과 밀크, 초코에만 (켠 것만 남긴다)
    petStands: pick(
      r.petStands,
      base.petStands,
      (k) => models.has(k) || STARTER_STAND.test(k),
      (x) => (x === true ? true : undefined),
    ),
    // 개인 용도 표시는 입체 사진 펫(설계도)에만, 켠 것만 남긴다
    petPersonal: pick(
      r.petPersonal,
      base.petPersonal,
      (k) => models.has(k),
      (x) => (x === true ? true : undefined),
    ),
    // 말로 만든 처음 글도 입체 사진 펫(설계도)에만. 다듬기는 저장할 때(maker.ts cleanDescribe) 하고 여기는 모양과 길이만
    petTexts: pick(
      r.petTexts,
      base.petTexts,
      (k) => models.has(k),
      (x) => (typeof x === 'string' && x.trim() && x.length <= PET_TEXT_MAX_UNITS ? x.trim() : undefined),
    ),
  };
}

/** 기본 펫 모습마다 지은 이름: 아는 모습 열쇠(kind:<모양>)만, 이름은 이름 칸과 같이 다듬는다 */
function kindNamesOf(v: unknown, fallback: Record<string, string>): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fallback;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const name = cleanPetName(x);
    if (name && isPetKind(KIND_KEY.exec(k)?.[1])) out[k] = name;
  }
  return out;
}

/** 고른 모델: 모양만 본다(목록에 있는지는 부를 때 본다). 빈 값이면 그 AI 의 기본으로 되돌린다 */
function aiModelsOf(v: unknown, current: Settings['aiModels']): Settings['aiModels'] {
  if (typeof v !== 'object' || v === null) return { ...current };
  const out: Settings['aiModels'] = {};
  for (const [k, m] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (/^[a-z][\w-]{0,40}$/.test(k) && typeof m === 'string' && /^\w[\w.:/-]{0,63}$/.test(m)) out[k] = m;
  }
  return out;
}

/** 사진 펫 파일 이름. 파일 이름만 받는다 (경로를 넣어 다른 폴더를 가리키지 못하게). 비우면 기본 펫. */
function petImageOf(v: unknown, current: string | undefined): { petImage?: string } {
  if (v === null || v === '') return {};
  if (typeof v === 'string' && PET_FILE.test(v)) return { petImage: v };
  return current ? { petImage: current } : {};
}

/** 펫 이름표: null 이면 지운다. 틀린 값은 지금 것 그대로 */
function petMetaOf(v: unknown, current: PetMeta | undefined): { petMeta?: PetMeta } {
  if (v === null) return {};
  const meta = v === undefined ? current : (cleanPetMeta(v) ?? current);
  return meta ? { petMeta: meta } : {};
}

/** 나이 단계: 사진 펫이 있을 때만. null 이면 지운다 */
function petAgeOf(r: Record<string, unknown>, base: Settings): { petAge?: AgeStage } {
  if (!petImageOf(r.petImage, base.petImage).petImage) return {};
  if (r.petAge === null) return {};
  if (isAgeStage(r.petAge)) return { petAge: r.petAge };
  return base.petAge ? { petAge: base.petAge } : {};
}

const MODEL_FILE = /^model-[\w-]+\.json$/;
const DEPTH_FILE = /^depth-[\w-]+\.png$/;
function petDepthOf(v: unknown, current: string | undefined): { petDepth?: string } {
  if (v === null || v === '') return {};
  if (typeof v === 'string' && DEPTH_FILE.test(v)) return { petDepth: v };
  return current ? { petDepth: current } : {};
}
function petModelOf(v: unknown, current: string | undefined): { petModel?: string } {
  if (v === null || v === '') return {};
  if (typeof v === 'string' && MODEL_FILE.test(v)) return { petModel: v };
  return current ? { petModel: current } : {};
}

/** 포즈 그림: 아는 포즈와 파일 이름 규칙에 맞는 것만. null 이면 그 포즈를 지운다. */
/** 보관함 검사: id 는 p- 로 시작, 파일 이름은 규칙에 맞는 것만, 12개까지 */
function libraryOf(list: unknown[]): SavedPet[] {
  const out: SavedPet[] = [];
  for (const v of list) {
    if (typeof v !== 'object' || v === null) continue;
    const f = v as Record<string, unknown>;
    const id = typeof f.id === 'string' && /^p-[\w-]{1,24}$/.test(f.id) ? f.id : undefined;
    const name = cleanPetName(f.name);
    const image = typeof f.image === 'string' && PET_FILE.test(f.image) ? f.image : undefined;
    if (!id || !name || !image || out.some((o) => o.id === id)) continue;
    const model = typeof f.model === 'string' && MODEL_FILE.test(f.model) ? f.model : undefined;
    const depth = typeof f.depth === 'string' && DEPTH_FILE.test(f.depth) ? f.depth : undefined;
    const meta = cleanPetMeta(f.meta);
    out.push({
      id,
      name,
      image,
      ...(model ? { model } : {}),
      ...(depth ? { depth } : {}),
      ...(isAgeStage(f.age) ? { age: f.age } : {}),
      poses: posesOf(f.poses, {}),
      ...(meta ? { meta } : {}),
    });
    if (out.length >= LIBRARY_MAX) break;
  }
  return out;
}

function posesOf(v: unknown, current: Settings['petPoses']): Settings['petPoses'] {
  if (typeof v !== 'object' || v === null) return { ...current };
  const out: Settings['petPoses'] = {};
  for (const { id } of POSE_KINDS) {
    const f = (v as Record<string, unknown>)[id];
    if (typeof f === 'string' && PET_FILE.test(f)) out[id] = f;
    else if (f === undefined && current[id]) out[id] = current[id];
  }
  return out;
}

/** 친구 펫 목록 검사: id 는 f- 로 시작하는 짧은 글, 이름은 펫 이름 규칙, 3마리까지 */
function friendsOf(list: unknown[]): Friend[] {
  const out: Friend[] = [];
  for (const v of list) {
    if (typeof v !== 'object' || v === null) continue;
    const f = v as Record<string, unknown>;
    const id = typeof f.id === 'string' && /^f-[\w-]{1,20}$/.test(f.id) ? f.id : undefined;
    const name = cleanPetName(f.name);
    if (!id || !name || out.some((o) => o.id === id)) continue;
    const kind: PetKind = isPetKind(f.kind) ? f.kind : 'kong';
    const image = typeof f.image === 'string' && PET_FILE.test(f.image) ? f.image : undefined;
    const model = image && typeof f.model === 'string' && MODEL_FILE.test(f.model) ? f.model : undefined;
    const depth = image && typeof f.depth === 'string' && DEPTH_FILE.test(f.depth) ? f.depth : undefined;
    out.push({
      id,
      name,
      kind,
      ...(image ? { image } : {}),
      ...(model ? { model } : {}),
      ...(depth ? { depth } : {}),
      ...(isGait(f.gait) ? { gait: f.gait } : {}),
      ...(image && isAgeStage(f.age) ? { age: f.age } : {}),
    });
    if (out.length >= FRIENDS_MAX) break;
  }
  return out;
}

/** 지금 운영체제가 맥인지. 화면(샌드박스)에는 process 가 없어 모른다(undefined) */
const HOST_MAC: boolean | undefined =
  typeof process === 'object' && typeof process?.platform === 'string'
    ? process.platform === 'darwin'
    : undefined;

/** 나중 버전에 생긴 단축키. 새로 더하면 여기에도 적는다 (예전 설정 파일에는 이 id 가 없다) */
const LATER_SHORTCUTS: readonly ShortcutId[] = ['chat', 'look', 'panel', 'pet'];

function shortcutsOf(v: unknown, current: Record<ShortcutId, string>): Record<ShortcutId, string> {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const out = { ...current };
  const given = new Set<ShortcutId>();
  for (const id of Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[]) {
    const v = r[id];
    if (v === NO_SHORTCUT) {
      out[id] = NO_SHORTCUT;
      given.add(id);
      continue;
    }
    // 손으로 고친 설정 파일의 복사, 종료 같은 조합은 등록하지 않는다. 운영체제는 이 컴퓨터 것 (파일은 두 운영체제가 같이 쓴다)
    if (isAccelerator(v) && !(HOST_MAC !== undefined && reservedUse(v, HOST_MAC))) {
      out[id] = v;
      given.add(id);
    }
  }
  // 새 버전에서 생긴 단축키(파일에 없는 id)의 기본 키가 사용자가 이미 쓰던 키와 겹치면 새 쪽을 비운다.
  // 예전에는 통째로 기본값으로 돌아가 사용자가 바꿔 둔 키가 사라졌다 (리뷰 HIGH)
  // 처음부터 있던 숨기기, 할 일 넣기는 여기서 비우지 않는다 (일부만 바꾸는 요청이 멀쩡한 키를 지우지 않게)
  for (const id of LATER_SHORTCUTS) {
    if (given.has(id) || out[id] !== SHORTCUT_DEFAULTS[id]) continue;
    const key = out[id].toLowerCase();
    if ([...given].some((g) => out[g].toLowerCase() === key)) out[id] = NO_SHORTCUT;
  }
  // 그래도 두 단축키가 같으면 바꾼 쪽을 버린다 (화면은 shortcutClash 로 먼저 알리고 보내지 않는다)
  if (shortcutClash(out)) return { ...current };
  return out;
}

/** 캘린더 주소: https 만, webcal:// 은 https 로 바꿔 받는다 (가져오기와 같은 cleanIcsUrl). 빈 글이나 null 이면 지운다 */
function icsOf(v: unknown, current: string | undefined): { icsUrl?: string } {
  if (v === null || v === '') return {};
  const url = typeof v === 'string' && v.length < 2000 ? cleanIcsUrl(v) : undefined;
  if (url) return { icsUrl: url };
  return current ? { icsUrl: current } : {};
}

/** 바꾸기: 지금 설정에 바꿀 값만 덮는다. 틀린 값은 무시하고 지금 값을 둔다. */
export function applyPatch(current: Settings, patch: unknown): Settings {
  const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  return parseSettings({ ...current, ...p }, current);
}
