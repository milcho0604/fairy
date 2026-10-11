// 빠른 입력과 패널이 넘긴 값에서 미리 알림, 할 일 마감 시각 읽기 (8판).
// 알림 말 떼기는 remind.ts takeRemind, 시각 읽기는 일정 한 줄과 같은 parseQuickEvent 를 쓴다.
import { plusDays } from './day.ts';
import { parseQuickEvent } from './event-store.ts';
import { hasDeadlineWord, parseQuickTodo, type QuickTodo } from './quick-add.ts';
import { MAX_REMINDS, type RemindSpec, resolveSpecs, takeRemind } from './remind.ts';
import { isDueMin, isRepeat, type Repeat } from './todo-store.ts';

export interface QuickTodoTimed extends QuickTodo {
  /** 마감 시각 (하루 안의 분). "3시까지 보고서", "report by 5pm" */
  dueMin: number | null;
}

/** 영어 마감 낱말이 제목 끝에 남으면 뗀다 ("report by 5pm" 의 시각을 읽고 남은 "report by") */
const EN_DEADLINE_TAIL = /\s+(?:by|until|due|before)$/i;
const MIDNIGHT = /자정|\bmidnight\b/i;

/**
 * 할 일 한 줄. parseQuickTodo 에 더해 마감 시각("내일 3시까지 보고서", "보고서 오후 5시까지", "report by 5pm")을 읽는다.
 * 시각은 마감 낱말(까지, by, until, due)이 있을 때만: "3시 회의"는 일정이고, 반복 할 일의 시각은 제목에 남긴다(7판과 같다)
 */
export function parseTodoLine(text: string, today: string, nowMinute: number): QuickTodoTimed {
  const parsed = parseQuickTodo(text, today);
  if (parsed.repeat || !hasDeadlineWord(text)) return { ...parsed, dueMin: null };
  const ev = parseQuickEvent(text, today, nowMinute);
  if (!ev || ev.durationMin !== null) return { ...parsed, dueMin: null };
  const inner = parseQuickTodo(ev.title.replace(EN_DEADLINE_TAIL, ''), today);
  if (!inner.title) return { ...parsed, dueMin: null };
  // "자정까지", "by midnight" 는 그날 밤 11시 59분 (다음 날 0시로 두면 마감이 "내일 오전 12:00" 으로 보였다)
  const midnight = ev.minute === 0 && MIDNIGHT.test(text);
  return {
    title: inner.title,
    due: midnight ? plusDays(ev.day, -1) : ev.day,
    important: parsed.important || inner.important,
    repeat: null,
    dueMin: midnight ? 24 * 60 - 1 : ev.minute,
  };
}

/** 한 줄에서 뗀 알림 말 */
export type TakenRemind = { specs: RemindSpec[]; none: boolean } | null;

/** 한 줄에서 알림 말을 뗀다. 남은 글(rest)로 일정이나 할 일을 읽는다 */
export function splitRemind(text: string): { rest: string; remind: TakenRemind } {
  const r = takeRemind(text);
  return r ? { rest: r.rest, remind: { specs: r.specs, none: r.none } } : { rest: text, remind: null };
}

/**
 * 뗀 알림 말을 알림 목록으로. 알림 말이 없었으면 undefined (기본 알림).
 * "알림 없이"는 빈 목록. 뜻이 없는 말만 있었으면(마감일만 있는 할 일의 "1시간 전") 기본으로
 */
export function remindsOf(remind: TakenRemind, dateOnly: boolean, minute = 0): number[] | undefined {
  if (!remind) return undefined;
  if (remind.none) return [];
  const list = resolveSpecs(remind.specs, dateOnly, minute);
  return list.length ? list : undefined;
}

/** 화면이 보낸 알림 목록: 숫자 배열만 (값 범위는 저장할 때 다듬는다) */
export function remindsInput(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length > MAX_REMINDS * 2) return undefined;
  return v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]) : undefined;
}

/** 화면이 보낸 할 일 고치기를 아는 칸만 남긴다 */
export function todoPatchInput(p: unknown): {
  title?: string;
  due?: string | null;
  important?: boolean;
  repeat?: Repeat | null;
  dueMin?: number | null;
  reminds?: number[];
} {
  if (typeof p !== 'object' || p === null) return {};
  const v = p as Record<string, unknown>;
  const reminds = remindsInput(v.reminds);
  return {
    ...(typeof v.title === 'string' ? { title: v.title } : {}),
    ...(v.due === null || (typeof v.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.due))
      ? { due: v.due as string | null }
      : {}),
    ...(typeof v.important === 'boolean' ? { important: v.important } : {}),
    ...(v.repeat === null || isRepeat(v.repeat) ? { repeat: v.repeat as Repeat | null } : {}),
    ...(v.dueMin === null || isDueMin(v.dueMin) ? { dueMin: v.dueMin as number | null } : {}),
    ...(reminds ? { reminds } : {}),
  };
}
