import { useId, useState } from 'react';
import { plusDays } from '../../../shared/day.ts';
import { allDayLabel, allDaySpan, type CalEvent, dayStartMs } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import { localDay } from '../../../shared/todo-store.ts';
import { dayHeading, timeOf, toInputValue } from './format.ts';
import { RemindButton, RemindSheet } from './RemindPicker.tsx';

const bridge = window.jjakkungPanel;

/** 날짜 사이 날 수 (b - a) */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

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
  // 방금 넣은 일정이 다른 일정과 시간이 겹친다 (넣기는 했다. 다음 글을 적으면 지운다)
  const [clash, setClash] = useState('');
  const now = Date.now();

  const add = async () => {
    const r = await bridge.eventAdd(text);
    if (!r.ok) {
      setError(r.error ?? t('panel.add.failed'));
      setClash('');
      return;
    }
    setText('');
    setError('');
    setClash(r.clash ? t('assist.clash', { time: timeOf(r.clash.startAt), title: r.clash.title }) : '');
  };

  // 끝난 일정은 빼고 날짜별로 묶는다. 종일 일정은 마지막 날이 지나야 끝나고,
  // 어제 시작한 여러 날 일정은 오늘 칸에 둔다 (지난 날 제목 아래 숨지 않게)
  const upcoming = s.events.filter((e) =>
    e.allDay ? allDaySpan(e).last >= s.today : (e.endAt ?? e.startAt + 30 * 60_000) >= now,
  );
  // 겹침은 메인이 저장 파일에서 센다: 어제 시작해 오늘까지 이어지는 시각 일정은 s.events 에 없다
  const clashing = new Set(s.eventClash);
  const days = new Map<string, CalEvent[]>();
  for (const e of upcoming) {
    const first = localDay(e.startAt);
    const d = e.allDay && first < s.today ? s.today : first;
    days.set(d, [...(days.get(d) ?? []), e]);
  }

  return (
    <>
      <div className="add">
        <input
          ref={inputRef}
          value={text}
          aria-label={t('panel.event.add')}
          placeholder={t('panel.event.placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
            setClash('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add();
          }}
        />
      </div>
      {error && <p className="hint error">{error}</p>}
      {clash && <p className="hint clash">{clash}</p>}
      <div className="scroll events-list">
        {days.size === 0 && <p className="empty">{t('panel.event.empty')}</p>}
        {[...days].map(([day, list]) => (
          <section key={day}>
            <h3>{dayHeading(day, s.today)}</h3>
            <ul className="events">
              {list.map((e) => (
                <EventRow
                  key={e.id}
                  e={e}
                  now={now}
                  today={s.today}
                  onRemoved={onRemoved}
                  clash={clashing.has(e.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function EventRow({
  e,
  now,
  today,
  onRemoved,
  clash,
}: {
  e: CalEvent;
  now: number;
  today: string;
  onRemoved: (id: number) => void;
  /** 다른 일정과 시간이 겹친다 */
  clash?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(e.title);
  // 미리 알림 고르기 (8판): 종 단추를 누르면 줄 아래에 펼친다
  const [reminding, setReminding] = useState(false);
  const sheetId = useId();
  const span = e.allDay ? allDaySpan(e) : null;
  const started = span ? span.first <= today : e.startAt <= now;

  /** 종일과 시각 일정 사이를 바꾼다. 시각으로 바꾸면 첫날 오전 9시 (오늘이면 다음 정시) */
  const toggleAllDay = () => {
    if (span) {
      const hour = span.first === today ? Math.min(23, new Date(now).getHours() + 1) : 9;
      bridge.eventUpdate(e.id, {
        startAt: dayStartMs(span.first) + hour * 3_600_000,
        endAt: null,
        allDay: false,
      });
    } else {
      bridge.eventUpdate(e.id, { startAt: dayStartMs(localDay(e.startAt)), endAt: null, allDay: true });
    }
  };

  return (
    <>
      <li className={`event ${started ? 'now' : ''} ${span ? 'all-day' : ''}`}>
        {span ? (
          <label className="time" title={t('panel.event.changeDay')}>
            {t('panel.event.allDay')}
            <input
              type="date"
              value={span.first}
              aria-label={t('panel.event.startDay')}
              onChange={(ev) => {
                const first = ev.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return;
                // 날 수는 그대로 두고 옮긴다
                const extra = daysBetween(span.first, span.last);
                bridge.eventUpdate(e.id, {
                  startAt: dayStartMs(first),
                  endAt: extra > 0 ? dayStartMs(plusDays(first, extra + 1)) : null,
                });
              }}
            />
          </label>
        ) : (
          <label className="time" title={t('panel.event.changeTime')}>
            {started ? t('panel.today.now') : timeOf(e.startAt)}
            <input
              type="datetime-local"
              value={toInputValue(e.startAt)}
              aria-label={t('panel.event.startTime')}
              onChange={(ev) => {
                const at = new Date(ev.target.value).getTime();
                if (Number.isFinite(at)) {
                  const len = e.endAt ? e.endAt - e.startAt : null;
                  bridge.eventUpdate(e.id, { startAt: at, endAt: len ? at + len : null });
                }
              }}
            />
          </label>
        )}
        {editing ? (
          <input
            className="title-edit"
            value={title}
            aria-label={t('panel.event.editTitle')}
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
          <button
            type="button"
            className="title"
            title={t('panel.todo.clickToEdit')}
            onClick={() => setEditing(true)}
          >
            {e.title}
            {e.endAt && !e.allDay && <small> ~{timeOf(e.endAt)}</small>}
            {/* 여러 날이면 기간을 제목 옆에 ("종일 | 워크숍 10/7~10/10"). 시각 칸에 넣으면 칸이 넓어져 제목 줄이 어긋난다 */}
            {span && span.last > span.first && <small> {allDayLabel(e)}</small>}
          </button>
        )}
        <span className="tools">
          {clash && (
            <span className="clash-badge" title={t('assist.clash.title')}>
              {t('assist.clash.badge')}
            </span>
          )}
          <span className="extra">
            <label className={`all-day-toggle ${e.allDay ? 'on' : ''}`} title={t('panel.event.allDayToggle')}>
              <input type="checkbox" checked={e.allDay} onChange={toggleAllDay} />
              {t('panel.event.allDay')}
            </label>
            <button
              type="button"
              className="remove"
              aria-label={t('panel.todo.remove', { title: e.title })}
              onClick={() => {
                bridge.eventRemove(e.id);
                onRemoved(e.id);
              }}
            >
              ×
            </button>
          </span>
          <RemindButton
            name={e.title}
            reminds={e.reminds}
            dateOnly={e.allDay}
            allDay={e.allDay}
            open={reminding}
            controls={sheetId}
            onToggle={() => setReminding((v) => !v)}
          />
        </span>
      </li>
      {reminding && (
        <li className="remind-sheet-row">
          <RemindSheet
            id={sheetId}
            reminds={e.reminds}
            dateOnly={e.allDay}
            allDay={e.allDay}
            onChange={(reminds) => bridge.eventUpdate(e.id, { reminds })}
            onClose={() => setReminding(false)}
          />
        </li>
      )}
    </>
  );
}
