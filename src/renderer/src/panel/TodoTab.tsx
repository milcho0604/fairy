import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { timeLabel } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelAddResult, PanelState } from '../../../shared/ipc.ts';
import { pinFirst } from '../../../shared/pin.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import { remindSummary } from '../../../shared/remind-text.ts';
import { allTags, filterTodos, titleParts } from '../../../shared/todo-filter.ts';
import {
  REPEAT_LABEL,
  REPEATS,
  type Repeat,
  STEP_MAX,
  stepProgress,
  type Todo,
  type TodoStep,
} from '../../../shared/todo-store.ts';
import './assist.css';
import { useDraft } from './draft.ts';
import { dueToSend, minuteToSend } from './due-input.ts';
import { CheckIcon, PlayIcon, RepeatIcon, SearchIcon, StarIcon, StepsIcon } from './icons.tsx';
import { isEsc, takeEsc } from './keys.ts';
import { MoreRow } from './more.tsx';
import { pageOf, pagesForIndex } from './paging.ts';
import { PinButton, PinMark, usePinMenu } from './pin.tsx';
import { RemindButton, RemindSheet } from './RemindPicker.tsx';
import { useSurface } from './surface.tsx';
import { TrashBox } from './TrashBox.tsx';
import { updateView, useKeepScroll, viewNow } from './view-keep.ts';

const bridge = window.jjakkungPanel;
/** 예전 판이 브라우저 저장소에 두던 쓰다 만 한 줄. 지금은 메인이 메모리에 들고 있다 (draft.ts). 한 번 옮기고 지운다 */
const LEGACY_DRAFT_KEY = 'jj.panel.todoDraft';
/** 넓은 배치에서 상세 칸에 열어 둔 할 일. 탭을 갔다 와도 그대로 (창을 닫으면 잊는다) */
let lastSelected: number | undefined;

function takeLegacyDraft(): string {
  try {
    const v = localStorage.getItem(LEGACY_DRAFT_KEY) ?? '';
    if (v) localStorage.removeItem(LEGACY_DRAFT_KEY);
    return v;
  } catch {
    return '';
  }
}

/** 없음 → 매일 → 평일 → 매주 → 없음 */
function nextRepeat(r: Repeat | null): Repeat | null {
  if (r === null) return REPEATS[0] ?? null;
  const i = REPEATS.indexOf(r);
  return REPEATS[i + 1] ?? null;
}

export function TodoTab({
  s,
  onComplete,
  inputRef,
  onAdded,
  onRemoved,
}: {
  s: PanelState;
  onComplete: (todo: Todo) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** 넣었다. 넣은 글(text)도 같이 (일정으로 들어간 것을 알림에서 할 일로 옮길 때 쓴다) */
  onAdded: (r: Extract<PanelAddResult, { ok: true }>, text: string) => void;
  /** 지웠다 (되돌리기 알림) */
  onRemoved: (todo: Todo) => void;
}) {
  const [text, setText] = useDraft('todo');
  /** 넓은 본문 칸(큰 창)이면 태그 칸, 목록, 상세 칸 세 열. 좁으면 지금처럼 한 열 */
  const wide = useSurface().zone === 'wide';
  const [selId, setSelId] = useState(lastSelected);
  const select = (id: number | undefined) => {
    lastSelected = id;
    setSelId(id);
  };
  // 예전 판이 저장소에 남긴 글은 한 번 가져온다 (이미 메인에 쓰던 글이 있으면 그것을 지킨다)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만
  useEffect(() => {
    const legacy = takeLegacyDraft();
    if (legacy && !text) setText(legacy);
  }, []);
  const [error, setError] = useState('');
  const [recentId, setRecentId] = useState<number>();
  const [pendingId, setPendingId] = useState<number>();
  const [highlightId, setHighlightId] = useState<number>();
  // 보던 위치 (#145): 탭을 갔다 와도, 패널을 닫았다 열어도 찾는 말, 태그, 완료 목록, 쪽 수가 그대로
  const [kept] = useState(() => viewNow().todo);
  const [showDone, setShowDone] = useState(kept.showDone);
  // 찾기와 태그 (할 일이 많을 때 좁혀 보기)
  const [finding, setFinding] = useState(kept.finding);
  const [query, setQuery] = useState(kept.query);
  const [composing, setComposing] = useState(false);
  const [tag, setTag] = useState<string | null>(kept.tag);
  /** 그린 쪽 수 (찾는 말과 태그마다) */
  const [paging, setPaging] = useState({ key: kept.pageKey, pages: kept.pages });
  const listRef = useRef<HTMLUListElement>(null);
  useKeepScroll(listRef, 'todo');
  const findRef = useRef<HTMLInputElement>(null);
  const tags = allTags(s.open);
  // 고른 태그가 목록에서 사라지면(마지막 것을 끝냄) 모두로
  const picked = tag && tags.some((x) => x.tag.toLowerCase() === tag.toLowerCase()) ? tag : null;
  // 고정한 것을 맨 위로 (고정한 순서), 아래는 원래 정렬 (중요, 마감 순)
  const shown = pinFirst(filterTodos(s.open, { query: finding ? query : '', tag: picked, composing }));
  const lastPinned = shown.findLast((todo) => todo.pinnedAt !== null)?.id;
  /** 상세 칸에 열린 할 일 (목록에 보이는 것만: 태그나 찾기로 가려지면 닫는다) */
  const selected = wide ? shown.find((x) => x.id === selId) : undefined;
  const filtered = shown.length !== s.open.length;
  // 앞에서부터 한 쪽씩 그린다 (paging.ts). 찾는 말이나 태그가 바뀌면 첫 쪽부터
  const pageKey = `${finding ? query : ''}\u0000${picked ?? ''}`;
  const pages = paging.key === pageKey ? paging.pages : 1;
  useEffect(() => {
    updateView((v) => ({
      ...v,
      todo: { finding, query, tag: picked, showDone, pageKey, pages },
    }));
  }, [finding, query, picked, showDone, pageKey, pages]);
  const page = pageOf(shown, pages);
  const recent = s.open.find((todo) => todo.id === recentId);
  const recentHidden = !!recent && !shown.some((todo) => todo.id === recent.id);
  useEffect(() => {
    if (recentId === undefined) return;
    const timer = setTimeout(() => {
      setRecentId(undefined);
      setPendingId(undefined);
    }, 8000);
    return () => clearTimeout(timer);
  }, [recentId]);
  useEffect(() => {
    if (highlightId === undefined) return;
    const timer = setTimeout(() => setHighlightId(undefined), 1000);
    return () => clearTimeout(timer);
  }, [highlightId]);
  useLayoutEffect(() => {
    if (pendingId === undefined) return;
    const index = shown.findIndex((todo) => todo.id === pendingId);
    // 검색과 태그는 유지한다. 가려진 항목은 안내의 보기 단추로 직접 열 수 있다.
    if (index < 0) return;
    const needed = pagesForIndex(index);
    if (pages < needed) {
      setPaging({ key: pageKey, pages: needed });
      return;
    }
    const row = listRef.current?.querySelector<HTMLElement>(`li.todo[data-id="${pendingId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    setHighlightId(pendingId);
    setPendingId(undefined);
  }, [pendingId, shown, pages, pageKey]);
  const canFind = s.open.length >= FIND_FROM || finding;
  const openFind = () => {
    setFinding(true);
    requestAnimationFrame(() => findRef.current?.focus());
  };
  const closeFind = () => {
    setFinding(false);
    setQuery('');
    inputRef.current?.focus();
  };
  // Ctrl/Cmd+F 로 찾기
  // biome-ignore lint/correctness/useExhaustiveDependencies: 여는 함수는 매번 새로 만들어도 하는 일이 같다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFind();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** value 를 넣는다. 여러 줄 붙여 넣기면 칸에 적던 글은 그대로 둔다 */
  const add = async (value = text) => {
    const r = await bridge.add(value);
    if (!r.ok) {
      setError(r.error ?? t('panel.add.failed'));
      return;
    }
    if (value === text) setText('');
    setError('');
    const addedId =
      r.kind === 'todo'
        ? r.id
        : r.kind === 'many'
          ? r.items.findLast((item) => item.kind === 'todo')?.id
          : undefined;
    if (addedId !== undefined) {
      setRecentId(addedId);
      setPendingId(addedId);
    }
    onAdded(r, value);
  };

  // 태그 고르기 단추들. 좁으면 목록 위 가로 줄, 넓으면 왼쪽 세로 칸
  const tagChips = (
    <fieldset className={`tag-chips${wide ? ' tag-col' : ''}`} aria-label={t('assist.tag.nav')}>
      <button
        type="button"
        className={picked === null ? 'len-chip on' : 'len-chip'}
        aria-pressed={picked === null}
        onClick={() => setTag(null)}
      >
        {t('assist.tag.all')}
      </button>
      {tags.map((x) => {
        const on = picked?.toLowerCase() === x.tag.toLowerCase();
        return (
          <button
            key={x.tag}
            type="button"
            className={on ? 'len-chip on' : 'len-chip'}
            aria-pressed={on}
            onClick={() => setTag(on ? null : x.tag)}
          >
            #{x.tag}
            <small>{x.n}</small>
          </button>
        );
      })}
    </fieldset>
  );
  const listRowsKey = (e: React.KeyboardEvent) => {
    if (!wide || e.nativeEvent.isComposing) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('li.todo[data-id]');
    if (!row || !(e.target as HTMLElement).classList.contains('title')) return;
    const ids = page.shown.map((x) => x.id);
    const at = ids.indexOf(Number(row.dataset.id));
    const go = (id: number | undefined) => {
      if (id === undefined) return;
      e.preventDefault();
      select(id);
      requestAnimationFrame(() =>
        listRef.current?.querySelector<HTMLElement>(`li.todo[data-id="${id}"] .title`)?.focus(),
      );
    };
    if (e.key === 'ArrowDown') go(ids[at + 1]);
    else if (e.key === 'ArrowUp') go(ids[at - 1]);
    else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      // 상세 칸으로: 고른 할 일을 열고 제목 칸에 커서를 둔다
      e.preventDefault();
      select(Number(row.dataset.id));
      requestAnimationFrame(() => detailRef.current?.querySelector<HTMLElement>('.detail-title')?.focus());
    }
  };
  const detailRef = useRef<HTMLElement>(null);
  /** 상세 칸에서 Esc: 목록의 그 줄로 돌아간다 */
  const backToRow = (id: number) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`li.todo[data-id="${id}"] .title`)?.focus(),
    );

  return (
    <div className={`todo-layout${wide ? ' wide' : ''}`}>
      {wide ? (
        <nav className="todo-tags" aria-label={t('assist.tag.nav')}>
          <h3>{t('panel.todo.tagsHead')}</h3>
          {tags.length > 0 ? tagChips : <p className="todo-col-empty">{t('panel.todo.noTags')}</p>}
        </nav>
      ) : null}
      <div className="todo-main">
        <div className="add">
          <input
            ref={inputRef}
            value={text}
            aria-label={t('panel.todo.add')}
            placeholder={t('panel.todo.placeholder')}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) add();
              // 쓰던 줄이 있으면 Esc 는 먼저 그것만 지운다 (한 번 더 누르면 패널이 닫힌다)
              if (isEsc(e) && text) {
                takeEsc(e);
                setText('');
                setError('');
              }
            }}
            onPaste={(e) => {
              // 여러 줄을 붙여 넣으면 줄마다 할 일 하나 (한 줄 칸이 줄바꿈을 지워 한 줄로 붙이지 않게)
              const pasted = e.clipboardData.getData('text');
              if (pasted.split(/\r?\n/).filter((l) => l.trim()).length < 2) return;
              e.preventDefault();
              void add(pasted);
            }}
          />
          {canFind && !finding && (
            <button
              type="button"
              className="find-btn"
              aria-label={t('assist.find.open')}
              title={t('assist.find.open')}
              onClick={openFind}
            >
              <SearchIcon />
            </button>
          )}
        </div>
        {error && <p className="hint error">{error}</p>}
        {recent && (
          <div className="todo-added-notice" role="status">
            <span title={recent.title}>
              {t(recentHidden ? 'panel.todo.addedHidden' : 'panel.todo.added', { title: recent.title })}
            </span>
            {recentHidden && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setFinding(false);
                  setQuery('');
                  setTag(null);
                  setPendingId(recent.id);
                }}
              >
                {t('panel.todo.addedShow')}
              </button>
            )}
            <button
              type="button"
              className="find-clear"
              aria-label={t('panel.todo.addedDismiss')}
              onClick={() => {
                setRecentId(undefined);
                setPendingId(undefined);
              }}
            >
              ×
            </button>
          </div>
        )}
        {finding && (
          <div className="find-row">
            <SearchIcon />
            <input
              ref={findRef}
              value={query}
              aria-label={t('assist.find.open')}
              placeholder={t('assist.find.placeholder')}
              onChange={(e) => {
                setQuery(e.target.value);
                setComposing((e.nativeEvent as InputEvent).isComposing ?? false);
              }}
              onCompositionEnd={() => setComposing(false)}
              onKeyDown={(e) => {
                if (isEsc(e)) {
                  takeEsc(e);
                  closeFind();
                }
              }}
            />
            <button
              type="button"
              className="find-clear"
              aria-label={t('assist.find.clear')}
              onClick={closeFind}
            >
              ×
            </button>
          </div>
        )}
        {!wide && tags.length > 0 && tagChips}

        <ul className="todos scroll" ref={listRef} onKeyDown={listRowsKey}>
          {s.open.length === 0 && <li className="empty">{t('panel.todo.empty')}</li>}
          {s.open.length > 0 && filtered && shown.length === 0 && (
            <li className="empty">{t('assist.find.none')}</li>
          )}
          {page.shown.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              today={s.today}
              pinEnd={todo.id === lastPinned && shown.length > 1 && shown.at(-1)?.id !== todo.id}
              doing={s.doing.includes(todo.id)}
              highlighted={todo.id === highlightId}
              onComplete={() => onComplete(todo)}
              onRemoved={() => onRemoved(todo)}
              {...(wide ? { onSelect: () => select(todo.id), selected: todo.id === selected?.id } : {})}
            />
          ))}
          <MoreRow rest={page.rest} onMore={() => setPaging({ key: pageKey, pages: pages + 1 })} />
        </ul>

        {s.doneToday.length > 0 && (
          <div className="done">
            <button
              type="button"
              className="done-toggle"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
            >
              {t('panel.todo.doneToday', { n: s.doneToday.length })}
            </button>
            {showDone && (
              <ul className="todos">
                {s.doneToday.map((todo) => (
                  <li key={todo.id} className="todo done-item">
                    <button
                      type="button"
                      className="check on"
                      aria-label={t('panel.todo.undoDone')}
                      onClick={() => bridge.undo(todo.id)}
                    >
                      <CheckIcon />
                    </button>
                    <span className="title" dir="auto">
                      {todo.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <TrashBox s={s} />
      </div>
      {wide ? (
        <aside className="todo-detail" ref={detailRef} aria-label={t('panel.todo.detail')}>
          {selected ? (
            <TodoDetail
              key={selected.id}
              todo={selected}
              today={s.today}
              onComplete={() => {
                select(undefined);
                onComplete(selected);
              }}
              onRemoved={() => {
                select(undefined);
                onRemoved(selected);
              }}
              onEsc={() => backToRow(selected.id)}
            />
          ) : (
            <p className="todo-col-empty">{t('panel.todo.pickOne')}</p>
          )}
        </aside>
      ) : null}
    </div>
  );
}

export function TodoRow({
  todo,
  today,
  onComplete,
  onRemoved,
  compact,
  pinEnd,
  doing,
  onSelect,
  selected,
  highlighted,
}: {
  todo: Todo;
  today: string;
  /** 넓은 배치: 줄을 누르면 상세 칸에 연다 (줄 끝 단추는 줄이고 고치기는 상세 칸에서) */
  onSelect?: () => void;
  selected?: boolean;
  /** 방금 추가한 줄을 잠깐 표시한다. 입력 포커스는 옮기지 않는다. */
  highlighted?: boolean;
  /** 진행 중으로 표시한 할 일 (펫 머리 위 말풍선, 이슈 #124) */
  doing?: boolean;
  onComplete: () => void;
  /** 지웠다 (되돌리기 알림) */
  onRemoved?: () => void;
  /** 오늘 탭: 고치기 단추 없이 */
  compact?: boolean;
  /** 고정한 것 가운데 마지막 줄 (아래 고정 안 한 줄과 사이에 선) */
  pinEnd?: boolean;
}) {
  const pinned = todo.pinnedAt !== null;
  const lean = !!onSelect;
  const pinMenu = usePinMenu('todo', todo.id, todo.title, pinned);
  // 진행 중 표시(▶). 안 켠 줄은 마우스를 올리거나 키보드로 오면 보이고, 켠 줄은 늘 강조색으로 보인다
  const doingButton = (on: boolean) => (
    <button
      type="button"
      className={`pin doing-btn ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={
        on ? t('chips.doingStopFor', { title: todo.title }) : t('chips.doingStartFor', { title: todo.title })
      }
      title={on ? t('chips.doingStop') : t('chips.doingStart')}
      onClick={() => bridge.doing(todo.id, !on)}
    >
      <PlayIcon filled={on} />
    </button>
  );
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const dateRef = useRef<HTMLInputElement>(null);
  const [dueMenu, setDueMenu] = useState(false);
  // 미리 알림 고르기 (8판). 마감일이 있을 때만 종이 보인다 (마감일이 없으면 알릴 때가 없다)
  const [reminding, setReminding] = useState(false);
  const sheetId = useId();
  // 단계 (9판 체크리스트): 단추를 누르면 줄 아래에 펼친다
  const [stepping, setStepping] = useState(false);
  const stepsId = useId();
  const progress = stepProgress(todo.steps);
  const stepsButton = (
    <button
      type="button"
      className={`steps-btn ${progress ? 'on' : ''} ${stepping ? 'open' : ''} ${
        progress && progress.done === progress.total ? 'all' : ''
      }`}
      aria-expanded={stepping}
      aria-controls={stepsId}
      aria-label={t('assist.step.open', { title: todo.title })}
      title={t('assist.step.button')}
      onClick={() => setStepping((v) => !v)}
    >
      <StepsIcon />
      {progress && (
        <span>
          {progress.done}/{progress.total}
        </span>
      )}
    </button>
  );
  const due = todo.due ? dueLabel(todo.due, today) : undefined;
  const repeatButton = (
    <button
      type="button"
      className={`repeat ${todo.repeat ? 'on' : ''}`}
      aria-label={
        todo.repeat
          ? t('panel.todo.repeatOn', { label: REPEAT_LABEL[todo.repeat] })
          : t('panel.todo.repeatOff')
      }
      title={
        todo.repeat
          ? t('panel.todo.repeatTitle', { label: REPEAT_LABEL[todo.repeat] })
          : t('panel.todo.repeat')
      }
      onClick={() => bridge.update(todo.id, { repeat: nextRepeat(todo.repeat) })}
    >
      <RepeatIcon />
      {todo.repeat && <span>{REPEAT_LABEL[todo.repeat]}</span>}
    </button>
  );
  const dueText = due
    ? todo.dueMin === null
      ? due.text
      : `${due.text} ${timeLabel(todo.dueMin)}`
    : t('panel.todo.due');
  // 칩 하나가 단추다: 누르면(키보드로도) 운영체제 달력을 연다. 날짜 칸은 단추 뒤에 숨겨 두고 탭으로 오지 않는다
  // (예전엔 투명한 날짜 칸이 칩 위에 겹쳐 키보드로 오면 날짜 조각을 고치는 칸이 됐고 달력은 열리지 않았다)
  const dueChip = (
    <span className={`due ${due?.overdue ? 'overdue' : ''} ${todo.due ? '' : 'none'}`}>
      <button
        type="button"
        className="due-btn"
        title={t('panel.todo.dueDate')}
        aria-label={t('panel.todo.dueFor', { title: todo.title, when: dueText })}
        onClick={() => {
          setDueMenu((v) => !v);
        }}
      >
        {dueText}
      </button>
      {dueMenu && (
        <fieldset className="due-menu" aria-label={t('panel.todo.dueDate')}>
          {(['today', 'tomorrow', 'monday'] as const).map((key) => {
            const d = new Date();
            if (key === 'tomorrow') d.setDate(d.getDate() + 1);
            if (key === 'monday') {
              const days = (8 - d.getDay()) % 7 || 7;
              d.setDate(d.getDate() + days);
            }
            const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  bridge.update(todo.id, { due: date });
                  setDueMenu(false);
                }}
              >
                {t(`panel.todo.dueQuick.${key}`)}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const el = dateRef.current;
              if (!el) return;
              setDueMenu(false);
              try {
                el.showPicker();
              } catch {
                el.focus();
              }
            }}
          >
            {t('panel.todo.dueQuick.pick')}
          </button>
        </fieldset>
      )}
      <input
        ref={dateRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={todo.due ?? ''}
        onChange={(e) => bridge.update(todo.id, { due: e.target.value || null })}
      />
    </span>
  );
  return (
    <>
      <li
        className={`todo ${pinned ? 'pinned' : ''} ${pinEnd ? 'pin-end' : ''} ${selected ? 'selected' : ''} ${highlighted ? 'just-added' : ''}`}
        data-id={todo.id}
        onContextMenu={compact ? undefined : pinMenu.onContextMenu}
      >
        <button
          type="button"
          className="check"
          aria-label={t('panel.todo.complete', { title: todo.title })}
          onClick={onComplete}
        >
          <CheckIcon />
        </button>
        {editing && !lean ? (
          <input
            className="title-edit"
            value={title}
            aria-label={t('panel.todo.editTitle')}
            // biome-ignore lint/a11y/noAutofocus: 고치기를 누른 바로 그 칸이라 커서가 가야 한다
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (title.trim() && title !== todo.title) bridge.update(todo.id, { title });
              else setTitle(todo.title);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
              if (isEsc(e)) {
                takeEsc(e);
                setTitle(todo.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="title"
            dir="auto"
            title={compact || lean ? undefined : t('panel.todo.clickToEdit')}
            aria-current={selected ? 'true' : undefined}
            onClick={() => (lean ? onSelect?.() : !compact && setEditing(true))}
          >
            <span className="title-text">
              {titleParts(todo.title).map((p, i) =>
                p.tag ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 제목 조각은 순서가 곧 자리다
                  <span key={i} className="tag">
                    {p.text}
                  </span>
                ) : (
                  p.text
                ),
              )}
            </span>
          </button>
        )}
        {/* 줄 끝 단추. 마우스를 올려야 나오는 것(extra)은 제목 위에 겹쳐 띄워 제목 폭과 줄 높이가 바뀌지 않게 */}
        <span className="tools">
          {lean ? (
            <>
              {doing && (
                <span
                  className="pin-mark"
                  role="img"
                  aria-label={t('chips.doingMark')}
                  title={t('chips.doingMark')}
                >
                  <PlayIcon filled />
                </span>
              )}
              {pinned && <PinMark />}
              {progress && (
                <span className="steps-badge" title={t('assist.step.button')}>
                  <StepsIcon />
                  {progress.done}/{progress.total}
                </span>
              )}
              {todo.repeat && (
                <span
                  className="repeat-badge"
                  title={t('panel.todo.repeatTitle', { label: REPEAT_LABEL[todo.repeat] })}
                >
                  <RepeatIcon />
                </span>
              )}
              {todo.due && dueChip}
              <button
                type="button"
                className={`star ${todo.important ? 'on' : ''}`}
                aria-pressed={todo.important}
                aria-label={t('panel.todo.importantFor', { title: todo.title })}
                title={t('panel.todo.important')}
                onClick={() => bridge.update(todo.id, { important: !todo.important })}
              >
                <StarIcon />
              </button>
            </>
          ) : (
            <>
              {(!compact || !todo.due) && (
                <span className="extra">
                  {!compact && !doing && doingButton(false)}
                  {!compact && !pinned && (
                    <PinButton kind="todo" id={todo.id} title={todo.title} pinned={false} />
                  )}
                  {!compact && !todo.repeat && repeatButton}
                  {!compact && !progress && stepsButton}
                  {!todo.due && dueChip}
                  {!compact && (
                    <button
                      type="button"
                      className="remove"
                      aria-label={t('panel.todo.remove', { title: todo.title })}
                      onClick={() => {
                        bridge.remove(todo.id);
                        onRemoved?.();
                      }}
                    >
                      ×
                    </button>
                  )}
                </span>
              )}
              {compact && doing && (
                <span
                  className="pin-mark"
                  role="img"
                  aria-label={t('chips.doingMark')}
                  title={t('chips.doingMark')}
                >
                  <PlayIcon filled />
                </span>
              )}
              {!compact && doing && doingButton(true)}
              {compact && pinned && <PinMark />}
              {!compact && pinned && <PinButton kind="todo" id={todo.id} title={todo.title} pinned />}
              {progress && stepsButton}
              {!compact && todo.repeat && repeatButton}
              {!compact && todo.due && (
                <RemindButton
                  name={todo.title}
                  reminds={todo.reminds}
                  dateOnly={todo.dueMin === null}
                  open={reminding}
                  controls={sheetId}
                  onToggle={() => setReminding((v) => !v)}
                />
              )}
              {todo.due && dueChip}
              {!compact && (
                <button
                  type="button"
                  className={`star ${todo.important ? 'on' : ''}`}
                  aria-pressed={todo.important}
                  aria-label={t('panel.todo.importantFor', { title: todo.title })}
                  title={t('panel.todo.important')}
                  onClick={() => bridge.update(todo.id, { important: !todo.important })}
                >
                  <StarIcon />
                </button>
              )}
            </>
          )}
        </span>
        {pinMenu.menu}
      </li>
      {stepping && (
        <li className="steps-sheet-row">
          <StepSheet
            id={stepsId}
            todo={todo}
            onClose={() => setStepping(false)}
            onFinish={() => {
              setStepping(false);
              onComplete();
            }}
          />
        </li>
      )}
      {reminding && !compact && todo.due && (
        <li className="remind-sheet-row">
          <RemindSheet
            id={sheetId}
            reminds={todo.reminds}
            dateOnly={todo.dueMin === null}
            onChange={(reminds) => bridge.update(todo.id, { reminds })}
            onClose={() => setReminding(false)}
            dueTime={{
              due: todo.due,
              minute: todo.dueMin,
              onChange: (dueMin) => bridge.update(todo.id, { dueMin }),
            }}
          />
        </li>
      )}
    </>
  );
}

/** 분(하루 안)을 time 칸 값으로 */
const timeValue = (m: number | null) =>
  m === null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * 넓은 배치의 상세 칸 (이슈 #163): 고른 할 일 하나를 제목, 마감, 단계, 알림, 반복으로 고친다.
 * 고친 값은 줄에서 고칠 때와 같은 길(bridge.update)로 메인에 가고, 메인이 보내는 상태로 목록 줄이 바로 바뀐다.
 * 제목 칸만 글을 들고 있다가 멈추면(또는 칸을 떠나거나 사라질 때) 보낸다.
 */
function TodoDetail({
  todo,
  today,
  onComplete,
  onRemoved,
  onEsc,
}: {
  todo: Todo;
  today: string;
  onComplete: () => void;
  onRemoved: () => void;
  /** Esc: 목록의 그 줄로 돌아간다 */
  onEsc: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [reminding, setReminding] = useState(false);
  // 날짜, 시각 칸은 React 가 값을 쥐지 않는다(비제어): 치는 도중에 값이 ''(덜 찬 칸)로 오면 제어 칸은 달, 일 조각까지 지워 버린다.
  // 메인에서 돌아온 값은 칸을 쓰는 중이 아닐 때만 넣고, 칸을 떠날 때 저장된 값으로 맞춘다
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = dateRef.current;
    if (el && document.activeElement !== el) el.value = todo.due ?? '';
  }, [todo.due]);
  useEffect(() => {
    const el = timeRef.current;
    if (el && document.activeElement !== el) el.value = timeValue(todo.dueMin);
  }, [todo.dueMin]);
  const sheetId = useId();
  const stepsId = useId();
  // 메인에서 제목이 바뀌면(다른 곳에서 고침) 쓰는 중이 아닐 때 따라간다
  const titleRef = useRef<HTMLInputElement>(null);
  const typed = useRef(title);
  typed.current = title;
  const sent = useRef(todo.title);
  useEffect(() => {
    sent.current = todo.title;
    if (document.activeElement !== titleRef.current) setTitle(todo.title);
  }, [todo.title]);
  const commit = () => {
    const v = typed.current;
    if (v.trim() && v !== sent.current) {
      sent.current = v;
      bridge.update(todo.id, { title: v });
    }
  };
  // 사라질 때 보내지 못한 제목을 보낸다 (끝내기, 다른 할 일 고르기, 탭 바꾸기)
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);
  // 0.5초 멈춤을 기다리는 사이 창을 닫거나(beforeunload) 숨겨도(메인이 알린다) 제목을 바로 보낸다
  useEffect(() => {
    const now = () => commitRef.current();
    window.addEventListener('beforeunload', now);
    const off = bridge.onHiding(now);
    return () => {
      window.removeEventListener('beforeunload', now);
      off();
    };
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const due = todo.due ? dueLabel(todo.due, today) : undefined;
  const dateOnly = todo.dueMin === null;
  const keyEsc = (e: React.KeyboardEvent) => {
    if (isEsc(e) && !e.defaultPrevented) {
      takeEsc(e);
      onEsc();
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 상세 칸 안 어디서든 Esc 는 목록으로
    <div className="detail" onKeyDown={keyEsc}>
      <input
        ref={titleRef}
        className="detail-title"
        value={title}
        aria-label={t('panel.todo.editTitle')}
        onChange={(e) => {
          setTitle(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commitRef.current(), 500);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            commit();
            onEsc();
          }
        }}
      />
      <section className="detail-sec">
        <h4>{t('panel.todo.due')}</h4>
        <div className="detail-due">
          <input
            type="date"
            ref={dateRef}
            className="detail-date"
            aria-label={t('panel.todo.dueDate')}
            defaultValue={todo.due ?? ''}
            onChange={(e) => {
              // 치는 도중 값('' , 0002-10-22)은 보내지 않는다. 지우기는 "마감 없애기" 단추로만
              const v = dueToSend(e.target.value);
              if (v !== undefined && v !== todo.due) bridge.update(todo.id, { due: v });
            }}
            onBlur={(e) => {
              e.currentTarget.value = todo.due ?? '';
            }}
          />
          {todo.due && (
            <input
              type="time"
              ref={timeRef}
              className="detail-time"
              aria-label={t('remind.dueTime')}
              defaultValue={timeValue(todo.dueMin)}
              onChange={(e) => {
                const m = minuteToSend(e.target.value);
                if (m !== undefined && m !== todo.dueMin) bridge.update(todo.id, { dueMin: m });
              }}
              onBlur={(e) => {
                e.currentTarget.value = timeValue(todo.dueMin);
              }}
            />
          )}
          {todo.due && todo.dueMin !== null && (
            <button
              type="button"
              className="ghost small"
              onClick={() => bridge.update(todo.id, { dueMin: null })}
            >
              {t('remind.clearTime')}
            </button>
          )}
          {todo.due && !todo.repeat && (
            <button
              type="button"
              className="ghost small"
              onClick={() => bridge.update(todo.id, { due: null })}
            >
              {t('panel.todo.dueClear')}
            </button>
          )}
        </div>
        {due && <p className={`detail-when${due.overdue ? ' overdue' : ''}`}>{due.text}</p>}
      </section>
      <section className="detail-sec">
        <h4>{t('assist.step.button')}</h4>
        <StepSheet id={stepsId} todo={todo} focusEmpty={false} onClose={onEsc} onFinish={onComplete} />
      </section>
      <section className="detail-sec">
        <h4>{t('panel.todo.remindHead')}</h4>
        {todo.due ? (
          <>
            <div className="detail-remind">
              <RemindButton
                name={todo.title}
                reminds={todo.reminds}
                dateOnly={dateOnly}
                open={reminding}
                controls={sheetId}
                onToggle={() => setReminding((v) => !v)}
              />
              <span>{remindSummary(todo.reminds, dateOnly)}</span>
            </div>
            {reminding && (
              <RemindSheet
                id={sheetId}
                reminds={todo.reminds}
                dateOnly={dateOnly}
                onChange={(reminds) => bridge.update(todo.id, { reminds })}
                onClose={() => setReminding(false)}
              />
            )}
          </>
        ) : (
          <p className="rs-hint">{t('remind.needDue')}</p>
        )}
      </section>
      <section className="detail-sec">
        <h4>{t('panel.todo.repeat')}</h4>
        <div className="detail-repeat">
          {([null, ...REPEATS] as const).map((r) => (
            <button
              key={r ?? 'none'}
              type="button"
              className={`len-chip${todo.repeat === r ? ' on' : ''}`}
              aria-pressed={todo.repeat === r}
              onClick={() => bridge.update(todo.id, { repeat: r })}
            >
              {r === null ? t('panel.todo.repeatNone') : REPEAT_LABEL[r]}
            </button>
          ))}
        </div>
      </section>
      <div className="detail-actions">
        <button
          type="button"
          className={`star ${todo.important ? 'on' : ''}`}
          aria-pressed={todo.important}
          aria-label={t('panel.todo.importantFor', { title: todo.title })}
          title={t('panel.todo.important')}
          onClick={() => bridge.update(todo.id, { important: !todo.important })}
        >
          <StarIcon />
        </button>
        <PinButton kind="todo" id={todo.id} title={todo.title} pinned={todo.pinnedAt !== null} />
        <span className="spacer" />
        <button
          type="button"
          className="ghost"
          onClick={() => {
            bridge.remove(todo.id);
            onRemoved();
          }}
        >
          {t('panel.todo.detailRemove')}
        </button>
        <button type="button" className="primary" onClick={onComplete}>
          {t('panel.todo.detailFinish')}
        </button>
      </div>
    </div>
  );
}

/** 이만큼 할 일이 있으면 찾기 단추가 보인다 */
const FIND_FROM = 6;

/** 붙여 넣은 목록 한 줄의 머리 기호 ("- ", "* [ ] ", "1. ") */
const LIST_MARK = /^\s*(?:[-*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/;

/** 할 일 단계 (9판): 하나씩 체크, 고치기, 지우기, 아래 칸에서 더하기. 여러 줄을 붙여 넣으면 줄마다 하나 */
function StepSheet({
  id,
  todo,
  onClose,
  onFinish,
  focusEmpty = true,
}: {
  /** 단계가 없을 때 바로 적을 수 있게 칸에 커서를 둔다. 상세 칸처럼 늘 펼쳐 있는 곳은 끈다 */
  focusEmpty?: boolean;
  id: string;
  todo: Todo;
  onClose: () => void;
  /** 단계를 다 했을 때 "끝내기" */
  onFinish: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const progress = stepProgress(todo.steps);
  const full = todo.steps.length >= STEP_MAX;
  // 단계가 없으면 바로 적을 수 있게
  // biome-ignore lint/correctness/useExhaustiveDependencies: 펼칠 때 한 번
  useEffect(() => {
    if (focusEmpty && todo.steps.length === 0) inputRef.current?.focus();
  }, []);

  const add = async (lines: string[]) => {
    const r = await bridge.stepAdd(todo.id, lines);
    if (!r.ok) {
      setError(r.error ?? t('panel.add.failed'));
      return false;
    }
    setError('');
    return true;
  };

  return (
    <div className="step-sheet" id={id}>
      {todo.steps.length > 0 && (
        <ul className="steps">
          {todo.steps.map((st) => (
            <StepItem key={st.id} step={st} />
          ))}
        </ul>
      )}
      {progress && progress.done === progress.total && (
        <p className="step-done">
          <span>{t('assist.step.allDone')}</span>
          <button type="button" className="primary small" onClick={onFinish}>
            {t('assist.step.finish')}
          </button>
        </p>
      )}
      {!full && (
        <input
          ref={inputRef}
          className="step-add"
          value={text}
          aria-label={t('assist.step.add')}
          placeholder={t('assist.step.placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={async (e) => {
            if (isEsc(e)) {
              takeEsc(e);
              if (text) setText('');
              else onClose();
              return;
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && text.trim()) {
              if (await add([text])) setText('');
            }
          }}
          onPaste={(e) => {
            // 목록을 붙여 넣으면 줄마다 단계 하나 (머리 기호는 뗀다)
            const lines = e.clipboardData
              .getData('text')
              .split(/\r?\n/)
              .map((l) => l.replace(LIST_MARK, '').trim())
              .filter(Boolean);
            if (lines.length < 2) return;
            e.preventDefault();
            void add(lines);
          }}
        />
      )}
      {error && <p className="hint error">{error}</p>}
      {todo.steps.length === 0 && <p className="step-hint">{t('assist.step.hint')}</p>}
    </div>
  );
}

function StepItem({ step }: { step: TodoStep }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  return (
    <li className={`step ${step.done ? 'done-step' : ''}`}>
      <button
        type="button"
        className={`check ${step.done ? 'on' : ''}`}
        aria-pressed={step.done}
        aria-label={t(step.done ? 'assist.step.uncheck' : 'assist.step.check', { title: step.title })}
        onClick={() => bridge.stepToggle(step.id, !step.done)}
      >
        <CheckIcon />
      </button>
      {editing ? (
        <input
          className="title-edit"
          value={title}
          aria-label={t('panel.todo.editTitle')}
          // biome-ignore lint/a11y/noAutofocus: 고치기를 누른 바로 그 칸이라 커서가 가야 한다
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title !== step.title) bridge.stepRename(step.id, title);
            else setTitle(step.title);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
            if (isEsc(e)) {
              takeEsc(e);
              setTitle(step.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="title" dir="auto" onClick={() => setEditing(true)}>
          {step.title}
        </button>
      )}
      <button
        type="button"
        className="remove"
        aria-label={t('assist.step.remove', { title: step.title })}
        onClick={() => bridge.stepRemove(step.id)}
      >
        ×
      </button>
    </li>
  );
}
