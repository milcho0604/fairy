// 미리 알림 말풍선 (8판). 일정과 할 일의 여러 알림을 때가 되면 펫이 말한다. 플래너가 15초마다 부른다.
// 같은 때 울릴 것이 여럿이면 말풍선 하나로 묶는다 (따로 띄우면 뒤 것이 앞 것을 밀어낸다).
// 펫이 숨어 있거나(방해 금지, 발표, 숨기기), 집에서 쉬거나, 화면이 잠겼으면 펫이 모아 두었다가 나올 때 말하고(hold),
// 때가 한참 지났으면 놓친 알림에만 둔다. 'schedule' 종류라 조용히에서도 말하고 시간당 상한에 세지 않는다.
import { bundleText, SCHEDULE_STALE_MS } from '../shared/bubble-queue.ts';
import { allDayLabel, type CalEvent, type EventStore, eventAnchor } from '../shared/event-store.ts';
import { t } from '../shared/i18n/index.ts';
import { eventLink } from '../shared/links.ts';
import { type Anchor, anchorAt, snoozeFor, staleAt } from '../shared/remind.ts';
import { missedLine, type RemindItem, remindLine } from '../shared/remind-text.ts';
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
const holdUntil = (a: Anchor) => (a.kind === 'time' ? a.at + SCHEDULE_STALE_MS : staleAt(a));

export function createReminders(o: RemindersOptions) {
  /** 미룬 알림 (메모리에만, 앱을 끄면 사라진다). at 에 다시 말한다 */
  let snoozed: { at: number; keys: { kind: 'event' | 'todo'; id: number }[] }[] = [];

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
    snoozed = snoozed.filter((s) => s.at > now);
    const seen = new Set(due.map((d) => `${d.kind}:${d.id}`));
    const again: Due[] = [];
    for (const k of ready.flatMap((s) => s.keys)) {
      const key = `${k.kind}:${k.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = reread(k);
      // 그사이 때가 지나 쓸모없어졌으면 다시 말하지 않는다
      if (d && now < holdUntil(d.anchor)) again.push(d);
    }
    const list = [...due, ...again].sort((a, b) => anchorAt(a.anchor) - anchorAt(b.anchor));
    if (list.length === 0) return;
    const first = list[0] as Due;
    const items = list.map(itemOf);
    const lines = items.map((it) => remindLine(it, now));
    const stale = Math.min(...list.map((d) => holdUntil(d.anchor)));
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
      if (a === 'link' && link) {
        o.log('planner', '일정 링크 열기', link.meeting ? 'meeting' : 'link');
        o.openUrl(link.url);
      }
      if (a === 'show') o.openToday();
      if (a !== 'snooze' || snoozeMs === undefined) return;
      o.log('planner', '알림 미룸', list.length, snoozeMs / 60_000);
      snoozed.push({ at: Date.now() + snoozeMs, keys: list.map((d) => ({ kind: d.kind, id: d.id })) });
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
          // 숨어 있다 다시 꺼낸 말풍선에서 누른 단추 (미루기, 회의 열기, 볼게)
          onAction: act,
        },
      })
      .then(act);
  }

  return { tick };
}
