// 사용자 설정 (P1-12). 2단계에서 SQLite 로 옮기기 전까지 JSON 파일 하나에 둔다.
import { isPersona, type PersonaId } from './ai/persona.ts';
import type { ChatterLevel } from './chatter.ts';
import { type FocusLength, isFocusLength } from './focus.ts';
import { type LangPref, t } from './i18n/index.ts';
import { cleanIcsUrl } from './ics.ts';
import { GAITS, type Gait } from './pet3d/blueprint.ts';
import { cleanWish } from './pet3d/prompt.ts';
import { DEFAULT_ROUTINE, parseRoutine, type Routine } from './routine.ts';
import { isAccelerator, reservedUse, SHORTCUT_DEFAULTS, type ShortcutId, shortcutClash } from './shortcut.ts';

/** 입체 펫 모습: 피규어, 게임 캐릭터, 실사처럼 */
export const PET_STYLES = ['figure', 'game', 'real'] as const;
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
  /** 펫 성격과 말투 (v1) */
  persona: PersonaId;
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
  /** 집중 타이머 길이 (15, 25, 50분). 마지막에 고른 것 */
  focusMin: FocusLength;
  /** 한가할 때 커서 쪽을 바라본다 */
  lookAtCursor: boolean;
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
   * 만나는 시간 (shared/routine.ts, 사용자 요청 2026-10-08): 요일마다 일을 시작하고 끝내는 시간. 그때 맞이하고 헤어지는 인사.
   * 기본 꺼짐(예전처럼 켤 때 브리핑). 켜 두면 만나지 않는 요일이 삐짐 쉬는 날도 된다(restDays 대신, routine.ts restDaysOf)
   */
  routine: Routine;
}

/** 보관한 사진 펫. 파일은 pets/ 안 */
export interface SavedPet {
  id: string;
  name: string;
  image: string;
  model?: string;
  depth?: string;
  poses: Partial<Record<PoseKind, string>>;
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

export const PET_KIND_IDS = ['kong', 'cat', 'chick', 'dog', 'bunny'] as const;
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
export type SettingsPatch = Partial<Omit<Settings, 'petImage' | 'petPoses' | 'petModel' | 'petDepth'>> & {
  petImage?: string | null;
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
  shortcuts: { ...SHORTCUT_DEFAULTS },
  myMcp: false,
  friends: [],
  lang: 'auto',
  aiModels: {},
  petLibrary: [],
  petRules: '',
  focusMin: 25,
  lookAtCursor: true,
  dayRhythm: true,
  diaryAi: false,
  sounds: false,
  boost: false,
  petGaits: {},
  petWishes: {},
  routine: DEFAULT_ROUTINE,
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
    default:
      return t('common.defaultPetName');
  }
}

/**
 * 이름을 손대지 않았으면 기본 펫 모습을 바꿀 때 이름도 그 모습의 기본 이름으로 (첫 안내, 설정의 모습 카드).
 * 이름을 같이 바꾸는 변경(보관한 사진 펫 꺼내기, 펫 만들기)과 사진 펫으로 바꾸는 변경은 건드리지 않는다
 */
export function followKindName(prev: Settings, next: Settings, patch: unknown): Settings {
  if (next.petNameEdited || next.petImage) return next;
  if (typeof patch === 'object' && patch !== null && 'petName' in patch) return next;
  if (!prev.petImage && prev.petKind === next.petKind) return next;
  const name = defaultPetName(next.petKind);
  return name === next.petName ? next : { ...next, petName: name };
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
    shortcuts: shortcutsOf(r.shortcuts, base.shortcuts),
    ...icsOf(r.icsUrl, base.icsUrl),
    myMcp: bool(r.myMcp, base.myMcp),
    friends: Array.isArray(r.friends) ? friendsOf(r.friends) : base.friends,
    lang: r.lang === 'auto' || r.lang === 'ko' || r.lang === 'en' ? r.lang : base.lang,
    aiModels: aiModelsOf(r.aiModels, base.aiModels),
    petLibrary: Array.isArray(r.petLibrary) ? libraryOf(r.petLibrary) : base.petLibrary,
    petRules:
      typeof r.petRules === 'string' ? r.petRules.replace(/\r\n/g, '\n').slice(0, RULES_MAX) : base.petRules,
    focusMin: isFocusLength(r.focusMin) ? r.focusMin : base.focusMin,
    lookAtCursor: bool(r.lookAtCursor, base.lookAtCursor),
    dayRhythm: bool(r.dayRhythm, base.dayRhythm),
    diaryAi: bool(r.diaryAi, base.diaryAi),
    sounds: bool(r.sounds, base.sounds),
    boost: bool(r.boost, base.boost),
    routine: parseRoutine(r.routine, base.routine),
    ...bodiesOf(r, base),
    ...(typeof r.skipVersion === 'string' && /^\d+\.\d+\.\d+/.test(r.skipVersion)
      ? { skipVersion: r.skipVersion.slice(0, 32) }
      : base.skipVersion
        ? { skipVersion: base.skipVersion }
        : {}),
  };
}

/** 몸 열쇠 모양: 설계도 파일 이름이나 kind:<기본 펫 모양> */
const KIND_KEY = /^kind:(\w+)$/;

/**
 * 걸음새와 요청사항 칸 검사. 설계도 파일 키는 지금 펫이나 보관함이 아직 쓰는 것만 남긴다
 * (펫을 지우거나 몸을 다시 만들면 옛 키가 빠진다). 기본 펫 키는 아는 모양만
 */
function bodiesOf(r: Record<string, unknown>, base: Settings): Pick<Settings, 'petGaits' | 'petWishes'> {
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
  };
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
    out.push({
      id,
      name,
      image,
      ...(model ? { model } : {}),
      ...(depth ? { depth } : {}),
      poses: posesOf(f.poses, {}),
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

function shortcutsOf(v: unknown, current: Record<ShortcutId, string>): Record<ShortcutId, string> {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const out = { ...current };
  for (const id of Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[]) {
    const v = r[id];
    // 손으로 고친 설정 파일의 복사, 종료 같은 조합은 등록하지 않는다. 운영체제는 이 컴퓨터 것 (파일은 두 운영체제가 같이 쓴다)
    if (isAccelerator(v) && !(HOST_MAC !== undefined && reservedUse(v, HOST_MAC))) out[id] = v;
  }
  // 두 단축키가 같으면 바꾼 쪽을 버린다 (화면은 shortcutClash 로 먼저 알리고 보내지 않는다)
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
