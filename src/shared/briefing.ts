// 오늘 브리핑 (v1). 그날 처음 컴퓨터 앞에 앉았을 때(아침 5시 이후) 한 번, 펫이 말풍선으로 알려 준다.
// 수다 빈도 "조용히"면 하지 않는다 (기획서 "수다 빈도" 표).

import type { ChatterLevel } from './chatter.ts';
import { timeLabel } from './event-store.ts';
import { t } from './i18n/index.ts';

/** 이 시각(현지, 분) 전에는 브리핑하지 않는다. 새벽에 켠 컴퓨터에 "좋은 아침"을 하지 않게. */
export const BRIEFING_FROM_MINUTE = 5 * 60;

export interface BriefingInput {
  /** 오늘 남은 일정 (시작 분, 제목), 이른 것부터. 종일 일정(allDay)은 시각 없이 "오늘 종일: ..." 로 먼저 말한다 */
  events: { minute: number; title: string; allDay?: boolean }[];
  /** 마감이 오늘인 안 끝낸 할 일 수 */
  dueToday: number;
  /** 마감이 지난 안 끝낸 할 일 수 */
  overdue: number;
  /** 하루 중 지금 분 (인사말용) */
  nowMinute: number;
}

function greeting(minute: number): string {
  if (minute < 11 * 60) return t('briefing.hi.morning');
  if (minute < 17 * 60) return t('briefing.hi.day');
  return t('briefing.hi.evening');
}

export function briefingText(b: BriefingInput): string {
  return `${greeting(b.nowMinute)} ${briefingBody(b)}`;
}

/**
 * 인사 없는 브리핑 (만나는 시간의 맞이 인사 뒤에 붙인다). 아무것도 없으면 empty 글
 * (기본은 "일정도 마감도 없어", 쉬는 날 한마디처럼 덧붙일 것이 없으면 빈 글을 넘긴다)
 */
export function briefingBody(b: Omit<BriefingInput, 'nowMinute'>, empty = t('briefing.nothing')): string {
  const parts: string[] = [];
  const allDay = b.events.filter((e) => e.allDay);
  if (allDay.length > 0) {
    // 둘까지 이름을 말하고 나머지는 수로 ("오늘 종일: 제주도 여행, 엄마 생일 외 1개.")
    const more = allDay.length - 2;
    const list =
      allDay
        .slice(0, 2)
        .map((e) => e.title)
        .join(', ') + (more > 0 ? t('briefing.due.more', { n: more }) : '');
    parts.push(t('briefing.allDay', { list }));
  }
  const timed = b.events.filter((e) => !e.allDay);
  const first = timed[0];
  if (first) {
    parts.push(
      timed.length === 1
        ? t('briefing.oneEvent', { time: timeLabel(first.minute), title: first.title })
        : t('briefing.events', { n: timed.length, time: timeLabel(first.minute), title: first.title }),
    );
  }
  if (b.dueToday > 0 || b.overdue > 0) {
    const due = b.dueToday > 0 ? t('briefing.dueToday', { n: b.dueToday }) : '';
    const late = b.overdue > 0 ? t('briefing.overdue', { n: b.overdue }) : '';
    parts.push(t('briefing.todos', { list: [due, late].filter(Boolean).join(', ') }));
  }
  return parts.length === 0 ? empty : parts.join(' ');
}

// ---- 하루 회고 (v2) ----

export interface ReviewInput {
  doneTitles: readonly string[];
  /** 오늘 마감인데 안 끝낸 할 일 수 */
  leftToday: number;
}

/** 퇴근 때 말풍선. 끝낸 일을 칭찬하고, 남은 오늘 마감이 있으면 내일로 넘길지 묻는다 */
export function reviewText(r: ReviewInput): string {
  const n = r.doneTitles.length;
  const done =
    n === 0
      ? t('briefing.review.none')
      : n === 1
        ? t('briefing.review.one', { title: r.doneTitles[0] ?? '' })
        : t('briefing.review.many', { n });
  return r.leftToday > 0 ? `${done} ${t('briefing.review.left', { n: r.leftToday })}` : done;
}

/**
 * 회고 "내일로 넘기기" 되돌리기: 넘긴 할 일 중 아직 열려 있고 마감이 그대로 내일인 것만 원래 마감으로.
 * 그사이 끝냈거나, 지웠거나, 손으로 마감을 바꾼 것은 둔다
 */
export function undoMoved(
  moved: readonly { id: number; due: string | null }[],
  open: readonly { id: number; due: string | null }[],
  tomorrow: string,
): { id: number; due: string | null }[] {
  const now = new Map(open.map((t) => [t.id, t.due]));
  return moved.filter((m) => now.get(m.id) === tomorrow);
}

// ---- 오늘 마감 알림 (기획서 "수다 빈도" 마감 알림: 보통은 마감 당일 한 번, 수다쟁이는 오전과 오후) ----

export type DueSlot = 'am' | 'pm';

/** 오전 알림은 이 시각부터 오후 알림 전까지 (수다쟁이만) */
export const DUE_AM_FROM = 10 * 60;
/** 오후 알림. 보통은 14시, 수다쟁이는 15시부터. 하루 회고 시각 전까지만 (회고가 남은 마감을 묻는다) */
export const DUE_PM_FROM: Record<'normal' | 'chatty', number> = { normal: 14 * 60, chatty: 15 * 60 };

/** 지금 분에 해당하는 마감 알림 칸. 조용히거나 칸 밖이면 undefined */
export function dueSlot(minute: number, level: ChatterLevel, reviewMinute: number): DueSlot | undefined {
  if (level === 'quiet' || minute >= reviewMinute) return undefined;
  if (minute >= DUE_PM_FROM[level]) return 'pm';
  if (level === 'chatty' && minute >= DUE_AM_FROM) return 'am';
  return undefined;
}

/** 오늘 마감 남은 할 일 말풍선. 제목은 셋까지 */
export function deadlineText(titles: readonly string[]): string {
  const shown = titles.slice(0, 3).map((title) => `"${title}"`);
  const more = titles.length - shown.length;
  return t('briefing.due.left', {
    n: titles.length,
    list: shown.join(', ') + (more > 0 ? t('briefing.due.more', { n: more }) : ''),
  });
}
