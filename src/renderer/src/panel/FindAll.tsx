// 할 일, 메모, 일정을 한 번에 찾는 칸 (#146): 머리의 돋보기나 Cmd/Ctrl+K 로 열고, 글자를 적으면 세 종류를 묶어 보여 준다.
// 고르면 그 탭으로 가서 그 줄을 보인다 (메모는 편집기를 연다). 화살표로 고르고 Enter, Esc 로 닫는다.
import { useEffect, useId, useRef, useState } from 'react';
import type { FindAllResult } from '../../../shared/find-all.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelTab } from '../../../shared/ipc.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import { currentQueryResult, type FindQuerySnapshot } from './find-query.ts';
import { dayHeading, timeOf } from './format.ts';
import { SearchIcon } from './icons.tsx';
import { isEsc, takeEsc } from './keys.ts';
import { Overlay } from './surface.tsx';

const bridge = window.jjakkungPanel;

type Pick =
  | { kind: 'todo'; id: number; title: string }
  | { kind: 'note'; id: number; title: string }
  | { kind: 'event'; id: number; title: string; startAt: number };

export function FindAll({
  today,
  onClose,
  onPick,
}: {
  today: string;
  onClose: () => void;
  /** 고른 곳으로 간다 (탭을 바꾸고 그 줄을 보인다) */
  onPick: (tab: PanelTab, pick: Pick) => void;
}) {
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [found, setFound] = useState<FindQuerySnapshot<FindAllResult>>();
  const [at, setAt] = useState(0);
  const seq = useRef(0);
  const listId = useId();
  const q = query.trim();

  // 적을 때마다 (잠깐 멈추면) 메인에서 세 종류를 한꺼번에 찾는다. 늦게 돌아온 앞 결과는 버린다.
  // 결과를 입력값과 묶어 두어 다음 요청이 시작되기 전의 짧은 틈에도 옛 결과를 고르지 못하게 한다.
  useEffect(() => {
    if (!q) {
      setFound(undefined);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() => bridge.findAll(query, composing))
        .then(
          (result) => {
            if (mine === seq.current) {
              setFound({ query, composing, result });
              setAt(0);
            }
          },
          () => {
            // 창을 닫는 중 IPC가 거절돼도 오래된 결과를 되살리거나 미처리 거절을 남기지 않는다.
            if (mine === seq.current) setFound(undefined);
          },
        );
    }, 120);
    return () => {
      clearTimeout(timer);
      if (mine === seq.current) seq.current++;
    };
  }, [query, composing, q]);

  const current = currentQueryResult(found, query, composing);
  const groups: { key: 'todos' | 'notes' | 'events'; label: string; rows: Row[] }[] = current
    ? [
        {
          key: 'todos',
          label: t('rows.find.todos'),
          rows: current.todos.map((x) => ({
            id: `todo-${x.id}`,
            title: x.title,
            sub: x.done ? t('rows.find.done') : x.due ? dueLabel(x.due, today).text : undefined,
            tab: 'todo',
            pick: { kind: 'todo', id: x.id, title: x.title },
          })),
        },
        {
          key: 'notes',
          label: t('rows.find.notes'),
          rows: current.notes.map((x) => ({
            id: `note-${x.id}`,
            title: x.title,
            snippet: x.snippet,
            mark: x.mark,
            tab: 'note',
            pick: { kind: 'note', id: x.id, title: x.title },
          })),
        },
        {
          key: 'events',
          label: t('rows.find.events'),
          rows: current.events.map((x) => ({
            id: `event-${x.id}`,
            title: x.title,
            sub: x.allDay
              ? dayHeading(dayOf(x.startAt), today)
              : `${dayHeading(dayOf(x.startAt), today)} ${timeOf(x.startAt)}`,
            tab: 'event',
            pick: { kind: 'event', id: x.id, title: x.title, startAt: x.startAt },
          })),
        },
      ]
    : [];
  const flat = groups.flatMap((g) => g.rows);
  const go = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    onPick(r.tab, r.pick);
  };
  const empty = !!current && flat.length === 0;

  return (
    <Overlay>
      <div className="find-veil" role="presentation">
        <div
          className="find-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t('rows.find.label')}
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return;
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button')];
            const first = items[0];
            const last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }}
        >
          <div className="find-input">
            <SearchIcon />
            <input
              // biome-ignore lint/a11y/noAutofocus: 찾기를 연 바로 그 칸이라 커서가 가야 한다
              autoFocus
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-activedescendant={flat[at] ? `${listId}-${flat[at]?.id}` : undefined}
              aria-label={t('rows.find.label')}
              placeholder={t('rows.find.placeholder')}
              value={query}
              onChange={(e) => {
                seq.current++;
                setFound(undefined);
                setQuery(e.target.value);
                setComposing((e.nativeEvent as InputEvent).isComposing ?? false);
              }}
              onCompositionEnd={() => {
                seq.current++;
                setFound(undefined);
                setComposing(false);
              }}
              onKeyDown={(e) => {
                if (isEsc(e)) {
                  takeEsc(e);
                  onClose();
                  return;
                }
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'ArrowDown' && flat.length) {
                  e.preventDefault();
                  setAt((i) => (i + 1) % flat.length);
                } else if (e.key === 'ArrowUp' && flat.length) {
                  e.preventDefault();
                  setAt((i) => (i - 1 + flat.length) % flat.length);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  go(flat[at]);
                }
              }}
            />
            <button type="button" className="find-close" aria-label={t('rows.find.close')} onClick={onClose}>
              ×
            </button>
          </div>
          <div className="find-body" id={listId} role="listbox" aria-label={t('rows.find.label')}>
            {!q && <p className="find-hint">{t('rows.find.hint')}</p>}
            {empty && (
              <p className="find-hint" role="status">
                {t('rows.find.none')}
              </p>
            )}
            {groups.map(
              (g) =>
                g.rows.length > 0 && (
                  <div key={g.key} className="find-group" role="presentation">
                    <h3>{g.label}</h3>
                    {g.rows.map((r) => {
                      const on = flat[at]?.id === r.id;
                      return (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: 키는 위 입력칸이 받는다 (화살표, Enter)
                        <div
                          key={r.id}
                          id={`${listId}-${r.id}`}
                          role="option"
                          aria-selected={on}
                          tabIndex={-1}
                          className={`find-row${on ? ' on' : ''}`}
                          onMouseMove={() => setAt(flat.findIndex((x) => x.id === r.id))}
                          onClick={() => go(r)}
                        >
                          <span className="find-title" dir="auto">
                            {r.title}
                          </span>
                          {r.sub && <small>{r.sub}</small>}
                          {r.snippet && r.mark ? (
                            <span className="find-snippet">
                              {r.snippet.slice(0, r.mark[0])}
                              <mark>{r.snippet.slice(r.mark[0], r.mark[1])}</mark>
                              {r.snippet.slice(r.mark[1])}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                    {current && current.more[g.key] > 0 && (
                      <p className="find-more">{t('rows.find.more', { n: current.more[g.key] })}</p>
                    )}
                  </div>
                ),
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

interface Row {
  id: string;
  title: string;
  sub?: string | undefined;
  snippet?: string | undefined;
  mark?: [number, number] | undefined;
  tab: PanelTab;
  pick: Pick;
}

/** ms → YYYY-MM-DD (현지) */
function dayOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
