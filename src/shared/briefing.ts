// 오늘 브리핑 (v1). 그날 처음 컴퓨터 앞에 앉았을 때(아침 5시 이후) 한 번, 펫이 말풍선으로 알려 준다.
// 수다 빈도 "조용히"면 하지 않는다 (기획서 "수다 빈도" 표).
import { timeLabel } from './event-store.ts';

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
  if (minute < 11 * 60) return '좋은 아침!';
  if (minute < 17 * 60) return '안녕!';
  return '왔구나!';
}

export function briefingText(b: BriefingInput): string {
  const parts: string[] = [];
  const first = b.events[0];
  if (first) {
    parts.push(
      b.events.length === 1
        ? `오늘 일정은 ${timeLabel(first.minute)} ${first.title} 하나야.`
        : `오늘 일정 ${b.events.length}개, 첫 일정은 ${timeLabel(first.minute)} ${first.title}.`,
    );
  }
  if (b.dueToday > 0 || b.overdue > 0) {
    const due = b.dueToday > 0 ? `오늘 마감 ${b.dueToday}개` : '';
    const late = b.overdue > 0 ? `지난 마감 ${b.overdue}개` : '';
    parts.push(`할 일은 ${[due, late].filter(Boolean).join(', ')} 있어.`);
  }
  if (parts.length === 0) parts.push('오늘은 일정도 마감도 없어. 하고 싶은 걸 적어 봐.');
  return `${greeting(b.nowMinute)} ${parts.join(' ')}`;
}
