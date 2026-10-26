import { useEffect, useId, useRef, useState } from 'react';
import { dueChoices } from '../../../shared/due-choices.ts';
import { timeLabel } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelAddResult, PanelState } from '../../../shared/ipc.ts';
import { pinFirst } from '../../../shared/pin.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
import { remindSummary } from '../../../shared/remind-text.ts';
import { allTags, filterTodos, titleParts } from '../../../shared/todo-filter.ts';
import { dropPlace, type MoveDir, moveTarget } from '../../../shared/todo-move.ts';
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
import './rows.css';
import { useDraft } from './draft.ts';
import { dueToSend, minuteToSend } from './due-input.ts';
import {
  BellIcon,
  CheckIcon,
  GripIcon,
  MoreIcon,
  PinIcon,
  PlayIcon,
  RepeatIcon,
  SearchIcon,
  StarIcon,
  StepsIcon,
} from './icons.tsx';
import { isEsc, takeEsc } from './keys.ts';
import { MoreRow } from './more.tsx';
import { LIST_PAGE, pageOf } from './paging.ts';
import { PinButton, PinMark } from './pin.tsx';
import { RemindButton, RemindSheet } from './RemindPicker.tsx';
import { type MenuItem, useMenu } from './row-menu.tsx';
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
  // 줄 하나가 탭 정지점 하나: 마지막으로 초점이 간 줄이 정지점 (없으면 첫 줄)
  const [activeRow, setActiveRow] = useState<number>();
  // 순서 끌기: 끄는 줄과 지금 올려 둔 줄
  const [drag, setDrag] = useState<{ id: number; over?: number }>();
  // 방금 넣은 줄 (스크롤하고 1초 알린다)과 순서를 바꾼 줄 (초점을 돌려주고 읽어 준다)
  const [flashIds, setFlashIds] = useState<number[]>([]);
  const pendingFlash = useRef<{ ids: number[]; until: number }>({ ids: [], until: 0 });
  const pendingMove = useRef<{ id: number; focus: boolean; until: number }>({
    id: 0,
    focus: false,
    until: 0,
  });
  const [said, setSaid] = useState('');
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
    // 새로 넣은 줄이 어디 있는지 알리려고 기억해 둔다 (상태가 오면 그 줄까지 스크롤하고 알린다)
    const ids =
      r.kind === 'todo'
        ? [r.id]
        : r.kind === 'many'
          ? r.items.filter((i) => i.kind === 'todo').map((i) => i.id)
          : [];
    if (ids.length > 0) pendingFlash.current = { ids, until: Date.now() + 4000 };
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
  const detailRef = useRef<HTMLElement>(null);
  const rowEl = (id: number) => listRef.current?.querySelector<HTMLElement>(`li.todo[data-id="${id}"]`);
  /** 상세 칸에서 Esc: 목록의 그 줄로 돌아간다 */
  const backToRow = (id: number) => requestAnimationFrame(() => rowEl(id)?.focus());
  /** 넓은 배치에서 줄에서 Enter: 상세 칸 제목으로 간다 */
  const toDetail = () =>
    requestAnimationFrame(() => detailRef.current?.querySelector<HTMLElement>('.detail-title')?.focus());

  // 상태가 바뀌면(넣은 뒤, 순서를 바꾼 뒤): 방금 넣은 줄까지 굴려 1초 알리고, 순서를 바꾼 줄에 초점을 돌려주고 읽어 준다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 목록이 바뀔 때만
  useEffect(() => {
    const now = Date.now();
    const fl = pendingFlash.current;
    if (fl.ids.length > 0 && now > fl.until) pendingFlash.current = { ids: [], until: 0 };
    else if (fl.ids.length > 0) {
      const at = fl.ids.map((id) => shown.findIndex((x) => x.id === id)).filter((i) => i >= 0);
      if (at.length > 0) {
        pendingFlash.current = { ids: [], until: 0 };
        // 긴 목록은 앞에서부터 쪽으로 그린다: 그 줄이 있는 쪽까지 그린다
        const need = Math.ceil((Math.max(...at) + 1) / LIST_PAGE);
        if (need > pages) setPaging({ key: pageKey, pages: need });
        setFlashIds(fl.ids);
      }
    }
    const mv = pendingMove.current;
    if (mv.id !== 0 && now > mv.until) pendingMove.current = { id: 0, focus: false, until: 0 };
    else if (mv.id !== 0) {
      const i = shown.findIndex((x) => x.id === mv.id);
      if (i >= 0) {
        pendingMove.current = { id: 0, focus: false, until: 0 };
        const todo = shown[i];
        if (todo) setSaid(t('rows.moved', { title: todo.title, n: i + 1, total: shown.length }));
        if (mv.focus) requestAnimationFrame(() => rowEl(mv.id)?.focus());
      }
    }
  }, [s.open]);
  // 알릴 줄: 그 줄이 보이게 굴리고 1초 뒤 끈다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 알릴 줄이 바뀔 때만
  useEffect(() => {
    if (flashIds.length === 0) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      rowEl(flashIds[0] as number)?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' }),
    );
    const timer = setTimeout(() => setFlashIds([]), 1000);
    return () => clearTimeout(timer);
  }, [flashIds]);

  /** 한 줄을 dir 쪽으로 옮긴다. 옮긴 뒤 상태가 오면 초점을 그 줄에 돌려준다 (줄 안에 초점이 있었을 때만) */
  const moveRow = (todo: Todo, dir: MoveDir) => {
    const place = moveTarget(shown, todo.id, dir);
    if (!place) return;
    const had = !!rowEl(todo.id)?.contains(document.activeElement);
    pendingMove.current = {
      id: todo.id,
      focus: had || document.activeElement === document.body,
      until: Date.now() + 3000,
    };
    bridge.place(todo.id, place.target, place.after);
  };
  const orderOf = (todo: Todo) => ({
    can: {
      top: !!moveTarget(shown, todo.id, 'top'),
      up: !!moveTarget(shown, todo.id, 'up'),
      down: !!moveTarget(shown, todo.id, 'down'),
      bottom: !!moveTarget(shown, todo.id, 'bottom'),
    },
    move: (dir: MoveDir) => moveRow(todo, dir),
    dragStart: () => setDrag({ id: todo.id }),
    dragOver: () => setDrag((d) => (d && d.over !== todo.id ? { ...d, over: todo.id } : d)),
    drop: () => {
      const place = drag ? dropPlace(shown, drag.id, todo.id) : undefined;
      if (drag && place) {
        pendingMove.current = { id: drag.id, focus: false, until: Date.now() + 3000 };
        bridge.place(drag.id, place.target, place.after);
      }
      setDrag(undefined);
    },
    dragEnd: () => setDrag(undefined),
    dragging: drag?.id === todo.id,
    over: !!drag && drag.over === todo.id && drag.id !== todo.id,
  });
  // 탭 키가 서는 줄: 마지막으로 초점이 간 줄 (그 줄이 보이지 않으면 첫 줄)
  const tabRow = page.shown.some((x) => x.id === activeRow) ? activeRow : page.shown[0]?.id;

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

        <ul className="todos scroll" ref={listRef}>
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
              onComplete={() => onComplete(todo)}
              onRemoved={() => onRemoved(todo)}
              rowTab={todo.id === tabRow}
              onRowFocus={() => {
                setActiveRow(todo.id);
                if (wide) select(todo.id);
              }}
              order={orderOf(todo)}
              flash={flashIds.includes(todo.id)}
              {...(wide
                ? {
                    onSelect: () => select(todo.id),
                    onEdit: toDetail,
                    onGo: select,
                    selected: todo.id === selected?.id,
                  }
                : {})}
            />
          ))}
          <MoreRow rest={page.rest} onMore={() => setPaging({ key: pageKey, pages: pages + 1 })} />
        </ul>
        {/* 키보드로 순서를 바꾸면 어디로 갔는지 읽어 준다 */}
        <p className="sr-only" role="status" aria-live="polite">
          {said}
        </p>

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

/** 줄 순서 바꾸기에 필요한 것 (할 일 탭만 준다. 오늘 탭 줄은 순서를 바꾸지 않는다) */
export interface RowOrder {
  /** 이 방향으로 옮길 수 있는가 (이미 그 끝이거나 고정한 줄이면 거짓) */
  can: Record<MoveDir, boolean>;
  move: (dir: MoveDir) => void;
  /** 끌기 */
  dragStart: () => void;
  dragOver: () => void;
  drop: () => void;
  dragEnd: () => void;
  dragging: boolean;
  over: boolean;
}

/** 줄 이웃 (같은 목록의 앞뒤 줄) */
const rowAround = (row: HTMLElement, step: 1 | -1) => {
  const rows = [...(row.closest('ul')?.querySelectorAll<HTMLElement>('li.todo[data-id]') ?? [])];
  return rows[rows.indexOf(row) + step];
};

export function TodoRow({
  todo,
  today,
  onComplete,
  onRemoved,
  compact,
  pinEnd,
  doing,
  onSelect,
  onEdit,
  onGo,
  selected,
  rowTab,
  onRowFocus,
  order,
  flash,
}: {
  todo: Todo;
  today: string;
  /** 넓은 배치: 줄을 누르면 상세 칸에 연다 (줄 끝 단추는 줄이고 고치기는 상세 칸에서) */
  onSelect?: () => void;
  /** 넓은 배치에서 Enter: 상세 칸 제목으로 간다 */
  onEdit?: () => void;
  /** 화살표로 다른 줄로 갔다 (넓은 배치는 그 줄을 상세 칸에 연다) */
  onGo?: (id: number) => void;
  selected?: boolean;
  /** 진행 중으로 표시한 할 일 (펫 머리 위 말풍선, 이슈 #124) */
  doing?: boolean;
  onComplete: () => void;
  /** 지웠다 (되돌리기 알림) */
  onRemoved?: () => void;
  /** 오늘 탭: 고치기 단추 없이 */
  compact?: boolean;
  /** 고정한 것 가운데 마지막 줄 (아래 고정 안 한 줄과 사이에 선) */
  pinEnd?: boolean;
  /** 목록 전체에서 탭 키가 서는 줄인가 (줄 하나가 탭 정지점 하나. 오늘 탭 줄은 주지 않는다) */
  rowTab?: boolean;
  /** 줄에 초점이 왔다 (탭 정지점을 이 줄로 옮긴다) */
  onRowFocus?: () => void;
  order?: RowOrder;
  /** 방금 넣은 줄: 잠깐 배경으로 알린다 */
  flash?: boolean;
}) {
  const pinned = todo.pinnedAt !== null;
  const lean = !!onSelect;
  const roving = rowTab !== undefined;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const dateRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  // 미리 알림 고르기 (8판). 마감일이 있을 때만 (마감일이 없으면 알릴 때가 없다)
  const [reminding, setReminding] = useState(false);
  const sheetId = useId();
  // 단계 (9판 체크리스트): 줄 아래에 펼친다
  const [stepping, setStepping] = useState(false);
  const stepsId = useId();
  const progress = stepProgress(todo.steps);
  const stepsButton = (
    <button
      type="button"
      className={`steps-btn ${progress ? 'on' : ''} ${stepping ? 'open' : ''} ${
        progress && progress.done === progress.total ? 'all' : ''
      }`}
      tabIndex={roving ? -1 : undefined}
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
  const dueText = due
    ? todo.dueMin === null
      ? due.text
      : `${due.text} ${timeLabel(todo.dueMin)}`
    : t('panel.todo.due');
  const pickDate = () => {
    const el = dateRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  // 마감 고르기 메뉴 (칩 누르기, 줄 메뉴의 "마감 바꾸기"): 오늘, 내일, 다음 주 월요일, 날짜 고르기, 마감 없애기
  const dueMenu = useMenu(t('rows.due.menu', { title: todo.title }), () => [
    ...dueChoices(today).map((c) => ({
      key: c.key,
      label: c.key === 'nextMon' ? t('rows.due.nextMon') : dueLabel(c.day, today).text,
      ...(c.key === 'nextMon'
        ? { hint: t('panel.due.date', { m: Number(c.day.slice(5, 7)), d: Number(c.day.slice(8, 10)) }) }
        : {}),
      checked: todo.due === c.day,
      onSelect: () => bridge.update(todo.id, { due: c.day }),
    })),
    { key: 'pick', label: t('rows.due.pick'), sepBefore: true, onSelect: pickDate },
    ...(todo.due && !todo.repeat
      ? [
          {
            key: 'clear',
            label: t('panel.todo.dueClear'),
            onSelect: () => bridge.update(todo.id, { due: null }),
          },
        ]
      : []),
  ]);
  const openDue = () => {
    const anchor = dueRef.current ?? moreRef.current;
    if (anchor) dueMenu.openFrom(anchor);
  };
  const dueChip = (
    <span ref={dueRef} className={`due ${due?.overdue ? 'overdue' : ''} ${todo.due ? '' : 'none'}`}>
      <button
        type="button"
        className="due-btn"
        tabIndex={roving ? -1 : undefined}
        title={t('panel.todo.dueDate')}
        aria-haspopup="menu"
        aria-label={t('panel.todo.dueFor', { title: todo.title, when: dueText })}
        onClick={openDue}
      >
        {dueText}
      </button>
    </span>
  );
  const liRef = useRef<HTMLLIElement>(null);
  /** 이 줄에 초점이 있으면 줄이 사라지기 전에 이웃 줄로 옮겨 둔다 (끝내기, 지우기 뒤에 초점이 사라지지 않게) */
  const leaveRow = () => {
    const li = liRef.current;
    if (li?.contains(document.activeElement)) (rowAround(li, 1) ?? rowAround(li, -1))?.focus();
  };
  const finish = () => {
    leaveRow();
    onComplete();
  };
  const remove = () => {
    leaveRow();
    bridge.remove(todo.id);
    onRemoved?.();
  };
  // 줄 메뉴: 줄 끝에 겹쳐 뜨던 단추 6개를 모았다. 넓은 배치는 마감, 반복, 알림, 단계를 상세 칸에서 고쳐서 뺀다
  const rowMenu = useMenu(t('pin.menu', { title: todo.title }), () => {
    const items: MenuItem[] = [
      {
        key: 'doing',
        label: doing ? t('rows.doStop') : t('rows.doStart'),
        icon: <PlayIcon filled={!!doing} />,
        onSelect: () => bridge.doing(todo.id, !doing),
      },
      {
        key: 'pin',
        label: pinned ? t('pin.unpin') : t('pin.pin'),
        icon: <PinIcon />,
        onSelect: () => bridge.pin('todo', todo.id, !pinned),
      },
      {
        key: 'important',
        label: todo.important ? t('rows.importantOff') : t('rows.important'),
        icon: <StarIcon />,
        onSelect: () => bridge.update(todo.id, { important: !todo.important }),
      },
    ];
    if (!lean) {
      items.push(
        { key: 'due', label: t('rows.due'), onSelect: openDue },
        {
          key: 'repeat',
          label: t('rows.repeat', {
            label: todo.repeat ? REPEAT_LABEL[todo.repeat] : t('panel.todo.repeatNone'),
          }),
          hint: t('rows.repeatHint'),
          icon: <RepeatIcon />,
          onSelect: () => bridge.update(todo.id, { repeat: nextRepeat(todo.repeat) }),
        },
        {
          key: 'steps',
          label: stepping ? t('rows.stepsHide') : t('rows.steps'),
          icon: <StepsIcon />,
          onSelect: () => setStepping((v) => !v),
        },
      );
      if (todo.due)
        items.push({
          key: 'remind',
          label: t('rows.remind'),
          icon: <BellIcon />,
          onSelect: () => setReminding((v) => !v),
        });
    }
    if (order && !pinned) {
      const moves: [MoveDir, string][] = [
        ['top', 'rows.top'],
        ['up', 'rows.up'],
        ['down', 'rows.down'],
        ['bottom', 'rows.bottom'],
      ];
      moves.forEach(([dir, key], i) => {
        items.push({
          key: `move-${dir}`,
          label: t(key as 'rows.top'),
          disabled: !order.can[dir],
          ...(i === 0 ? { sepBefore: true } : {}),
          onSelect: () => order.move(dir),
        });
      });
    }
    items.push({ key: 'remove', label: t('rows.remove'), danger: true, sepBefore: true, onSelect: remove });
    return items;
  });
  const moreButton = (
    <button
      ref={moreRef}
      type="button"
      className="row-more"
      tabIndex={roving ? -1 : undefined}
      aria-haspopup="menu"
      aria-expanded={rowMenu.open}
      aria-label={t('pin.menu', { title: todo.title })}
      title={t('rows.more')}
      onClick={() => rowMenu.openFrom(moreRef.current as HTMLElement)}
    >
      <MoreIcon />
    </button>
  );
  // 줄에 초점이 있을 때 키: 위아래 줄 이동, Space 끝내기, Enter 고치기, Delete 지우기, Alt+위아래 순서 (줄 안 단추와 칸의 키는 건드리지 않는다)
  const onRowKey = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing || !roving) return;
    const row = e.currentTarget;
    const go = (el: HTMLElement | undefined) => {
      if (!el) return;
      e.preventDefault();
      el.focus();
      onGo?.(Number(el.dataset.id));
    };
    const rows = [...(row.closest('ul')?.querySelectorAll<HTMLElement>('li.todo[data-id]') ?? [])];
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 'up' : 'down';
      if (order?.can[dir]) order.move(dir);
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowDown') go(rowAround(row, 1));
    else if (e.key === 'ArrowUp') go(rowAround(row, -1));
    else if (e.key === 'Home') go(rows[0]);
    else if (e.key === 'End') go(rows.at(-1));
    else if (e.key === ' ') {
      e.preventDefault();
      finish();
    } else if (e.key === 'Enter' || (lean && e.key === 'ArrowRight')) {
      e.preventDefault();
      if (lean) {
        onSelect?.();
        onEdit?.();
      } else setEditing(true);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove();
    }
  };
  const doingMark = doing && (
    <span className="pin-mark" role="img" aria-label={t('chips.doingMark')} title={t('chips.doingMark')}>
      <PlayIcon filled />
    </span>
  );
  const starMark = todo.important && (
    <button
      type="button"
      className="star on"
      tabIndex={roving ? -1 : undefined}
      aria-pressed
      aria-label={t('panel.todo.importantFor', { title: todo.title })}
      title={t('panel.todo.important')}
      onClick={() => bridge.update(todo.id, { important: false })}
    >
      <StarIcon />
    </button>
  );
  return (
    <>
      <li
        ref={liRef}
        className={`todo ${pinned ? 'pinned' : ''} ${pinEnd ? 'pin-end' : ''} ${selected ? 'selected' : ''} ${
          flash ? 'flash' : ''
        } ${order?.dragging ? 'dragging' : ''} ${order?.over ? 'drop-over' : ''}`}
        data-id={todo.id}
        data-find-key={`todo:${todo.id}`}
        tabIndex={roving ? (rowTab ? 0 : -1) : undefined}
        aria-keyshortcuts={
          roving ? 'ArrowUp ArrowDown Space Enter Delete Alt+ArrowUp Alt+ArrowDown' : undefined
        }
        onKeyDown={onRowKey}
        onFocus={roving ? onRowFocus : undefined}
        onContextMenu={compact ? undefined : rowMenu.onContextMenu}
        onDragOver={
          order
            ? (e) => {
                e.preventDefault();
                order.dragOver();
              }
            : undefined
        }
        onDrop={
          order
            ? (e) => {
                e.preventDefault();
                order.drop();
              }
            : undefined
        }
      >
        {order && !pinned && (
          // biome-ignore lint/a11y/noStaticElementInteractions: 끌기 손잡이는 마우스 몫이다 (키보드는 Alt+위아래와 줄 메뉴)
          <span
            className="grip"
            draggable
            role="presentation"
            title={t('rows.grip')}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(todo.id));
              const li = (e.currentTarget as HTMLElement).closest('li');
              if (li) e.dataTransfer.setDragImage(li, 12, 12);
              order.dragStart();
            }}
            onDragEnd={order.dragEnd}
          >
            <GripIcon />
          </span>
        )}
        <button
          type="button"
          className="check"
          tabIndex={roving ? -1 : undefined}
          aria-label={t('panel.todo.complete', { title: todo.title })}
          onClick={finish}
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
              // 고치고 나면 그 줄로 돌아온다 (줄이 탭 정지점). 칸이 사라지기 전에 줄을 잡아 둔다
              const row = (e.target as HTMLElement).closest('li');
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                (e.target as HTMLInputElement).blur();
                requestAnimationFrame(() => row?.focus());
              }
              if (isEsc(e)) {
                takeEsc(e);
                setTitle(todo.title);
                setEditing(false);
                requestAnimationFrame(() => row?.focus());
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="title"
            dir="auto"
            tabIndex={roving ? -1 : undefined}
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
        {/* 줄 끝. 제목 폭을 먼저 남기고 표시와 "..." 만 둔다 (예전엔 마우스를 올리면 단추 6개가 제목 위에 겹쳤다) */}
        <span className="tools">
          {compact ? (
            <>
              {doingMark}
              {pinned && <PinMark />}
              {progress && stepsButton}
              {dueChip}
            </>
          ) : (
            <>
              {doingMark}
              {pinned && <PinMark />}
              {progress &&
                (lean ? (
                  <span className="steps-badge" title={t('assist.step.button')}>
                    <StepsIcon />
                    {progress.done}/{progress.total}
                  </span>
                ) : (
                  stepsButton
                ))}
              {todo.repeat && (
                <span
                  className="repeat-badge"
                  title={t('panel.todo.repeatTitle', { label: REPEAT_LABEL[todo.repeat] })}
                >
                  <RepeatIcon />
                  {!lean && <span>{REPEAT_LABEL[todo.repeat]}</span>}
                </span>
              )}
              {todo.due && dueChip}
              {starMark}
              {moreButton}
            </>
          )}
          {/* 날짜 고르기 달력이 뜰 자리 (보이지 않는다) */}
          <input
            ref={dateRef}
            className="due-pick"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={todo.due ?? ''}
            onChange={(e) => bridge.update(todo.id, { due: e.target.value || null })}
          />
        </span>
        {compact ? dueMenu.menu : null}
        {compact ? null : rowMenu.menu}
        {compact ? null : dueMenu.menu}
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
