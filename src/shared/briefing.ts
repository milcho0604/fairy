// 오늘 브리핑 (v1). 그날 처음 컴퓨터 앞에 앉았을 때(아침 5시 이후) 한 번, 펫이 말풍선으로 알려 준다.
// 수다 빈도 "조용히"면 하지 않는다 (기획서 "수다 빈도" 표).
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
