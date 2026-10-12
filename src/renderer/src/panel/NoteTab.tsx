import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { NoteAiKind, NoteHit, NoteSummary, PanelState } from '../../../shared/ipc.ts';
import { POLISH_MAX, type PolishReply, splicePolished } from '../../../shared/note-polish.ts';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type Note } from '../../../shared/note-store.ts';
import { pinFirst } from '../../../shared/pin.ts';
import { ago } from './format.ts';
import { isEsc, takeEsc } from './keys.ts';
import { type NoteResume, parseResume, RESUME_KEY } from './note-resume.ts';
import { PinButton, usePinMenu } from './pin.tsx';

const bridge = window.jjakkungPanel;
const SAVE_MS = 400;
/** 다듬은 글로 바꾼 뒤 되돌리기를 보여 주는 시간 */
const UNDO_MS = 10_000;
/** 글 칸을 떠난 뒤 이 안에 다듬기를 누르면 떠나기 전에 고른 부분을 다듬는다 (키보드로 단추까지 오는 사이) */
const SEL_KEEP_MS = 30_000;
const POLISH_ERROR = {
  fail: 'panel.note.polishFail',
  locked: 'panel.note.polishLocked',
  tooLong: 'panel.note.polishTooLong',
} as const;

/** 다듬기 상태: 기다리는 중, 또는 받은 글 (어느 자리를 다듬었는지와 함께) */
type Polish = { phase: 'busy' } | { phase: 'ready'; text: string; start: number; end: number };

function readResume(): NoteResume | undefined {
  try {
    return parseResume(localStorage.getItem(RESUME_KEY), Date.now());
  } catch {
    return undefined;
  }
}

function writeResume(r: NoteResume | undefined) {
  try {
    if (r) localStorage.setItem(RESUME_KEY, JSON.stringify(r));
    else localStorage.removeItem(RESUME_KEY);
  } catch {
    // 못 적으면 다음에 목록에서 연다
  }
}

/** 메모 (v1): 목록과 고치기. 고치면 잠깐 뒤 저절로 저장한다. */
export function NoteTab({ s, onRemoved }: { s: PanelState; onRemoved: (id: number) => void }) {
  const [open, setOpen] = useState<Note>();
  /** 다른 곳을 눌러 닫혔던 메모 자리. 여는 동안(메모를 읽는 동안)은 목록을 그리지 않는다 */
  const [resume, setResume] = useState<NoteResume | undefined>(readResume);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  /** 본문까지 찾은 결과 (메인에서). 새 결과가 올 때까지 앞 결과를 둔다 */
  const [hits, setHits] = useState<NoteHit[]>();
  const searchSeq = useRef(0);
  const now = Date.now();

  // biome-ignore lint/correctness/useExhaustiveDependencies: 탭을 열 때 한 번만
  useEffect(() => {
    if (!resume) {
      writeResume(undefined);
      return;
    }
    bridge.noteGet(resume.id).then((n) => {
      if (n) setOpen(n);
      else {
        writeResume(undefined);
        setResume(undefined);
      }
    });
  }, []);

  const q = query.trim();
  // biome-ignore lint/correctness/useExhaustiveDependencies: 메모가 바뀌면(s.notes) 다시 찾는다
  useEffect(() => {
    if (!q) {
      setHits(undefined);
      return;
    }
    const seq = ++searchSeq.current;
    bridge.noteSearch(query, composing).then((r) => {
      if (seq === searchSeq.current) setHits(r);
    });
  }, [query, composing, s.notes]);

  if (open)
    return (
      <NoteEditor
        note={open}
        resume={resume}
        onBack={() => {
          setResume(undefined);
          setOpen(undefined);
        }}
        onRemoved={onRemoved}
      />
    );
  if (resume) return null;

  // 첫 결과가 오기 전에는 목록에 있는 제목과 미리보기로 먼저 거른다
  const local = q.toLowerCase();
  const hitOf = new Map((hits ?? []).map((h) => [h.id, h]));
  // 고정한 것을 맨 위로 (고정한 순서), 아래는 최근에 고친 것부터. 찾을 때도 같다
  const list = pinFirst(
    !q
      ? s.notes
      : hits
        ? s.notes.filter((n) => hitOf.has(n.id))
        : s.notes.filter((n) => `${n.title} ${n.preview}`.toLowerCase().includes(local)),
  );
  const lastPinned = list.findLast((n) => n.pinnedAt !== null)?.id;
  return (
    <>
      <div className="add row">
        <input
          value={query}
          aria-label={t('panel.note.search')}
          placeholder={
            s.notes.length > 0 ? t('panel.note.searchIn', { n: s.notes.length }) : t('panel.note.search')
          }
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            // 찾는 말이 있으면 Esc 는 먼저 그것만 지운다 (한 번 더 누르면 패널이 닫힌다)
            if (isEsc(e) && query) {
              takeEsc(e);
              setQuery('');
            }
          }}
        />
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const n = await bridge.noteAdd();
            setOpen(n);
          }}
        >
          {t('panel.note.new')}
        </button>
      </div>
      <ul className="notes scroll">
        {list.length === 0 && (
          <li className="empty">{q ? t('panel.note.notFound') : t('panel.note.empty.list')}</li>
        )}
        {list.map((n) => (
          <NoteRow
            key={n.id}
            n={n}
            hit={hitOf.get(n.id)}
            now={now}
            pinEnd={n.id === lastPinned && list.at(-1)?.id !== n.id}
            onOpen={async () => {
              const full = await bridge.noteGet(n.id);
              if (full) setOpen(full);
            }}
          />
        ))}
      </ul>
    </>
  );
}

/** 메모 목록 한 줄: 누르면 연다. 오른쪽 위 고정 단추, 우클릭 메뉴 */
function NoteRow({
  n,
  hit,
  now,
  pinEnd,
  onOpen,
}: {
  n: NoteSummary;
  hit: NoteHit | undefined;
  now: number;
  /** 고정한 것 가운데 마지막 줄 (아래 고정 안 한 줄과 사이에 선) */
  pinEnd: boolean;
  onOpen: () => void;
}) {
  const pinned = n.pinnedAt !== null;
  const pinMenu = usePinMenu('note', n.id, n.title, pinned);
  return (
    <li
      className={`note-row ${pinned ? 'pinned' : ''} ${pinEnd ? 'pin-end' : ''}`}
      onContextMenu={pinMenu.onContextMenu}
    >
      <button type="button" onClick={onOpen}>
        <span className="note-title" dir="auto">
          {n.source === 'ai' && <i className="tag">AI</i>}
          {n.title}
        </span>
        <span className="note-meta">
          <span className="when">{ago(n.updatedAt, now)}</span>
          {hit?.snippet && hit.mark ? (
            <span className="preview snippet">
              {hit.snippet.slice(0, hit.mark[0])}
              <mark>{hit.snippet.slice(hit.mark[0], hit.mark[1])}</mark>
              {hit.snippet.slice(hit.mark[1])}
            </span>
          ) : (
            n.preview &&
            n.preview !== n.title && (
              <span className="preview" dir="auto">
                {n.preview}
              </span>
            )
          )}
        </span>
      </button>
      <PinButton kind="note" id={n.id} title={n.title} pinned={pinned} />
      {pinMenu.menu}
    </li>
  );
}

function NoteEditor({
  note,
  resume,
  onBack,
  onRemoved,
}: {
  note: Note;
  /** 다른 곳을 눌러 닫혔던 자리 (커서, 스크롤) */
  resume?: NoteResume;
  onBack: () => void;
  onRemoved: (id: number) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ title?: string; body?: string }>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  /** 열 때 비어 있던 메모 ("새 메모"). 빈 채로 나가면 소리 없이 지운다 */
  const wasEmpty = !note.title.trim() && !note.body.trim();
  /** 지금 글. 창이 닫힐 때와 나갈 때 쓰는 함수는 처음 그릴 때 만든 것이라 state 대신 여기서 읽는다 */
  const latest = useRef({ title, body });
  latest.current = { title, body };
  /** 지웠다 (뒤로 나가며 빈 것을 지웠거나 지우기 단추). 두 번 지우지 않게 */
  const gone = useRef(false);
  const isEmpty = () => !latest.current.title.trim() && !latest.current.body.trim();

  /** 고정 (열 때 받은 값에서 시작해 여기서 바꾼다) */
  const [pinned, setPinned] = useState(note.pinnedAt !== null);
  const [aiNote, setAiNote] = useState('');
  /** AI 로 정리: 채팅 창이 열리고 답이 그리로 온다. 답 아래 "할 일로"로 넣는다 */
  const askAi = async (kind: NoteAiKind) => {
    flush();
    if (!(await bridge.noteAi(note.id, kind))) {
      setAiNote(t('panel.note.aiBusy'));
      setTimeout(() => setAiNote(''), 3000);
    }
  };
  // ---- 다듬기: 받은 글을 원래 글 위에 보여 주고, 바꾸기를 눌러야 바꾼다. 기다리는 동안과 견주는 동안은 글을 잠근다
  const [polish, setPolish] = useState<Polish>();
  const [undo, setUndo] = useState<string>();
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      clearTimeout(undoTimer.current);
    },
    [],
  );
  /** 지금 AI 이름 (단추 풀이와 진행 글) */
  const [aiName, setAiName] = useState('');
  /** 글 칸을 떠나기 직전에 고른 자리. 키보드로 단추에 오면 글 칸에 커서가 없어서 여기서 읽는다 */
  const lastSel = useRef<{ start: number; end: number; at: number }>(undefined);
  const notice = (text: string) => {
    setAiNote(text);
    setTimeout(() => setAiNote(''), 5000);
  };
  const receive = (r: PolishReply) => {
    // 그새 목록으로 나갔으면 받지 않는다 (메인이 들고 있다가 이 메모를 다시 열 때 준다)
    if (!alive.current) return;
    bridge.notePolishTaken(note.id);
    if (!r.ok) {
      setPolish(undefined);
      if (r.error !== 'none') notice(t(POLISH_ERROR[r.error]));
      return;
    }
    // 패널을 닫았다 연 사이 글이 바뀌었으면 받은 자리가 어긋난다
    if (r.body !== latest.current.body) {
      setPolish(undefined);
      notice(t('panel.note.polishStale'));
      return;
    }
    setPolish({ phase: 'ready', text: r.text, start: r.start, end: r.end });
  };
  // 메모를 열 때: 패널이 닫힌 사이에도 돌던 다듬기나 받아 둔 답이 있으면 이어 받는다 (메인이 메모마다 하나만 돌린다)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 메모를 열 때 한 번만
  useEffect(() => {
    void bridge.notePolishInfo(note.id).then((info) => {
      if (!alive.current) return;
      setAiName(info.ai ?? '');
      if (info.job === 'none') return;
      setPolish({ phase: 'busy' });
      void bridge.notePolish(note.id).then(receive);
    });
  }, []);
  const askPolish = () => {
    flush();
    // 글 칸에 커서가 있으면 지금 고른 부분, 방금 글 칸을 떠났으면 떠나기 전에 고른 부분, 아니면 전체
    const el = bodyRef.current;
    const mark = lastSel.current;
    const sel =
      el && document.activeElement === el
        ? { start: el.selectionStart, end: el.selectionEnd }
        : mark && Date.now() - mark.at < SEL_KEEP_MS
          ? mark
          : { start: 0, end: 0 };
    // 고른 것이 공백뿐이면 전체를 다듬는다
    const part =
      sel.start < sel.end && body.slice(sel.start, sel.end).trim()
        ? { start: sel.start, end: sel.end }
        : { start: 0, end: 0 };
    const src = part.start < part.end ? body.slice(part.start, part.end) : body;
    if (src.length > POLISH_MAX) {
      notice(t('panel.note.polishTooLong'));
      return;
    }
    setUndo(undefined);
    setPolish({ phase: 'busy' });
    void bridge.notePolishInfo(note.id).then((info) => alive.current && setAiName(info.ai ?? ''));
    void bridge.notePolish(note.id, { body, ...part }).then(receive);
  };
  const applyPolish = () => {
    if (polish?.phase !== 'ready') return;
    const next = splicePolished(body, polish.start, polish.end, polish.text);
    // 메모 한도를 넘으면 끝을 자르지 않고 그대로 둔다 (견주기는 남겨 둬서 글을 옮겨 갈 수 있다)
    if (next === undefined) {
      notice(t('panel.note.polishOver'));
      return;
    }
    setUndo(body);
    setBody(next);
    save({ body: next });
    setPolish(undefined);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(undefined), UNDO_MS);
  };
  const undoPolish = () => {
    if (undo === undefined) return;
    setBody(undo);
    save({ body: undo });
    setUndo(undefined);
    clearTimeout(undoTimer.current);
  };
  const flush = () => {
    clearTimeout(timer.current);
    if (Object.keys(pending.current).length > 0) bridge.noteUpdate(note.id, pending.current);
    pending.current = {};
  };
  const save = (patch: { title?: string; body?: string }) => {
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_MS);
  };
  /** 뒤로(단추, Esc). 비었으면 지운다: 새 메모는 소리 없이, 쓰던 것을 다 지웠으면 되돌리기 알림과 함께 */
  const leave = () => {
    writeResume(undefined);
    if (isEmpty()) {
      gone.current = true;
      clearTimeout(timer.current);
      pending.current = {};
      if (!wasEmpty) {
        // 쓰던 것을 다 지우고 나갔다: 되돌리기로 살리면 빈 메모가 아니라 열 때 글이 돌아오게 그 글로 두고 지운다
        bridge.noteUpdate(note.id, { title: note.title, body: note.body });
        onRemoved(note.id);
      }
      bridge.noteRemove(note.id);
    } else flush();
    onBack();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 메모를 열 때 한 번만 건다
  useEffect(() => {
    if (resume?.id === note.id) {
      // 다른 곳을 눌러 닫혔던 자리로: 같은 칸, 같은 커서, 같은 스크롤
      const el = resume.field === 'title' ? titleRef.current : bodyRef.current;
      if (el) {
        const len = el.value.length;
        el.focus();
        el.setSelectionRange(Math.min(resume.start, len), Math.min(resume.end, len));
      }
      if (bodyRef.current) bodyRef.current.scrollTop = resume.scroll;
    } else if (!note.title && !note.body) bodyRef.current?.focus();
    writeResume(undefined);
    // 창이 닫히기 전에(다른 곳을 눌러서) 남은 것을 저장하고 어디였는지 적어 둔다. 빈 새 메모는 지운다.
    const onUnload = () => {
      flush();
      if (gone.current) return;
      if (wasEmpty && isEmpty()) {
        bridge.noteRemove(note.id);
        return;
      }
      const field = document.activeElement === titleRef.current ? 'title' : 'body';
      const el = field === 'title' ? titleRef.current : bodyRef.current;
      writeResume({
        id: note.id,
        field,
        start: el?.selectionStart ?? 0,
        end: el?.selectionEnd ?? 0,
        scroll: Math.round(bodyRef.current?.scrollTop ?? 0),
        at: Date.now(),
      });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      // 탭을 바꿔 나갔다: 남은 것을 저장하고, 빈 새 메모는 지운다
      flush();
      if (!gone.current && wasEmpty && isEmpty()) bridge.noteRemove(note.id);
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 메모 안 어디서든 Esc 는 목록으로 (입력칸, 단추 모두)
    <div
      className="note-editor"
      // 마우스로 다른 곳을 눌렀으면 글 칸을 떠나기 전에 고른 자리는 잊는다 (다듬기 단추는 빼고)
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('[data-polish]')) lastSel.current = undefined;
      }}
      onKeyDown={(e) => {
        if (isEsc(e) && !e.defaultPrevented) {
          takeEsc(e);
          leave();
        }
      }}
    >
      <div className="note-bar">
        <button type="button" className="link back" onClick={leave}>
          ‹ {t('panel.note.back')}
        </button>
        <span className="note-ai">
          <button type="button" className="link" disabled={!body.trim()} onClick={() => askAi('todos')}>
            {t('panel.note.toTodos')}
          </button>
          <button type="button" className="link" disabled={!body.trim()} onClick={() => askAi('summary')}>
            {t('panel.note.summary')}
          </button>
          <button
            type="button"
            className="link"
            data-polish
            title={t('panel.note.polishHint', { ai: aiName })}
            disabled={!body.trim() || !!polish}
            // 누를 때 글 칸의 고른 부분이 풀리지 않게
            onMouseDown={(e) => e.preventDefault()}
            onClick={askPolish}
          >
            {t('panel.note.polish')}
          </button>
        </span>
        <span className="note-end">
          <PinButton
            kind="note"
            id={note.id}
            title={title.trim() || t('panel.note.empty')}
            pinned={pinned}
            onToggle={setPinned}
          />
          <button
            type="button"
            className="link danger"
            onClick={() => {
              flush();
              writeResume(undefined);
              gone.current = true;
              bridge.noteRemove(note.id);
              // 빈 새 메모는 되돌릴 것이 없다
              if (!(wasEmpty && isEmpty())) onRemoved(note.id);
              onBack();
            }}
          >
            {t('panel.note.delete')}
          </button>
        </span>
      </div>
      {aiNote && <p className="hint error">{aiNote}</p>}
      {polish?.phase === 'busy' && (
        <p className="note-polish-busy" role="status">
          {t('panel.note.polishing', { ai: aiName })}
        </p>
      )}
      {polish?.phase === 'ready' && (
        <section className="note-polish" aria-label={t('panel.note.polishTitle')}>
          <div className="note-polish-head">
            <strong>{t('panel.note.polishTitle')}</strong>
            {polish.start < polish.end && <span>{t('panel.note.polishPart')}</span>}
          </div>
          <div className="note-polish-text">{polish.text}</div>
          <div className="note-polish-actions">
            <button type="button" className="ghost small" onClick={() => setPolish(undefined)}>
              {t('panel.note.polishKeep')}
            </button>
            <button type="button" className="primary small" onClick={applyPolish}>
              {t('panel.note.polishApply')}
            </button>
          </div>
        </section>
      )}
      {undo !== undefined && (
        <p className="hint note-polish-undo" role="status">
          {t('panel.note.polishDone')}{' '}
          <button type="button" className="link" onClick={undoPolish}>
            {t('panel.note.polishUndo')}
          </button>
        </p>
      )}
      <input
        ref={titleRef}
        className="note-title-input"
        value={title}
        maxLength={NOTE_TITLE_MAX}
        aria-label={t('panel.note.titleLabel')}
        placeholder={t('panel.note.titlePlaceholder')}
        onChange={(e) => {
          setTitle(e.target.value);
          save({ title: e.target.value });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) bodyRef.current?.focus();
        }}
      />
      <textarea
        ref={bodyRef}
        value={body}
        maxLength={NOTE_BODY_MAX}
        aria-label={t('panel.note.bodyLabel')}
        placeholder={t('panel.note.bodyPlaceholder')}
        // 다듬는 동안 글이 바뀌면 받은 글을 끼울 자리가 어긋난다
        readOnly={!!polish}
        onBlur={(e) => {
          lastSel.current = {
            start: e.currentTarget.selectionStart,
            end: e.currentTarget.selectionEnd,
            at: Date.now(),
          };
        }}
        onChange={(e) => {
          lastSel.current = undefined;
          setUndo(undefined);
          setBody(e.target.value);
          save({ body: e.target.value });
        }}
      />
    </div>
  );
}
