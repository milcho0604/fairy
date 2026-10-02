// 펫 상태 기계. 기획서 "펫 동작 규칙"의 상태 표를 그대로 옮겼다. 위에 있을수록 우선한다.
// 바쁨은 사용자 요청(2026-10-02)으로 더했다: 컴퓨터가 바쁘면 펫이 움직임을 멈춘다.

export type PetMood =
  | 'hidden'
  | 'grabbed'
  | 'thinking'
  | 'talking'
  | 'busy'
  | 'excited'
  | 'sleeping'
  | 'dozing'
  | 'sulky'
  | 'idle';

export interface PetInputs {
  hidden: boolean;
  grabbed: boolean;
  /** AI 답을 기다리는 중 (3단계). */
  thinking: boolean;
  /** 말풍선이 떠 있는 끝 시각(ms). 0 이면 없음. */
  talkingUntil: number;
  /** 컴퓨터가 바쁜지 (CPU, 메모리). */
  systemBusy: boolean;
  /** 신남이 끝나는 시각(ms). 0 이면 없음. */
  excitedUntil: number;
  /** 사용자가 키보드, 마우스를 안 만진 시간(ms). */
  userIdleMs: number;
  /** 집중 타이머 중 (v1). */
  focusTimer: boolean;
  /** 삐짐 게이지 칸 수 (v1). */
  sulkLevel: number;
  /** 배부름이 낮다 (2단계). 상태는 바꾸지 않고 기본 상태에 배고픈 표정만 더한다 */
  hungry: boolean;
}

export const SLEEP_AFTER_MS = 10 * 60 * 1000;
/** 이만큼 입력이 없으면 꾸벅꾸벅 존다 (P1-06). 잠보다 먼저 온다. */
export const DOZE_AFTER_MS = 5 * 60 * 1000;
export const EXCITED_MS = 3000;
export const TALK_MS = 8000;

export const INITIAL_INPUTS: PetInputs = {
  hidden: false,
  grabbed: false,
  thinking: false,
  talkingUntil: 0,
  systemBusy: false,
  excitedUntil: 0,
  userIdleMs: 0,
  focusTimer: false,
  sulkLevel: 0,
  hungry: false,
};

export function moodOf(i: PetInputs, now: number): PetMood {
  if (i.hidden) return 'hidden';
  if (i.grabbed) return 'grabbed';
  if (i.thinking) return 'thinking';
  if (i.talkingUntil > now) return 'talking';
  if (i.systemBusy) return 'busy';
  if (i.excitedUntil > now) return 'excited';
  if (i.focusTimer || i.userIdleMs >= SLEEP_AFTER_MS) return 'sleeping';
  if (i.userIdleMs >= DOZE_AFTER_MS) return 'dozing';
  if (i.sulkLevel > 0) return 'sulky';
  return 'idle';
}

/** 시간이 흘러서 상태가 바뀔 수 있는 가장 가까운 시각. 없으면 undefined. 타이머를 걸 때 쓴다. */
export function nextChangeAt(i: PetInputs, now: number): number | undefined {
  const times = [i.talkingUntil, i.excitedUntil].filter((t) => t > now);
  return times.length > 0 ? Math.min(...times) : undefined;
}

/** 상태마다 그리기를 계속 돌려야 하는지. 정지 상태는 한 번 그리고 멈춘다 (L10). */
export function isAnimated(mood: PetMood): boolean {
  return mood === 'excited' || mood === 'thinking';
}

/** 가끔 눈을 깜빡여도 되는 상태. 잠, 바쁨, 숨김에서는 아무것도 움직이지 않는다. */
export function canBlink(mood: PetMood): boolean {
  return mood === 'idle' || mood === 'sulky' || mood === 'talking';
}
