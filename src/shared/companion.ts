// 펫 경험 (동료이자 친구): 끝낸 일 축하, 만난 날 기념, 친구 펫끼리 수다, 기억 저장 모양.
// 모두 순수 함수다. 저장과 말풍선은 main/companion.ts 가 한다.
import { plusDays, weekdayOf } from './day.ts';
import type { I18nKey } from './i18n/index.ts';

// ---- 끝낸 일 축하 ----

export type CheerKind = 'clear' | 'streak' | 'count';
/** 오늘 끝낸 수가 이 수가 되면 축하한다 */
export const CHEER_COUNTS = [5, 10, 20] as const;

export interface CheerFacts {
  /** 오늘 끝낸 할 일 수 (방금 끝낸 것 포함) */
  doneToday: number;
  /** 오늘 끝낸 것 중 마감이 오늘이나 그 전이던 수 */
  doneDueToday: number;
  /** 마감이 오늘이나 그 전인데 아직 남은 수 */
  openDueToday: number;
  /** 연속 기록 (오늘 포함) */
  streak: number;
}

export interface Cheer {
  /** 그날 한 번만 하려고 적어 두는 이름 (count 는 수까지: count-5) */
  id: string;
  kind: CheerKind;
  key: Extract<I18nKey, `companion.cheer.${string}`>;
  n: number;
}

/**
 * 할 일을 끝낸 직후 펫이 따로 축하할 일. 없으면 undefined (평소처럼 통통 튀기만).
 * 오늘 마감인 일을 다 끝냄 > 오늘 첫 끝내기로 연속 2일 이상 > 오늘 5, 10, 20개째. 같은 축하는 그날 한 번만.
 */
export function completionCheer(f: CheerFacts, saidToday: ReadonlySet<string>): Cheer | undefined {
  const list: Cheer[] = [];
  if (f.openDueToday === 0 && f.doneDueToday > 0)
    list.push({ id: 'clear', kind: 'clear', key: 'companion.cheer.clear', n: f.doneDueToday });
  if (f.doneToday === 1 && f.streak >= 2)
    list.push({ id: 'streak', kind: 'streak', key: 'companion.cheer.streak', n: f.streak });
  if ((CHEER_COUNTS as readonly number[]).includes(f.doneToday))
    list.push({ id: `count-${f.doneToday}`, kind: 'count', key: 'companion.cheer.count', n: f.doneToday });
  return list.find((c) => !saidToday.has(c.id));
}

// ---- 만난 날 기념 ----

/** 기념하는 날 (처음 만난 날이 1일째). 1년부터는 해마다 */
export const ANNIV_DAYS = [7, 30, 50, 100, 200, 300] as const;
/** 그날 앱을 켜지 않았으면 이만큼 지나서까지는 늦게라도 축하한다 */
export const ANNIV_LATE_DAYS = 3;

export interface Anniversary {
  /** 저장용: 기념한 날 수 (1년은 365, 2년은 730) */
  mark: number;
  key: Extract<I18nKey, `companion.anniv.${string}`>;
  /** 말에 넣는 수 (날 수나 햇수) */
  n: number;
}

/** 처음 만난 날에서 y 년 뒤 같은 월일이 몇째 날인지. 2월 29일에 만났으면 평년은 2월 28일 */
export function yearMark(firstDay: string, y: number): number {
  const [fy, fm, fd] = firstDay.split('-').map(Number);
  const year = (fy ?? 1970) + y;
  const last = new Date(Date.UTC(year, fm ?? 1, 0)).getUTCDate();
  const d = Math.min(fd ?? 1, last);
  const iso = `${year}-${String(fm ?? 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return dayNumber(firstDay, iso);
}

/** 지금 처음 만난 날이 몇째 날인지 (처음 만난 날 = 1) */
export function dayNumber(firstDay: string, today: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((t(today) - t(firstDay)) / 86_400_000) + 1;
}

/**
 * 오늘 기념할 날. said 는 이미 기념한 mark 들. 기념일에서 ANNIV_LATE_DAYS 넘게 지났으면 건너뛴다
 * (처음 이 기능을 받은 오래 쓴 사용자에게 지난 기념일을 몰아서 말하지 않게)
 */
export function anniversaryDue(
  day: number,
  said: readonly number[],
  firstDay?: string,
): Anniversary | undefined {
  if (!Number.isFinite(day) || day < 1) return undefined;
  const marks: { mark: number; year?: number }[] = ANNIV_DAYS.map((mark) => ({ mark }));
  // 해마다는 달력으로: 처음 만난 날의 같은 월일 (첫날이 1일째라 1년은 366, 2월 29일을 지나면 367일째)
  const years = Math.floor(day / 365);
  for (const y of [years - 1, years])
    if (y >= 1) marks.push({ mark: firstDay ? yearMark(firstDay, y) : y * 365 + 1, year: y });
  for (const m of marks) {
    const late = day - m.mark;
    if (late < 0 || late > ANNIV_LATE_DAYS || said.includes(m.mark)) continue;
    if (m.year) return { mark: m.mark, key: 'companion.anniv.year', n: m.year };
    return { mark: m.mark, key: late === 0 ? 'companion.anniv.day' : 'companion.anniv.late', n: m.mark };
  }
  return undefined;
}

// ---- 친구 펫끼리 수다 ----

export const FRIEND_TALKS = 6;
export type FriendTalkKey = Extract<I18nKey, `companion.friend.${string}`>;

/** 만났을 때 주고받을 말 한 쌍. 바로 앞 쌍(last)은 다시 고르지 않는다 */
export function friendTalk(
  rand: () => number,
  last?: number,
): { index: number; a: FriendTalkKey; b: FriendTalkKey } {
  const pool = Array.from({ length: FRIEND_TALKS }, (_, i) => i + 1).filter((i) => i !== last);
  const index = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? 1;
  return {
    index,
    a: `companion.friend.${index}.a` as FriendTalkKey,
    b: `companion.friend.${index}.b` as FriendTalkKey,
  };
}

// ---- 기억 (pet-memory.json) ----

export interface PetMemory {
  /** 그날 한 축하 (day 가 오늘이 아니면 비운다) */
  cheers: { day: string; ids: string[] };
  /** 기념한 날 (mark) */
  anniv: number[];
  /** 최근 혼잣말 (다시 켜도 되풀이하지 않게) */
  recent: string[];
}

export const EMPTY_MEMORY: PetMemory = { cheers: { day: '', ids: [] }, anniv: [], recent: [] };

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 80).slice(-max) : [];

/** 저장 파일을 읽은 값. 모양이 틀린 칸은 빈 값으로 (깨진 파일이 앱을 막지 않게) */
export function parseMemory(raw: unknown): PetMemory {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MEMORY, cheers: { day: '', ids: [] } };
  const r = raw as Record<string, unknown>;
  const c = (r.cheers ?? {}) as Record<string, unknown>;
  const day = typeof c.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.day) ? c.day : '';
  const anniv = Array.isArray(r.anniv)
    ? r.anniv.filter((x): x is number => Number.isInteger(x) && x > 0 && x < 100_000).slice(-64)
    : [];
  return {
    cheers: { day, ids: day ? strings(c.ids, 16) : [] },
    anniv,
    recent: strings(r.recent, 24),
  };
}

/** 이번 주 월요일부터 오늘까지 날들 (월요일이 시작. 일요일이면 6일 전 월요일부터) */
export function weekDays(today: string): string[] {
  const back = (weekdayOf(today) + 6) % 7;
  return Array.from({ length: back + 1 }, (_, i) => plusDays(today, i - back));
}
