// 집중 타이머 (v1). 기본 25분 집중, 5분 쉬기. 집중 중엔 펫이 자고, 끝내면 코인 (15분 5, 25분 10, 50분 25, 하루 100개까지).
// 길이는 5~120분 정수 중에 고른다 (설정 focusMin, 마지막에 고른 것을 기억).

import { focusCoins as coinsForMinutes, FOCUS_LENGTHS, focusReward } from './coin-rules.ts';

export const FOCUS = {
  focusMin: 25,
  breakMin: 5,
} as const;

export { FOCUS_LENGTHS, focusReward };
export const FOCUS_MIN_MINUTES = 5;
export const FOCUS_MAX_MINUTES = 120;

/** 직접 고른 긴 집중도 기존 1회 보상 상한(50분 기준, 25코인)을 유지한다. */
export function focusCoins(minutes: number): number {
  return coinsForMinutes(Math.min(minutes, 50));
}
export type FocusLength = number;
export const isFocusLength = (v: unknown): v is FocusLength =>
  typeof v === 'number' && Number.isInteger(v) && v >= FOCUS_MIN_MINUTES && v <= FOCUS_MAX_MINUTES;

export const FOCUS_CUSTOM = { min: FOCUS_MIN_MINUTES, max: FOCUS_MAX_MINUTES } as const;
export const isFocusMinutes = isFocusLength;

/** 쉬는 시간: 50분 집중은 10분, 나머지는 5분 */
export function breakFor(focusMin: number): number {
  return focusMin >= 50 ? 10 : FOCUS.breakMin;
}

// 집중 코인 값(focusCoins)과 길이(FOCUS_LENGTHS)는 coin-rules.ts 한 곳에 (서버도 같은 값을 쓴다)

export type FocusPhase = 'idle' | 'focus' | 'break';

export interface FocusState {
  phase: FocusPhase;
  /** 지금 단계 시작 시각(ms). idle 이면 0 */
  startedAt: number;
  /** 지금 단계 끝 시각(ms). idle 이면 0 */
  endsAt: number;
  /** 이 할 일을 하려고 시작한 집중 (오늘 탭 "다음 할 일"). 끝나면 끝냈는지 묻는다. 쉬기에는 없다 */
  todoId?: number;
}

export const IDLE: FocusState = { phase: 'idle', startedAt: 0, endsAt: 0 };

export function startFocus(now: number, minutes: number = FOCUS.focusMin, todoId?: number): FocusState {
  return {
    phase: 'focus',
    startedAt: now,
    endsAt: now + minutes * 60_000,
    ...(todoId !== undefined && Number.isInteger(todoId) && todoId > 0 ? { todoId } : {}),
  };
}

/** 집중이 끝났을 때 끝냈는지 물을 할 일: 할 일을 걸고 시작했고 그 할 일이 아직 열려 있으면 그 id */
export function focusTodoToAsk(
  s: FocusState,
  open: readonly { id: number; doneAt?: number | null }[],
): number | undefined {
  if (s.todoId === undefined) return undefined;
  const todo = open.find((t) => t.id === s.todoId);
  return todo && (todo.doneAt === null || todo.doneAt === undefined) ? todo.id : undefined;
}

/** 집중이 끝났을 때 말풍선 단추 (id). 할 일을 걸었으면 끝냈어, 조금 더, 그만할래. 아니면 그만할래 하나 */
export function focusDoneButtons(withTodo: boolean): ('finished' | 'more' | 'stop')[] {
  // 할 일을 물을 때도 쉬기를 멈출 길을 남긴다 (리뷰 LOW: 할 일이 있으면 "그만할래"가 사라졌다)
  return withTodo ? ['finished', 'more', 'stop'] : ['stop'];
}

/**
 * 집중 끝 말풍선에서 누른 단추로 할 일. finish 는 할 일을 끝낸다, again 은 같은 할 일로 집중을 바로 다시 한다
 * ("조금 더"가 아무것도 안 하고 쉬기로 넘어갔다), stop 은 쉬기도 그만한다. 그 밖(닫음, 시간 끝)은 그대로 쉰다
 */
export function focusDoneAction(
  a: string | undefined,
  withTodo: boolean,
): 'finish' | 'again' | 'stop' | undefined {
  if (a === 'stop') return 'stop';
  if (!withTodo) return undefined;
  if (a === 'finished') return 'finish';
  if (a === 'more') return 'again';
  return undefined;
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
