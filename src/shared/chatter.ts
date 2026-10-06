// 말풍선 수다 빈도. 기획서 "펫 동작 규칙"의 수다 빈도 표.
import { t } from './i18n/index.ts';

export type ChatterLevel = 'quiet' | 'normal' | 'chatty';

/**
 * 말풍선 종류.
 * - answer: 사용자가 물은 질문의 답이 왔다는 알림. 사용자가 시작한 일이라 빈도 제한에 넣지 않는다.
 * - schedule: 일정 시작 (v1). 조용히에서도 켠다.
 * - system: 바쁨 모드 같은 펫 상태 알림.
 * - idle-talk: 혼잣말과 칭찬. 수다쟁이만.
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
  get chatty() {
    return t('pet.chatter.chatty');
  },
};

const ENABLED: Record<ChatterLevel, readonly BubbleKind[]> = {
  quiet: ['answer', 'schedule'],
  normal: ['answer', 'schedule', 'system'],
  chatty: ['answer', 'schedule', 'system', 'idle-talk'],
};

/** 한 시간에 보일 수 있는 말풍선 수 (answer, schedule 은 세지 않는다). */
export const MAX_PER_HOUR: Record<ChatterLevel, number> = { quiet: 0, normal: 3, chatty: 6 };

/** "나중에"를 이만큼 연달아 누르면 조용히 할지 묻는다. */
export const LATER_LIMIT = 3;

const HOUR = 60 * 60 * 1000;
const UNCOUNTED: readonly BubbleKind[] = ['answer', 'schedule'];

export class ChatterGate {
  #shown: number[] = [];
  #laterInRow = 0;

  level: ChatterLevel;

  constructor(level: ChatterLevel = 'normal') {
    this.level = level;
  }

  /** 지금 이 종류의 말풍선을 띄워도 되는지. 된다면 띄운 것으로 센다. */
  take(kind: BubbleKind, now: number): boolean {
    if (!ENABLED[this.level].includes(kind)) return false;
    if (UNCOUNTED.includes(kind)) return true;
    this.#shown = this.#shown.filter((t) => now - t < HOUR);
    if (this.#shown.length >= MAX_PER_HOUR[this.level]) return false;
    this.#shown.push(now);
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

/** 한 단계 조용하게. */
export function quieter(level: ChatterLevel): ChatterLevel {
  return level === 'chatty' ? 'normal' : 'quiet';
}
