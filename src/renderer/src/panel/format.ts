// 패널에서 쓰는 날짜, 시각 글.
import { plusDays } from '../../../shared/day.ts';
import { timeLabel } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelAddResult } from '../../../shared/ipc.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import { localDay } from '../../../shared/todo-store.ts';

export const minuteOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

export const timeOf = (ms: number) => timeLabel(minuteOf(ms));

/** "오늘", "내일", "10월 9일 (금)" (영어는 "Fri, Oct 9") */
export function dayHeading(day: string, today: string): string {
  if (day === today) return t('panel.due.today');
  if (day === plusDays(today, 1)) return t('panel.due.tomorrow');
  const [y = 2000, m = 1, d = 1] = day.split('-').map(Number);
  return t('panel.day.heading', { y, m, d });
}

/** datetime-local 입력칸 값 "2026-10-07T15:00" */
export function toInputValue(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "3분 전", "어제", "10월 2일" */
export function ago(ms: number, now: number): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return t('panel.ago.now');
  if (min < 60) return t('panel.ago.min', { n: min });
  if (localDay(ms) === localDay(now)) return t('panel.ago.hour', { n: Math.floor(min / 60) });
  // 날짜로 센다: 24시간을 더하면 서머타임이 끝나는 날(25시간) 이른 시각이 "어제"가 되지 못했다
  if (plusDays(localDay(ms), 1) === localDay(now)) return t('panel.ago.yesterday');
  const d = new Date(ms);
  return t('panel.due.date', { m: d.getMonth() + 1, d: d.getDate() });
}

/** 일정 시작: "내일 오후 3:00", "10월 9일 (금) 오전 9:30" */
export function whenLabel(startAt: number, today: string): string {
  return `${dayHeading(localDay(startAt), today)} ${timeOf(startAt)}`;
}

/** 한 줄 입력이 어디에 언제로 들어갔는지: "내일 오후 3:00 일정에 넣었어", "할 일에 넣었어 (내일까지)" */
export function addedText(r: Extract<PanelAddResult, { ok: true }>, today: string): string {
  if (r.kind === 'many') return t('panel.add.many', { todos: r.todos, events: r.events });
  if (r.kind === 'event') return t('panel.quick.event', { when: whenLabel(r.startAt, today) });
  if (r.remindAt !== undefined) return t('snooze.quick.added', { when: whenLabel(r.remindAt, today) });
  if (!r.due) return t('panel.quick.todo');
  // 모레 뒤는 요일까지: 주말에 적은 "이번 주 금요일"이 어느 금요일로 들어갔는지 보이게
  const later = r.due > plusDays(today, 1);
  return t('panel.quick.todoDue', { due: later ? dayHeading(r.due, today) : dueLabel(r.due, today).text });
}
