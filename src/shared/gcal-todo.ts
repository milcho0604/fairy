// 할 일을 구글 캘린더 일정으로 바꾸기 (docs/gcal-todo-plan.md 5절, 11절). 화면, 메인, 시험이 같이 쓰는 순수한 것만.
import { plusDays } from './day.ts';
import { NO_END_MIN } from './event-overlap.ts';
import { dayIn, type GcalBody, type GcalTime } from './gcal.ts';

/** 할 일에서 보내는 칸 (단계, 메모, 코인, 반복 규칙은 보내지 않는다) */
export interface GcalTodoSource {
  title: string;
  /** 마감일 YYYY-MM-DD (현지) */
  due: string;
  /** 마감 시각 (하루 안의 분, 현지). 없으면 날짜만 */
  dueMin: number | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDueDay = (v: unknown): v is string => typeof v === 'string' && DATE.test(v);

const clock = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;

/**
 * 할 일 → 구글 일정. tz 는 이 컴퓨터 시간대, today 는 그 시간대의 오늘 (YYYY-MM-DD).
 * - 날짜만: 그날 종일 일정 (끝은 다음 날)
 * - 날짜와 시각: 그 시각부터 30분 (일정과 같다). dueMin 이 현지 시계 분이라 시각은 UTC 로 바꾸지 않고
 *   현지 시각 그대로 적고 timeZone 을 같이 준다
 * - 밀린 할 일(마감이 오늘보다 앞): 시각이 있었어도 오늘 종일 일정. 오늘 날짜가 내용에 들어가 지문이 날마다 바뀌고,
 *   그래서 하루에 한 번 저절로 옮겨진다
 * - 알림은 넣지 않는다 (페어리가 컴퓨터에서 이미 알린다): useDefault false 에 빈 목록
 * - 표식: jjakkung 과 fairyKind (가져오기가 되돌려 읽지 않게)
 */
export function todoToGoogle(t: GcalTodoSource, o: { tz: string; today: string }): GcalBody {
  let start: GcalTime;
  let end: GcalTime;
  if (t.due < o.today) {
    start = { date: o.today };
    end = { date: plusDays(o.today, 1) };
  } else if (t.dueMin === null || !Number.isInteger(t.dueMin) || t.dueMin < 0 || t.dueMin >= 1440) {
    start = { date: t.due };
    end = { date: plusDays(t.due, 1) };
  } else {
    const endMin = t.dueMin + NO_END_MIN;
    start = { dateTime: `${t.due}T${clock(t.dueMin)}`, timeZone: o.tz };
    end = {
      dateTime:
        endMin >= 1440 ? `${plusDays(t.due, 1)}T${clock(endMin - 1440)}` : `${t.due}T${clock(endMin)}`,
      timeZone: o.tz,
    };
  }
  return {
    summary: t.title.slice(0, 1024),
    start,
    end,
    reminders: { useDefault: false, overrides: [] },
    status: 'confirmed',
    extendedProperties: { private: { jjakkung: '1', fairyKind: 'todo' } },
  };
}

/** 이 시간대의 오늘 */
export const todayIn = (now: number, tz: string): string => dayIn(now, tz);

/** 처음 올릴 때 이만큼 지난 할 일까지만 올린다 (켜자마자 오래 밀린 것이 쏟아지지 않게) */
export const FIRST_SEND_BACK_DAYS = 30;
