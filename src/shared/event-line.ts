// 일정 탭의 한 줄을 읽는 단 하나의 길. 넣을 때(메인의 PANEL.eventAdd)와 입력 중 미리보기(화면)가 같은 함수를 써서
// 미리보기와 실제가 다를 수 없다.
import { dayStartMs, parseEventInput, type QuickAllDay, type QuickEvent } from './event-store.ts';
import { parseTodoLine, splitRemind, type TakenRemind } from './remind-parse.ts';
import { localDay } from './todo-store.ts';

export type EventRepeat = 'daily' | 'weekdays' | 'weekly';

export type EventLine =
  | {
      ok: true;
      ev: QuickEvent | QuickAllDay;
      /** 시각 일정의 반복 (종일 일정은 반복이 없다) */
      repeat: EventRepeat | undefined;
      remind: TakenRemind;
    }
  | {
      ok: false;
      /** 반복 말이 있었다 (시각 일정으로 못 읽었으면 반복 할 일로 넣을 수 있다) */
      repeatWord: boolean;
    };

const minuteOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * 일정 한 줄을 읽는다. picked 는 달력에서 고른 날("3시 회의" 는 그날 3시, "내일" 은 그다음 날).
 * 오늘이 아닌 날은 0시로 보고 읽는다: 지금 시각보다 이른 시각을 다음 날로 미루지 않게
 */
export function resolveEventLine(line: string, now: number, day?: unknown): EventLine {
  const picked =
    typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && localDay(dayStartMs(day)) === day
      ? day
      : undefined;
  const base = picked ?? localDay(now);
  const minute = base === localDay(now) ? minuteOf(now) : 0;
  // 알림 말("1시간 전에 알려줘")은 먼저 뗀다
  const { rest: text, remind } = splitRemind(line);
  // 일정 탭에서는 날짜만 적어도 된다: "내일 제주도 여행"은 종일, "10/10-10/12 제주도"는 여러 날 종일.
  // (빠른 입력은 시각이 있어야 일정이다. 거기서 날짜만 있으면 할 일 마감)
  const repeatTodo = parseTodoLine(text, base, minute);
  const repeat: EventRepeat | undefined =
    repeatTodo.dueMin !== null &&
    (repeatTodo.repeat === 'daily' || repeatTodo.repeat === 'weekdays' || repeatTodo.repeat === 'weekly')
      ? repeatTodo.repeat
      : undefined;
  // 달력에서 고른 날이면 날짜도 시각도 없는 글("장보기")은 그날 종일. "오늘" 을 붙여 읽어
  // 시각처럼 보이는 말("25시 회의")은 종일로 넣지 않고 되묻는 규칙을 그대로 쓴다
  const eventText = repeat
    ? `${String(Math.floor((repeatTodo.dueMin ?? 0) / 60)).padStart(2, '0')}:${String((repeatTodo.dueMin ?? 0) % 60).padStart(2, '0')} ${repeatTodo.title}`
    : text;
  const eventBase = repeat ? (repeatTodo.due ?? base) : base;
  const ev =
    parseEventInput(eventText, eventBase, repeat ? 0 : minute) ??
    (!repeat && picked ? parseEventInput(`오늘 ${text}`, base, minute) : null);
  if (!ev || (repeat && 'allDay' in ev) || (repeatTodo.repeat && !repeat))
    return { ok: false, repeatWord: !!repeatTodo.repeat };
  return { ok: true, ev, repeat, remind };
}
