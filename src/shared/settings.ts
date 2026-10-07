// 사용자 설정 (P1-12). 2단계에서 SQLite 로 옮기기 전까지 JSON 파일 하나에 둔다.
import { isPersona, type PersonaId } from './ai/persona.ts';
import type { ChatterLevel } from './chatter.ts';
import { type LangPref, t } from './i18n/index.ts';
import { isAccelerator, SHORTCUT_DEFAULTS, type ShortcutId } from './shortcut.ts';

export interface Settings {
  /** 펫 이름. 메뉴, 채팅, 말풍선, AI 성격 지시에 쓰인다 */
  petName: string;
  chatter: ChatterLevel;
  /** 가만히 있다가 가끔 걷고 앉기 (P1-06) */
  wander: boolean;
  /** AI 를 사용자 설정(훅, MCP, 스킬) 없이 부르기. 끄면 "내 AI 설정 그대로" */
  aiIsolation: boolean;
  /** 펫 성격과 말투 (v1) */
  persona: PersonaId;
  /** 질문할 때 오늘 할 일과 일정 제목을 같이 보낸다 (v1, 기본 끔: 밖으로 나가는 정보라 사용자가 켠다) */
  aiKnowsTodos: boolean;
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
  /** 사진 펫을 AI 가 입체로 만든 설계도 (6단계). pets/ 안 model-*.json. 있으면 입체로 보기일 때 사진 대신 이것 */
  petModel?: string;
  /** 사진 펫의 2.5D 깊이 그림 (6단계). pets/ 안 depth-*.png. 있으면 입체로 보기일 때 사진을 입체 판으로 */
  petDepth?: string;
  /** 상태별 포즈 그림 (v1). 기쁨, 졸림, 배고픔. pets/ 안 파일 이름 */
  petPoses: Partial<Record<PoseKind, string>>;
  /** 삐짐 게이지를 세지 않는 요일 (0 일 ~ 6 토). 기본 토, 일 */
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
}

export const FRIENDS_MAX = 3;

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
  chatter: 'normal',
  wander: true,
  aiIsolation: true,
  persona: 'friend',
  aiKnowsTodos: false,
  launchAtLogin: false,
  hideHints: 0,
  petKind: 'kong',
  pet3d: true,
  petPoses: {},
  restDays: [0, 6],
  spicy: false,
  onboarded: false,
  updateCheck: true,
  reviewMinute: 18 * 60,
  shortcuts: { ...SHORTCUT_DEFAULTS },
  myMcp: false,
  friends: [],
  lang: 'auto',
  aiModels: {},
  petLibrary: [],
  petRules: '',
};

export const PET_NAME_MAX = 12;

/** 펫 이름을 다듬는다. 앞뒤 공백, 줄바꿈, 제어 문자를 빼고 12자까지. 비면 undefined. */
export function cleanPetName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // 제어 문자(줄바꿈 포함)는 지운다. 정규식 대신 글자 번호로 걸러 린트 예외를 두지 않는다.
  const printable = [...raw].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
  const name = printable.join('').replace(/\s+/g, ' ').trim();
  if (!name) return undefined;
  return [...name].slice(0, PET_NAME_MAX).join('');
}

/** 저장 파일이나 화면에서 온 값을 설정으로 만든다. 모르는 값, 틀린 값은 기본값으로. */
export function parseSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    petName: cleanPetName(r.petName) ?? base.petName,
    chatter:
      r.chatter === 'quiet' || r.chatter === 'normal' || r.chatter === 'chatty' ? r.chatter : base.chatter,
    wander: bool(r.wander, base.wander),
    aiIsolation: bool(r.aiIsolation, base.aiIsolation),
    persona: isPersona(r.persona) ? r.persona : base.persona,
    aiKnowsTodos: bool(r.aiKnowsTodos, base.aiKnowsTodos),
    launchAtLogin: bool(r.launchAtLogin, base.launchAtLogin),
    hideHints:
      typeof r.hideHints === 'number' && Number.isFinite(r.hideHints)
        ? Math.max(0, Math.floor(r.hideHints))
        : base.hideHints,
    ...petImageOf(r.petImage, base.petImage),
    petKind: isPetKind(r.petKind) ? r.petKind : base.petKind,
    pet3d: bool(r.pet3d, base.pet3d),
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
    shortcuts: shortcutsOf(r.shortcuts, base.shortcuts),
    ...icsOf(r.icsUrl, base.icsUrl),
    myMcp: bool(r.myMcp, base.myMcp),
    friends: Array.isArray(r.friends) ? friendsOf(r.friends) : base.friends,
    lang: r.lang === 'auto' || r.lang === 'ko' || r.lang === 'en' ? r.lang : base.lang,
    aiModels: aiModelsOf(r.aiModels, base.aiModels),
    petLibrary: Array.isArray(r.petLibrary) ? libraryOf(r.petLibrary) : base.petLibrary,
    petRules:
      typeof r.petRules === 'string' ? r.petRules.replace(/\r\n/g, '\n').slice(0, RULES_MAX) : base.petRules,
    ...(typeof r.skipVersion === 'string' && /^\d+\.\d+\.\d+/.test(r.skipVersion)
      ? { skipVersion: r.skipVersion.slice(0, 32) }
      : base.skipVersion
        ? { skipVersion: base.skipVersion }
        : {}),
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
    });
    if (out.length >= FRIENDS_MAX) break;
  }
  return out;
}

function shortcutsOf(v: unknown, current: Record<ShortcutId, string>): Record<ShortcutId, string> {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const out = { ...current };
  for (const id of Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[]) if (isAccelerator(r[id])) out[id] = r[id];
  // 두 단축키가 같으면 바꾼 쪽을 버린다
  if (out.hide === out.quickAdd) return { ...current };
  return out;
}

/** 캘린더 주소: https 만. 빈 글이나 null 이면 지운다 */
function icsOf(v: unknown, current: string | undefined): { icsUrl?: string } {
  if (v === null || v === '') return {};
  if (typeof v === 'string' && /^https:\/\/\S+$/.test(v.trim()) && v.length < 2000)
    return { icsUrl: v.trim() };
  return current ? { icsUrl: current } : {};
}

/** 움직이는 그림 파일인지 (gif, webp) */
export const isAnimatedFile = (f: string) => /\.(gif|webp)$/i.test(f);

/** 바꾸기: 지금 설정에 바꿀 값만 덮는다. 틀린 값은 무시하고 지금 값을 둔다. */
export function applyPatch(current: Settings, patch: unknown): Settings {
  const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  return parseSettings({ ...current, ...p }, current);
}
