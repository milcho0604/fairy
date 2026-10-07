// 혼잣말과 칭찬 (기획서 "수다 빈도": 수다쟁이만, 30분마다). AI 는 쓰지 않고 정해 둔 대사에서 고른다.
// 시각(아침, 점심, 오후, 저녁, 늦은 밤), 요일(월요일 아침, 금요일 오후), 오늘 끝낸 할 일 수로 고를 대사를 정하고,
// 최근에 한 말은 피한다.
import type { I18nKey } from './i18n/index.ts';

/** 혼잣말 사이 간격 */
export const IDLE_TALK_MS = 30 * 60_000;
/** 이만큼 최근에 한 대사는 다시 고르지 않는다 */
export const IDLE_RECENT = 6;

export type IdleKey = Extract<I18nKey, `idle.${string}`>;

const ANY: IdleKey[] = ['idle.any.1', 'idle.any.2', 'idle.any.3', 'idle.any.4', 'idle.any.5'];

export interface IdleFacts {
  /** 현지 시각 (ms) */
  now: number;
  /** 오늘 끝낸 할 일 수 */
  doneToday: number;
}

/** 지금 할 만한 대사들. 앞쪽이 지금 상황에 맞는 것, 뒤쪽이 아무 때나 하는 것 */
export function idleCandidates(f: IdleFacts): { fit: IdleKey[]; any: IdleKey[] } {
  const d = new Date(f.now);
  const minute = d.getHours() * 60 + d.getMinutes();
  const day = d.getDay();
  const fit: IdleKey[] = [];
  if (minute >= 22 * 60 || minute < 5 * 60) fit.push('idle.late.1', 'idle.late.2');
  else if (minute < 11 * 60) {
    fit.push('idle.morning.1', 'idle.morning.2');
    if (day === 1) fit.push('idle.monday.1');
  } else if (minute >= 11 * 60 + 30 && minute < 13 * 60 + 30) fit.push('idle.lunch.1', 'idle.lunch.2');
  else if (minute >= 14 * 60 && minute < 17 * 60) {
    fit.push('idle.afternoon.1', 'idle.afternoon.2');
    if (day === 5) fit.push('idle.friday.1');
  } else if (minute >= 18 * 60) fit.push('idle.evening.1', 'idle.evening.2');
  if (f.doneToday >= 5) fit.push('idle.praise.5');
  else if (f.doneToday >= 3) fit.push('idle.praise.3');
  else if (f.doneToday >= 1) fit.push('idle.praise.1');
  return { fit, any: ANY };
}

/** 대사 고르기. 상황에 맞는 말을 먼저 보고(4번에 3번), 최근에 한 말은 건너뛴다 */
export class IdleTalk {
  #recent: IdleKey[] = [];

  pick(f: IdleFacts, rand: () => number = Math.random): IdleKey | undefined {
    const { fit, any } = idleCandidates(f);
    const fresh = (list: IdleKey[]) => list.filter((k) => !this.#recent.includes(k));
    const fitFresh = fresh(fit);
    const anyFresh = fresh(any);
    const pool = fitFresh.length > 0 && (anyFresh.length === 0 || rand() < 0.75) ? fitFresh : anyFresh;
    const key = pool[Math.floor(rand() * pool.length)] ?? pool[0];
    if (!key) return undefined;
    this.#recent.push(key);
    if (this.#recent.length > IDLE_RECENT) this.#recent.shift();
    return key;
  }
}
