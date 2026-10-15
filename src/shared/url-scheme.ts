// fairy:// 주소 (단축어, Raycast, Alfred, PowerToys 에서 페어리 부르기). 예전 이름 jjakkung:// 도 같은 주소로 받는다.
// 다른 앱이 아무 글이나 넘길 수 있는 문이라 엄하게 본다: 아는 동작과 아는 칸만, 길이 상한, 같은 칸 두 번은 거절.
// 파일 경로, 다른 주소로 옮겨 가기 같은 동작은 아예 없다. 글은 할 일, 메모, 일정 제목으로만 쓰인다.
// 무엇을 할 수 있는지와 예시는 docs/integrations.md

import { FOCUS_LENGTHS, type FocusLength } from './focus.ts';

export const URL_SCHEME = 'fairy';
/** 예전 이름(짝꿍) 때 주소. 만들어 둔 단축어, Raycast 명령이 그대로 돌게 같이 받는다 */
export const LEGACY_URL_SCHEMES = ['jjakkung'] as const;
/** 받는 주소 이름 모두 (운영체제 등록도 이것 모두) */
export const URL_SCHEMES: readonly string[] = [URL_SCHEME, ...LEGACY_URL_SCHEMES];

/** 우리 주소 이름으로 시작하는지 (대소문자 무시) */
const hasOurScheme = (s: string): boolean => {
  const low = s.toLowerCase();
  return URL_SCHEMES.some((name) => low.startsWith(`${name}:`));
};
/** 주소 전체 길이 상한 (퍼센트 인코딩 포함). 한글 한 글자가 9바이트(%EA%B0%80)라 넉넉히 */
export const URL_MAX = 8192;
/** add 글 상한 (빠른 입력 한 줄) */
export const ADD_TEXT_MAX = 300;
/** memo 글 상한 */
export const MEMO_TEXT_MAX = 4000;

export const URL_TABS = ['today', 'todo', 'memo', 'calendar'] as const;
export type UrlTab = (typeof URL_TABS)[number];

export type UrlAction =
  | { action: 'add'; text: string }
  | { action: 'memo'; text: string }
  | { action: 'focus'; min?: FocusLength }
  | { action: 'open'; tab: UrlTab };

export type UrlReason =
  | 'scheme'
  | 'tooLong'
  | 'malformed'
  | 'action'
  | 'param'
  | 'duplicate'
  | 'empty'
  | 'value';

export type UrlParse = { ok: true; value: UrlAction } | { ok: false; reason: UrlReason };

/** 동작마다 받는 칸. 여기 없는 칸이 오면 거절한다 (오타를 조용히 넘기지 않게) */
const PARAMS: Record<UrlAction['action'], readonly string[]> = {
  add: ['text'],
  memo: ['text'],
  focus: ['min'],
  open: ['tab'],
};

const fail = (reason: UrlReason): UrlParse => ({ ok: false, reason });

/**
 * 글 다듬기: NFC, 제어 문자 빼기(memo 는 줄바꿈과 탭만 남긴다), 앞뒤 공백. 상한을 넘으면 undefined (자르지 않는다:
 * 잘린 할 일이 조용히 들어가는 것보다 거절하고 알리는 편이 낫다)
 */
export function cleanUrlText(raw: string, max: number, multiline: boolean): string | undefined {
  const kept = [...raw.normalize('NFC')]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (multiline && (ch === '\n' || ch === '\t')) return ch;
      if (code === 0x0d) return multiline ? '' : ' ';
      if (code === 0x0a || code === 0x09) return ' ';
      // C0, DEL, C1 제어 문자와 방향 바꾸기 문자(글을 거꾸로 보이게 하는 속임수)를 뺀다
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return '';
      if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return '';
      return ch;
    })
    .join('');
  const text = multiline ? kept.replace(/[ \t]+\n/g, '\n').trim() : kept.replace(/\s+/g, ' ').trim();
  if ([...text].length > max) return undefined;
  return text;
}

/** fairy:// (또는 예전 jjakkung://) 주소 하나를 읽는다. 틀리면 까닭 */
export function parseJjUrl(raw: unknown): UrlParse {
  if (typeof raw !== 'string') return fail('malformed');
  if (raw.length > URL_MAX) return fail('tooLong');
  const trimmed = raw.trim();
  if (!hasOurScheme(trimmed)) return fail('scheme');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail('malformed');
  }
  if (!URL_SCHEMES.includes(url.protocol.slice(0, -1))) return fail('scheme');
  // 사용자, 비밀번호, 포트, # 은 쓸 데가 없다. 붙어 오면 무언가 잘못 만든 주소다
  if (url.username || url.password || url.port || url.hash) return fail('malformed');
  // fairy://add?… 는 host 가 동작, fairy:add?… (슬래시 없이)는 pathname 이 동작
  const name = (url.host || url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '').toLowerCase();
  if (url.host && url.pathname && url.pathname !== '/') return fail('malformed');
  if (!Object.hasOwn(PARAMS, name)) return fail('action');
  const action = name as UrlAction['action'];
  const allowed = PARAMS[action];
  const seen = new Map<string, string>();
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key)) return fail('param');
    if (seen.has(key)) return fail('duplicate');
    seen.set(key, value);
  }
  switch (action) {
    case 'add':
    case 'memo': {
      const given = seen.get('text');
      if (given === undefined) return fail('empty');
      const text = cleanUrlText(given, action === 'add' ? ADD_TEXT_MAX : MEMO_TEXT_MAX, action === 'memo');
      if (text === undefined) return fail('tooLong');
      if (!text) return fail('empty');
      return { ok: true, value: { action, text } };
    }
    case 'focus': {
      const given = seen.get('min');
      if (given === undefined) return { ok: true, value: { action } };
      if (!/^\d{1,3}$/.test(given)) return fail('value');
      const min = Number(given);
      if (!(FOCUS_LENGTHS as readonly number[]).includes(min)) return fail('value');
      return { ok: true, value: { action, min: min as FocusLength } };
    }
    case 'open': {
      const tab = (seen.get('tab') ?? 'today').toLowerCase();
      if (!(URL_TABS as readonly string[]).includes(tab)) return fail('value');
      return { ok: true, value: { action, tab: tab as UrlTab } };
    }
  }
}

/**
 * 윈도우, 리눅스는 주소나 파일을 명령줄 인자로 넘긴다 (처음 켤 때 process.argv, 이미 떠 있으면 second-instance).
 * 우리 주소처럼 보이는 첫 인자. 크로미엄 스위치(--…) 뒤에 붙어 와도 찾는다
 */
export function urlFromArgv(argv: readonly string[]): string | undefined {
  return argv.find((a) => typeof a === 'string' && hasOurScheme(a));
}

/** 페어리 파일 확장자. 새로 내보내는 파일은 이것 */
export const PET_FILE_EXT = '.fairy';
/** 예전 이름(짝꿍) 때 확장자. 읽기는 그대로 한다 (안의 모양은 같다, docs/pet-format.md) */
export const LEGACY_PET_FILE_EXT = '.jjpet';
/** 읽는 확장자 모두 (점 없이, 파일 고르기 창 거르개용) */
export const PET_FILE_EXTS_READ = [PET_FILE_EXT.slice(1), LEGACY_PET_FILE_EXT.slice(1)] as const;

/** 페어리 파일로 읽을 이름인지 (.fairy, .jjpet, 대소문자 무시) */
export const isPetFileName = (name: string): boolean => {
  const low = name.toLowerCase();
  return low.endsWith(PET_FILE_EXT) || low.endsWith(LEGACY_PET_FILE_EXT);
};

/** Codex 펫 파일 확장자 (Codex 앱의 펫 묶음 zip, shared/codex-pet.ts) */
export const CODEX_PET_EXT = '.codex-pet.zip';
/** Codex 펫 파일로 읽을 이름인지 (.codex-pet.zip, 대소문자 무시) */
export const isCodexPetFileName = (name: string): boolean => name.toLowerCase().endsWith(CODEX_PET_EXT);
/** 가져오기로 받는 파일 이름인지 (페어리 파일과 Codex 펫 파일). 끌어 놓기, 명령줄 */
export const isImportFileName = (name: string): boolean => isPetFileName(name) || isCodexPetFileName(name);
/**
 * zip 이면 Codex 펫 파일로 읽는다 (가져오기 창에서 고른 것, 맥 "다음으로 열기"). 이름이 .codex-pet.zip 이 아니어도
 * 사용자가 페어리로 열겠다고 고른 것이라 안을 보고 판단한다
 */
export const isZipFileName = (name: string): boolean => name.toLowerCase().endsWith('.zip');

/**
 * 명령줄에서 페어리 파일 경로 (파일 연결로 두 번 눌러 연 것). 첫 인자(실행 파일)와 스위치는 빼고,
 * 확장자가 정확히 .fairy 나 .jjpet, .codex-pet.zip 인 것만. 읽기와 검사는 페어리 가져오기(backup.ts importPet)가 한다
 */
export function petFileFromArgv(argv: readonly string[]): string | undefined {
  return argv
    .slice(1)
    .find(
      (a) =>
        typeof a === 'string' &&
        !a.startsWith('-') &&
        a.length < 4096 &&
        !a.includes('\0') &&
        isImportFileName(a),
    );
}

/** 패널 탭 이름으로 (주소는 사람이 읽기 쉬운 말, 패널은 안쪽 이름) */
export function panelTabOf(tab: UrlTab): 'today' | 'todo' | 'note' | 'event' {
  return tab === 'memo' ? 'note' : tab === 'calendar' ? 'event' : tab;
}

/** 주소를 연달아 받을 상한 (windowMs 안에 max 개). 웹 페이지가 주소를 마구 열어도 할 일이 쌓이지 않게 */
export const URL_BURST = { max: 8, windowMs: 10_000 } as const;

/** 최근 받은 시각들로 이번 것을 받을지. 받으면 새 목록, 아니면 undefined */
export function admitUrl(
  recent: readonly number[],
  now: number,
  burst: { max: number; windowMs: number } = URL_BURST,
): number[] | undefined {
  const kept = recent.filter((at) => now - at < burst.windowMs && at <= now);
  if (kept.length >= burst.max) return undefined;
  return [...kept, now];
}
