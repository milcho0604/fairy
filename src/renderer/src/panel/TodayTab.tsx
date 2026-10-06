import { useEffect, useState } from 'react';
import { FOCUS, remainLabel } from '../../../shared/focus.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import type { Todo } from '../../../shared/todo-store.ts';
import { timeOf } from './format.ts';
import { TodoRow } from './TodoTab.tsx';

const bridge = window.jjakkungPanel;

/**
 * 오늘 (v1): 집중 타이머, 오늘 남은 일정, 오늘 마감과 지난 마감 할 일.
 * 기획서 "화면 설계": 패널은 오늘 화면에서 시작한다.
 */
export function TodayTab({
  s,
  onComplete,
  goTo,
}: {
  s: PanelState;
  onComplete: (todo: Todo) => void;
  goTo: (tab: 'todo' | 'event') => void;
}) {
  const [now, setNow] = useState(Date.now());
  const running = s.focus.phase !== 'idle';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const endOfDay = new Date(now).setHours(24, 0, 0, 0);
  const events = s.events.filter((e) => (e.endAt ?? e.startAt) >= now && e.startAt < endOfDay);
  const due = s.open.filter((todo) => todo.due !== null && todo.due <= s.today);
  const important = s.open
    .filter((todo) => todo.important && (todo.due === null || todo.due > s.today))
    .slice(0, 3);

  return (
    <div className="scroll today">
      <section className={`focus-card ${s.focus.phase}`}>
        {s.focus.phase === 'idle' ? (
          <>
            <div className="focus-text">
              <strong>{t('panel.today.focusTitle', { n: FOCUS.focusMin })}</strong>
              <small>
                {t('panel.today.focusHint', {
                  name: s.petName,
                  coins: s.focusCoins,
                  breakMin: FOCUS.breakMin,
                })}
              </small>
            </div>
            <button type="button" className="primary" onClick={() => bridge.focusStart()}>
              {t('panel.today.start')}
            </button>
          </>
        ) : (
          <>
            <div className="focus-text">
              <strong className="clock">{remainLabel(s.focus, now)}</strong>
              <small>
                {s.focus.phase === 'focus' ? t('panel.today.focusing') : t('panel.today.resting')}
              </small>
            </div>
            <button type="button" className="ghost" onClick={() => bridge.focusStop()}>
              {t('panel.today.stop')}
            </button>
          </>
        )}
      </section>

      <section>
        <h3>
          {t('panel.today.events')}
          <button type="button" className="link" onClick={() => goTo('event')}>
            {t('panel.today.addEvent')}
          </button>
        </h3>
        {events.length === 0 ? (
          <p className="empty-line">{t('panel.today.noEvents')}</p>
        ) : (
          <ul className="events">
            {events.map((e) => (
              <li key={e.id} className={e.startAt <= now ? 'now' : ''}>
                <span className="time">{e.startAt <= now ? t('panel.today.now') : timeOf(e.startAt)}</span>
                <span className="title">{e.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>
          {t('panel.todo.due')}
          <button type="button" className="link" onClick={() => goTo('todo')}>
            {t('panel.today.allTodos')}
          </button>
        </h3>
        {due.length === 0 ? (
          <p className="empty-line">{t('panel.today.noDue')}</p>
        ) : (
          <ul className="todos">
            {due.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                today={s.today}
                onComplete={() => onComplete(todo)}
                compact
              />
            ))}
          </ul>
        )}
      </section>

      {important.length > 0 && (
        <section>
          <h3>{t('panel.todo.important')}</h3>
          <ul className="todos">
            {important.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                today={s.today}
                onComplete={() => onComplete(todo)}
                compact
              />
            ))}
          </ul>
        </section>
      )}

      <p className="done-count">
        <span>
          {t('panel.today.doneLabel')} <b>{s.doneToday.length}</b>
        </span>
        <span className="streak" title={t('panel.today.streakHint')}>
          {t('panel.today.streakBefore')} <b>{s.achieve.streak}</b>
          {t(s.achieve.streak === 1 ? 'panel.today.streakAfterOne' : 'panel.today.streakAfter')}
        </span>
      </p>

      <details className="achieve">
        <summary>
          {t('panel.today.achieve', { got: s.achieve.got.length, total: s.achieve.total })}
          {s.achieve.next && <small>{t('panel.today.achieveNext', { hint: s.achieve.next.hint })}</small>}
        </summary>
        <ul>
          {s.achieve.got.length === 0 && <li className="empty-line">{t('panel.today.noAchieve')}</li>}
          {s.achieve.got.map((a) => (
            <li key={a.key}>
              <b>{a.name}</b>
              <small>{a.hint}</small>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
