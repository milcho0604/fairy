import { useEffect, useId, useRef, useState } from 'react';
import { timeLabel } from '../../../shared/event-store.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelAddResult, PanelState } from '../../../shared/ipc.ts';
import { pinFirst } from '../../../shared/pin.ts';
import { dueLabel } from '../../../shared/quick-add.ts';
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
import { CheckIcon, PlayIcon, RepeatIcon, SearchIcon, StarIcon, StepsIcon } from './icons.tsx';
import { isEsc, takeEsc } from './keys.ts';
import { MoreRow } from './more.tsx';
import { pageOf } from './paging.ts';
import { PinButton, PinMark, usePinMenu } from './pin.tsx';
import { RemindButton, RemindSheet } from './RemindPicker.tsx';
import { TrashBox } from './TrashBox.tsx';

const bridge = window.jjakkungPanel;
/** 쓰다 만 한 줄. 다른 곳을 눌러 패널이 닫혀도 다음에 열면 그대로 있다 */
const DRAFT_KEY = 'jj.panel.todoDraft';

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(text: string) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 못 적으면 이번 창에서만 남는다
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
  const [text, setTextState] = useState(readDraft);
  const setText = (next: string) => {
    setTextState(next);
    writeDraft(next);
  };
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);
  // 찾기와 태그 (할 일이 많을 때 좁혀 보기)
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  /** 그린 쪽 수 (찾는 말과 태그마다) */
  const [paging, setPaging] = useState({ key: '', pages: 1 });
  const findRef = useRef<HTMLInputElement>(null);
  const tags = allTags(s.open);
  // 고른 태그가 목록에서 사라지면(마지막 것을 끝냄) 모두로
  const picked = tag && tags.some((x) => x.tag.toLowerCase() === tag.toLowerCase()) ? tag : null;
  // 고정한 것을 맨 위로 (고정한 순서), 아래는 원래 정렬 (중요, 마감 순)
  const shown = pinFirst(filterTodos(s.open, { query: finding ? query : '', tag: picked, composing }));
  const lastPinned = shown.findLast((todo) => todo.pinnedAt !== null)?.id;
  const filtered = shown.length !== s.open.length;
  // 앞에서부터 한 쪽씩 그린다 (paging.ts). 찾는 말이나 태그가 바뀌면 첫 쪽부터
  const pageKey = `${finding ? query : ''}\u0000${picked ?? ''}`;
  const pages = paging.key === pageKey ? paging.pages : 1;
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
    onAdded(r, value);
  };

  return (
    <>
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
      {tags.length > 0 && (
        <fieldset className="tag-chips" aria-label={t('assist.tag.nav')}>
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
      )}

      <ul className="todos scroll">
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
    </>
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
}: {
  todo: Todo;
  today: string;
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
          const el = dateRef.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
      >
        {dueText}
      </button>
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
        className={`todo ${pinned ? 'pinned' : ''} ${pinEnd ? 'pin-end' : ''}`}
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
            title={compact ? undefined : t('panel.todo.clickToEdit')}
            onClick={() => !compact && setEditing(true)}
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
}: {
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
    if (todo.steps.length === 0) inputRef.current?.focus();
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
