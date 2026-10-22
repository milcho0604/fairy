// 앱 운영자 칸의 요약 (이슈 #150). 서버 GET /v1/admin/overview 가 주는 큰 자료에서 요약에 쓰는 것만 읽는다.
// 서버가 더 낡아 새 칸(todo, reports, recent)이 없어도 요약은 그린다. 숫자가 아닌 값은 요약을 못 받은 것으로 본다.

import { type AdminWebPlace, isAdminWebPlace } from './admin-web.ts';
import { t } from './i18n/index.ts';

export type AdminTodoKind = 'reports' | 'budget' | 'ending_events' | 'ending_coupons' | 'backup';

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

/** 오늘 숫자 (서버가 한국 날짜로 센 마지막 날). 옛 서버는 주지 않는다 */
export interface AdminToday {
  signups: number;
  active: number;
  asks: number;
  costMicros: number;
}

/** 서버가 아는 백업 한 줄 (이용자가 올린 백업). 데이터베이스 덤프와 외장 디스크 사본은 서버가 알 수 없다 */
export interface AdminBackupLine {
  enabled: boolean;
  lastUploadAt: number | null;
  files: number;
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
  /** 서버가 더 낡아 새 칸이 없으면 null */
  today: AdminToday | null;
  backup: AdminBackupLine | null;
  /** 업데이트 기준으로 잠기는 계정과 서버 기능이 막히는 계정. 옛 서버, 기준이 없을 때는 null */
  locked: { force: number; restricted: number } | null;
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const text = (v: unknown, max = 120): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

const KINDS: readonly AdminTodoKind[] = ['reports', 'budget', 'ending_events', 'ending_coupons', 'backup'];

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
  // 신고 대기는 처리하지 않은 건수(pending). 옛 서버는 total(받은 전체)만 주고, 그보다 낡으면 확인할 것의 신고 줄에서 읽는다
  const rep = obj(o.reports);
  const reports = num(rep?.pending) ?? num(rep?.total) ?? todo.find((x) => x.kind === 'reports')?.n ?? 0;
  return {
    accounts,
    coins,
    passes,
    costMicros,
    budgetMicros,
    reports,
    todo,
    recent,
    today: todayOf(o.trend),
    backup: backupOf(o.backup),
    locked: lockedOf(o.versions),
  };
}

function todayOf(raw: unknown): AdminToday | null {
  const days = obj(raw)?.days;
  const last = Array.isArray(days) ? obj(days[days.length - 1]) : undefined;
  const signups = num(last?.signups);
  const active = num(last?.active);
  const asks = num(last?.asks);
  const costMicros = num(last?.costMicros);
  if (signups === undefined || active === undefined || asks === undefined || costMicros === undefined)
    return null;
  return { signups, active, asks, costMicros };
}

function backupOf(raw: unknown): AdminBackupLine | null {
  const b = obj(raw);
  const files = num(b?.files);
  if (!b || typeof b.enabled !== 'boolean' || files === undefined) return null;
  return { enabled: b.enabled, lastUploadAt: num(b.lastUploadAt) ?? null, files };
}

function lockedOf(raw: unknown): { force: number; restricted: number } | null {
  const l = obj(obj(raw)?.locked);
  const force = num(l?.locked);
  const restricted = num(l?.restricted);
  if (!l || force === undefined || restricted === undefined) return null;
  // 기준이 둘 다 없으면 잠기는 계정이 없으니 줄을 보이지 않는다
  if (typeof l.min !== 'string' && typeof l.restrict !== 'string') return null;
  return { force, restricted };
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
    case 'backup':
      return item.n < 0 ? t('admin.todo.backupZero') : t('admin.todo.backup', { n: item.n });
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
