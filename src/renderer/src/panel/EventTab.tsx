import { useState } from 'react';
import { type CalEvent, REMIND_CHOICES } from '../../../shared/event-store.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import { localDay } from '../../../shared/todo-store.ts';
import { dayHeading, timeOf, toInputValue } from './format.ts';
import { BellIcon } from './icons.tsx';

const bridge = window.jjakkungPanel;

const remindText = (m: number) => (m === 0 ? '시작할 때' : m >= 60 ? `${m / 60}시간 전` : `${m}분 전`);

/** 일정 (v1): 한 줄로 넣고, 날짜별로 본다. 시간이 되면 펫이 알린다. */
export function EventTab({
  s,
  inputRef,
  onRemoved,
}: {
  s: PanelState;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onRemoved: (id: number) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const now = Date.now();

  const add = async () => {
    const r = await bridge.eventAdd(text);
    if (!r.ok) {
      setError(r.error ?? '못 넣었어');
      return;
    }
    setText('');
    setError('');
  };

  // 끝난 일정은 빼고 날짜별로 묶는다.
  const upcoming = s.events.filter((e) => (e.endAt ?? e.startAt + 30 * 60_000) >= now);
  const days = new Map<string, CalEvent[]>();
  for (const e of upcoming) {
    const d = localDay(e.startAt);
    days.set(d, [...(days.get(d) ?? []), e]);
  }

  return (
    <>
      <div className="add">
        <input
          ref={inputRef}
          value={text}
          aria-label="일정 추가"
          placeholder="일정 추가 (예: 내일 3시 회의)"
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add();
          }}
        />
      </div>
      {error && <p className="hint error">{error}</p>}
      <div className="scroll events-list">
        {days.size === 0 && <p className="empty">2주 안에 일정이 없어. 위에 시각과 같이 적어 봐.</p>}
        {[...days].map(([day, list]) => (
          <section key={day}>
            <h3>{dayHeading(day, s.today)}</h3>
            <ul className="events">
              {list.map((e) => (
                <EventRow key={e.id} e={e} now={now} onRemoved={onRemoved} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function EventRow({ e, now, onRemoved }: { e: CalEvent; now: number; onRemoved: (id: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(e.title);
  const started = e.startAt <= now;
  return (
    <li className={`event ${started ? 'now' : ''}`}>
      <label className="time" title="시각 바꾸기">
        {started ? '지금' : timeOf(e.startAt)}
        <input
          type="datetime-local"
          value={toInputValue(e.startAt)}
          aria-label="시작 시각"
          onChange={(ev) => {
            const t = new Date(ev.target.value).getTime();
            if (Number.isFinite(t)) {
              const len = e.endAt ? e.endAt - e.startAt : null;
              bridge.eventUpdate(e.id, { startAt: t, endAt: len ? t + len : null });
            }
          }}
        />
      </label>
      {editing ? (
        <input
          className="title-edit"
          value={title}
          aria-label="일정 제목 고치기"
          // biome-ignore lint/a11y/noAutofocus: 고치기를 누른 바로 그 칸이라 커서가 가야 한다
          autoFocus
          onChange={(ev) => setTitle(ev.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title !== e.title) bridge.eventUpdate(e.id, { title });
            else setTitle(e.title);
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) (ev.target as HTMLInputElement).blur();
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              setTitle(e.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="title" title="눌러서 고치기" onClick={() => setEditing(true)}>
          {e.title}
          {e.endAt && <small> ~{timeOf(e.endAt)}</small>}
        </button>
      )}
      <label className="remind" title={`알림: ${remindText(e.remindMin)}`}>
        <BellIcon />
        <select
          value={e.remindMin}
          aria-label="알림"
          onChange={(ev) => bridge.eventUpdate(e.id, { remindMin: Number(ev.target.value) })}
        >
          {REMIND_CHOICES.map((m) => (
            <option key={m} value={m}>
              {remindText(m)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="remove"
        aria-label={`${e.title} 지우기`}
        onClick={() => {
          bridge.eventRemove(e.id);
          onRemoved(e.id);
        }}
      >
        ×
      </button>
    </li>
  );
}
