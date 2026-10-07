// 오늘 브리핑 (v1). 그날 처음 컴퓨터 앞에 앉았을 때(아침 5시 이후) 한 번, 펫이 말풍선으로 알려 준다.
// 수다 빈도 "조용히"면 하지 않는다 (기획서 "수다 빈도" 표).

import type { ChatterLevel } from './chatter.ts';
import { timeLabel } from './event-store.ts';
import { t } from './i18n/index.ts';

/** 이 시각(현지, 분) 전에는 브리핑하지 않는다. 새벽에 켠 컴퓨터에 "좋은 아침"을 하지 않게. */
export const BRIEFING_FROM_MINUTE = 5 * 60;

export interface BriefingInput {
  /** 오늘 남은 일정 (시작 분, 제목), 이른 것부터 */
  events: { minute: number; title: string }[];
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
  const parts: string[] = [];
  const first = b.events[0];
  if (first) {
    parts.push(
      b.events.length === 1
        ? t('briefing.oneEvent', { time: timeLabel(first.minute), title: first.title })
        : t('briefing.events', { n: b.events.length, time: timeLabel(first.minute), title: first.title }),
    );
  }
  if (b.dueToday > 0 || b.overdue > 0) {
    const due = b.dueToday > 0 ? t('briefing.dueToday', { n: b.dueToday }) : '';
    const late = b.overdue > 0 ? t('briefing.overdue', { n: b.overdue }) : '';
    parts.push(t('briefing.todos', { list: [due, late].filter(Boolean).join(', ') }));
  }
  if (parts.length === 0) parts.push(t('briefing.nothing'));
  return `${greeting(b.nowMinute)} ${parts.join(' ')}`;
}

// ---- 하루 회고 (v2) ----

/** 이 시각(현지, 분) 뒤 처음 자리에 있을 때 한 번. 설정에서 바꾼다 */
export const REVIEW_DEFAULT_MINUTE = 18 * 60;

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
