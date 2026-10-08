// 같은 일정을 두 번 넣었는지 (빠른 입력, 일정 탭). 제목(앞뒤 공백, 대소문자, 띄어쓰기 수 무시)과 시작 시각, 종일 여부가 같으면 같은 일정
import type { CalEvent } from './event-store.ts';

const norm = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

export function findSameEvent(
  existing: readonly Pick<CalEvent, 'id' | 'title' | 'startAt' | 'allDay'>[],
  ev: { title: string; startAt: number; allDay?: boolean },
): Pick<CalEvent, 'id' | 'title' | 'startAt' | 'allDay'> | undefined {
  const title = norm(ev.title);
  return existing.find(
    (e) => e.startAt === ev.startAt && e.allDay === !!ev.allDay && norm(e.title) === title,
  );
}
