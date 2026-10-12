// "오늘 뭐부터 할까?" 규칙 답 (2026-10-11). 셈과 글은 shared/what-first.ts, 여기는 저장 파일에서 오늘 할 일, 습관, 일정을 읽는다.
// 채팅(AI 가 없거나 무료 AI 일 때 바로 답, 클라우드 AI 면 자료로)과 펫 우클릭 메뉴 "오늘 뭐부터?" 가 같이 쓴다.
import { aiSafeEvent, type EventStore } from '../shared/event-store.ts';
import type { HabitStore } from '../shared/habit.ts';
import { localDay, type TodoStore } from '../shared/todo-store.ts';
import { type FirstPlan, firstAnswer, firstBubble, firstContext, planFirst } from '../shared/what-first.ts';
import { startOfDay, startOfDayAfter } from './planner.ts';

export interface WhatFirstOptions {
  todos: TodoStore;
  habits: HabitStore;
  events: EventStore;
  restDays: () => number[];
  /** 하루 마무리 시각 (분). 빈 시간을 찾는 끝 */
  dayEndMinute: () => number;
}

export type WhatFirst = ReturnType<typeof createWhatFirst>;

export function createWhatFirst(o: WhatFirstOptions) {
  /** ai: 클라우드 AI 에 보낼 자료면 구글에서 읽어 온 일정을 뺀다 (aiSafeEvent) */
  function plan(now: number, ai = false): { today: string; plan: FirstPlan } {
    const today = localDay(now);
    const dayStart = startOfDay(now);
    const events = o.events
      .between(dayStart, startOfDayAfter(now, 1))
      .filter((ev) => !ai || aiSafeEvent(ev))
      .map((ev) => ({ title: ev.title, startAt: ev.startAt, endAt: ev.endAt, allDay: ev.allDay }));
    const habits = o.habits
      .list(now, o.restDays())
      .map((h) => ({ id: h.id, title: h.title, status: h.status }));
    return {
      today,
      plan: planFirst({
        todos: o.todos.list(now).open,
        habits,
        events,
        today,
        dayStart,
        now,
        endMinute: o.dayEndMinute(),
      }),
    };
  }
  /** 맨 위 할 일 (집중 시작 단추가 이 할 일로 집중한다) */
  const focusId = (p: FirstPlan) => p.block?.todoId ?? p.items[0]?.id;
  return {
    /** 채팅 답: 마크다운 글과 집중할 할 일 */
    answer(now = Date.now()): { text: string; focusTodoId?: number } {
      const r = plan(now);
      const id = focusId(r.plan);
      return { text: firstAnswer(r.plan, r.today), ...(id !== undefined ? { focusTodoId: id } : {}) };
    },
    /** 펫 말풍선 */
    bubble(now = Date.now()): { text: string; focusTodoId?: number; empty: boolean } {
      const r = plan(now);
      const id = focusId(r.plan);
      return {
        text: firstBubble(r.plan, r.today),
        empty: r.plan.items.length === 0,
        ...(id !== undefined ? { focusTodoId: id } : {}),
      };
    },
    /** 클라우드 AI 에 보낼 자료 (할 일 같이 보내기를 켰을 때만 부른다) */
    context(now = Date.now()): string {
      const r = plan(now, true);
      return firstContext(r.plan, r.today);
    },
  };
}
