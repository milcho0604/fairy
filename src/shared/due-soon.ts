// 할 일 줄의 마감 색: 지남(빨강)과 임박(1시간 안, 주황). 시각이 있는 마감만 시각으로 가르고, 날짜만이면 날짜로 지남만 본다.
import { atLocal, dayOf } from './remind.ts';

/** 마감 시각이 이만큼 안으로 다가오면 임박 */
export const DUE_SOON_MS = 60 * 60_000;

export type DueUrgency = 'overdue' | 'soon' | null;

export function dueUrgency(todo: { due: string | null; dueMin: number | null }, now: number): DueUrgency {
  if (!todo.due) return null;
  if (todo.dueMin === null) return todo.due < dayOf(now) ? 'overdue' : null;
  const at = atLocal(todo.due, todo.dueMin);
  if (at < now) return 'overdue';
  return at - now <= DUE_SOON_MS ? 'soon' : null;
}
