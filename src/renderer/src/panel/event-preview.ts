// 일정 입력칸 아래 해석 미리보기. 읽는 길은 일정을 넣을 때와 같은 resolveEventLine 하나라서
// 미리보기와 실제가 다를 수 없다. 못 읽으면 null (조용히 숨긴다).
import { resolveEventLine } from '../../../shared/event-line.ts';
import { timeLabel } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import { localDay } from '../../../shared/todo-store.ts';
import { lengthLabel } from './event-end.ts';
import { dayHeading } from './format.ts';

/** 날짜, 시각, 반복, 제목을 한 줄로. 보일 것이 없으면 null */
export function eventPreview(line: string, now: number, day?: string): string | null {
  if (!line.trim()) return null;
  const r = resolveEventLine(line, now, day);
  if (!r.ok || !r.ev.title) return null;
  const today = localDay(now);
  const { ev } = r;
  const parts: string[] = [];
  if ('allDay' in ev) {
    parts.push(
      ev.lastDay && ev.lastDay > ev.day
        ? `${dayHeading(ev.day, today)} ~ ${dayHeading(ev.lastDay, today)}`
        : dayHeading(ev.day, today),
      t('panel.event.allDay'),
    );
  } else {
    parts.push(dayHeading(ev.day, today));
    parts.push(
      ev.durationMin
        ? `${timeLabel(ev.minute)} (${lengthLabel(0, ev.durationMin * 60_000)})`
        : timeLabel(ev.minute),
    );
    if (r.repeat) parts.push(t(`panel.repeat.${r.repeat}`));
  }
  parts.push(`“${ev.title}”`);
  return t('panel.event.preview', { text: parts.join(', ') });
}
