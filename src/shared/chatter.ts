// 말풍선 수다 빈도. 기획서 "펫 동작 규칙"의 수다 빈도 표.
import { t } from './i18n/index.ts';

export type ChatterLevel = 'quiet' | 'normal' | 'sometimes' | 'chatty';

/**
 * 말풍선 종류.
 * - answer: 사용자가 물은 질문의 답이 왔다는 알림. 사용자가 시작한 일이라 빈도 제한에 넣지 않는다.
 * - schedule: 일정 시작 (v1). 조용히에서도 켠다.
 * - system: 바쁨 모드 같은 펫 상태 알림.
 * - idle-talk: 혼잣말과 칭찬. 가끔 한마디(드문드문)와 수다쟁이(자주)만.
 */
export type BubbleKind = 'answer' | 'schedule' | 'system' | 'idle-talk';

// 이름은 지금 말로 읽는다 (getter)
export const LEVEL_LABEL: Readonly<Record<ChatterLevel, string>> = {
  get quiet() {
    return t('pet.chatter.quiet');
  },
  get normal() {
    return t('pet.chatter.normal');
  },
  get sometimes() {
    return t('pet.chatter.sometimes');
  },
  get chatty() {
    return t('pet.chatter.chatty');
  },
};

const ENABLED: Record<ChatterLevel, readonly BubbleKind[]> = {
  quiet: ['answer', 'schedule'],
  normal: ['answer', 'schedule', 'system'],
  sometimes: ['answer', 'schedule', 'system', 'idle-talk'],
  chatty: ['answer', 'schedule', 'system', 'idle-talk'],
};

/**
 * 한 시간에 보일 수 있는 말풍선 수 (answer, schedule 은 세지 않는다).
 * 수다쟁이는 2026-10-08 사용자 요청("수다쟁이면 말을 좀 많이")으로 6 에서 14 로. 혼잣말이 4~6분마다라 상태 알림과 합쳐 넉넉히.
 */
export const MAX_PER_HOUR: Record<ChatterLevel, number> = { quiet: 0, normal: 3, sometimes: 5, chatty: 14 };

/** 혼잣말은 다른 말풍선(어떤 종류든)이 뜬 뒤 이만큼은 기다린다. 알림 바로 뒤에 수다가 붙지 않게 */
export const IDLE_AFTER_ANY_MS = 2 * 60_000;

/** "나중에"를 이만큼 연달아 누르면 조용히 할지 묻는다. */
export const LATER_LIMIT = 3;

const HOUR = 60 * 60 * 1000;
const UNCOUNTED: readonly BubbleKind[] = ['answer', 'schedule'];

export class ChatterGate {
  #shown: number[] = [];
  #laterInRow = 0;
  /** 마지막으로 말풍선을 띄운 때 (종류와 상관없이) */
  #lastAt: number | undefined;

  level: ChatterLevel;

  constructor(level: ChatterLevel = 'normal') {
    this.level = level;
  }

  /** 이 수다 빈도에서 이 종류를 말하는지 (세지 않는다. 숨어 있을 때 모아 둘지 정할 때) */
  allows(kind: BubbleKind): boolean {
    return ENABLED[this.level].includes(kind);
  }

  /** 지금 이 종류의 말풍선을 띄워도 되는지. 된다면 띄운 것으로 센다. */
  take(kind: BubbleKind, now: number): boolean {
    if (!ENABLED[this.level].includes(kind)) return false;
    if (
      kind === 'idle-talk' &&
      this.#lastAt !== undefined &&
      now >= this.#lastAt &&
      now - this.#lastAt < IDLE_AFTER_ANY_MS
    )
      return false;
    if (UNCOUNTED.includes(kind)) {
      this.#lastAt = now;
      return true;
    }
    this.#shown = this.#shown.filter((t) => now - t < HOUR);
    if (this.#shown.length >= MAX_PER_HOUR[this.level]) return false;
    this.#shown.push(now);
    this.#lastAt = now;
    return true;
  }

  /** 사용자가 말풍선을 어떻게 닫았는지. "나중에"가 연달아 쌓이면 true (조용히 할지 물을 때). */
  closed(action: 'later' | 'other'): boolean {
    if (action !== 'later') {
      this.#laterInRow = 0;
      return false;
    }
    this.#laterInRow++;
    if (this.#laterInRow < LATER_LIMIT) return false;
    this.#laterInRow = 0;
    return this.level !== 'quiet';
  }
}

export const CHATTER_LEVELS = [
  'quiet',
  'normal',
  'sometimes',
  'chatty',
] as const satisfies readonly ChatterLevel[];
export const isChatter = (v: unknown): v is ChatterLevel =>
  (CHATTER_LEVELS as readonly unknown[]).includes(v);

/** 혼잣말을 하는 단계인지 (가끔 한마디, 수다쟁이) */
export const talksToSelf = (level: ChatterLevel): boolean => level === 'sometimes' || level === 'chatty';

/** 한 단계 조용하게. */
export function quieter(level: ChatterLevel): ChatterLevel {
  return level === 'chatty' || level === 'sometimes' ? 'normal' : 'quiet';
}
