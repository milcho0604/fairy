import { useEffect, useState } from 'react';
import { FOCUS, remainLabel } from '../../../shared/focus.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
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
  onComplete: (t: Todo) => void;
  goTo: (tab: 'todo' | 'event') => void;
}) {
  const [now, setNow] = useState(Date.now());
  const running = s.focus.phase !== 'idle';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const endOfDay = new Date(now).setHours(24, 0, 0, 0);
  const events = s.events.filter((e) => (e.endAt ?? e.startAt) >= now && e.startAt < endOfDay);
  const due = s.open.filter((t) => t.due !== null && t.due <= s.today);
  const important = s.open.filter((t) => t.important && (t.due === null || t.due > s.today)).slice(0, 3);

  return (
    <div className="scroll today">
      <section className={`focus-card ${s.focus.phase}`}>
        {s.focus.phase === 'idle' ? (
          <>
            <div className="focus-text">
              <strong>집중 {FOCUS.focusMin}분</strong>
              <small>
                {withParticle(s.petName, '이')} 옆에서 자. 끝나면 코인 {s.focusCoins}개, 그다음{' '}
                {FOCUS.breakMin}분 쉬기.
              </small>
            </div>
            <button type="button" className="primary" onClick={() => bridge.focusStart()}>
              시작
            </button>
          </>
        ) : (
          <>
            <div className="focus-text">
              <strong className="clock">{remainLabel(s.focus, now)}</strong>
              <small>{s.focus.phase === 'focus' ? '집중하는 중' : '쉬는 중'}</small>
            </div>
            <button type="button" className="ghost" onClick={() => bridge.focusStop()}>
              그만
            </button>
          </>
        )}
      </section>

      <section>
        <h3>
          오늘 일정
          <button type="button" className="link" onClick={() => goTo('event')}>
            일정 넣기
          </button>
        </h3>
        {events.length === 0 ? (
          <p className="empty-line">남은 일정이 없어.</p>
        ) : (
          <ul className="events">
            {events.map((e) => (
              <li key={e.id} className={e.startAt <= now ? 'now' : ''}>
                <span className="time">{e.startAt <= now ? '지금' : timeOf(e.startAt)}</span>
                <span className="title">{e.title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>
          마감
          <button type="button" className="link" onClick={() => goTo('todo')}>
            할 일 전체
          </button>
        </h3>
        {due.length === 0 ? (
          <p className="empty-line">오늘까지인 할 일이 없어.</p>
        ) : (
          <ul className="todos">
            {due.map((t) => (
              <TodoRow key={t.id} todo={t} today={s.today} onComplete={() => onComplete(t)} compact />
            ))}
          </ul>
        )}
      </section>

      {important.length > 0 && (
        <section>
          <h3>중요</h3>
          <ul className="todos">
            {important.map((t) => (
              <TodoRow key={t.id} todo={t} today={s.today} onComplete={() => onComplete(t)} compact />
            ))}
          </ul>
        </section>
      )}

      <p className="done-count">
        오늘 끝낸 일 <b>{s.doneToday.length}</b>
      </p>
    </div>
  );
}
