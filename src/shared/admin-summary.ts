// 앱 운영자 칸의 요약 (이슈 #150). 서버 GET /v1/admin/overview 가 주는 큰 자료에서 요약에 쓰는 것만 읽는다.
// 서버가 더 낡아 새 칸(todo, reports, recent)이 없어도 요약은 그린다. 숫자가 아닌 값은 요약을 못 받은 것으로 본다.

import { type AdminWebPlace, isAdminWebPlace } from './admin-web.ts';
import { t } from './i18n/index.ts';

export type AdminTodoKind = 'reports' | 'budget' | 'ending_events' | 'ending_coupons';

export interface AdminTodoItem {
  kind: AdminTodoKind;
  level: 'warn' | 'bad';
  /** 건수, 예산은 쓴 비율(%), 예산 0 이면 -1 */
  n: number;
  place: AdminWebPlace;
}

export interface AdminRecentLine {
  at: number;
  actor: string;
  actorName: string | null;
  action: string;
  target: string | null;
  targetName: string | null;
}

export interface AdminSummary {
  accounts: number;
  coins: number;
  passes: number;
  costMicros: number;
  budgetMicros: number;
  reports: number;
  todo: AdminTodoItem[];
  recent: AdminRecentLine[];
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const text = (v: unknown, max = 120): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

const KINDS: readonly AdminTodoKind[] = ['reports', 'budget', 'ending_events', 'ending_coupons'];

/** 서버가 준 자료에서 요약을 뽑는다. 모양이 맞지 않으면 undefined (화면은 실패로 보인다) */
export function adminSummaryOf(raw: unknown): AdminSummary | undefined {
  const o = obj(raw);
  const s = obj(o?.summary);
  const ai = obj(o?.ai);
  if (!o || !s || !ai) return undefined;
  const accounts = num(s.accounts);
  const coins = num(s.coins);
  const passes = num(s.tickets);
  const costMicros = num(s.aiCostMicros);
  const budgetMicros = num(ai.monthlyBudgetMicros);
  if (
    accounts === undefined ||
    coins === undefined ||
    passes === undefined ||
    costMicros === undefined ||
    budgetMicros === undefined
  )
    return undefined;
  const todo: AdminTodoItem[] = [];
  for (const x of Array.isArray(o.todo) ? o.todo.slice(0, 20) : []) {
    const r = obj(x);
    const n = num(r?.n);
    if (!r || n === undefined || !KINDS.includes(r.kind as AdminTodoKind)) continue;
    todo.push({
      kind: r.kind as AdminTodoKind,
      level: r.level === 'bad' ? 'bad' : 'warn',
      n,
      place: isAdminWebPlace(r.place) ? r.place : 'home',
    });
  }
  const recent: AdminRecentLine[] = [];
  for (const x of Array.isArray(o.recent) ? o.recent.slice(0, 5) : []) {
    const r = obj(x);
    const at = num(r?.at);
    if (!r || at === undefined || typeof r.actor !== 'string' || typeof r.action !== 'string') continue;
    recent.push({
      at,
      actor: r.actor.slice(0, 120),
      actorName: text(r.actorName),
      action: r.action.slice(0, 60),
      target: text(r.target),
      targetName: text(r.targetName),
    });
  }
  const reports = num(obj(o.reports)?.total) ?? todo.find((x) => x.kind === 'reports')?.n ?? 0;
  return { accounts, coins, passes, costMicros, budgetMicros, reports, todo, recent };
}

/** 확인할 것 한 줄의 글 */
export function todoLabel(item: AdminTodoItem): string {
  switch (item.kind) {
    case 'reports':
      return t('admin.todo.reports', { n: item.n });
    case 'budget':
      return item.n < 0 ? t('admin.todo.budgetZero') : t('admin.todo.budget', { n: item.n });
    case 'ending_events':
      return t('admin.todo.endingEvents', { n: item.n });
    case 'ending_coupons':
      return t('admin.todo.endingCoupons', { n: item.n });
  }
}

/** 운영 기록의 동작 이름을 지금 말로 (모르는 이름은 코드 그대로) */
export function actionName(action: string): string {
  const key = `admin.act.${action}`;
  const text = (t as unknown as (k: string) => string)(key);
  return text === key || !text ? action : text;
}

/** 운영 기록의 "누가": 웹 운영자(세션 표시 admin:)는 지금 말로, 앱 운영자는 닉네임과 번호, 이름 없는 옛 기록은 세션 표시 그대로 */
export function whoName(l: { actor: string; actorName?: string | null }): string {
  if (l.actor.startsWith('admin:')) return t('admin.log.web');
  return l.actorName ?? l.actor;
}
