// 펫 머리 위에 늘 떠 있는 말풍선 (이슈 #124): 집중 중이면 남은 시간, 아니면 진행 중인 할 일.
// 진행 중 표시(▶)는 할 일 줄의 단추가 켜고 끈다. 끝내거나 지우면 보이지 않고(열려 있는 것만 보인다), 되돌리면 돌아온다.
import type { FocusState } from './focus.ts';
import { t } from './i18n/index.ts';
import { shortTitle } from './pet-chips.ts';

/**
 * 표시를 이만큼까지만 기억한다 (오래된 것부터 버린다). 끝내거나 지운 할 일의 표시는 일부러 지우지 않는다:
 * 말풍선과 패널은 열려 있는 할 일만 보이고, 되돌리기로 살리면 표시도 돌아온다
 */
export const DOING_KEEP = 100;

/** 진행 중으로 표시한 할 일 id 들, 표시한 순서대로. 저장은 부르는 쪽이 넘겨 준 save 가 한다. 끝내거나 지운 것은 보이지 않을 뿐 남는다 */
export class DoingSet {
  #ids: number[];
  #save: (ids: number[]) => void;

  constructor(saved: unknown, save: (ids: number[]) => void) {
    this.#save = save;
    const list = Array.isArray(saved) ? saved : [];
    this.#ids = [...new Set(list.filter((v): v is number => Number.isInteger(v) && v > 0))];
  }

  ids(): number[] {
    return [...this.#ids];
  }

  has(id: number): boolean {
    return this.#ids.includes(id);
  }

  /** 켜거나 끈다. 바뀌었으면 true */
  set(id: number, on: boolean): boolean {
    if (!Number.isInteger(id) || id <= 0 || this.has(id) === on) return false;
    this.#ids = on ? [...this.#ids, id].slice(-DOING_KEEP) : this.#ids.filter((x) => x !== id);
    this.#save(this.ids());
    return true;
  }
}

export interface StatusInput {
  now: number;
  focus: FocusState;
  /** 진행 중인 할 일 제목, 표시한 순서대로 (열려 있는 것만) */
  doing: readonly string[];
  /** 진행 중 말풍선 설정 */
  doingOn: boolean;
}

/**
 * 펫 머리 위 말풍선 글. 집중 중이면 집중이 먼저(쉬는 시간은 집중이 아니라 진행 중으로 돌아간다),
 * 아니면 진행 중, 둘 다 아니거나 설정이 꺼져 있으면 null.
 * 집중 말풍선도 설정 "진행 중 말풍선"이 끄면 같이 꺼진다 (상시 말풍선 하나로 본다)
 */
export function statusText(s: StatusInput): string | null {
  if (!s.doingOn) return null;
  if (s.focus.phase === 'focus') {
    const left = Math.max(0, s.focus.endsAt - s.now);
    const min = Math.ceil(left / 60_000);
    return min <= 1 ? t('chips.focusingLast') : t('chips.focusing', { min });
  }
  const first = s.doing[0];
  if (first === undefined) return null;
  const title = shortTitle(first, 22);
  return s.doing.length === 1
    ? t('chips.doing', { title })
    : t('chips.doingMore', { title, n: s.doing.length - 1 });
}
