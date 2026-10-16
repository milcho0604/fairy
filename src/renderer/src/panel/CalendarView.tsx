import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CalItem,
  calendarDays,
  fitItems,
  type HolidayKey,
  holidaysBetween,
  isWeekStart,
  monthOf,
  monthWeeks,
  moveDay,
  type WeekStart,
  weekdayOrder,
  weekOf,
} from '../../../shared/calendar.ts';
import { plusDays, plusMonths, weekdayOf } from '../../../shared/day.ts';
import { type CalEvent, dayStartMs, timeLabel } from '../../../shared/event-store.ts';
import { getLang, t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { EventRow } from './EventTab.tsx';
import { dayHeading } from './format.ts';
import { RepeatIcon } from './icons.tsx';
import { TodoRow } from './TodoTab.tsx';
import './calendar.css';

const bridge = window.jjakkungPanel;
/** 월, 주 (창을 열 때마다 새로 만들어 브라우저 저장소에 둔다) */
const MODE_KEY = 'jj.cal.mode';
const WEEK_START_KEY = 'jj.cal.weekStart';
/** 칸에 그리는 줄 수. 넘으면 앞의 (줄 수 - 1)개와 "+N" */
const MONTH_LINES = 2;
const WEEK_LINES = 4;

type Mode = 'month' | 'week';

function remembered<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    const v = raw === null ? null : JSON.parse(raw);
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 못 적어도 이번 창에서는 바뀐다
  }
}
const isMode = (v: unknown): v is Mode => v === 'month' || v === 'week';

const dayNum = (day: string) => Number(day.slice(8, 10));

/** 칸의 읽어 주는 이름: "2026년 10월 15일 (목), 오늘, 한글날, 3개" */
function cellLabel(day: string, today: string, n: number, holiday: HolidayKey | undefined): string {
  const [y = 2000, m = 1, d = 1] = day.split('-').map(Number);
  return [
    t('panel.day.heading', { y, m, d }),
    day === today ? t('cal.todayMark') : '',
    holiday ? t(holiday) : '',
    t('cal.count', { n }),
  ]
    .filter(Boolean)
    .join(', ');
}

/** 칸 안 짧은 줄의 풀이 (마우스를 올렸을 때) */
function itemHint(i: CalItem): string {
  const when = i.minute !== null ? `${timeLabel(i.minute)} ` : '';
  const cont = i.part === 'middle' || i.part === 'last' ? ` (${t('cal.continued')})` : '';
  return `${when}${i.title}${cont}`;
}

/**
 * 일정 탭 달력 보기: 월 칸이나 주 띠, 아래에 고른 날(주 보기면 그 주 7일) 목록.
 * 일정, 가져온 일정, 마감 있는 할 일, 반복 할 일의 다음 회차를 같이 본다. 줄을 누르면 일정 탭, 할 일 탭과 같은 고치기.
 * 날짜를 고르면 위 입력칸이 그날에 넣는다 (EventTab). 키보드: 화살표 하루와 한 주, Home, End, PageUp, PageDown 한 달,
 * Enter 는 그날 입력칸으로, T 는 오늘로
 */
export function CalendarView({
  s,
  day,
  setDay,
  onPick,
  onRemoved,
  onComplete,
  onTodoRemoved,
}: {
  s: PanelState;
  /** 고른 날 YYYY-MM-DD */
  day: string;
  setDay: (day: string) => void;
  /** Enter: 그날에 넣으러 입력칸으로 */
  onPick: () => void;
  onRemoved: (id: number) => void;
  onComplete: (todo: Todo) => void;
  onTodoRemoved: (todo: Todo) => void;
}) {
  const [mode, setModeState] = useState<Mode>(() => remembered(MODE_KEY, isMode, 'month'));
  const [weekStart, setWeekStartState] = useState<WeekStart>(() =>
    remembered(WEEK_START_KEY, isWeekStart, 0),
  );
  const [events, setEvents] = useState<CalEvent[]>([]);
  const gridRef = useRef<HTMLTableElement>(null);
  /** 키보드로 날을 옮겼다: 새 칸에 포커스를 옮긴다 (마우스로 고를 때는 그대로) */
  const focusNext = useRef(false);
  const setMode = (next: Mode) => {
    setModeState(next);
    remember(MODE_KEY, next);
  };
  const setWeekStart = (next: WeekStart) => {
    setWeekStartState(next);
    remember(WEEK_START_KEY, next);
  };

  const weeks = useMemo(
    () => (mode === 'month' ? monthWeeks(monthOf(day), weekStart) : [weekOf(day, weekStart)]),
    [mode, day, weekStart],
  );
  const from = weeks[0]?.[0] ?? day;
  const to = weeks[weeks.length - 1]?.[6] ?? day;

  // 보이는 기간의 일정을 메인에서 받는다. 패널 상태(s)가 바뀌면(넣기, 고치기, 지우기) 다시
  // biome-ignore lint/correctness/useExhaustiveDependencies: 패널 상태가 바뀔 때마다 다시 읽는다
  useEffect(() => {
    let alive = true;
    bridge
      .eventsBetween(dayStartMs(from), dayStartMs(plusDays(to, 1)))
      .then((list) => {
        if (alive) setEvents(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [s, from, to]);

  const byDay = useMemo(
    () => calendarDays(events, s.open, from, to, s.today),
    [events, s.open, from, to, s.today],
  );
  const holidays = useMemo(() => (getLang() === 'ko' ? holidaysBetween(from, to) : new Map()), [from, to]);

  // 키보드로 옮긴 날의 칸에 포커스 (달이 바뀌어 칸을 새로 그린 뒤에도)
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"] button`)?.focus();
  }, [day]);

  const go = (next: string, keyboard = false) => {
    focusNext.current = keyboard;
    setDay(next);
  };
  const step = (n: number) => go(mode === 'month' ? plusMonths(day, n) : plusDays(day, 7 * n));

  const onGridKey = (e: React.KeyboardEvent) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onPick();
      return;
    }
    // 한글 입력 상태에서는 e.key 가 'ㅅ' 이라 자리(code)로 본다
    if (e.code === 'KeyT') {
      e.preventDefault();
      go(s.today, true);
      return;
    }
    const next = moveDay(day, e.key, weekStart);
    if (next) {
      e.preventDefault();
      go(next, true);
    }
  };

  const [y = 2000, m = 1] = day.split('-').map(Number);
  const title =
    mode === 'month'
      ? t('cal.month', { y, m })
      : t('cal.week', {
          m1: Number(from.slice(5, 7)),
          d1: dayNum(from),
          m2: Number(to.slice(5, 7)),
          d2: dayNum(to),
        });
  const short = t('cal.weekdays').split(' ');
  const full = t('cal.weekdaysFull').split(' ');
  const lines = mode === 'month' ? MONTH_LINES : WEEK_LINES;
  const month = monthOf(day);
  const listDays = mode === 'month' ? [day] : (weeks[0] ?? []);

  return (
    <div className={`cal ${mode}`} data-from={from} data-to={to} data-items={events.length}>
      <div className="cal-bar">
        <button
          type="button"
          className="cal-nav"
          aria-label={mode === 'month' ? t('cal.prevMonth') : t('cal.prevWeek')}
          title={mode === 'month' ? t('cal.prevMonth') : t('cal.prevWeek')}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <h2 className="cal-title" aria-live="polite">
          {title}
        </h2>
        <button
          type="button"
          className="cal-nav"
          aria-label={mode === 'month' ? t('cal.nextMonth') : t('cal.nextWeek')}
          title={mode === 'month' ? t('cal.nextMonth') : t('cal.nextWeek')}
          onClick={() => step(1)}
        >
          ›
        </button>
        <button
          type="button"
          className="cal-today"
          title={t('cal.goToday.hint')}
          disabled={day === s.today}
          onClick={() => go(s.today)}
        >
          {t('cal.goToday')}
        </button>
        <fieldset className="cal-mode" aria-label={t('cal.mode.label')}>
          {(['month', 'week'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>
              {t(k === 'month' ? 'cal.mode.month' : 'cal.mode.week')}
            </button>
          ))}
        </fieldset>
      </div>

      <table ref={gridRef} className="cal-grid" aria-label={t('cal.grid', { title })} onKeyDown={onGridKey}>
        <thead>
          <tr>
            {weekdayOrder(weekStart).map((wd) => (
              <th key={wd} scope="col" abbr={full[wd]} className={wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}>
                {short[wd]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const items = byDay.get(d) ?? [];
                const { shown, more } = fitItems(items, lines);
                const holiday = holidays.get(d) as HolidayKey | undefined;
                const wd = weekdayOf(d);
                const cls = [
                  'cal-cell',
                  d === day ? 'on' : '',
                  d === s.today ? 'today' : '',
                  mode === 'month' && monthOf(d) !== month ? 'out' : '',
                  holiday || wd === 0 ? 'sun' : wd === 6 ? 'sat' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={d} className={cls} data-day={d}>
                    <button
                      type="button"
                      tabIndex={d === day ? 0 : -1}
                      aria-pressed={d === day}
                      aria-label={cellLabel(d, s.today, items.length, holiday)}
                      aria-current={d === s.today ? 'date' : undefined}
                      title={holiday ? t(holiday) : undefined}
                      onClick={() => go(d)}
                    >
                      <span className="cal-num">{dayNum(d)}</span>
                      <span className="cal-lines" aria-hidden="true">
                        {shown.map((i) => (
                          <span
                            key={i.key}
                            className={`cal-line k-${i.kind} ${i.part} ${i.minute === null && (i.kind === 'event' || i.kind === 'ics') ? 'bar' : ''}${i.color ? ' cal-color' : ''}`}
                            title={itemHint(i)}
                            style={i.color ? ({ '--cal': i.color } as CSSProperties) : undefined}
                          >
                            {i.part === 'middle' || i.part === 'last' ? '\u00a0' : i.title}
                          </span>
                        ))}
                        {more > 0 && (
                          <span className="cal-more" title={t('cal.moreLabel', { n: more })}>
                            {t('cal.more', { n: more })}
                          </span>
                        )}
                      </span>
                      {items.length > 0 && <span className="cal-dot" aria-hidden="true" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cal-keys">{t('cal.keys')}</p>

      <div className="cal-days">
        {listDays.map((d) => (
          <DayList
            key={d}
            day={d}
            picked={d === day}
            s={s}
            items={byDay.get(d) ?? []}
            events={events}
            holiday={holidays.get(d) as HolidayKey | undefined}
            onPick={() => go(d)}
            onRemoved={onRemoved}
            onComplete={onComplete}
            onTodoRemoved={onTodoRemoved}
          />
        ))}
      </div>

      <label className="cal-week-start">
        {t('cal.weekStart')}
        <select
          value={weekStart}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (isWeekStart(v)) setWeekStart(v);
          }}
        >
          <option value={0}>{t('cal.weekStart.sun')}</option>
          <option value={1}>{t('cal.weekStart.mon')}</option>
        </select>
      </label>
    </div>
  );
}

/** 하루 목록: 일정은 일정 탭 줄(EventRow), 할 일은 할 일 탭 줄(TodoRow)을 그대로 써서 같은 자리에서 고친다 */
function DayList({
  day,
  picked,
  s,
  items,
  events,
  holiday,
  onPick,
  onRemoved,
  onComplete,
  onTodoRemoved,
}: {
  day: string;
  picked: boolean;
  s: PanelState;
  items: CalItem[];
  events: CalEvent[];
  holiday: HolidayKey | undefined;
  onPick: () => void;
  onRemoved: (id: number) => void;
  onComplete: (todo: Todo) => void;
  onTodoRemoved: (todo: Todo) => void;
}) {
  const now = Date.now();
  const evs = items
    .filter((i) => i.kind === 'event' || i.kind === 'ics')
    .map((i) => events.find((e) => e.id === i.id))
    .filter((e): e is CalEvent => !!e);
  const todos = items
    .filter((i) => i.kind === 'todo')
    .map((i) => s.open.find((x) => x.id === i.id))
    .filter((x): x is Todo => !!x);
  const repeats = items.filter((i) => i.kind === 'repeat');
  return (
    <section className={`cal-day ${picked ? 'on' : ''}`} data-day={day}>
      <h2>
        <button type="button" className="cal-day-head" aria-pressed={picked} onClick={onPick}>
          {dayHeading(day, s.today)}
        </button>
        {holiday && <small className="cal-holiday">{t(holiday)}</small>}
      </h2>
      {items.length === 0 && <p className="empty-line">{t('cal.day.empty')}</p>}
      {evs.length > 0 && (
        <ul className="events">
          {evs.map((e) => (
            <EventRow key={e.id} e={e} now={now} today={s.today} onRemoved={onRemoved} gcal={s.gcal} />
          ))}
        </ul>
      )}
      {todos.length + repeats.length > 0 && (
        <ul className="todos cal-todos">
          {todos.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              today={s.today}
              doing={s.doing.includes(todo.id)}
              onComplete={() => onComplete(todo)}
              onRemoved={() => onTodoRemoved(todo)}
            />
          ))}
          {repeats.map((i) => (
            <li key={i.key} className="todo cal-repeat" title={t('cal.kind.repeat')}>
              <RepeatIcon />
              <span className="title" dir="auto">
                {i.title}
              </span>
              <small>{i.minute !== null ? timeLabel(i.minute) : t('cal.repeat.next')}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
