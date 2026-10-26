// 하루 도구 (2026-10-11): 습관 체크, 아침 계획, 방금 울린 알림 미루기, 내보내기. 패널과 설정 창이 쓴다.
// 패널 상태(PanelState)에 넣지 않고 따로 묻는다: 패널은 상태가 바뀔 때마다 다시 묻는다.
import type { DayPlan, Gap, PlanPrefs, PlanTodo } from './day-plan.ts';
import type { ExportKind } from './export.ts';
import type { Habit } from './habit.ts';
import type { SnoozeChoice } from './snooze.ts';

export const DAY = {
  habits: 'day:habits',
  plan: 'day:plan',
  planSave: 'day:plan-save',
  planPolish: 'day:plan-polish',
  planPrefs: 'day:plan-prefs',
  /** 패널이 계획 화면을 저절로 띄웠다 (그날 다시 띄우지 않게) */
  planShown: 'day:plan-shown',
  /** 메인 → 패널: 계획 화면을 띄워 줘 (펫 아침 한마디 "같이 정하기") */
  openPlan: 'day:open-plan',
  remind: 'day:remind',
  remindSnooze: 'day:remind-snooze',
  remindDismiss: 'day:remind-dismiss',
} as const;

export const DATA_EXPORT = {
  run: 'export:run',
} as const;

export interface HabitView {
  today: string;
  habits: Habit[];
}

/** 고를 거리에 붙는 까닭 (작은 꼬리표) */
export type PickReason = 'overdue' | 'today' | 'soon' | 'important';

export interface PlanView {
  today: string;
  prefs: PlanPrefs;
  /** 오늘 정한 계획 (없으면 아직) */
  plan?: DayPlan;
  /** 고를 거리 (점수 순) */
  candidates: (PlanTodo & { reason?: PickReason })[];
  /** 먼저 골라 둔 것 */
  suggested: number[];
  /** 오늘 남은 시각 일정 사이 빈 시간 */
  gaps: Gap[];
  /** 오늘 남은 시각 일정 (빈 시간을 이해하게) */
  events: { title: string; startAt: number; endAt: number | null }[];
  /** 지금 계획 화면을 띄울지 (아침 첫 열기, 펫 한마디로 열었음) */
  autoOpen: boolean;
  /** 펫이 사용자의 명시적 요청으로 연 것. 할 일이 없어도 입력 칸이 있는 계획 창을 띄운다. */
  manualOpen: boolean;
  /** 쓸 수 있는 AI 이름. 없으면 다듬기 단추를 숨긴다 */
  ai?: string;
}

export type PolishResult =
  | { ok: true; picks: number[]; why?: string }
  | { ok: false; error: 'none' | 'fail' | 'locked' };

export interface RecentRemind {
  titles: string[];
  at: number;
  choices: SnoozeChoice[];
}

export interface DayBridge {
  habits(): Promise<HabitView>;
  /** auto 면 지금 저절로 띄울지(autoOpen)도 본다 (패널마다 한 곳, 계획 화면 자리만 부른다) */
  plan(auto?: boolean): Promise<PlanView>;
  /** 꼭 할 일 저장 (집중 칸은 메인이 다시 놓는다). 저장한 계획 */
  planSave(picks: number[], note?: string): Promise<DayPlan | undefined>;
  planPolish(picks: number[]): Promise<PolishResult>;
  planPrefs(prefs: PlanPrefs): Promise<PlanPrefs>;
  planShown(): void;
  onOpenPlan(listener: () => void): void;
  remind(): Promise<RecentRemind | undefined>;
  /** 다시 울릴 때. 못 미뤘으면 undefined */
  remindSnooze(choice: SnoozeChoice): Promise<number | undefined>;
  remindDismiss(): void;
}

export type ExportResult = { ok: true; n: number; path: string } | { ok: false; error: 'failed' | 'nothing' };

export interface ExportBridge {
  /** 저장 대화상자를 띄워 내보낸다. 고르지 않고 닫았으면 undefined */
  run(kind: ExportKind): Promise<ExportResult | undefined>;
}

/** 계획 고를 거리의 까닭 */
export function pickReason(todo: PlanTodo, today: string, soon: string): PickReason | undefined {
  if (todo.due !== null && todo.due < today) return 'overdue';
  if (todo.due === today) return 'today';
  if (todo.due !== null && todo.due <= soon) return 'soon';
  return todo.important ? 'important' : undefined;
}
