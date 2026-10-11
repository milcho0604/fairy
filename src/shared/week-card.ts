// 주간 회고 카드 (2026-10-11). 오늘 탭 "이번 주"에서 펫과 이번 주 숫자(끝낸 일, 집중 시간, 연속 기록, 한 줄 일기)를
// 귀여운 카드 한 장으로 그려 PNG 로 저장한다. 할 일 제목은 사용자가 "할 일 제목 넣기"를 고를 때만 넣는다.
// 여기는 카드에 들어갈 값만 고른다 (순수 함수). 그리기는 renderer panel/WeekCard.tsx, 저장은 main/week-card.ts.
import { plusDays } from './day.ts';
import { weekStart } from './week.ts';

/** 카드 크기 (4:5, 사진 앱과 메신저에 그대로 올리기 좋은 비율) */
export const CARD_W = 1080;
export const CARD_H = 1350;
/** 넣는 할 일 제목 수와 한 제목 글자 수 */
export const CARD_TITLES = 5;
export const CARD_TITLE_LEN = 26;
/** 한 줄 일기 글자 수 */
export const CARD_DIARY_LEN = 70;
/** 저장할 수 있는 그림 크기 (data URL 글자 수). 카드 한 장은 1MB 안팎 */
export const CARD_MAX_URL = 12 * 1024 * 1024;

/** 글자 수(사람이 보는 글자)로 자르고 넘치면 말줄임 */
export function clip(text: string, max: number): string {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const g = Array.from(seg.segment(text.replace(/\s+/g, ' ').trim()), (s) => s.segment);
  return g.length <= max
    ? g.join('')
    : `${g
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** 이번 주 월요일과 일요일 */
export function cardRange(today: string): { from: string; to: string } {
  const from = weekStart(today);
  return { from, to: plusDays(from, 6) };
}

/** 집중 분을 시간과 분으로 */
export function hoursMinutes(min: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(min));
  return { h: Math.floor(total / 60), m: total % 60 };
}

/** 넣을 할 일 제목: 고른 때만, 빈 것과 같은 것은 빼고 다섯 개까지 */
export function cardTitles(titles: readonly string[], include: boolean): string[] {
  if (!include) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const t = clip(raw, CARD_TITLE_LEN);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= CARD_TITLES) break;
  }
  return out;
}

/** 한 줄 일기: 첫 문장 하나만 (없으면 빈 글) */
export function cardDiary(text: string | undefined): string {
  if (!text) return '';
  const one = text.replace(/\s+/g, ' ').trim();
  const first = /^(.+?[.!?。])(\s|$)/.exec(one)?.[1] ?? one;
  return clip(first, CARD_DIARY_LEN);
}

/** 저장할 파일 이름 (주 첫날로). 말에 맞는 앞말은 부르는 쪽이 준다 */
export function cardFileName(prefix: string, today: string): string {
  const safe = prefix.replace(/[\\/:*?"<>|]/g, '').trim() || 'jjakkung';
  return `${safe}-${cardRange(today).from}.png`;
}

/** 받은 그림이 PNG data URL 인지 (저장 전에 메인이 본다) */
export function isPngDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length < CARD_MAX_URL && v.startsWith('data:image/png;base64,');
}
