// 친구 펫 놀러 오기 (이슈 #141): 손님을 부를지 정하는 순수 판단과 상한. 창 다루기는 main/visitors.ts.
// 상한, 쉬는 시간, 길이는 모두 아래 VISIT 한곳에 둔다.

export const VISIT = {
  /** 하루(현지 날짜) 최대 손님 수 */
  dayMax: 6,
  /** 한 번 온 뒤 다음 손님까지 쉬는 시간 */
  cooldownMs: 20 * 60_000,
  /** 같은 친구가 다시 오기까지 쉬는 시간 */
  perFriendMs: 3 * 3600_000,
  /** 한 번 머무는 시간 (오가는 시간 포함) */
  lengthMs: 3 * 60_000,
  /** 볼 때마다 부를 확률 */
  chance: 0.35,
  /** 손님 목록을 보는 간격 (서버 친구 목록을 받는 간격과 같다) */
  tickMs: 3 * 60_000,
  /** 와 있는 동안 친구가 아직 허락하는지 다시 보는 간격 */
  recheckMs: 60_000,
  /** 와 있는 동안 펫이 바빠졌는지 보는 간격 */
  watchMs: 2000,
  /** 지금부터 이만큼 안에 시각 일정이 있으면 미룬다 (회의 대용) */
  soonMs: 4 * 60_000,
  /** 이 시간 안에 입력이 없으면 자리를 비운 것 */
  awaySec: 60,
} as const;

export interface VisitState {
  /** count 가 센 현지 날짜 */
  day: string;
  count: number;
  /** "오늘은 그만"을 누른 현지 날짜 */
  pausedDay: string | null;
  /** 마지막 손님이 온 때 */
  lastAt: number;
  /** 친구 코드별 마지막으로 온 때 */
  last: Record<string, number>;
}

export const emptyState = (today: string): VisitState => ({
  day: today,
  count: 0,
  pausedDay: null,
  lastAt: 0,
  last: {},
});

const CODE = /^F-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** 파일에서 읽은 값을 믿지 않고 모양을 확인한다. 날짜가 바뀌었으면 센 수를 0으로 */
export function parseState(raw: unknown, today: string): VisitState {
  const o =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const last: Record<string, number> = {};
  if (typeof o.last === 'object' && o.last !== null && !Array.isArray(o.last))
    for (const [k, v] of Object.entries(o.last))
      if (CODE.test(k) && num(v) > 0 && Object.keys(last).length < 200) last[k] = num(v);
  const day = typeof o.day === 'string' ? o.day : today;
  return {
    day: today,
    count: day === today ? Math.min(Math.floor(num(o.count)), 999) : 0,
    pausedDay: o.pausedDay === today ? today : null,
    lastAt: num(o.lastAt),
    last,
  };
}

export const isPaused = (s: VisitState, today: string): boolean => s.pausedDay === today;

/** 지금 손님을 부르면 안 되는 까닭 (판정 순서대로). 위 줄이 먼저 말한다 */
export type DeferReason =
  | 'present'
  | 'paused'
  | 'dayMax'
  | 'cooldown'
  | 'server'
  | 'hidden'
  | 'focus'
  | 'play'
  | 'seek'
  | 'away'
  | 'saver'
  | 'calendar'
  | 'busy'
  | 'friend'
  | 'chance';

export interface VisitFacts {
  today: string;
  now: number;
  /** 서버가 말할 수 있다 (기능 켜짐, 로그인, 오프라인 아님, 업데이트 관문 아님). 아니면 조용히 미룬다 */
  serverOk: boolean;
  /** 기본 펫이 숨었다 (사용자, 발표와 전체 화면, 집 안) */
  hidden: boolean;
  /** 집중 타이머 중 */
  focus: boolean;
  /** 공놀이, 산책 중 */
  playing: boolean;
  /** 숨바꼭질 중 */
  seeking: boolean;
  /** 마지막 입력 뒤 지난 초 */
  awaySec: number;
  /** 배터리 절약 중 (main/battery.ts saverNow) */
  saver: boolean;
  /** 곧(VISIT.soonMs 안에) 시각 일정이 있다 */
  eventSoon: boolean;
  /** 기본 펫이 한가하다 (말풍선, 걷기, 들림 중이 아니다) */
  mainIdle: boolean;
  /** 이미 손님이 와 있다 */
  present: boolean;
}

/** 손님이 와 있는 동안 계속 따지는 것: 이것이 하나라도 걸리면 와 있는 손님도 돌려보낸다 */
export function interruptReason(
  f: Pick<VisitFacts, 'hidden' | 'focus' | 'playing' | 'seeking' | 'awaySec' | 'saver'>,
): DeferReason | null {
  if (f.hidden) return 'hidden';
  if (f.focus) return 'focus';
  if (f.playing) return 'play';
  if (f.seeking) return 'seek';
  if (f.awaySec >= VISIT.awaySec) return 'away';
  if (f.saver) return 'saver';
  return null;
}

/** 확률과 친구 고르기 전에 걸리는 까닭. 없으면 null */
export function deferReason(s: VisitState, f: VisitFacts): DeferReason | null {
  if (f.present) return 'present';
  if (isPaused(s, f.today)) return 'paused';
  if (s.day === f.today && s.count >= VISIT.dayMax) return 'dayMax';
  if (f.now - s.lastAt < VISIT.cooldownMs) return 'cooldown';
  if (!f.serverOk) return 'server';
  const i = interruptReason(f);
  if (i) return i;
  if (f.eventSoon) return 'calendar';
  if (!f.mainIdle) return 'busy';
  return null;
}

/** 쉬는 시간이 지난 친구 중 하나를 무작위로 */
export function pickVisitor<T extends { code: string }>(
  cands: readonly T[],
  s: VisitState,
  now: number,
  random: () => number,
): T | undefined {
  const ready = cands.filter((c) => now - (s.last[c.code] ?? 0) >= VISIT.perFriendMs);
  return ready[Math.min(ready.length - 1, Math.floor(random() * ready.length))];
}

export type VisitDecision<T> = { go: true; visitor: T } | { go: false; reason: DeferReason };

/** 이번 차례에 누구를 부를지. force 는 확률을 건너뛴다 (개발용 손잡이) */
export function decide<T extends { code: string }>(
  s: VisitState,
  f: VisitFacts,
  cands: readonly T[],
  random: () => number,
  force = false,
): VisitDecision<T> {
  const why = deferReason(s, f);
  if (why) return { go: false, reason: why };
  const v = pickVisitor(cands, s, f.now, random);
  if (!v) return { go: false, reason: 'friend' };
  if (!force && random() >= VISIT.chance) return { go: false, reason: 'chance' };
  return { go: true, visitor: v };
}

/** 손님이 왔다고 적는다 */
export function recordVisit(s: VisitState, code: string, now: number, today: string): VisitState {
  const base = s.day === today ? s : { ...s, day: today, count: 0 };
  return { ...base, count: base.count + 1, lastAt: now, last: { ...base.last, [code]: now } };
}

export function setPaused(s: VisitState, on: boolean, today: string): VisitState {
  return {
    ...s,
    day: s.day === today ? s.day : today,
    count: s.day === today ? s.count : 0,
    pausedDay: on ? today : null,
  };
}
