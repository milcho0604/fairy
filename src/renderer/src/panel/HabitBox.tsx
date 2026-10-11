import { useEffect, useState } from 'react';
import type { HabitView } from '../../../shared/day-ipc.ts';
import { GRASS_WEEKS, grass, type Habit, thisWeekCount } from '../../../shared/habit.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { dayHeading } from './format.ts';
import { CheckIcon } from './icons.tsx';
import './day.css';

const panel = window.jjakkungPanel;
const day = window.jjakkungDay;
/** 잔디 달력을 펼쳐 두었는지 (창을 열 때마다 새로 만들어 브라우저 저장소에 둔다) */
const GRASS_KEY = 'jj.habit.grass';

function remembered(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 못 적어도 이번에는 된다
  }
}

/**
 * 습관 (오늘 탭): 반복 할 일마다 오늘 체크와 연속 기록, 아래에 최근 12주 잔디 달력.
 * 체크는 패널의 할 일 끝내기와 같다 (코인, 펫 반응). 끊겨도 벌은 없다: "다시 시작"만 보인다
 */
export function HabitBox({ s, onComplete }: { s: PanelState; onComplete: (todo: Todo) => void }) {
  const [view, setView] = useState<HabitView>();
  // 패널 상태가 바뀔 때마다 (체크, 되돌리기, 할 일 고침) 다시 읽는다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 패널 상태(s)가 바뀔 때마다 다시 읽는다
  useEffect(() => {
    let alive = true;
    day
      .habits()
      .then((v) => {
        if (alive && v) setView(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [s]);
  if (!view) return null;
  const { habits, today } = view;
  const left = habits.filter((h) => h.status === 'todo').length;

  const check = (h: Habit) => {
    if (h.status === 'done' && h.doneTodayId !== undefined) {
      panel.undo(h.doneTodayId);
      return;
    }
    const todo = s.open.find((x) => x.id === h.id);
    if (todo) onComplete(todo);
  };

  return (
    <section className="habits">
      <h3>
        {t('habit.title')}
        {habits.length > 0 && (
          <small className={left === 0 ? 'habit-all' : ''}>
            {left === 0 ? t('habit.allDone') : t('habit.left', { n: left })}
          </small>
        )}
      </h3>
      {habits.length === 0 ? (
        <p className="empty-line">{t('habit.empty')}</p>
      ) : (
        <>
          <ul className="habit-list">
            {habits.map((h) => (
              <HabitRow key={h.rootId} h={h} today={today} onCheck={() => check(h)} />
            ))}
          </ul>
          <GrassBox habits={habits} today={today} />
        </>
      )}
    </section>
  );
}

function HabitRow({ h, today, onCheck }: { h: Habit; today: string; onCheck: () => void }) {
  const done = h.status === 'done';
  const weekly = h.repeat === 'weekly';
  // 연속이 있으면 "3일째", 끊겼으면 "오늘 다시 시작!", 처음이면 "첫 체크를 기다려" (벌이나 잃은 수는 말하지 않는다)
  const note =
    h.streak > 0
      ? h.repeat === 'monthly'
        ? t('habit.streakMonthly', { n: h.streak })
        : t('habit.streak', { n: h.streak, weekly })
      : h.total > 0
        ? t('habit.restart')
        : t('habit.first');
  return (
    <li className={`habit habit-${h.status}`}>
      <button
        type="button"
        className={done ? 'check on' : 'check'}
        aria-pressed={done}
        aria-label={done ? t('habit.uncheck', { title: h.title }) : t('habit.check', { title: h.title })}
        title={done ? t('habit.uncheck', { title: h.title }) : t('habit.check', { title: h.title })}
        onClick={onCheck}
      >
        <CheckIcon />
      </button>
      <span className="habit-title" title={h.title}>
        {h.title}
      </span>
      {h.status === 'later' && h.due ? (
        <small className="habit-note">{t('habit.later', { when: dayHeading(h.due, today) })}</small>
      ) : (
        <small className={`habit-note ${h.streak > 0 ? 'streak' : ''}`}>{note}</small>
      )}
    </li>
  );
}

/** 최근 12주 잔디. 습관이 여럿이면 하나만 골라 볼 수 있다 */
function GrassBox({ habits, today }: { habits: Habit[]; today: string }) {
  const [open, setOpen] = useState(() => remembered(GRASS_KEY, '1') === '1');
  const [pick, setPick] = useState<number | 'all'>('all');
  const chosen = pick === 'all' ? habits : habits.filter((h) => h.rootId === pick);
  const list = chosen.length ? chosen : habits;
  const cols = grass(
    list.map((h) => h.days),
    today,
    list.length,
  );
  const allDays = list.flatMap((h) => h.days);
  const week = list.reduce((a, h) => a + thisWeekCount(h.days, today), 0);
  const total = list.reduce((a, h) => a + h.total, 0);
  const labels = t('assist.week.days').split(',');
  return (
    <details
      className="achieve grass-box"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        remember(GRASS_KEY, next ? '1' : '0');
      }}
    >
      <summary>
        {t('habit.grass')}
        <small>
          {t('habit.week', { n: week })}, {t('habit.total', { n: total })}
        </small>
      </summary>
      {habits.length > 1 && (
        <fieldset className="grass-pick" aria-label={t('habit.grass')}>
          <button
            type="button"
            className={pick === 'all' ? 'len-chip on' : 'len-chip'}
            aria-pressed={pick === 'all'}
            onClick={() => setPick('all')}
          >
            {t('habit.grassAll')}
          </button>
          {habits.map((h) => (
            <button
              key={h.rootId}
              type="button"
              className={pick === h.rootId ? 'len-chip on' : 'len-chip'}
              aria-pressed={pick === h.rootId}
              title={h.title}
              onClick={() => setPick(h.rootId)}
            >
              {h.title}
            </button>
          ))}
        </fieldset>
      )}
      <div className="grass-wrap">
        {/* 요일 이름: 월, 수, 금만 (GitHub 처럼). 주는 일요일부터 */}
        <div className="grass-days" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span key={i}>{i % 2 === 1 ? labels[(i + 6) % 7] : ''}</span>
          ))}
        </div>
        <div
          className="grass"
          role="img"
          aria-label={`${t('habit.grass')}: ${t('habit.total', { n: new Set(allDays).size })}`}
          style={{ gridTemplateColumns: `repeat(${GRASS_WEEKS}, var(--cell))` }}
        >
          {cols.flat().map((c) => (
            <i
              key={c.day}
              className={`lv${c.level}${c.future ? ' is-future' : ''}${c.day === today ? ' is-today' : ''}`}
              title={c.future ? undefined : t('habit.grassCell', { day: dayHeading(c.day, today), n: c.n })}
            />
          ))}
        </div>
      </div>
      <div className="grass-foot">
        <small className="gentle">{t('habit.gentle')}</small>
        <span className="grass-legend" aria-hidden="true">
          {t('habit.less')}
          <i className="lv0" />
          <i className="lv1" />
          <i className="lv2" />
          <i className="lv3" />
          <i className="lv4" />
          {t('habit.more')}
        </span>
      </div>
    </details>
  );
}
