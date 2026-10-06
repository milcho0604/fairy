// 빠른 입력 한 줄을 할 일로 (P2-04). "내일 보고서 쓰기!" → 제목 "보고서 쓰기", 마감 내일, 중요.
// 반복(v1): "매일 운동", "평일 스탠드업", "매주 주간 보고" → 반복 할 일, 마감 오늘(평일은 다음 평일).
import type { Repeat } from './todo-store.ts';

export interface QuickTodo {
  title: string;
  due: string | null;
  important: boolean;
  repeat: Repeat | null;
}

const REPEAT_WORDS: Record<string, Repeat> = { 매일: 'daily', 평일: 'weekdays', 매주: 'weekly' };

const DAY_WORDS: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2 };

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, (d ?? 1) + n));
  return t.toISOString().slice(0, 10);
}

/** today 는 현지 날짜 YYYY-MM-DD. 날짜 낱말은 맨 앞이나 맨 끝에 있을 때만 날짜로 본다 ("오늘의 메모"는 제목). */
export function parseQuickTodo(text: string, today: string): QuickTodo {
  let rest = text.replace(/\s+/g, ' ').trim();
  let important = false;
  while (rest.endsWith('!') || rest.startsWith('!')) {
    important = true;
    rest = rest.replace(/^!+|!+$/g, '').trim();
  }
  let repeat: Repeat | null = null;
  for (const [word, r] of Object.entries(REPEAT_WORDS)) {
    if (rest.startsWith(`${word} `)) {
      repeat = r;
      rest = rest.slice(word.length + 1);
      break;
    }
  }
  let due: string | null = null;
  for (const [word, n] of Object.entries(DAY_WORDS)) {
    if (rest.startsWith(`${word} `) || rest.startsWith(`${word}까지 `)) {
      due = addDays(today, n);
      rest = rest.replace(new RegExp(`^${word}(까지)? `), '');
      break;
    }
    if (rest.endsWith(` ${word}`) || rest.endsWith(` ${word}까지`)) {
      due = addDays(today, n);
      rest = rest.replace(new RegExp(` ${word}(까지)?$`), '');
      break;
    }
  }
  if (repeat && !due) {
    due = today;
    if (repeat === 'weekdays')
      while ([0, 6].includes(new Date(`${due}T00:00:00Z`).getUTCDay())) due = addDays(due, 1);
  }
  return { title: rest.trim(), due, important, repeat };
}

/** 마감일을 사람 말로: 오늘, 내일, 어제까지, 10월 5일. */
export function dueLabel(due: string, today: string): { text: string; overdue: boolean } {
  if (due === today) return { text: '오늘', overdue: false };
  if (due === addDays(today, 1)) return { text: '내일', overdue: false };
  if (due < today)
    return { text: `${Number(due.slice(5, 7))}월 ${Number(due.slice(8, 10))}일 지남`, overdue: true };
  return { text: `${Number(due.slice(5, 7))}월 ${Number(due.slice(8, 10))}일`, overdue: false };
}
