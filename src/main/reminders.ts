// 미리 알림 말풍선 (8판). 일정과 할 일의 여러 알림을 때가 되면 펫이 말한다. 플래너가 알림 때(nextAt)에 깨어 부른다.
// 같은 때 울릴 것이 여럿이면 말풍선 하나로 묶는다 (따로 띄우면 뒤 것이 앞 것을 밀어낸다).
// 펫이 숨어 있거나(방해 금지, 발표, 숨기기), 집에서 쉬거나, 화면이 잠겼으면 펫이 모아 두었다가 나올 때 말하고(hold),
// 때가 한참 지났으면 놓친 알림에만 둔다. 'schedule' 종류라 조용히에서도 말하고 시간당 상한에 세지 않는다.
// 펫이 안 보이는 곳(맥 전체 화면 등)이면 시스템 알림으로도 한 번 (pet-window osNotify). 미룬 것은 플래너 저장 파일에 남는다.
import { bundleText, SCHEDULE_STALE_MS } from '../shared/bubble-queue.ts';
import { allDayLabel, type CalEvent, type EventStore, eventAnchor } from '../shared/event-store.ts';
import { t } from '../shared/i18n/index.ts';
import { eventLink } from '../shared/links.ts';
import { type Anchor, anchorAt, parseSnoozed, type Snoozed, snoozeFor, staleAt } from '../shared/remind.ts';
import { missedLine, type RemindItem, remindLine } from '../shared/remind-text.ts';
import {
  choiceOfAction,
  type SnoozeChoice,
  snoozeAction,
  snoozeAt,
  snoozeChoices,
} from '../shared/snooze.ts';
import { type Todo, type TodoStore, todoAnchor } from '../shared/todo-store.ts';
import type { SayOptions } from './pet-window.ts';

export interface RemindersOptions {
  events: EventStore;
  todos: TodoStore;
  say: (o: SayOptions) => Promise<string | undefined>;
  /** 회의 주소 열기 (메인이 http, https 만 다시 본다) */
  openUrl: (url: string) => void;
  /** 패널 오늘 탭 열기 (할 일 알림 "볼게") */
  openToday: () => void;
  /** 저장해 둔 미룬 알림 (플래너 저장 파일의 snoozed) */
  saved?: unknown;
  /** 미룬 알림이 바뀌었다 (플래너가 저장 파일에 적는다) */
  onSnoozedChange?: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
}

/** 말할 것 하나 */
type Due =
  | { kind: 'event'; id: number; e: CalEvent; anchor: Anchor }
  | { kind: 'todo'; id: number; todo: Todo; anchor: Anchor };

const itemOf = (d: Due): RemindItem =>
  d.kind === 'event'
    ? {
        kind: 'event',
        title: d.e.title,
        anchor: d.anchor,
        ...(d.e.allDay && d.e.endAt !== null ? { range: allDayLabel(d.e) } : {}),
      }
    : { kind: 'todo', title: d.todo.title, anchor: d.anchor };

const fromEvent = (e: CalEvent): Due => ({ kind: 'event', id: e.id, e, anchor: eventAnchor(e) });
const fromTodo = (todo: Todo): Due | undefined => {
  const anchor = todoAnchor(todo);
  return anchor ? { kind: 'todo', id: todo.id, todo, anchor } : undefined;
};

/** 말풍선으로 꺼내도 되는 마지막 때: 시각 기준은 시작 10분 뒤(7판과 같다), 날짜 기준은 그날 끝 */
/** 오늘 탭 "방금 울린 알림"은 이만큼 둔다 */
const RECENT_MS = 30 * 60_000;

const holdUntil = (a: Anchor) => (a.kind === 'time' ? a.at + SCHEDULE_STALE_MS : staleAt(a));

export function createReminders(o: RemindersOptions) {
  /** 미룬 알림. at 에 다시 말한다. 플래너 저장 파일에 남겨 앱을 다시 켜도 이어진다 (parseSnoozed) */
  let snoozed: Snoozed[] = parseSnoozed(o.saved, Date.now());

  /** 미룬 것을 다시 읽는다: 그사이 지웠거나 끝냈으면 빼고, 고쳤으면 고친 제목과 시각으로 */
  function reread(k: { kind: 'event' | 'todo'; id: number }): Due | undefined {
    if (k.kind === 'event') {
      const e = o.events.get(k.id);
      return e ? fromEvent(e) : undefined;
    }
    const todo = o.todos.get(k.id);
    return todo && todo.doneAt === null ? fromTodo(todo) : undefined;
  }

  function tick(now: number) {
    const due: Due[] = [
      ...o.events.dueReminders(now).map(fromEvent),
      ...o.todos
        .dueReminders(now)
        .map(fromTodo)
        .filter((d) => d !== undefined),
    ];
    for (const d of due) {
      if (d.kind === 'event') o.events.markNotified(d.id, now);
      else o.todos.markNotified(d.id, now);
      o.log('planner', d.kind === 'event' ? '일정 알림' : '할 일 알림', d.id);
    }
    const ready = snoozed.filter((s) => s.at <= now);
    if (ready.length > 0) {
      snoozed = snoozed.filter((s) => s.at > now);
      o.onSnoozedChange?.();
    }
    const seen = new Set(due.map((d) => `${d.kind}:${d.id}`));
    const again: Due[] = [];
    /** 사용자가 때를 골라 미룬 것 (때가 지난 할 일도 다시 말한다) */
    const kept = new Set<string>();
    for (const s of ready)
      for (const k of s.keys) {
        const key = `${k.kind}:${k.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = reread(k);
        // 그사이 때가 지나 쓸모없어졌으면 다시 말하지 않는다 (고른 때에 미룬 것은 말한다)
        if (d && (s.keep || now < holdUntil(d.anchor))) again.push(d);
        if (d && s.keep) kept.add(key);
      }
    const list = [...due, ...again].sort((a, b) => anchorAt(a.anchor) - anchorAt(b.anchor));
    if (list.length === 0) return;
    const first = list[0] as Due;
    const items = list.map(itemOf);
    const lines = items.map((it) => remindLine(it, now));
    const stale = Math.min(
      ...list.map((d) =>
        kept.has(`${d.kind}:${d.id}`)
          ? Math.max(holdUntil(d.anchor), now + 3 * SCHEDULE_STALE_MS)
          : holdUntil(d.anchor),
      ),
    );
    // 미루기 고르기 (시스템 알림 단추, 오늘 탭 "방금 울린 알림")
    const choices = snoozeChoices({ now, stale, todosOnly: list.every((d) => d.kind === 'todo') });
    const keys = list.map((d) => ({ kind: d.kind, id: d.id }));
    recent = {
      keys,
      titles: list.map((d) => (d.kind === 'event' ? d.e.title : d.todo.title)),
      at: now,
      choices,
    };
    const buttons = [{ id: 'ok', label: t('panel.remind.ok') }];
    const snoozeMs = snoozeFor(now, anchorAt(first.anchor), stale);
    if (snoozeMs !== undefined)
      buttons.push({
        id: 'snooze',
        label: snoozeMs >= 3_600_000 ? t('remind.snoozeHour') : t('panel.remind.snooze'),
      });
    // 제목에 회의 주소(Zoom, Meet, Teams 등)가 있으면 여는 단추. 여럿이면 가장 이른 일정 것
    const link = list
      .filter((d) => d.kind === 'event')
      .map((d) => eventLink(d.e.title))
      .find((l) => l !== undefined);
    // 회의면 들어가는 것이 할 일이라 맨 앞(강조 단추)에, 다른 주소는 맨 뒤에
    if (link?.meeting) buttons.unshift({ id: 'link', label: t('panel.remind.openMeeting') });
    else if (link) buttons.push({ id: 'link', label: t('panel.remind.openLink') });
    // 할 일만 있으면 패널에서 바로 볼 수 있게
    else if (list.every((d) => d.kind === 'todo')) buttons.push({ id: 'show', label: t('remind.show') });
    const act = (a: string | undefined) => {
      const choice = choiceOfAction(a);
      if (choice) {
        snooze(keys, choice);
        return;
      }
      // 확인, 미루기, 회의 열기를 눌렀으면 오늘 탭의 "방금 울린 알림"은 거둔다 (볼게, 시간 끝은 남긴다)
      if ((a === 'ok' || a === 'snooze' || a === 'link') && recent?.keys === keys) recent = undefined;
      if (a === 'link' && link) {
        o.log('planner', '일정 링크 열기', link.meeting ? 'meeting' : 'link');
        o.openUrl(link.url);
      }
      if (a === 'show') o.openToday();
      if (a !== 'snooze' || snoozeMs === undefined) return;
      o.log('planner', '알림 미룸', list.length, snoozeMs / 60_000);
      snoozed.push({ at: Date.now() + snoozeMs, keys: list.map((d) => ({ kind: d.kind, id: d.id })) });
      o.onSnoozedChange?.();
    };
    void o
      .say({
        kind: 'schedule',
        text: bundleText([{ text: '', lines, at: now }]),
        buttons,
        ttlMs: 30_000,
        hold: {
          staleAt: stale,
          lines,
          // 숨어 있다 늦게 꺼내도 "몇 분 뒤"가 맞게, 놓친 알림에는 제목과 때만
          render: (at) => items.map((it) => remindLine(it, at)),
          missedLines: items.map(missedLine),
          // 보일 때 지금 언어로 다시 만든다 (언어를 바꿔도 따라간다)
          missedMsgs: list.map((d, i) => ({
            remind: items[i] as RemindItem,
            ...(d.kind === 'event' && d.e.allDay && d.e.endAt !== null
              ? { span: { startAt: d.e.startAt, endAt: d.e.endAt } }
              : {}),
          })),
          // 숨어 있다 다시 꺼낸 말풍선에서 누른 단추 (미루기, 회의 열기, 볼게). 시스템 알림을 눌러도 이것
          onAction: act,
          // 펫이 안 보이면(맥 전체 화면, 숨김, 발표) 시스템 알림으로도 한 번 (설정 osNotify)
          osNotify: true,
          // 시스템 알림 단추로 미루기 (맥, 윈도우). 단추가 없는 곳은 알림을 누르면 오늘 탭에서 고른다
          osActions: choices.map((c) => ({ id: snoozeAction(c), label: t(`snooze.${c}`) })),
        },
      })
      .then(act);
  }

  /** 방금 울린 알림 (오늘 탭에서 미루기를 고를 수 있게). 확인하거나 미루면 없어진다 */
  let recent: { keys: Snoozed['keys']; titles: string[]; at: number; choices: SnoozeChoice[] } | undefined;

  /** 고른 때에 다시 말한다 (keep: 때가 지난 할 일도) */
  function snooze(keys: Snoozed['keys'], choice: SnoozeChoice): number {
    const at = snoozeAt(choice, Date.now());
    o.log('planner', '알림 미룸', keys.length, choice);
    snoozed.push({ at, keys, keep: true });
    if (recent?.keys === keys) recent = undefined;
    o.onSnoozedChange?.();
    return at;
  }

  return {
    tick,
    /** now 뒤로 가장 먼저 울릴 알림이나 미룬 알림의 때 (플래너가 그때 깬다). 없으면 undefined */
    nextAt(now: number): number | undefined {
      const times = [o.events.nextReminderAt(now), o.todos.nextReminderAt(now), ...snoozed.map((s) => s.at)];
      return times.reduce<number | undefined>(
        (m, at) => (at === undefined || (m !== undefined && m <= at) ? m : at),
        undefined,
      );
    },
    /** 방금(30분 안) 울린 알림. 고를 미루기가 없으면 없다 */
    recent(now: number) {
      if (!recent || now - recent.at > RECENT_MS || recent.choices.length === 0) return undefined;
      return { titles: recent.titles, at: recent.at, choices: recent.choices };
    },
    /** 방금 울린 알림을 미룬다. 다시 울릴 때 (없으면 undefined) */
    snoozeRecent(choice: SnoozeChoice, now: number): number | undefined {
      if (!recent || now - recent.at > RECENT_MS || !recent.choices.includes(choice)) return undefined;
      return snooze(recent.keys, choice);
    },
    dismissRecent() {
      recent = undefined;
    },
    /** 저장할 모양 */
    get snoozed(): Snoozed[] {
      return snoozed;
    },
  };
}
