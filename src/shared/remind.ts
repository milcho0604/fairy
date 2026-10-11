// 미리 알림 (db 8판). 일정과 할 일에 알림을 여러 개 단다: "1주 전, 하루 전, 1시간 전, 정각".
// 알림 하나는 기준보다 몇 분 앞(before)인지로 적는다. 기준은 둘이다.
// - 시각 기준(시각 일정, 마감 시각이 있는 할 일): 시작 시각에서 before 분 앞.
//   하루 단위(1440 의 배수)면 "같은 시각의 며칠 전"으로 센다 (서머타임이 바뀌는 주에도 오후 3시 회의의 하루 전은 오후 3시).
// - 날짜 기준(종일 일정, 마감일만 있는 할 일): 그날 0시에서 before 분 앞. 240 은 전날 저녁 8시, -540 은 당일 아침 9시,
//   900 은 전날 아침 9시. 7판 종일 일정의 "전날 저녁 8시"(remind_min 240)와 같은 셈이라 그대로 옮긴다.
// 날짜 계산은 현지 달력으로 한다 (시간대를 바꾸면 그 시간대의 아침 9시에 알린다).
// 이 파일은 계산만 한다 (글은 remind-text.ts, 저장은 reminder-store.ts).
import { plusDays } from './day.ts';

const MIN = 60_000;
export const DAY_MIN = 24 * 60;

/** 한 일정, 한 할 일에 다는 알림 수 상한 */
export const MAX_REMINDS = 6;
/** 가장 이른 알림: 30일 전 */
export const REMIND_MAX_MIN = 30 * DAY_MIN;
/** 날짜 기준 알림의 아침, 저녁 시각 (하루 안의 분) */
export const MORNING_MIN = 9 * 60;
export const EVENING_MIN = 20 * 60;

/** 날짜 기준 알림: days 일 전 minute 시각 (0 이면 당일) */
export const dayBefore = (days: number, minute: number) => days * DAY_MIN - minute;
/** 전날 저녁 8시 (7판 ALL_DAY_EVE_MIN 과 같은 값) */
export const EVE = dayBefore(1, EVENING_MIN);
/** 당일 아침 9시 */
export const SAME_MORNING = dayBefore(0, MORNING_MIN);

/** 시각 기준 고르기: 1주, 3일, 1일, 3시간, 1시간, 30분, 10분, 5분 전, 정각 */
export const TIMED_CHOICES: readonly number[] = [7 * DAY_MIN, 3 * DAY_MIN, DAY_MIN, 180, 60, 30, 10, 5, 0];
/** 날짜 기준 고르기: 1주 전 아침, 3일 전 아침, 전날 아침, 전날 저녁, 당일 아침 */
export const DATE_CHOICES: readonly number[] = [
  dayBefore(7, MORNING_MIN),
  dayBefore(3, MORNING_MIN),
  dayBefore(1, MORNING_MIN),
  EVE,
  SAME_MORNING,
];

/**
 * 기본 알림.
 * - 시각 일정: 10분 전 (7판과 같다)
 * - 종일 일정: 없음 (아침 브리핑에 나온다. 7판과 같다)
 * - 마감일만 있는 할 일: 전날 저녁 8시. 당일은 아침 브리핑과 오후 마감 알림이 이미 말해 주니 하루 앞서 한 번
 * - 마감 시각이 있는 할 일: 하루 전 같은 시각과 1시간 전
 */
export const DEFAULT_REMINDS = {
  event: [10],
  allDay: [],
  todo: [EVE],
  todoTimed: [DAY_MIN, 60],
} as const satisfies Record<string, readonly number[]>;

/** 알림의 기준. time 은 ms 시각, day 는 현지 날짜 YYYY-MM-DD (그날 0시가 기준) */
export type Anchor = { kind: 'time'; at: number } | { kind: 'day'; day: string };

export const isDateAnchor = (a: Anchor): a is { kind: 'day'; day: string } => a.kind === 'day';

/** 현지 날짜와 하루 안의 분으로 ms 시각 */
export function atLocal(day: string, minute: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, Math.floor(minute / 60), minute % 60).getTime();
}

/** ms 시각의 현지 날짜 YYYY-MM-DD */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 날짜 기준 before 를 [며칠 전, 그날 몇 분]으로. 240 → [1, 1200], -540 → [0, 540] */
export function splitDayBefore(before: number): { days: number; minute: number } {
  const days = Math.max(0, Math.ceil(before / DAY_MIN));
  return { days, minute: days * DAY_MIN - before };
}

/** 알림이 울릴 ms 시각 */
export function fireAt(anchor: Anchor, before: number): number {
  if (anchor.kind === 'day') {
    const { days, minute } = splitDayBefore(before);
    return atLocal(plusDays(anchor.day, -days), minute);
  }
  if (before > 0 && before % DAY_MIN === 0) {
    const d = new Date(anchor.at);
    d.setDate(d.getDate() - before / DAY_MIN);
    return d.getTime();
  }
  return anchor.at - before * MIN;
}

/** 시각 일정이 시작한 뒤 이만큼까지는 "지금 시작" 알림을 한다 (7판 STALE_MS 와 같다) */
export const START_GRACE_MS = 5 * MIN;

/** 이 때가 지나면 알림을 말하지 않는다: 시각 기준은 시작 5분 뒤, 날짜 기준은 그날이 끝날 때 */
export function staleAt(anchor: Anchor): number {
  return anchor.kind === 'day' ? atLocal(plusDays(anchor.day, 1), 0) : anchor.at + START_GRACE_MS;
}

/** 기준 시각 (남은 시간 셈, 가장 이른 것 고르기): 날짜 기준은 그날 0시 */
export const anchorAt = (a: Anchor) => (a.kind === 'day' ? atLocal(a.day, 0) : a.at);

/** before 를 쓸 수 있는 값으로. 시각 기준은 0 이상, 날짜 기준은 당일 23:59 까지(음수) 된다 */
export function clampBefore(n: number, dateOnly: boolean): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  const v = Math.round(n);
  const min = dateOnly ? -(DAY_MIN - 1) : 0;
  if (v < min || v > REMIND_MAX_MIN) return undefined;
  return v;
}

/** 알림 목록 다듬기: 쓸 수 없는 값을 빼고, 겹치지 않게, 이른 것(큰 값)부터, MAX_REMINDS 개까지 */
export function normalizeReminds(list: readonly unknown[], dateOnly: boolean): number[] {
  const out = new Set<number>();
  for (const v of list) {
    const n = typeof v === 'number' ? clampBefore(v, dateOnly) : undefined;
    if (n !== undefined) out.add(n);
  }
  return [...out].sort((a, b) => b - a).slice(0, MAX_REMINDS);
}

/** 알림 하나의 상태. notifiedAt: null 은 아직, 0 은 말없이 넘김(넣을 때 이미 지남, 늦어서 쓸모없음), 그 밖은 말한 시각 */
export interface ReminderMark {
  before: number;
  notifiedAt: number | null;
}

/** 늦게 꺼낸 알림(컴퓨터가 꺼져 있었음 등)으로 칠 만큼 지났는지 */
export const LATE_MS = 2 * MIN;
/** 늦게 꺼낸 알림을 말할 때, 곧 울릴 다음 알림도 이만큼 안이면 같이 한 것으로 친다 (5분 사이 두 번 말하지 않게) */
export const ABSORB_MS = 15 * MIN;
/** 시작이 이만큼 안이면, 넣을 때 이미 지난 알림 중 가장 가까운 하나는 바로 말한다 (5분 뒤 회의를 넣으면 10분 전 알림) */
export const ARM_NOW_MS = 60 * MIN;

/**
 * 지금 할 일: 말할지(speak), 말한 것으로 적을 알림(mark), 말없이 넘길 알림(skip).
 * - 기준이 지났으면(시각 일정은 시작 5분 뒤, 날짜 기준은 그날 끝) 지난 알림은 넘긴다.
 * - 울릴 때가 지난 알림이 있으면 한 번 말하고 그것들을 다 적는다 (컴퓨터가 꺼져 있던 사이 여러 개가 지났어도 한 번).
 * - 늦게 말하는 것이면 곧(15분 안) 울릴 다음 알림도 같이 적는다.
 */
export function planReminders(
  anchor: Anchor,
  marks: readonly ReminderMark[],
  now: number,
): { speak: boolean; mark: number[]; skip: number[] } {
  const pending = marks
    .filter((m) => m.notifiedAt === null)
    .map((m) => ({ before: m.before, at: fireAt(anchor, m.before) }));
  const passed = pending.filter((p) => p.at <= now);
  if (passed.length === 0) return { speak: false, mark: [], skip: [] };
  if (now >= staleAt(anchor)) return { speak: false, mark: [], skip: passed.map((p) => p.before) };
  const latest = Math.max(...passed.map((p) => p.at));
  const late = now - latest > LATE_MS;
  const soon = late ? pending.filter((p) => p.at > now && p.at <= now + ABSORB_MS) : [];
  return { speak: true, mark: [...passed, ...soon].map((p) => p.before), skip: [] };
}

/** 아직 말하지 않은 알림 중 now 뒤로 가장 먼저 울릴 때. 없으면 undefined (플래너가 다음에 깰 때) */
export function nextFireAt(anchor: Anchor, marks: readonly ReminderMark[], now: number): number | undefined {
  let next: number | undefined;
  for (const m of marks) {
    if (m.notifiedAt !== null) continue;
    const at = fireAt(anchor, m.before);
    if (at > now && (next === undefined || at < next)) next = at;
  }
  return next;
}

/**
 * 알림을 새로 걸 때(넣기, 기준 바꾸기, 알림 더하기)의 상태. keep 에 있는 것은 그대로 둔다(이미 말한 알림).
 * 이미 지난 알림은 말없이 넘긴다: 오늘 마감 할 일을 넣자마자 "전날 저녁" 알림이 울리지 않게.
 * 다만 시각 기준이 1시간 안에 시작하면 지난 것 중 가장 가까운 하나는 남겨 바로 말한다 (7판과 같다).
 */
export function armReminders(
  anchor: Anchor | null,
  befores: readonly number[],
  now: number,
  keep: ReadonlyMap<number, number | null> = new Map(),
): ReminderMark[] {
  if (!anchor) return befores.map((before) => ({ before, notifiedAt: keep.get(before) ?? null }));
  const fresh = befores.filter((b) => !keep.has(b));
  const passedFresh = fresh
    .map((before) => ({ before, at: fireAt(anchor, before) }))
    .filter((p) => p.at <= now)
    .sort((a, b) => b.at - a.at);
  const start = anchorAt(anchor);
  const nowOne =
    anchor.kind === 'time' && start > now && start - now <= ARM_NOW_MS ? passedFresh[0]?.before : undefined;
  return befores.map((before) => {
    if (keep.has(before)) return { before, notifiedAt: keep.get(before) ?? null };
    const passed = passedFresh.some((p) => p.before === before);
    return { before, notifiedAt: passed && before !== nowOne ? 0 : null };
  });
}

// ---- 미루기 ----

/** 짧은 미루기 (7판 SNOOZE_MS 와 같다) */
export const SNOOZE_SHORT_MS = 5 * MIN;
export const SNOOZE_LONG_MS = 60 * MIN;
/** 시작까지 이보다 많이 남았으면 1시간 미루기 (사흘 전 알림을 5분 뒤에 또 하면 귀찮다) */
const LONG_SNOOZE_FROM_MS = 3 * 60 * MIN;

/** 미루기 길이. 미룬 뒤에도 말할 수 있을 때만(기준이 지나기 전). 없으면 미루기 단추를 달지 않는다 */
export function snoozeFor(now: number, start: number, stale: number): number | undefined {
  if (start - now > LONG_SNOOZE_FROM_MS && now + SNOOZE_LONG_MS < stale) return SNOOZE_LONG_MS;
  if (now + SNOOZE_SHORT_MS <= stale) return SNOOZE_SHORT_MS;
  return undefined;
}

/** 미룬 알림 하나: at 에 keys 의 일정과 할 일을 다시 말한다 */
export interface Snoozed {
  at: number;
  keys: { kind: 'event' | 'todo'; id: number }[];
  /** 사용자가 고른 때(10분, 1시간, 내일, snooze.ts). 때가 지난 할 일도 그때 다시 말한다 */
  keep?: boolean;
}

/** 앱이 꺼져 있던 사이 때가 된 미룬 알림은 이만큼 지난 것까지 켜자마자 말한다. 더 지난 것은 버린다 */
export const SNOOZE_KEEP_MS = 10 * MIN;
const SNOOZED_MAX = 50;
const SNOOZED_KEYS_MAX = 20;

/**
 * 저장해 둔 미룬 알림 읽기 (앱을 다시 켜도 미룬 것이 사라지지 않게. 전에는 메모리에만 있었다).
 * 모양이 틀린 것과 한참 지난 것은 버린다. 그사이 지웠거나 끝낸 것은 말할 때 다시 읽어 뺀다
 */
export function parseSnoozed(raw: unknown, now: number): Snoozed[] {
  if (!Array.isArray(raw)) return [];
  const out: Snoozed[] = [];
  for (const v of raw.slice(-SNOOZED_MAX)) {
    const s = v as Partial<Snoozed> | null;
    if (!s || typeof s.at !== 'number' || !Number.isFinite(s.at) || s.at < now - SNOOZE_KEEP_MS) continue;
    if (!Array.isArray(s.keys)) continue;
    const keys = s.keys
      .filter(
        (k): k is Snoozed['keys'][number] =>
          !!k && (k.kind === 'event' || k.kind === 'todo') && Number.isInteger(k.id) && k.id > 0,
      )
      .slice(0, SNOOZED_KEYS_MAX)
      .map((k) => ({ kind: k.kind, id: k.id }));
    if (keys.length > 0) out.push({ at: s.at, keys, ...(s.keep === true ? { keep: true } : {}) });
  }
  return out;
}

// ---- 빠른 입력: "하루 전 알림", "1시간 전에 알려줘", "3일 전", "remind me 1 hour before" ----

/** 읽은 알림 한 마디. 분이면 시각 기준 셈, eve 는 전날 저녁 8시, morning 은 당일 아침 9시 */
export type RemindSpec = number | 'eve' | 'morning';

const KO_NUM: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7 };
const KO_DAYS: Record<string, number> = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 일주일: 7, 한주: 7 };
const EN_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

// 한국어 한 마디: "1시간", "30분", "3일", "2주", "1시간 반", "하루", "이틀", "일주일"
// 같은 글을 두 갈래로 읽게 두지 않는다 ("한 주"는 앞 갈래 하나로만). 갈래가 겹치면 "한 주 하고"를 여러 번 이은
// 글에서 되짚기가 기하급수로 늘어 메인이 멈춘다
const KO_ONE =
  '(?:(\\d{1,3}|한|두|세|네|다섯|여섯|일곱) ?(분|시간|일|주일?)( ?반)?|(하루|이틀|사흘|나흘|일주일))';
/** 묶음 식에서는 한 마디 식의 잡는 괄호를 안 잡는 괄호로 (바깥 식의 잡는 자리 번호가 밀리지 않게) */
const quiet = (re: string) => re.replace(/\((?!\?)/g, '(?:');
const KO_ITEM = `(?:${quiet(KO_ONE)} ?전|정각|시작할 ?때|당일 ?아침|전날 ?(?:저녁|밤))`;
const KO_JOIN = '(?: ?, ?그리고 ?| ?, ?| ?이랑 ?| ?랑 ?| ?하고 ?| ?그리고 ?| ?및 ?| ?과 ?| ?와 ?)';
const KO_ASK =
  '(?:에|에도)? ?(?:알림|알려 ?줘|알려 ?주세요|알려 ?줄래\\??|알려 ?줘요|미리 ?알림|미리 ?알려 ?줘)';
// 맨 끝: 알림 낱말이 없어도 "~ 전" 이면 읽는다 ("회의 내일 3시 3일 전"). 맨 앞: 알림 낱말이 있어야 읽는다
// 여러 개: "하루 전, 1시간 전", "하루랑 1시간 전" (앞 것은 "전"을 빼도 된다. 끝은 "전"이나 정각 같은 말)
const KO_LIST = `(?:(?:${KO_ITEM}|${quiet(KO_ONE)})${KO_JOIN})*${KO_ITEM}`;
const KO_TAIL = new RegExp(`(?:^|\\s)(${KO_LIST})(${KO_ASK})?[.!]?$`);
const KO_HEAD = new RegExp(`^(${KO_LIST})(${KO_ASK})[.,]?\\s`);
const KO_NONE = /(?:^|\s)(?:알림 ?(?:없이|없음|끄기|꺼 ?줘)|알리지 ?(?:마|말아 ?줘))[.!]?$/;

// 한국어와 같은 까닭으로 겹치는 갈래를 뺐다: hours 는 h(?:ou)?rs? 가, "a day"는 앞 갈래(a + day)가 읽는다
const EN_UNIT = '(min(?:ute)?s?|m|h(?:ou)?rs?|h|days?|d|weeks?|w)';
const EN_ONE = `(?:(\\d{1,3}|an?|one|two|three|four|five|six|seven) ?${EN_UNIT}|(the day|the week))`;
const EN_ITEM = `(?:${quiet(EN_ONE)} (?:before|ahead|early|prior)|at (?:the )?start|on time|when it starts|the (?:night|evening) before|(?:that|the same) morning|morning of)`;
const EN_JOIN = '(?:, ?| and |, and | & | or )';
const EN_ASK = '(?:remind me |reminders? |alert me |notify me |ping me )';
// 여러 개: "1 day and 1 hour before" (앞 것은 before 를 빼도 된다)
const EN_LIST = `(?:(?:${EN_ITEM}|${quiet(EN_ONE)})${EN_JOIN})*${EN_ITEM}`;
const EN_TAIL = new RegExp(`(?:^|\\s)(?:,\\s?)?(${EN_ASK}|with (?:a )?reminders? )?(${EN_LIST})[.!]?$`, 'i');
const EN_HEAD = new RegExp(`^(${EN_ASK})(${EN_LIST})[,:]?\\s`, 'i');
const EN_NONE = /(?:^|\s)(?:,\s?)?(?:no reminders?|without (?:a )?reminders?|don'?t remind me)[.!]?$/i;

/** 알림 말을 찾아볼 한 줄의 최대 길이 */
const REMIND_TEXT_MAX = 200;

function koOne(s: string): RemindSpec | undefined {
  const t = s.replace(/\s+/g, '');
  if (/^(정각|시작할때)$/.test(t)) return 0;
  if (/^당일아침$/.test(t)) return 'morning';
  if (/^전날(저녁|밤)$/.test(t)) return 'eve';
  const m = new RegExp(`^${KO_ONE}(?:전)?$`).exec(s.trim().replace(/\s+전$/, '전'));
  if (!m) return undefined;
  if (m[4]) return (KO_DAYS[m[4].replace(/\s/g, '')] ?? 0) * DAY_MIN || undefined;
  const n = /^\d+$/.test(m[1] ?? '') ? Number(m[1]) : (KO_NUM[m[1] ?? ''] ?? 0);
  const half = m[3] ? 0.5 : 0;
  const unit = m[2] ?? '';
  const per = unit === '분' ? 1 : unit === '시간' ? 60 : unit === '일' ? DAY_MIN : 7 * DAY_MIN;
  return Math.round((n + half) * per);
}

function enOne(s: string): RemindSpec | undefined {
  const t = s.trim().toLowerCase();
  if (/^(at (the )?start|on time|when it starts)$/.test(t)) return 0;
  if (/^the (night|evening) before$/.test(t)) return 'eve';
  if (/^((that|the same) morning|morning of)$/.test(t)) return 'morning';
  const m = new RegExp(`^${EN_ONE}(?: (?:before|ahead|early|prior))?$`, 'i').exec(t);
  if (!m) return undefined;
  if (m[3]) return m[3].endsWith('week') ? 7 * DAY_MIN : DAY_MIN;
  const n = /^\d+$/.test(m[1] ?? '') ? Number(m[1]) : (EN_NUM[m[1] ?? ''] ?? 0);
  const u = (m[2] ?? '').toLowerCase();
  const per = u.startsWith('m') ? 1 : u.startsWith('h') ? 60 : u.startsWith('d') ? DAY_MIN : 7 * DAY_MIN;
  return n * per;
}

function splitItems(list: string, join: RegExp, one: (s: string) => RemindSpec | undefined) {
  const parts = list.split(join).filter((p) => p.trim());
  const specs = parts.map(one);
  return specs.every((s) => s !== undefined) ? (specs as RemindSpec[]) : undefined;
}

/**
 * 한 줄에서 알림 말을 떼어 낸다. 없으면 null. none 은 "알림 없이" (알림을 하나도 달지 않는다).
 * 맨 끝(알림 낱말이 없어도 "~ 전"이면)이나 맨 앞(알림 낱말이 있어야)만 읽는다: "3일 전 회의록 정리"의 앞은 제목이다.
 * 제목이 다 사라지면 읽지 않는다 ("1시간 전" 하나만 적은 줄).
 */
export function takeRemind(text: string): { specs: RemindSpec[]; none: boolean; rest: string } | null {
  const s = text.trim();
  // 긴 글은 읽지 않는다: 알림 말 식은 반복 묶음이라 글이 길면 느려진다. 빠른 입력 한 줄은 이보다 짧다
  if (s.length > REMIND_TEXT_MAX) return null;
  const none = KO_NONE.exec(s) ?? EN_NONE.exec(s);
  if (none) {
    const rest = s
      .slice(0, none.index)
      .replace(/[,\s]+$/, '')
      .trim();
    return rest ? { specs: [], none: true, rest } : null;
  }
  // [식, 알림 말 묶음 자리, 알림 낱말 자리, 나누기, 한 마디 읽기]
  const tries: [RegExp, number, number, RegExp, (x: string) => RemindSpec | undefined][] = [
    [KO_TAIL, 1, 2, new RegExp(KO_JOIN, 'g'), koOne],
    [KO_HEAD, 1, 2, new RegExp(KO_JOIN, 'g'), koOne],
    [EN_TAIL, 2, 1, new RegExp(EN_JOIN, 'gi'), enOne],
    [EN_HEAD, 2, 1, new RegExp(EN_JOIN, 'gi'), enOne],
  ];
  for (const [re, at, askAt, join, one] of tries) {
    const m = re.exec(s);
    if (!m) continue;
    const specs = splitItems(m[at] ?? '', join, one);
    if (!specs?.length) continue;
    // 알림 낱말 없이 맨 끝에 온 "정각", "전날 저녁", "on time" 은 제목일 수 있다 ("be on time"). "~ 전" 만 읽는다
    if (!m[askAt] && specs.some((x) => typeof x !== 'number' || x === 0)) continue;
    const rest = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/[,\s]+$/, '').trim();
    if (!rest) return null;
    return { specs, none: false, rest };
  }
  return null;
}

/**
 * 읽은 알림 말을 기준에 맞는 before 로. 시각 기준이면 minute 은 시작 시각(하루 안의 분)이다.
 * 날짜 기준에서 "N일 전"은 그날 아침 9시, "정각"은 당일 아침 9시. 시간, 분 단위는 날짜 기준에 뜻이 없어 버린다.
 */
export function resolveSpecs(specs: readonly RemindSpec[], dateOnly: boolean, minute = 0): number[] {
  const out: number[] = [];
  for (const s of specs) {
    if (dateOnly) {
      if (s === 'eve') out.push(EVE);
      else if (s === 'morning' || s === 0) out.push(SAME_MORNING);
      else if (s % DAY_MIN === 0) out.push(dayBefore(s / DAY_MIN, MORNING_MIN));
    } else if (s === 'eve') out.push(minute + (DAY_MIN - EVENING_MIN));
    else if (s === 'morning') {
      // 아침 9시 정각에 시작하면 당일 아침 알림은 시작할 때다 (날짜 기준에서 'morning'과 0이 같은 것처럼)
      if (minute >= MORNING_MIN) out.push(minute - MORNING_MIN);
    } else out.push(s);
  }
  return normalizeReminds(out, dateOnly);
}
