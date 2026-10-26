// 아침 계획 같이 세우기 (2026-10-11). 열린 할 일에서 "꼭 할 일"을 셋까지 고르고(마감과 중요로 먼저 골라 준다),
// 오늘 시각 일정 사이 빈 시간에 집중 칸을 놓아 준다. AI 없이 규칙으로 돈다. AI 가 있으면 고른 것을 다듬어 달라고 할 수 있다.
// 계획은 그날만 쓴다 (사용자 데이터 폴더 day-plan.json). 저장 파일(SQLite) 판은 바꾸지 않는다.
import { plusDays } from './day.ts';
import { spanEnd } from './event-overlap.ts';

/** 꼭 할 일은 셋까지 */
export const PLAN_PICKS = 3;
/** 고를 거리로 보여 주는 수 */
export const PLAN_CANDIDATES = 12;
/** 이보다 짧은 빈 시간에는 집중 칸을 놓지 않는다 (분) */
export const GAP_MIN = 25;
/** 집중 칸 길이 (분). 집중 타이머의 가장 긴 길이와 같다 */
export const BLOCK_MIN = 50;
/** 집중 칸 뒤 쉬는 틈, 일정 앞뒤 여유 (분) */
export const BREAK_MIN = 10;
export const BUFFER_MIN = 5;
/** 일 시작 (분). 이보다 일찍 계획하면 여기부터 칸을 놓는다 */
export const WORK_START_MIN = 9 * 60;
/** 아침에 저절로 띄우는 것은 이 시각까지 (점심 넘어 처음 연 패널에 "아침 계획"을 띄우지 않는다) */
export const AUTO_UNTIL_MIN = 13 * 60;

export interface PlanTodo {
  id: number;
  title: string;
  due: string | null;
  dueMin?: number | null;
  important: boolean;
  repeat?: string | null;
  createdAt: number;
}

export interface PlanEvent {
  title: string;
  startAt: number;
  endAt: number | null;
  allDay: boolean;
}

export interface Gap {
  start: number;
  end: number;
}

export interface FocusBlock {
  start: number;
  end: number;
  /** 이 칸에 할 꼭 할 일 */
  todoId?: number;
}

export interface DayPlan {
  day: string;
  picks: number[];
  blocks: FocusBlock[];
  /** AI 가 다듬으며 남긴 한 줄 */
  note?: string;
  at: number;
}

export interface PlanPrefs {
  /** 아침에 처음 패널을 열면 계획 화면을 띄운다 (펫도 한 번 묻는다) */
  auto: boolean;
  /** 이 시각(분) 뒤 처음일 때 */
  fromMinute: number;
}

export const PLAN_PREFS: PlanPrefs = { auto: true, fromMinute: 8 * 60 };

export interface PlanFile {
  plan?: DayPlan;
  prefs: PlanPrefs;
  /** 계획 화면을 저절로 띄운 날 (하루 한 번) */
  shownDay?: string;
  /** 펫이 물어본 날 (하루 한 번) */
  nudgedDay?: string;
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** 저장 파일 읽기. 모양이 틀린 칸은 버린다 */
export function parsePlanFile(raw: unknown): PlanFile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p = (r.prefs && typeof r.prefs === 'object' ? r.prefs : {}) as Record<string, unknown>;
  const prefs: PlanPrefs = {
    auto: typeof p.auto === 'boolean' ? p.auto : PLAN_PREFS.auto,
    fromMinute:
      Number.isInteger(p.fromMinute) && (p.fromMinute as number) >= 0 && (p.fromMinute as number) < 1440
        ? (p.fromMinute as number)
        : PLAN_PREFS.fromMinute,
  };
  const out: PlanFile = { prefs };
  if (isDay(r.shownDay)) out.shownDay = r.shownDay;
  if (isDay(r.nudgedDay)) out.nudgedDay = r.nudgedDay;
  const plan = r.plan as Record<string, unknown> | undefined;
  if (plan && isDay(plan.day) && Array.isArray(plan.picks)) {
    const blocks = Array.isArray(plan.blocks)
      ? (plan.blocks as Record<string, unknown>[])
          .filter((b) => b && isMs(b.start) && isMs(b.end) && (b.end as number) > (b.start as number))
          .slice(0, 6)
          .map((b) => ({
            start: b.start as number,
            end: b.end as number,
            ...(isId(b.todoId) ? { todoId: b.todoId as number } : {}),
          }))
      : [];
    out.plan = {
      day: plan.day,
      picks: [...new Set(plan.picks.filter(isId))].slice(0, PLAN_PICKS),
      blocks,
      ...(typeof plan.note === 'string' && plan.note.trim() ? { note: plan.note.trim().slice(0, 300) } : {}),
      at: isMs(plan.at) ? plan.at : 0,
    };
  }
  return out;
}

/**
 * 계획 화면을 저절로 띄울지: 켜 두었고, 정한 시각 뒤 아침이고, 오늘 계획도 없고 오늘 띄운 적도 없고, 고를 할 일이 있다.
 * 고를 할 일(candidates)이 없으면 띄우지 않는다: 처음 켠 사람이 패널을 처음 열면 "아직 열린 할 일이 없어" 시트가
 * 패널을 덮었다 (2026-10-12). 띄운 것으로 치지 않아 아침에 할 일을 적으면 그때 띄운다
 */
export function shouldAutoOpen(f: PlanFile, today: string, minute: number, candidates = 1): boolean {
  if (
    candidates === 0 ||
    !f.prefs.auto ||
    minute < f.prefs.fromMinute ||
    minute >= Math.max(AUTO_UNTIL_MIN, f.prefs.fromMinute + 60)
  )
    return false;
  return f.plan?.day !== today && f.shownDay !== today;
}

/** 자동으로 띄울 때는 후보 할 일이 있어야 한다. 사용자가 직접 요청한 계획은 빈 목록이어도 연다. */
export function shouldPresentPlan(
  f: PlanFile,
  today: string,
  minute: number,
  candidates: number,
  pendingOpen: boolean,
): boolean {
  return pendingOpen || (candidates > 0 && shouldAutoOpen(f, today, minute, candidates));
}

/** 펫이 아침에 한 번 물어볼지 (같은 조건에 펫이 아직 안 물었을 때) */
export function shouldNudge(f: PlanFile, today: string, minute: number, candidates = 1): boolean {
  return shouldAutoOpen({ ...f, shownDay: undefined }, today, minute, candidates) && f.nudgedDay !== today;
}

/**
 * 꼭 할 일로 먼저 고를 점수. 지난 마감 > 오늘 마감 > 가까운 마감, 중요는 더 위. 반복 할 일(습관)은 고르지 않는다
 * (습관은 오늘 탭 습관 칸에서 따로 체크한다). 마감도 중요도 없는 것은 0 이라 맨 뒤
 */
export function pickScore(todo: PlanTodo, today: string): number {
  let s = 0;
  if (todo.due !== null) {
    if (todo.due < today) s += 50;
    else if (todo.due === today) s += 40 + (todo.dueMin !== null && todo.dueMin !== undefined ? 3 : 0);
    else if (todo.due <= plusDays(today, 3)) s += 20 - daysBetween(today, todo.due) * 3;
    else if (todo.due <= plusDays(today, 7)) s += 5;
  }
  if (todo.important) s += 30;
  return s;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 고를 거리: 반복이 아닌 열린 할 일을 점수, 마감, 먼저 넣은 순으로 */
export function planCandidates<T extends PlanTodo>(
  open: readonly T[],
  today: string,
  max = PLAN_CANDIDATES,
): T[] {
  return open
    .filter((todo) => !todo.repeat)
    .map((todo) => ({ todo, score: pickScore(todo, today) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.todo.due ?? '9999').localeCompare(b.todo.due ?? '9999') ||
        (a.todo.dueMin ?? 1440) - (b.todo.dueMin ?? 1440) ||
        a.todo.createdAt - b.todo.createdAt,
    )
    .slice(0, max)
    .map((x) => x.todo);
}

/** 먼저 골라 줄 꼭 할 일: 점수가 있는 것(마감이나 중요) 가운데 위에서 셋. 없으면 먼저 넣은 것 하나 */
export function suggestPicks(open: readonly PlanTodo[], today: string, n = PLAN_PICKS): number[] {
  const list = planCandidates(open, today);
  const scored = list.filter((todo) => pickScore(todo, today) > 0).slice(0, n);
  if (scored.length > 0) return scored.map((todo) => todo.id);
  return list.slice(0, 1).map((todo) => todo.id);
}

const MIN = 60_000;
const roundUp = (ms: number, step = 5 * MIN) => Math.ceil(ms / step) * step;

/**
 * from~to 사이 시각 일정이 없는 빈 시간. 일정 앞뒤로 BUFFER_MIN 씩 여유를 둔다. 종일 일정은 보지 않는다
 * (여행, 생일처럼 하루를 막지 않는 것이 보통이다. event-overlap.ts 와 같다). 끝이 없는 일정은 30분짜리로 본다
 */
export function freeGaps(
  events: readonly PlanEvent[],
  from: number,
  to: number,
  minMin = GAP_MIN,
  bufferMin = BUFFER_MIN,
): Gap[] {
  if (to <= from) return [];
  const busy = events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: e.startAt - bufferMin * MIN, end: spanEnd(e) + bufferMin * MIN }))
    .filter((b) => b.end > from && b.start < to)
    .sort((a, b) => a.start - b.start);
  const gaps: Gap[] = [];
  let cursor = from;
  for (const b of busy) {
    if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });
  return gaps
    .map((g) => ({ start: roundUp(g.start), end: g.end }))
    .filter((g) => g.end - g.start >= minMin * MIN);
}

/**
 * 빈 시간에 집중 칸을 놓는다: 빈 시간마다 앞에서부터 BLOCK_MIN 칸, 뒤에 BREAK_MIN 쉬고 또. 남은 것이 GAP_MIN 보다 짧으면 그만.
 * 칸마다 꼭 할 일을 차례로 하나씩 붙인다. 칸은 max 개까지 (꼭 할 일이 있으면 그 수, 없으면 하나)
 */
export function focusBlocks(gaps: readonly Gap[], picks: readonly number[], max?: number): FocusBlock[] {
  const limit = max ?? Math.max(1, Math.min(PLAN_PICKS, picks.length));
  const out: FocusBlock[] = [];
  for (const g of gaps) {
    let start = roundUp(g.start);
    while (out.length < limit && g.end - start >= GAP_MIN * MIN) {
      const len = Math.floor(Math.min(BLOCK_MIN * MIN, g.end - start) / (5 * MIN)) * 5 * MIN;
      const todoId = picks[out.length];
      out.push({ start, end: start + len, ...(todoId !== undefined ? { todoId } : {}) });
      start = roundUp(start + len + BREAK_MIN * MIN);
    }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 오늘 집중 칸을 찾을 때: 지금(5분 단위로 올림)이나 일 시작(9시) 중 늦은 때부터 하루 마무리(회고 시각)까지.
 * 이미 마무리 시각이 가까우면 밤 10시까지 본다
 */
export function planRange(dayStart: number, now: number, endMinute: number): { from: number; to: number } {
  const from = Math.max(roundUp(now), dayStart + WORK_START_MIN * MIN);
  let to = dayStart + endMinute * MIN;
  if (to - from < GAP_MIN * MIN) to = dayStart + 22 * 60 * MIN;
  return { from, to };
}

/** 지금 하고 있어야 할 집중 칸 (시작했고 안 끝났다) */
export function currentBlock(blocks: readonly FocusBlock[], now: number): FocusBlock | undefined {
  return blocks.find((b) => b.start <= now && now < b.end);
}

// ---- AI 다듬기 (선택) ----

/** AI 에게 보낼 글. 할 일 id 와 제목, 마감, 중요, 오늘 일정과 빈 시간을 준다. 답은 JSON 한 줄 */
export function polishPlanPrompt(o: {
  ask: string;
  candidates: readonly PlanTodo[];
  picks: readonly number[];
  events: readonly { time: string; title: string }[];
  gaps: readonly { time: string }[];
  today: string;
}): string {
  const todos = o.candidates.map(
    (c) =>
      `- id ${c.id}: ${c.title.slice(0, 120)}${c.due ? ` (due ${c.due})` : ''}${c.important ? ' [important]' : ''}`,
  );
  return [
    o.ask,
    '',
    `today: ${o.today}`,
    `picked: ${o.picks.join(', ') || '-'}`,
    'todos:',
    ...todos,
    'events:',
    ...(o.events.length ? o.events.map((e) => `- ${e.time} ${e.title.slice(0, 80)}`) : ['-']),
    'free:',
    ...(o.gaps.length ? o.gaps.map((g) => `- ${g.time}`) : ['-']),
    '',
    'Reply with JSON only: {"picks":[id,id,id],"why":"one short friendly sentence"}',
  ].join('\n');
}

/** AI 답 읽기: 고를 거리에 있는 id 만 셋까지, 한 줄 까닭. 못 읽으면 undefined */
export function parsePolishReply(
  answer: string | undefined,
  candidateIds: readonly number[],
): { picks: number[]; why?: string } | undefined {
  if (!answer) return undefined;
  const m = /\{[\s\S]*\}/.exec(answer);
  if (!m) return undefined;
  let v: unknown;
  try {
    // 답 안 글에 줄바꿈을 그대로 넣는 AI 가 있다 (JSON 으로는 틀린 글)
    v = JSON.parse(m[0].replace(/[\r\n]+/g, ' '));
  } catch {
    return undefined;
  }
  const r = (v && typeof v === 'object' ? v : {}) as { picks?: unknown; why?: unknown };
  if (!Array.isArray(r.picks)) return undefined;
  const known = new Set(candidateIds);
  const picks = [...new Set(r.picks.map(Number).filter((id) => known.has(id)))].slice(0, PLAN_PICKS);
  if (picks.length === 0) return undefined;
  const why =
    typeof r.why === 'string'
      ? r.why
          .replace(/[\r\n]+/g, ' ')
          .trim()
          .slice(0, 200)
      : '';
  return why ? { picks, why } : { picks };
}
