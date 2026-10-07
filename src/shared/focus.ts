// 집중 타이머 (v1). 기본 25분 집중, 5분 쉬기. 집중 중엔 펫이 자고, 끝내면 코인 (5분에 1개, 하루 40개까지).
// 길이는 15, 25, 50분 중에 고른다 (설정 focusMin, 마지막에 고른 것을 기억).

export const FOCUS = {
  focusMin: 25,
  breakMin: 5,
} as const;

export const FOCUS_LENGTHS = [15, 25, 50] as const;
export type FocusLength = (typeof FOCUS_LENGTHS)[number];
export const isFocusLength = (v: unknown): v is FocusLength => FOCUS_LENGTHS.includes(v as FocusLength);

/** 쉬는 시간: 50분 집중은 10분, 나머지는 5분 */
export function breakFor(focusMin: number): number {
  return focusMin >= 50 ? 10 : FOCUS.breakMin;
}

/** 집중을 끝내면 받는 코인. 분에 비례한다 (5분에 1개: 15분 3, 25분 5, 50분 10) */
export function focusCoins(focusMin: number): number {
  return Math.max(0, Math.round(focusMin / 5));
}

export type FocusPhase = 'idle' | 'focus' | 'break';

export interface FocusState {
  phase: FocusPhase;
  /** 지금 단계 시작 시각(ms). idle 이면 0 */
  startedAt: number;
  /** 지금 단계 끝 시각(ms). idle 이면 0 */
  endsAt: number;
}

export const IDLE: FocusState = { phase: 'idle', startedAt: 0, endsAt: 0 };

export function startFocus(now: number, minutes: number = FOCUS.focusMin): FocusState {
  return { phase: 'focus', startedAt: now, endsAt: now + minutes * 60_000 };
}

export function startBreak(now: number, minutes: number = FOCUS.breakMin): FocusState {
  return { phase: 'break', startedAt: now, endsAt: now + minutes * 60_000 };
}

/**
 * 시간이 흘렀을 때. 집중이 끝나면 쉬기로 넘어가며 'focus-done' (코인과 집중 분을 이때 준다),
 * 쉬기가 끝나면 멈추며 'break-done'. 컴퓨터가 잠들었다 깨서 한참 지났어도 한 단계씩만 넘긴다.
 */
export function tickFocus(
  s: FocusState,
  now: number,
): { state: FocusState; event?: 'focus-done' | 'break-done' } {
  if (s.phase === 'idle' || now < s.endsAt) return { state: s };
  if (s.phase === 'focus')
    return {
      state: startBreak(now, breakFor(Math.round((s.endsAt - s.startedAt) / 60_000))),
      event: 'focus-done',
    };
  return { state: IDLE, event: 'break-done' };
}

/**
 * 틱 사이에 시간이 튀었을 때(잠자기, 시계 바꾸기). 예상 간격보다 긴 만큼은 집중으로 치지 않고 단계를 그만큼 민다.
 * 시계를 되돌렸으면(gap 이 음수) 되돌린 만큼 당긴다. 그래서 잠자는 동안이나 시계 앞당기기로 코인이 생기지 않는다.
 */
export function skipGap(s: FocusState, lastTick: number, now: number, tickMs: number): FocusState {
  if (s.phase === 'idle' || lastTick === 0) return s;
  const gap = now - lastTick;
  // 틱이 조금 늦는 것은 그대로 둔다 (바쁠 때 몇 초)
  if (gap >= 0 && gap <= tickMs * 3) return s;
  const skip = gap < 0 ? gap : gap - tickMs;
  return { ...s, startedAt: s.startedAt + skip, endsAt: s.endsAt + skip };
}

/** 중간에 그만두면 집중한 분만큼만 기록한다 (코인은 없음). */
export function focusedMinutes(s: FocusState, now: number): number {
  if (s.phase !== 'focus') return 0;
  return Math.max(0, Math.floor((Math.min(now, s.endsAt) - s.startedAt) / 60_000));
}

/** 남은 시간 "12:05" */
export function remainLabel(s: FocusState, now: number): string {
  const sec = Math.max(0, Math.ceil((s.endsAt - now) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
