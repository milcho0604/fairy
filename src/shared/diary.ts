// 짝꿍 일기. 그날 기록(daily_stat 의 켜 둔 분, 집중 분, 산책 분, 같이 보기, 끝낸 할 일 수, 밥 먹은 횟수)으로
// 펫이 쓰는 한두 줄 일기. 정해 둔 문장에서 고르고, 같은 날은 늘 같은 글이 나온다(날짜로 고른다).
// AI 로 다듬기(설정, 기본 끔)를 켜도 이 글만 보낸다. 할 일 제목은 여기에 들어오지 않는다.
import { t } from './i18n/index.ts';

export interface DiaryFacts {
  /** 현지 날짜 YYYY-MM-DD */
  day: string;
  /** 켜 두고 화면이 잠기지 않은 분 */
  onMin: number;
  done: number;
  focusMin: number;
  walkMin: number;
  lookCount: number;
  fed: number;
}

/** 패널에 보이는 날 수 */
export const DIARY_DAYS = 7;

/** 날짜로 정하는 0~1 (같은 날은 늘 같은 문장) */
export function daySeed(day: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (const ch of day) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length] as T;

/** 맺음말 (지금 말로 읽는다) */
const endings = () => [t('diary.end.1'), t('diary.end.2'), t('diary.end.3'), t('diary.end.4')];

/** 쓸 만한 기록이 있는 날인지 (켜 두었거나 무언가 했다) */
export function hasDiary(f: DiaryFacts): boolean {
  return f.onMin > 0 || f.done > 0 || f.focusMin > 0 || f.walkMin > 0 || f.fed > 0 || f.lookCount > 0;
}

/** 그날 일기. 문장은 많아야 셋 (할 일, 눈에 띄는 일 하나, 맺음말). 오늘은 아직 쓰는 중이라 맺음말이 없다 */
export function diaryText(f: DiaryFacts, today = false): string {
  const parts: string[] = [];
  if (f.done >= 5) parts.push(t('diary.done.many', { n: f.done }));
  else if (f.done >= 1) parts.push(t('diary.done.some', { n: f.done }));
  else parts.push(t('diary.done.none'));
  // 눈에 띄는 일 하나: 집중, 산책, 밥, 같이 보기 순
  if (f.focusMin >= 15) parts.push(t('diary.focus', { n: f.focusMin }));
  else if (f.walkMin > 0) parts.push(t('diary.walk', { n: f.walkMin }));
  else if (f.fed > 0) parts.push(t('diary.fed', { n: f.fed }));
  else if (f.lookCount > 0) parts.push(t('diary.look', { n: f.lookCount }));
  if (!today) parts.push(pick(endings(), daySeed(f.day)));
  return parts.join(' ');
}

/** 글자 두 개씩 묶음 (띄어쓰기와 문장 부호는 뺀다) */
function bigrams(s: string): Set<string> {
  const letters = [...s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')];
  return new Set(letters.slice(1).map((ch, i) => `${letters[i]}${ch}`));
}

/** 다듬은 글이 원래 글과 이만큼은 겹쳐야 한다 (작은 모델이 없는 이야기를 지어내면 거의 안 겹친다) */
export const POLISH_MIN_OVERLAP = 0.3;
/** 다듬은 글에서 원래 글에 없던 글자 묶음이 이보다 많으면 지어낸 것으로 본다 */
export const POLISH_MAX_NEW = 0.6;

/**
 * AI 가 다듬은 글이 쓸 만한지: 원래 글의 숫자를 단위째 지키고("4개"가 "4일"이 되면 버림),
 * 원래 글과 충분히 겹치고, 너무 길지 않고, 한 덩어리
 */
export function acceptPolished(source: string, polished: string): string | undefined {
  const text = polished
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (!text || text.length > 240) return undefined;
  // 숫자와 바로 뒤 단위 첫 글자 ("4개" → 4개, "50 minutes" → 50m)
  const nums = (s: string): string[] =>
    [...s.matchAll(/(\d+)\s*([^\s\d.,!?]?)/gu)].map((m) => `${m[1]}${(m[2] ?? '').toLowerCase()}`);
  // 숫자가 없는 날(느긋한 날)은 붙잡을 사실이 없어 작은 모델이 이야기를 지어낸다. 다듬지 않는다
  if (nums(source).length === 0) return undefined;
  const have = nums(text);
  if (!nums(source).every((n) => have.includes(n))) return undefined;
  const src = bigrams(source);
  const out = bigrams(text);
  const shared = [...src].filter((b) => out.has(b)).length;
  if (src.size > 0 && shared / src.size < POLISH_MIN_OVERLAP) return undefined;
  if (out.size > 0 && (out.size - shared) / out.size > POLISH_MAX_NEW) return undefined;
  // 묻는 글의 말("데스크톱 펫")이 답에 새어 나오면 버린다
  if (/데스크톱\s*펫|desktop pet/i.test(text)) return undefined;
  return text;
}
