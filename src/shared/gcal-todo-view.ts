// 할 일을 구글 캘린더에 올리기: 설정 칸과 시트가 보일 것을 상태(GcalStatus.todos)에서 정한다.
// 순수한 것만 (화면, 시험이 같이 쓴다). 글은 화면이 i18n 키로 바꾼다 (docs/gcal-todo-plan.md 2절, 4절, 9절).
import type { GcalGrantProblem, GcalProblem, GcalStatus } from './gcal.ts';
import { canPush, type GcalCalendar } from './gcal-cals.ts';

export type GcalTodos = NonNullable<GcalStatus['todos']>;

/** 글 키 (i18n/gcal.ts) */
export type GrantKey = `gcal.todo.grant.${GcalGrantProblem}`;
export type ProblemKey = `gcal.problem.${GcalProblem}`;
export type LineKey =
  | GrantKey
  | ProblemKey
  | 'gcal.todo.gone'
  | 'gcal.todo.extras'
  | 'gcal.todo.state.pending'
  | 'gcal.todo.state.sent'
  | 'gcal.todo.state.idle';

/** 화면에 보일 한 줄: i18n 키와 끼울 값. warn 이면 붉은 글씨 */
export interface TodoLine {
  key: LineKey;
  params?: { n: number };
  warn: boolean;
}

export interface TodoView {
  on: boolean;
  /** 켜져 있을 때 올린 개수 줄 (꺼져 있으면 없음) */
  status: TodoLine | null;
  /** 문제와 안내 줄 (위에서부터) */
  notes: TodoLine[];
  /** 쓰던 페어리 할 일 캘린더가 구글에서 없어졌다: "다시 만들기" */
  recreate: boolean;
  /** 정본 말고 남은 캘린더 수 (1 이상이면 "남는 것 지우기") */
  extras: number;
  /** "구글에 올린 할 일도 지우기" 를 보일지 */
  removeSent: boolean;
  /** 올리는 곳: 페어리 캘린더인지, 고른 캘린더인지 (켜져 있고 정해졌을 때만) */
  where: 'fairy' | 'pick' | null;
}

/** 새 권한 받기가 막힌 까닭 → 글 키 */
export const grantKey = (p: GcalGrantProblem): GrantKey => `gcal.todo.grant.${p}`;

/** 이 까닭이면 "기존 캘린더에 올리기" 를 권한다 (새 캘린더 만들기 권한이 없다) */
export const suggestsPick = (p: GcalGrantProblem | null | undefined): boolean => p === 'noApp';

/** 보내기 문제 → 글 키 (연결 쪽 문제 글을 같이 쓴다) */
export const problemKey = (p: GcalProblem): ProblemKey => `gcal.problem.${p}`;

export function todoView(todos: GcalTodos | undefined): TodoView {
  if (!todos) {
    return { on: false, status: null, notes: [], recreate: false, extras: 0, removeSent: false, where: null };
  }
  const notes: TodoLine[] = [];
  if (todos.grant) notes.push({ key: grantKey(todos.grant), warn: true });
  const gone = todos.target === 'fairy' && todos.fairy === 'gone';
  if (gone) notes.push({ key: 'gcal.todo.gone', warn: true });
  const extras = Math.max(0, todos.extras ?? 0);
  if (extras > 0) notes.push({ key: 'gcal.todo.extras', params: { n: extras }, warn: true });
  if (todos.problem) notes.push({ key: problemKey(todos.problem), warn: true });

  let status: TodoLine | null = null;
  if (todos.on && !gone) {
    status =
      todos.pending > 0
        ? { key: 'gcal.todo.state.pending', params: { n: todos.pending }, warn: false }
        : todos.sent > 0
          ? { key: 'gcal.todo.state.sent', params: { n: todos.sent }, warn: false }
          : { key: 'gcal.todo.state.idle', warn: false };
  }
  const hasFairyCal = todos.target === 'fairy' && !!todos.calendarId;
  return {
    on: todos.on,
    status,
    notes,
    recreate: gone,
    extras,
    removeSent: todos.sent > 0 || hasFairyCal,
    where: todos.on && todos.calendarId && !gone ? todos.target : null,
  };
}

/** 올릴 곳을 고른 뒤 결과: ok(켜도 된다), problem(막혔다: 시트에 까닭을 보인다), none(아무 일도 안 됨: 취소) */
export function chooseOutcome(
  v: Pick<GcalStatus, 'connected' | 'connecting' | 'todos'>,
  want: 'fairy' | 'pick',
): 'ok' | 'problem' | 'none' {
  const t = v.todos;
  if (!t || !v.connected) return 'none';
  if (t.grant) return 'problem';
  if (v.connecting) return 'none';
  return t.target === want && t.calendarId ? 'ok' : 'none';
}

/** "기존 캘린더에 올리기" 에서 고를 수 있는 캘린더: 쓰기 권한이 있고 페어리 할 일 전용이 아닌 것 */
export const pickable = (cals: readonly GcalCalendar[] | null | undefined): GcalCalendar[] =>
  (cals ?? []).filter((c) => canPush(c) && c.fairy !== true);

/** 고른 캘린더가 일정 보내기 캘린더와 같아서 일정과 섞이는가 */
export const mixesWithEvents = (pickId: string, s: Pick<GcalStatus, 'push' | 'calendarId'>): boolean =>
  s.push && s.calendarId === pickId;

/** 올린 할 일 지우기 확인 글 키: 페어리 캘린더면 캘린더째, 고른 캘린더면 올린 할 일만 */
export const removeSentBodyKey = (
  target: 'fairy' | 'pick',
): 'gcal.todo.removeSentBody.fairy' | 'gcal.todo.removeSentBody.pick' =>
  target === 'fairy' ? 'gcal.todo.removeSentBody.fairy' : 'gcal.todo.removeSentBody.pick';
