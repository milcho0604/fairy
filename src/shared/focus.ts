// 집중 타이머 (v1). 25분 집중, 5분 쉬기. 집중 중엔 펫이 자고, 끝내면 코인 5개 (하루 8번까지).

export const FOCUS = {
  focusMin: 25,
  breakMin: 5,
} as const;

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
  if (s.phase === 'focus') return { state: startBreak(now), event: 'focus-done' };
  return { state: IDLE, event: 'break-done' };
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
