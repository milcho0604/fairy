// AI 에 보낼 "오늘 일정" 고르기 (내 할 일을 아는 대화). 예전에는 지금부터 오늘 0시+24시간까지만 봐서
// 오늘 하루 종일 일정(0시 시작)이 빠지고, 여러 날 종일 일정은 "오전 12:00"으로 보이고, 5분 전에 시작한 회의도 빠졌다.
// 서머타임이 바뀌는 날은 하루가 23, 25시간이라 24시간을 더하지 않고 다음 날 0시를 날짜로 센다.
import { plusDays } from '../day.ts';
import type { CalEvent } from '../event-store.ts';
import { timeLabel } from '../event-store.ts';
import { localDay } from '../todo-store.ts';
import type { ContextEvent } from './persona.ts';

/** 막 시작한 일정은 이만큼 지나도 "지금 하는 일"로 보낸다 (끝 시각이 없는 일정) */
export const STARTED_GRACE_MS = 30 * 60_000;

const midnight = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1).getTime();
};

/** 오늘(현지 날짜) 0시부터 다음 날 0시까지. events.between 에 그대로 준다 */
export function todayRange(now: number): { from: number; to: number } {
  const day = localDay(now);
  return { from: midnight(day), to: midnight(plusDays(day, 1)) };
}

/**
 * 오늘 일정 가운데 보낼 것: 종일 일정은 늘, 시각 일정은 아직 안 끝났거나(끝 시각) 시작한 지 30분 안인 것.
 * 종일 일정은 시각 대신 "종일"로 보낸다
 */
export function contextEvents(
  events: readonly Pick<CalEvent, 'title' | 'startAt' | 'endAt' | 'allDay'>[],
  now: number,
): ContextEvent[] {
  const { from, to } = todayRange(now);
  return events
    .filter((e) => {
      if (e.allDay) return e.startAt < to && (e.endAt ?? e.startAt + 1) > from;
      if (e.startAt >= to) return false;
      return (e.endAt !== null && e.endAt > now) || e.startAt >= now - STARTED_GRACE_MS;
    })
    .map((e) => {
      const d = new Date(e.startAt);
      return e.allDay
        ? { time: '', title: e.title, allDay: true }
        : { time: timeLabel(d.getHours() * 60 + d.getMinutes()), title: e.title };
    });
}
