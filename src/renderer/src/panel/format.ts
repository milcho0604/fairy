// 패널에서 쓰는 날짜, 시각 글.
import { timeLabel } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import { localDay } from '../../../shared/todo-store.ts';

export const minuteOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

export const timeOf = (ms: number) => timeLabel(minuteOf(ms));

/** YYYY-MM-DD 에 n 일 */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

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
  if (localDay(ms + 86_400_000) === localDay(now)) return t('panel.ago.yesterday');
  const d = new Date(ms);
  return t('panel.due.date', { m: d.getMonth() + 1, d: d.getDate() });
}
