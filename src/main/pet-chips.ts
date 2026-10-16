// 펫 질문 칩과 머리 위 상태 말풍선을 앱 데이터에 잇는다 (이슈 #124). AI 는 부르지 않는다.
// 계산은 shared/pet-chips.ts, shared/pet-status.ts 가 하고, 여기는 저장소에서 읽어 말풍선으로 내보낸다.
import type { StatStore } from '../shared/beta-stats.ts';
import type { EventStore } from '../shared/event-store.ts';
import { type FocusState, focusedMinutes } from '../shared/focus.ts';
import { t } from '../shared/i18n/index.ts';
import { type ChipFacts, chipAnswer, chipButtons, isChipId } from '../shared/pet-chips.ts';
import { type DoingSet, statusText } from '../shared/pet-status.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';

/** 칩을 보여 주는 시간. 답은 읽을 만큼 */
const CHIPS_TTL_MS = 25_000;
const ANSWER_TTL_MS = 14_000;
/** 앞으로 이만큼의 일정에서 다음 일정을 찾는다 */
const EVENT_DAYS = 14;
const DAY_MS = 86_400_000;

export interface PetChipsOptions {
  say: (options: SayOptions) => Promise<string | undefined>;
  store: TodoStore;
  events: EventStore;
  stats: StatStore;
  doing: DoingSet;
  focus: () => FocusState;
  /** 설정 doingBubble */
  doingOn: () => boolean;
}

export function createPetChips(o: PetChipsOptions) {
  /** 지금 앱 데이터에서 답에 쓸 것을 모은다 */
  function facts(now = Date.now()): ChipFacts {
    const { open, doneToday } = o.store.list(now);
    const day = localDay(now);
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    const byId = new Map<number, ChipFacts['events'][number] & { id: number }>();
    for (const e of [
      ...o.events.between(from.getTime(), from.getTime() + EVENT_DAYS * DAY_MS),
      ...o.events.timedOverlapping(now, now + 1),
    ])
      byId.set(e.id, { id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay });
    const recorded = o.stats.diaryFacts([day])[0]?.focusMin ?? 0;
    const running = o.focus();
    return {
      now,
      doneToday: doneToday.length,
      open: open.map((todo) => todo.title),
      events: [...byId.values()],
      focusMin: recorded + focusedMinutes(running, now),
      focusing: running.phase === 'focus',
      coins: o.store.balance(),
    };
  }

  /** 칩을 띄우고, 누른 칩의 답을 보여 준다. 답에서 "다른 것도"를 누르면 칩이 다시 뜬다 */
  async function ask(): Promise<void> {
    for (;;) {
      const picked = await o.say({
        kind: 'answer',
        text: t('chips.ask'),
        buttons: chipButtons(),
        ttlMs: CHIPS_TTL_MS,
      });
      if (!isChipId(picked)) return;
      const next = await o.say({
        kind: 'answer',
        text: chipAnswer(picked, facts()),
        buttons: [
          { id: 'more', label: t('chips.more') },
          { id: 'ok', label: t('chips.enough') },
        ],
        ttlMs: ANSWER_TTL_MS,
      });
      if (next !== 'more') return;
    }
  }

  /** 머리 위 상태 말풍선 글: 집중 중이면 집중, 아니면 진행 중인 할 일. 끝내거나 지운 할 일은 안 보인다 */
  function statusNow(now = Date.now()): string | null {
    const { open } = o.store.list(now);
    const titles = o.doing
      .ids()
      .map((id) => open.find((todo) => todo.id === id)?.title)
      .filter((title): title is string => title !== undefined);
    return statusText({ now, focus: o.focus(), doing: titles, doingOn: o.doingOn() });
  }

  return { ask, facts, statusNow };
}
