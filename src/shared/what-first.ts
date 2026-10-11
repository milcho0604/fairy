// "오늘 뭐부터 할까?" 를 AI 없이 답하기 (2026-10-11). 열린 할 일을 지난 마감 → 오늘 마감(시각이 이른 것 먼저) → 중요 →
// 곧 마감 → 오늘 아직 안 한 습관 순으로 세우고, 오늘 시각 일정 사이 빈 시간에 집중 칸 하나를 놓아 준다.
// AI 가 없거나 무료 AI(답이 약하다)일 때 채팅이 이 답을 바로 주고, 펫 우클릭 메뉴 "오늘 뭐부터?" 도 같은 답을 말풍선으로.
// 클라우드 AI 가 있으면 AI 에 묻되 이 순서를 자료로 같이 보낸다. 셈은 day-plan.ts(빈 시간, 집중 칸)를 그대로 쓴다.
import { DATA_CLOSE, DATA_OPEN, dataLine } from './ai/persona.ts';
import { plusDays } from './day.ts';
import { type FocusBlock, focusBlocks, freeGaps, type PlanEvent, planRange } from './day-plan.ts';
import { timeLabel } from './event-store.ts';
import { t } from './i18n/index.ts';

/** 답에 보여 주는 수 */
export const FIRST_TOP = 3;
/** 이 날 수 안의 마감은 "곧 마감" */
export const FIRST_SOON_DAYS = 3;

export interface FirstTodo {
  id: number;
  title: string;
  due: string | null;
  dueMin?: number | null;
  important: boolean;
  repeat?: string | null;
  createdAt: number;
}

export interface FirstHabit {
  id: number;
  title: string;
  /** habit.ts HabitStatus: 'todo' 만 오늘 할 차례 */
  status: 'done' | 'todo' | 'later';
}

export type FirstReason =
  | { kind: 'overdue'; due: string }
  | { kind: 'dueAt'; minute: number }
  | { kind: 'today' }
  | { kind: 'important' }
  | { kind: 'soon'; due: string }
  | { kind: 'habit' }
  /** 마감도 중요도 없을 때 먼저 넣은 것 하나 */
  | { kind: 'oldest' };

export interface FirstItem {
  id: number;
  title: string;
  important: boolean;
  reason: FirstReason;
}

export interface FirstPlan {
  items: FirstItem[];
  /** 다음 빈 시간의 집중 칸 (맨 위 할 일을 붙인다). 빈 시간이 없으면 없다 */
  block?: FocusBlock;
  /** 고르지 않은 열린 할 일 수 (답 끝 "그 밖에 N개") */
  more: number;
}

const GROUP: Record<FirstReason['kind'], number> = {
  overdue: 0,
  dueAt: 1,
  today: 2,
  important: 3,
  soon: 4,
  habit: 5,
  oldest: 6,
};

/** 할 일 하나의 까닭. 순서에 넣지 않을 것(마감이 멀고 중요도 아님, 반복)은 undefined */
export function firstReason(todo: FirstTodo, today: string): FirstReason | undefined {
  if (todo.repeat) return undefined;
  if (todo.due !== null && todo.due < today) return { kind: 'overdue', due: todo.due };
  if (todo.due === today)
    return typeof todo.dueMin === 'number' ? { kind: 'dueAt', minute: todo.dueMin } : { kind: 'today' };
  if (todo.important) return { kind: 'important' };
  if (todo.due !== null && todo.due <= plusDays(today, FIRST_SOON_DAYS))
    return { kind: 'soon', due: todo.due };
  return undefined;
}

/**
 * 순서: 지난 마감(오래된 것 먼저) → 오늘 시각 마감(이른 시각 먼저) → 오늘 마감 → 중요 → 곧 마감(가까운 것 먼저) →
 * 오늘 아직 안 한 습관. 같은 묶음에서는 중요가 먼저, 그다음 먼저 넣은 것. 하나도 없으면 먼저 넣은 할 일 하나
 */
export function rankFirst(
  todos: readonly FirstTodo[],
  habits: readonly FirstHabit[],
  today: string,
): FirstItem[] {
  const ranked = todos
    .flatMap((todo) => {
      const reason = firstReason(todo, today);
      return reason ? [{ todo, reason }] : [];
    })
    .sort((a, b) => {
      const g = GROUP[a.reason.kind] - GROUP[b.reason.kind];
      if (g !== 0) return g;
      const ra = a.reason;
      const rb = b.reason;
      if (ra.kind === 'dueAt' && rb.kind === 'dueAt' && ra.minute !== rb.minute) return ra.minute - rb.minute;
      const da = a.todo.due ?? '9999';
      const db = b.todo.due ?? '9999';
      if (da !== db) return da.localeCompare(db);
      return Number(b.todo.important) - Number(a.todo.important) || a.todo.createdAt - b.todo.createdAt;
    })
    .map(({ todo, reason }) => ({ id: todo.id, title: todo.title, important: todo.important, reason }));
  const habitItems = habits
    .filter((h) => h.status === 'todo')
    .map((h) => ({ id: h.id, title: h.title, important: false, reason: { kind: 'habit' } as const }));
  const out: FirstItem[] = [...ranked, ...habitItems];
  if (out.length > 0) return out;
  const oldest = todos.filter((todo) => !todo.repeat).sort((a, b) => a.createdAt - b.createdAt)[0];
  return oldest
    ? [{ id: oldest.id, title: oldest.title, important: oldest.important, reason: { kind: 'oldest' } }]
    : [];
}

/** 오늘 남은 시각 일정 사이 빈 시간 (아침 계획과 같은 범위: 지금이나 9시부터 하루 마무리까지) */
export function todayGaps(events: readonly PlanEvent[], dayStart: number, now: number, endMinute: number) {
  const { from, to } = planRange(dayStart, now, endMinute);
  const left = events.filter((ev) => !ev.allDay && (ev.endAt ?? ev.startAt) >= now);
  return freeGaps(left, from, to);
}

/** 순서와 집중 칸. 맨 위 할 일을 다음 빈 시간에 (습관도 칸에 붙인다: 집중을 그 할 일로 시작한다) */
export function planFirst(o: {
  todos: readonly FirstTodo[];
  habits: readonly FirstHabit[];
  events: readonly PlanEvent[];
  today: string;
  dayStart: number;
  now: number;
  endMinute: number;
}): FirstPlan {
  const all = rankFirst(o.todos, o.habits, o.today);
  const items = all.slice(0, FIRST_TOP);
  const top = items[0];
  const block = focusBlocks(todayGaps(o.events, o.dayStart, o.now, o.endMinute), top ? [top.id] : [], 1)[0];
  const open =
    o.todos.filter((todo) => !todo.repeat).length + o.habits.filter((h) => h.status === 'todo').length;
  return { items, ...(block ? { block } : {}), more: Math.max(0, open - items.length) };
}

// ---- 질문 알아듣기 ----

// 한국어: "오늘 뭐부터 할까", "뭐 먼저 해", "무엇부터 하면 돼?", "어떤 일부터 할까", "오늘 우선순위 정해 줘".
// "이 책 뭐부터 읽을까" 처럼 다른 것을 묻는 말은 고르지 않는다: 하다 동사가 있어야 하고, 길면 오늘, 할 일 같은 말도 있어야 한다
const KO_WHAT_FIRST =
  /(?:뭐|뭘|무엇|무얼|어떤 ?(?:것|거|걸|일))(?:을|를)? ?(?:부터|먼저|우선) ?(?:하|할|해|처리|시작)/;
const KO_PRIORITY = /우선 ?순위|뭐 ?(?:해야|하지|할까)/;
const KO_ABOUT_DAY = /오늘|지금|할 ?일|하루|투두|일정/;
// 영어: "what should I do first", "what should I do today", "what do I start with", "what to do first",
// "where should I start today", "help me prioritize my day"
const EN_WHAT_FIRST = [
  /\bwhat (?:should|shall|do|can|must) i (?:do|work on|start(?: with)?|tackle|focus on|begin(?: with)?)(?: first| today| now| next)\b/i,
  /\bwhat (?:to do|should come|comes) first\b/i,
  /\bwhat(?:'s| is) (?:first|next|my top priority)(?: today| on my (?:list|plate))?\s*\??$/i,
  /\bwhere (?:should|do|shall) i (?:start|begin)(?: today)?\s*\??$/i,
  /\bprioriti[sz]e (?:my |the )?(?:day|today|to-?dos|tasks|list)\b/i,
];

/** "오늘 뭐부터 할까?" 같은 물음인지 (한국어, 영어) */
export function isWhatFirstQuestion(text: string): boolean {
  const q = text.trim().replace(/\s+/g, ' ');
  if (!q || q.length > 80) return false;
  if (EN_WHAT_FIRST.some((re) => re.test(q))) return true;
  const short = q.replace(/[\s?？!.~]/g, '').length <= 12;
  if (KO_WHAT_FIRST.test(q)) return short || KO_ABOUT_DAY.test(q);
  return KO_PRIORITY.test(q) && KO_ABOUT_DAY.test(q);
}

// ---- 말 ----

/** 까닭 한마디: "마감 지남", "오후 3:00 마감", "중요". 중요 표시가 있으면 뒤에 붙인다 */
export function reasonText(item: FirstItem, today: string): string {
  const r = item.reason;
  const main =
    r.kind === 'overdue'
      ? t('first.why.overdue')
      : r.kind === 'dueAt'
        ? t('first.why.dueAt', { time: timeLabel(r.minute) })
        : r.kind === 'today'
          ? t('first.why.today')
          : r.kind === 'important'
            ? t('first.why.important')
            : r.kind === 'soon'
              ? r.due === plusDays(today, 1)
                ? t('first.why.tomorrow')
                : t('first.why.soon', { m: Number(r.due.slice(5, 7)), d: Number(r.due.slice(8, 10)) })
              : r.kind === 'habit'
                ? t('first.why.habit')
                : t('first.why.oldest');
  return item.important && r.kind !== 'important' ? `${main}, ${t('first.why.important')}` : main;
}

const localMinute = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/** 채팅 답 (마크다운). 순서 셋과 까닭, 다음 빈 시간의 집중 칸 */
export function firstAnswer(plan: FirstPlan, today: string, minuteOf = localMinute): string {
  if (plan.items.length === 0) return t('first.none');
  const lines = [t('first.head')];
  plan.items.forEach((item, i) => {
    lines.push(`${i + 1}. **${item.title.replace(/[*_`[\]]/g, '')}** · ${reasonText(item, today)}`);
  });
  if (plan.more > 0) lines.push(t('first.more', { n: plan.more }));
  lines.push('');
  const top = plan.items[0];
  if (plan.block && top) {
    const min = Math.round((plan.block.end - plan.block.start) / 60_000);
    lines.push(
      t('first.block', {
        from: timeLabel(minuteOf(plan.block.start)),
        to: timeLabel(minuteOf(plan.block.end)),
        title: top.title,
        min,
      }),
    );
  } else lines.push(t('first.noGap'));
  return lines.join('\n');
}

/** 펫 말풍선용 짧은 글 */
export function firstBubble(plan: FirstPlan, today: string): string {
  const [a, b, c] = plan.items;
  if (!a) return t('first.none');
  const rest = [b, c].filter((x): x is FirstItem => !!x).map((x) => x.title);
  return t('first.bubble', { title: a.title, why: reasonText(a, today), rest: rest.join(', ') });
}

/** 클라우드 AI 에 질문과 같이 보내는 자료 (할 일 같이 보내기를 켰을 때만). 제목은 자료 칸 안에 */
export function firstContext(plan: FirstPlan, today: string, minuteOf = localMinute): string {
  if (plan.items.length === 0) return '';
  const lines = [t('first.ctx.head'), DATA_OPEN];
  plan.items.forEach((item, i) => {
    lines.push(`${i + 1}. ${dataLine(item.title)} (${reasonText(item, today)})`);
  });
  if (plan.block)
    lines.push(
      t('first.ctx.free', {
        from: timeLabel(minuteOf(plan.block.start)),
        to: timeLabel(minuteOf(plan.block.end)),
      }),
    );
  lines.push(DATA_CLOSE);
  return `${lines.join('\n')}\n`;
}
