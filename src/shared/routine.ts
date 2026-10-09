// 만나는 시간 (사용자 요청 2026-10-08 "밀크와 만나는 날"): 사람마다 일을 시작하고 끝내는 시간이 달라 요일마다 정해 둔다.
// 정한 시간에 펫이 반갑게 맞이하고(오늘 브리핑을 그때 같이), 헤어지는 시간엔 수고했다고 인사한다(하루 회고를 같이).
// 만나지 않는 요일은 쉬는 날: 처음 왔을 때 조용히 한마디만. 꺼 두면 예전처럼 컴퓨터를 켤 때 브리핑만 한다.
//
// 시각은 모두 사용자 컴퓨터의 현지 날짜(YYYY-MM-DD)와 하루 안의 분(0~1439)으로 받는다. ms 를 받지 않아
// 시험이 시간대와 무관하고, 시간대를 옮기거나 서머타임이 바뀌어도 벽시계 그대로 따른다.
// 헤어지는 시간이 만나는 시간보다 이르면 다음 날 헤어진다(밤 근무). 그 일과는 시작한 날짜의 것이다.
import { plusDays, weekdayOf } from './day.ts';

/** 하루의 만나는 시간과 헤어지는 시간 (분). end 가 start 보다 이르면 다음 날 end */
export interface MeetTime {
  start: number;
  end: number;
}

export interface Routine {
  /** 만나는 시간을 쓰는지. 끄면 예전처럼 켤 때 브리핑 */
  on: boolean;
  /** 요일(0 일 ~ 6 토)마다 만나는 시간. null 이면 쉬는 날 */
  week: (MeetTime | null)[];
}

export const DEFAULT_MEET: MeetTime = { start: 9 * 60, end: 18 * 60 };
/** 기본은 꺼짐(예전 동작 그대로). 켜면 평일 9시에 만나 18시에 헤어진다 */
export const DEFAULT_ROUTINE: Routine = {
  on: false,
  week: [null, DEFAULT_MEET, DEFAULT_MEET, DEFAULT_MEET, DEFAULT_MEET, DEFAULT_MEET, null],
};

/** 만나는 시간 이만큼 전부터 맞이한다 (그보다 일찍 자리에 있으면 이때 "일찍 왔네") */
export const MEET_OPEN_BEFORE = 4 * 60;
/** 만나는 시간 앞뒤 이만큼 안이면 "딱 맞춰 왔네" */
export const ON_TIME_MIN = 10;
/** 헤어지는 인사는 헤어지는 시간 뒤 이만큼 안에 처음 자리에 있을 때 (그날 자정 전이면 자정까지) */
export const FAREWELL_GRACE = 4 * 60;
/** 일찍 와서 이미 맞이했으면 만나는 시간에 "시작할 시간이야" 한마디 (수다쟁이만). 그 뒤 이만큼 안에서만 */
export const CUE_WINDOW = 30;
/** 쉬는 날 한마디는 이 시각부터 (새벽에 켠 컴퓨터는 어젯밤으로 본다. 브리핑과 같다) */
export const REST_FROM = 5 * 60;
/** 기운(하루 리듬, shared/energy.ts)은 9시 출근을 기준으로 짠 표다. 만나는 시간을 이 시각으로 옮겨 읽는다 */
export const BODY_ANCHOR = 9 * 60;

/** 만난 날 코인: 하루 한 번만. 연속 기록이 STREAK_EVERY 의 배수인 날은 STREAK_BONUS 를 더한다 */
export const MEET_COINS = 3;
export const STREAK_EVERY = 5;
export const STREAK_BONUS = 5;

const DAY_MIN = 1440;
const isMinute = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < DAY_MIN;

/** 저장 파일이나 화면에서 온 값. 틀린 요일은 base 의 그 요일, 시작과 끝이 같으면 쓸 수 없어 base 로 */
export function parseRoutine(raw: unknown, base: Routine = DEFAULT_ROUTINE): Routine {
  if (typeof raw !== 'object' || raw === null) return { on: base.on, week: [...base.week] };
  const r = raw as Record<string, unknown>;
  const week = Array.isArray(r.week) ? r.week : [];
  return {
    on: typeof r.on === 'boolean' ? r.on : base.on,
    week: Array.from({ length: 7 }, (_, i) => {
      const v = week[i];
      if (v === null) return null;
      if (typeof v === 'object' && v !== undefined) {
        const m = v as Record<string, unknown>;
        if (isMinute(m.start) && isMinute(m.end) && m.start !== m.end) return { start: m.start, end: m.end };
      }
      return base.week[i] ?? null;
    }),
  };
}

/** 그날 만나는 시간. 꺼져 있거나 쉬는 날이면 null */
export function meetOn(r: Routine, day: string): MeetTime | null {
  if (!r.on) return null;
  return r.week[weekdayOf(day)] ?? null;
}

/** 쉬는 날인지 (켜 두었고 그 요일에 만나지 않는다) */
export const isRestDay = (r: Routine, day: string): boolean => r.on && meetOn(r, day) === null;

/** 헤어지는 때를 시작한 날 시계로 (밤 근무면 1440 을 넘는다) */
export const spanEnd = (m: MeetTime): number => (m.end > m.start ? m.end : m.end + DAY_MIN);
/** 일과 길이 (분) */
export const meetLength = (m: MeetTime): number => spanEnd(m) - m.start;
/** 다음 날에 헤어지는지 */
export const overnight = (m: MeetTime): boolean => m.end < m.start;

const openAt = (m: MeetTime) => Math.max(0, m.start - MEET_OPEN_BEFORE);
/** 헤어지는 인사를 이때까지 한다 (시작한 날 시계) */
export const farewellUntil = (m: MeetTime) => Math.max(spanEnd(m) + FAREWELL_GRACE, DAY_MIN);

export type Arrival = 'early' | 'onTime' | 'late';

/** 처음 자리에 온 때(일과 날 시계의 분)가 만나는 시간보다 이른지 */
export function arrivalOf(m: MeetTime, clock: number): Arrival {
  if (clock < m.start - ON_TIME_MIN) return 'early';
  if (clock <= m.start + ON_TIME_MIN) return 'onTime';
  return 'late';
}

/** 하루 한 번 규칙에 쓰는 기록 (메인 planner 저장 파일). 날짜는 일과가 시작한 날 */
export interface RoutineMemo {
  greeted: string;
  farewelled: string;
  restSaid: string;
  cued: string;
  /** 그 일과 날 처음 자리에 있던 때 (일과 날 시계의 분). 인사를 미뤄도(집중) "일찍 왔네"가 맞게 */
  arrival?: { day: string; clock: number };
  /** 이어서 만난 날 수와 마지막으로 만난 날 */
  streak?: { day: string; n: number };
}

export const EMPTY_MEMO: RoutineMemo = { greeted: '', farewelled: '', restSaid: '', cued: '' };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v: unknown): string => (typeof v === 'string' && DAY_RE.test(v) ? v : '');

export function parseMemo(raw: unknown): RoutineMemo {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_MEMO };
  const r = raw as Record<string, unknown>;
  const memo: RoutineMemo = {
    greeted: dayOf(r.greeted),
    farewelled: dayOf(r.farewelled),
    restSaid: dayOf(r.restSaid),
    cued: dayOf(r.cued),
  };
  const a = r.arrival as Record<string, unknown> | undefined;
  if (
    a &&
    dayOf(a.day) &&
    Number.isInteger(a.clock) &&
    (a.clock as number) >= 0 &&
    (a.clock as number) < 2 * DAY_MIN
  )
    memo.arrival = { day: a.day as string, clock: a.clock as number };
  const s = r.streak as Record<string, unknown> | undefined;
  if (s && dayOf(s.day) && Number.isInteger(s.n) && (s.n as number) > 0)
    memo.streak = { day: s.day as string, n: Math.min(s.n as number, 100_000) };
  return memo;
}

export type RoutineDue =
  /** 맞이하기 (오늘 브리핑을 같이). clock 은 일과 날 시계의 지금 분 */
  | { what: 'greet'; day: string; meet: MeetTime; clock: number; arrival: Arrival }
  /** 일찍 와서 맞이한 날, 만나는 시간이 되었다 */
  | { what: 'cue'; day: string; meet: MeetTime }
  /** 헤어지는 인사 (하루 회고를 같이) */
  | { what: 'farewell'; day: string; meet: MeetTime }
  /** 쉬는 날 한마디 (브리핑 대신) */
  | { what: 'rest'; day: string };

/**
 * 지금 할 일. day, minute 은 현지 날짜와 분. 하루 한 번 규칙은 memo 로 본다 (앱을 여러 번 켜도 한 번).
 * 어제 시작한 밤 근무가 아직이면 그 일과가 먼저다. 만난 날만 헤어진다(인사 없이 끝난 날은 헤어지는 인사도 없다)
 */
export function routineDue(
  r: Routine,
  memo: RoutineMemo,
  day: string,
  minute: number,
): RoutineDue | undefined {
  if (!r.on) return undefined;
  const yesterday = plusDays(day, -1);
  const y = meetOn(r, yesterday);
  /** 어제 일과가 아직 끝나지 않았다 (헤어지는 인사를 기다리는 때까지) */
  const yBusy = !!y && minute + DAY_MIN < farewellUntil(y);
  for (const [d, clock, meet] of [
    [yesterday, minute + DAY_MIN, y],
    [day, minute, meetOn(r, day)],
  ] as const) {
    if (!meet) continue;
    const end = spanEnd(meet);
    if (memo.greeted === d) {
      if (memo.farewelled !== d && clock >= end && clock < farewellUntil(meet))
        return { what: 'farewell', day: d, meet };
      const early = memo.arrival?.day === d && arrivalOf(meet, memo.arrival.clock) === 'early';
      if (memo.cued !== d && early && clock >= meet.start && clock < Math.min(meet.start + CUE_WINDOW, end))
        return { what: 'cue', day: d, meet };
      continue;
    }
    if (d === day && yBusy) continue;
    if (clock >= openAt(meet) && clock < end) {
      const first = memo.arrival?.day === d ? Math.min(memo.arrival.clock, clock) : clock;
      return { what: 'greet', day: d, meet, clock, arrival: arrivalOf(meet, first) };
    }
  }
  if (meetOn(r, day) === null && memo.restSaid !== day && minute >= REST_FROM && !yBusy)
    return { what: 'rest', day };
  return undefined;
}

/**
 * 오늘 브리핑을 만나는 시간이 맡는지 (그러면 예전 "켤 때 브리핑"은 하지 않는다).
 * 쉬는 날(한마디가 대신), 만나는 날 헤어지기 전, 만난 날, 어제 밤 근무 중. 만나는 날인데 헤어진 뒤에 처음 왔으면 예전 브리핑
 */
export function coversBriefing(r: Routine, memo: RoutineMemo, day: string, minute: number): boolean {
  if (!r.on) return false;
  const y = meetOn(r, plusDays(day, -1));
  if (y && minute + DAY_MIN < spanEnd(y)) return true;
  const m = meetOn(r, day);
  if (!m) return true;
  return memo.greeted === day || minute < spanEnd(m);
}

/** 오늘 하루 회고를 헤어지는 인사가 맡는지 (만나는 날 만났으면) */
export function coversReview(r: Routine, memo: RoutineMemo, day: string): boolean {
  return meetOn(r, day) !== null && memo.greeted === day;
}

/** 오늘 마감 알림이 끝나는 때 (회고 시각 대신 헤어지는 시간. 밤 근무는 회고 시각 그대로) */
export function dueUntil(r: Routine, day: string, reviewMinute: number): number {
  const m = meetOn(r, day);
  return m && !overnight(m) ? m.end : reviewMinute;
}

/** day 앞에서 가장 가까운 만나는 날 (7일 안). 없으면 undefined */
function prevMeetDay(r: Routine, day: string): string | undefined {
  for (let i = 1; i <= 7; i++) {
    const d = plusDays(day, -i);
    if (meetOn(r, d)) return d;
  }
  return undefined;
}

/** day 뒤로 가장 가까운 만나는 날 (7일 안) */
export function nextMeet(
  r: Routine,
  day: string,
): { day: string; inDays: number; meet: MeetTime } | undefined {
  for (let i = 1; i <= 7; i++) {
    const d = plusDays(day, i);
    const meet = meetOn(r, d);
    if (meet) return { day: d, inDays: i, meet };
  }
  return undefined;
}

/**
 * 오늘 만났을 때 연속 기록. 쉬는 날은 건너뛰어도 이어지고, 만나는 날을 하루라도 놓치면 1 부터.
 * fresh 는 오늘 처음 센 것 (같은 날이거나 시계를 되돌려 앞 날짜가 되면 false: 코인을 다시 주지 않는다)
 */
export function nextStreak(
  r: Routine,
  prev: RoutineMemo['streak'],
  day: string,
): { day: string; n: number; fresh: boolean } {
  if (prev && prev.day >= day) return { ...prev, fresh: false };
  const before = prevMeetDay(r, day);
  const n = prev && before !== undefined && prev.day >= before ? prev.n + 1 : 1;
  return { day, n, fresh: true };
}

/**
 * 만난 날 코인. 하루 한 번: 오늘 처음 센 연속 기록이고, 오늘 'meet' 코인 기록이 없을 때만
 * (설정을 껐다 켜거나, 요일을 바꾸거나, 시계를 돌려도 하루 상한을 넘지 않는다). 연속 5, 10, 15일에는 보너스
 */
export function meetCoins(streak: { n: number; fresh: boolean }, givenToday: number): number {
  if (!streak.fresh || givenToday > 0) return 0;
  return MEET_COINS + (streak.n % STREAK_EVERY === 0 ? STREAK_BONUS : 0);
}

// ---- 기운(하루 리듬)이 쓰는 것 ----

/** 그날 일과의 시작과 끝 (분, 시작한 날 시계. 밤 근무면 end 가 1440 을 넘는다). 꺼져 있거나 쉬는 날이면 undefined */
export function dayBounds(r: Routine, day: string): { start: number; end: number } | undefined {
  const m = meetOn(r, day);
  return m ? { start: m.start, end: spanEnd(m) } : undefined;
}

/**
 * 몸 시계: 만나는 시간이 9시(BODY_ANCHOR)가 되게 옮긴 지금 분 (0~1439). 하루 리듬 표를 이 값으로 읽으면
 * 13시에 시작하는 사람은 13시에 잠이 깨고, 밤 근무는 밤에 활발하다. 어젯밤 시작한 일과가 아직이면 그 일과로,
 * 쉬는 날은 가장 가까운 지난 만나는 날 시간으로 (주말에 갑자기 리듬이 튀지 않게). 꺼져 있으면 그대로
 */
export function bodyClock(r: Routine, day: string, minute: number): number {
  if (!r.on) return minute;
  const y = meetOn(r, plusDays(day, -1));
  const m = y && overnight(y) && minute + DAY_MIN < spanEnd(y) ? y : (meetOn(r, day) ?? lastMeet(r, day));
  if (!m) return minute;
  return (((minute + BODY_ANCHOR - m.start) % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

function lastMeet(r: Routine, day: string): MeetTime | null {
  const d = prevMeetDay(r, day);
  return d ? meetOn(r, d) : null;
}
