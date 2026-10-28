import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { NoteAiKind, NoteHit, NoteSummary, PanelState } from '../../../shared/ipc.ts';
import { POLISH_MAX, type PolishReply, splicePolished } from '../../../shared/note-polish.ts';
import { mergeNoteText, NOTE_BODY_MAX, NOTE_TITLE_MAX, type Note } from '../../../shared/note-store.ts';
import { pinFirst } from '../../../shared/pin.ts';
import { singleFlight } from '../chat/single-flight.ts';
import { useLanguage } from '../language-context.ts';
import { ago } from './format.ts';
import { isEsc, takeEsc } from './keys.ts';
import { MoreRow } from './more.tsx';
import { type NoteResume, parseResume, RESUME_KEY } from './note-resume.ts';
import { draftKeepOf, NoteSaver, openFromKept, SaveGate } from './note-save.ts';
import { onOpenNote, takePendingNote } from './open-target.ts';
import { pageOf } from './paging.ts';
import { PinButton, usePinMenu } from './pin.tsx';
import { useSurface } from './surface.tsx';
import { useKeepScroll } from './view-keep.ts';

const bridge = window.jjakkungPanel;
const SAVE_MS = 400;
/** 새 메모를 만든 뒤 이 동안은 또 만들지 않는다 (그사이 메모가 열려 단추가 사라진다) */
const NEW_NOTE_HOLD_MS = 800;
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

/**
 * 옛 판이 localStorage 에 남긴 한 칸: 한 번 읽어 메인 메모리로 옮기고 지운다
 * (쓰다 만 글이 디스크(브라우저 저장소)에 남지 않게, #145 원칙)
 */
function migrateLegacyResume() {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (raw === null) return;
    localStorage.removeItem(RESUME_KEY);
    const r = parseResume(raw, Date.now());
    if (r && !bridge.noteKeepGet(r.id)) bridge.noteKeepSet(r.id, r);
  } catch {
    // 못 읽으면 옛 자리는 목록에서 연다
  }
}

/** 패널을 열 때 돌아갈 메모 자리 (메인에 가장 나중에 적은 것) */
function readResume(): NoteResume | undefined {
  migrateLegacyResume();
  return bridge.noteKeepLatest() ?? undefined;
}

/** 닫힌 편집기의 마지막 저장을 메모마다 잡아 둔다 (SaveGate): 나란히 보기에서 같은 메모로 곧바로 돌아와도 방금 쓴 글이 먼저 저장된다 */
const saveGate = new SaveGate();

/** 그 메모의 보관 글을 적거나(r) 지운다. 메모마다 따로라 다른 메모를 열고 닫아도 서로 지우지 않는다 */
function keepNote(id: number, r: NoteResume | undefined) {
  bridge.noteKeepSet(id, r ?? null);
}

/** 메모 (v1): 목록과 고치기. 고치면 잠깐 뒤 저절로 저장한다. */
export function NoteTab({ s, onRemoved }: { s: PanelState; onRemoved: (id: number) => void }) {
  /** 넓은 본문 칸(큰 창)이면 목록과 편집기를 나란히 보인다. 좁으면 지금처럼 하나씩 (같은 편집기가 그대로 살아 있다) */
  const split = useSurface().zone === 'wide';
  const [open, setOpen] = useState<Note>();
  /** 다른 곳을 눌러 닫혔던 메모 자리. 여는 동안(메모를 읽는 동안)은 목록을 그리지 않는다 */
  const [resume, setResume] = useState<NoteResume | undefined>(() =>
    s.newNoteRequest ? undefined : readResume(),
  );
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  /** 본문까지 찾은 결과 (메인에서). 새 결과가 올 때까지 앞 결과를 둔다 */
  const [hits, setHits] = useState<NoteHit[]>();
  const searchSeq = useRef(0);
  /** 목록에서 메모를 누른 차례 (onOpen) */
  const openTurn = useRef(0);
  // 목록 스크롤 위치 (#145). 메모를 열었다 돌아와도, 탭을 갔다 와도 그 자리
  const listRef = useRef<HTMLUListElement>(null);
  useKeepScroll(listRef, !split && (open || resume) ? 'noteEditor' : 'note');
  /** 그린 쪽 수 (찾는 말마다) */
  const [paging, setPaging] = useState({ q: '', pages: 1 });
  const now = Date.now();

  // biome-ignore lint/correctness/useExhaustiveDependencies: 탭을 열 때 한 번만
  useEffect(() => {
    if (!resume) return;
    const turn = openTurn.current;
    bridge.noteGet(resume.id).then((n) => {
      if (turn !== openTurn.current) return;
      if (n) setOpen(n);
      else {
        keepNote(resume.id, undefined);
        setResume(undefined);
      }
    });
  }, []);

  // 한 번에 찾기(#146)에서 고른 메모를 연다: 탭을 바꾸며 맡겨 둔 것은 그릴 때 가져가고, 이미 떠 있으면 알림을 듣는다
  useEffect(() => {
    const openPending = () => {
      const id = takePendingNote();
      if (id !== undefined) bridge.noteGet(id).then((n) => n && setOpen(n));
    };
    openPending();
    return onOpenNote(openPending);
  }, []);

  const q = query.trim();
  // "새 메모"를 두 번 누르거나(더블클릭) Enter 를 두 번 치면 메모가 둘 생겨, 하나는 열리고 다른 하나는 "빈 메모"로
  // 목록에 남았다. 만든 메모가 열려 목록이 사라질 때까지 누름을 버린다
  const [newError, setNewError] = useState('');
  const [newNote] = useState(() =>
    singleFlight(async (text?: string) => {
      openTurn.current++;
      const n = await bridge.noteAdd(text).catch(() => undefined);
      // 디스크가 가득 차면 못 만든다: 말없이 두지 않고 이유를 보인다
      if (!n || 'ok' in n) {
        setNewError((n && 'error' in n && n.error) || t('panel.retry'));
        return false;
      }
      setNewError('');
      setOpen(n);
      return true;
    }, NEW_NOTE_HOLD_MS),
  );
  useEffect(() => {
    if (s.newNoteRequest && bridge.noteNewTake(s.newNoteRequest)) {
      setResume(undefined);
      void newNote();
    }
  }, [s.newNoteRequest, newNote]);
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

  const editor = open && (
    <NoteEditor
      key={open.id}
      note={open}
      changedAt={s.notes.find((n) => n.id === open.id)?.updatedAt}
      onBack={() => {
        setResume(undefined);
        setOpen(undefined);
      }}
      onRemoved={onRemoved}
    />
  );
  // 열고 있는 동안(메모를 읽는 동안)은 목록을 그리지 않는다. 나란히 보기에서는 열린 메모가 있어도 목록이 남는다
  const listShown = split ? !resume || !!open : !open && !resume;

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
  // 찾는 말에 맞는 메모가 없으면 그 글로 바로 메모를 만든다 (처음 쓰는 사람이 찾기 칸에 메모를 적고 Enter 를 눌러
  // "찾는 메모가 없어" 에서 막혔다, 2026-10-12)
  const makeFromQuery = () =>
    newNote(q).then((made) => {
      if (made) setQuery('');
    });
  // 앞에서부터 한 쪽씩 그린다 (paging.ts). 찾는 말이 바뀌면 첫 쪽부터
  const pages = paging.q === q ? paging.pages : 1;
  const page = pageOf(list, pages);
  // 줄은 memo 라서 여는 함수는 늘 같은 것 (부를 때 가장 새 함수로 간다)
  const openLatest = useRef<(id: number) => Promise<void>>(
    undefined as unknown as (id: number) => Promise<void>,
  );
  openLatest.current = async (id) => {
    if (open?.id === id) return;
    // 누를 때마다 번호를 매겨 마지막 누름만 연다 (빠르게 B, A, C 를 누르면 늦게 돌아온 A 가 C 를 덮지 않게)
    const turn = ++openTurn.current;
    // 같은 메모의 앞 편집기가 아직 저장 중이면 끝난 뒤 읽는다 (방금 쓴 글이 보이게)
    await saveGate.settle(id);
    const full = await bridge.noteGet(id);
    if (full && turn === openTurn.current) setOpen(full);
  };
  const openNote = useCallback((id: number) => void openLatest.current(id), []);
  const listEl = (
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
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && q && list.length === 0) {
              e.preventDefault();
              void makeFromQuery();
            }
          }}
        />
        <button type="button" className="primary" onClick={() => void newNote()}>
          {t('panel.note.new')}
        </button>
      </div>
      {newError && (
        <p className="hint error" role="alert">
          {newError}
        </p>
      )}
      <ul className="notes scroll" ref={listRef}>
        {list.length === 0 && (
          <li className="empty">
            {q && s.notes.length > 0 ? t('panel.note.notFound') : t('panel.note.empty.list')}
            {q && (
              <button type="button" className="ghost note-make" onClick={() => void makeFromQuery()}>
                {t('panel.note.makeFrom')}
              </button>
            )}
          </li>
        )}
        {page.shown.map((n) => (
          <NoteRow
            key={n.id}
            n={n}
            hit={hitOf.get(n.id)}
            when={ago(n.updatedAt, now)}
            pinEnd={n.id === lastPinned && list.at(-1)?.id !== n.id}
            current={split && open?.id === n.id}
            onOpen={openNote}
          />
        ))}
        <MoreRow rest={page.rest} onMore={() => setPaging({ q, pages: pages + 1 })} />
      </ul>
    </>
  );
  return (
    <div className={`note-layout${split ? ' split' : ''}`}>
      {listShown ? <div className="note-list-pane">{listEl}</div> : null}
      {editor}
      {split && !open && !resume ? <p className="note-pane-empty">{t('panel.note.pickOne')}</p> : null}
    </div>
  );
}

/** 메모 목록 한 줄: 누르면 연다. 오른쪽 위 고정 단추, 우클릭 메뉴 */
const NoteRow = memo(function NoteRow({
  n,
  hit,
  when,
  pinEnd,
  current,
  onOpen,
}: {
  n: NoteSummary;
  hit: NoteHit | undefined;
  /** "5분 전" 같은 고친 때 */
  when: string;
  /** 고정한 것 가운데 마지막 줄 (아래 고정 안 한 줄과 사이에 선) */
  pinEnd: boolean;
  /** 나란히 보기에서 지금 편집기에 열린 메모 */
  current: boolean;
  onOpen: (id: number) => void;
}) {
  useLanguage();
  const pinned = n.pinnedAt !== null;
  const pinMenu = usePinMenu('note', n.id, n.title, pinned);
  return (
    <li
      className={`note-row ${pinned ? 'pinned' : ''} ${pinEnd ? 'pin-end' : ''} ${current ? 'current' : ''}`}
      onContextMenu={pinMenu.onContextMenu}
    >
      <button type="button" aria-current={current ? 'true' : undefined} onClick={() => onOpen(n.id)}>
        <span className="note-title" dir="auto">
          {n.source === 'ai' && <i className="tag">AI</i>}
          {n.title}
        </span>
        <span className="note-meta">
          <span className="when">{when}</span>
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
});

function NoteEditor({
  note,
  changedAt,
  onBack,
  onRemoved,
}: {
  note: Note;
  /** 목록에 온 이 메모의 고친 시각. 연 뒤 다른 곳(append_note 등)이 고치면 커진다 */
  changedAt?: number;
  onBack: () => void;
  onRemoved: (id: number) => void;
}) {
  /** 저장하지 못한 채 닫혔던 글이 있으면 그 글로 연다 (다시 저장한다) */
  /** 이 메모의 보관 글 (닫히기 전 자리, 저장하지 못한 글). 메인이 메모마다 들고 있다 */
  const [kept] = useState(() => bridge.noteKeepGet(note.id) ?? undefined);
  /** 보관한 글을 어떻게 쓸지 (note-save.ts openFromKept): 저장된 글과 같으면 없다. 다른 곳이 그새 고쳤으면 덮지 않고 고르게 한다 */
  const [resumed] = useState(() => openFromKept(kept, note));
  const draft = resumed?.draft;
  /** 보관한 글이 있다: 저장되거나 고르기를 끝내면 지운다 */
  const keptDraft = useRef(!!draft);
  const dropKept = () => keepNote(note.id, undefined);
  /** 뒤로가기로 나갔다 (패널을 다시 열 때 저절로 열지 않는다) */
  const parked = useRef(false);
  const [title, setTitle] = useState(draft?.title ?? note.title);
  const [body, setBody] = useState(draft?.body ?? note.body);
  /** 마지막 저장이 실패했다 (디스크 가득 등). 글은 들고 있고 다음 고침이나 뒤로 갈 때 다시 보낸다 */
  const [saveError, setSaveError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
  /**
   * 저장 줄(note-save.ts): 마지막으로 받은 저장된 본문과 그 시각(base, baseAt)을 들고, 저장을 한 줄로 세운다.
   * 열어 둔 사이 다른 곳(Claude Code 의 append_note, 펫 실행)이 덧붙이면 창에 받아 오고, 저장할 때 같이 보내
   * 메인이 덮지 않고 합친다. 예전에는 창이 처음 받은 글로 덮어 덧붙인 글이 사라졌다
   */
  const seen = useRef(note.updatedAt);
  const saverRef = useRef<NoteSaver>(undefined);
  saverRef.current ??= new NoteSaver(
    note.body,
    note.updatedAt,
    {
      update: (patch, baseObj) => bridge.noteUpdate(note.id, patch, baseObj),
      get: () =>
        bridge
          .noteGet(note.id)
          .then((n) => (n ? { body: n.body, updatedAt: n.updatedAt, title: n.title } : undefined)),
    },
    { saved() {}, failed() {}, blocked() {} },
  );
  const saver = saverRef.current;
  /** 다른 곳이 먼저 고쳐 거절됐다: 그때 저장돼 있던 글. 사용자가 덮기를 고를 때까지 보내지 않는다 */
  const [stored, setStored] = useState<{ body: string; shown: boolean }>();
  saver.hooks = {
    saved(sentBody, storedBody, merged) {
      if (alive.current) setSaveError('');
      // 보관해 둔 글이 저장됐다: 그 메모의 보관 글을 지운다
      if (keptDraft.current && !saver.failed && Object.keys(saver.pending).length === 0 && alive.current) {
        keptDraft.current = false;
        dropKept();
      }
      if (sentBody !== undefined && merged) takeStored(sentBody, storedBody);
    },
    failed(r, conflict) {
      if (alive.current) {
        if (conflict) setStored({ body: saver.conflict?.body ?? '', shown: false });
        setSaveError(
          conflict
            ? `${r.error ?? ''} ${t('panel.note.staleKeep')}`
            : `${r.error ?? t('panel.retry')} ${t('panel.note.unsaved')}`,
        );
      } else keepDraft(); // 닫히는 중이라 안내를 볼 사람이 없다: 글을 보관 길에 남긴다
    },
    blocked() {
      if (!alive.current) keepDraft();
    },
  };
  /** S 를 바탕으로 쓰던 창 글에 저장된 글 M 을 합쳐 보여 준다. 합친 글이 저장된 글과 다르면 다시 저장한다 */
  const takeStored = (S: string, M: string) => {
    const mine = latest.current.body;
    const next = mergeNoteText(S, mine, M);
    if (next !== mine && alive.current) {
      const el = bodyRef.current;
      const sel =
        el && document.activeElement === el
          ? { el, start: el.selectionStart, end: el.selectionEnd }
          : undefined;
      latest.current = { ...latest.current, body: next };
      setBody(next);
      // 덧붙인 글은 끝에 붙어 커서 앞은 그대로다: 쓰던 자리를 지킨다
      if (sel)
        requestAnimationFrame(() => {
          if (document.activeElement !== sel.el) return;
          sel.el.setSelectionRange(Math.min(sel.start, next.length), Math.min(sel.end, next.length));
        });
    }
    if (next !== M) save({ body: next });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 고친 시각이 바뀔 때만
  useEffect(() => {
    if (changedAt === undefined || changedAt <= seen.current) return;
    seen.current = changedAt;
    // 보내는 중이거나 보낼 것이 있으면 그 저장이 메인에서 합친다
    if (saver.sending || saver.pending.body !== undefined) return;
    void bridge.noteGet(note.id).then((n) => {
      if (!n || !alive.current || saver.sending || saver.pending.body !== undefined) return;
      if (n.body === saver.base) return;
      const S = saver.base;
      saver.base = n.body;
      saver.baseAt = n.updatedAt;
      takeStored(S, n.body);
    });
  }, [changedAt]);

  /** 고정 (열 때 받은 값에서 시작해 여기서 바꾼다) */
  const [pinned, setPinned] = useState(note.pinnedAt !== null);
  const [aiNote, setAiNote] = useState('');
  /** AI 로 정리: 채팅 창이 열리고 답이 그리로 온다. 답 아래 "할 일로"로 넣는다 */
  const askAi = async (kind: NoteAiKind) => {
    void flush();
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
    void flush();
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
  /**
   * 남은 고침을 보낸다. 저장되면 true. 못 저장하면 보낸 것을 다시 모아(그 뒤에 쓴 것이 이긴다) 다음에 다시 보내고
   * 글 칸 아래에 안내를 띄운다 (버그잡이 4: 예전에는 보내기만 해서 디스크가 가득 차면 쓴 글이 말없이 사라졌다)
   */
  const flush = (): Promise<boolean> => {
    clearTimeout(timer.current);
    return saver.flush();
  };
  /** 다른 곳이 먼저 고친 뒤 사용자가 "내 글로 덮기"를 골랐다: 저장된 글을 바탕으로 삼아 다시 보낸다 */
  const overwriteStored = () => {
    saver.overwrite();
    setStored(undefined);
    setSaveError('');
    void flush();
  };
  /** 다른 곳이 먼저 고친 것을 보고 "저장된 글로 바꾸기"를 골랐다: 내 글을 버리고 저장된 글로 바꾼다 */
  const takeSaved = () => {
    const c = saver.discard();
    if (!c) return;
    clearTimeout(timer.current);
    const next = { title: c.title ?? latest.current.title, body: c.body };
    latest.current = next;
    setTitle(next.title);
    setBody(next.body);
    setStored(undefined);
    setSaveError('');
    dropKept();
  };
  /** 저장하지 못한 글을 패널이 닫혀도 잃지 않게 적어 둔다 (다시 열면 이 글로 연다) */
  const keepDraft = (extra?: Partial<NoteResume>) => {
    if (!saver.failed) return;
    const k = draftKeepOf(saver, latest.current);
    if (!k) return;
    keptDraft.current = true;
    keepNote(note.id, {
      id: note.id,
      field: 'body',
      start: 0,
      end: 0,
      scroll: 0,
      ...extra,
      at: Date.now(),
      ...k,
      ...(parked.current ? { parked: true as const } : {}),
    });
  };
  const save = (patch: { title?: string; body?: string }) => {
    saver.pending = { ...saver.pending, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_MS);
  };
  /**
   * 뒤로(단추, Esc). 비었으면 지운다: 새 메모는 소리 없이, 쓰던 것을 다 지웠으면 되돌리기 알림과 함께.
   * 저장이 실패하면 나가지 않고 글을 그대로 둔다 (안내가 뜬다)
   */
  const leave = async () => {
    if (isEmpty()) {
      gone.current = true;
      clearTimeout(timer.current);
      saver.pending = {};
      if (!wasEmpty) {
        // 쓰던 것을 다 지우고 나갔다: 되돌리기로 살리면 빈 메모가 아니라 열 때 글이 돌아오게 그 글로 두고 지운다
        bridge.noteUpdate(note.id, { title: note.title, body: note.body });
        onRemoved(note.id);
      }
      bridge.noteRemove(note.id);
      dropKept();
    } else if (saver.conflict) {
      // 다른 곳이 먼저 고친 것을 보고 있다: 아무것도 보내지 않고 나간다. 내 글은 보관 길에 남는다 (다시 열면 고르게 한다)
      clearTimeout(timer.current);
      parked.current = true;
      keepDraft();
    } else {
      if (!(await flush())) return;
      dropKept();
    }
    onBack();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 메모를 열 때 한 번만 건다
  useEffect(() => {
    if (kept) {
      // 다른 곳을 눌러 닫혔던 자리로: 같은 칸, 같은 커서, 같은 스크롤
      const el = kept.field === 'title' ? titleRef.current : bodyRef.current;
      if (el) {
        const len = el.value.length;
        el.focus();
        el.setSelectionRange(Math.min(kept.start, len), Math.min(kept.end, len));
      }
      if (bodyRef.current) bodyRef.current.scrollTop = kept.scroll;
    } else if (!note.title && !note.body) bodyRef.current?.focus();
    // 글 없이 자리만 있던 보관 글은 읽었으니 지운다 (저장하지 못한 글은 저장되거나 고를 때까지 둔다)
    if (!draft) dropKept();
    // 저장하지 못한 채 닫혔던 글로 열었다: 바로 다시 저장해 본다 (또 실패하면 안내가 뜨고 글은 그대로)
    if (draft && resumed?.conflict) {
      // 다른 곳이 먼저 고쳐 거절된 채 닫혔던 글: 자동 저장하지 않고 고르는 단추를 다시 보인다
      saver.restore({ title: draft.title, body: draft.body }, resumed.conflict);
      setStored({ body: resumed.conflict.body, shown: false });
      setSaveError(`${t('panel.note.stale')} ${t('panel.note.staleKeep')}`);
    } else if (draft) save({ title: draft.title, body: draft.body });
    // 창이 닫히기 전에(다른 곳을 눌러서) 남은 것을 저장하고 어디였는지 적어 둔다. 빈 새 메모는 지운다.
    const onUnload = () => {
      // 저장이 실패한 채이거나 아직 답을 못 받은 글이 있으면 글도 적어 둔다 (닫히는 중이라 이번 저장의 답은 기다릴 수 없다).
      // 저장이 되면 다시 열 때 저장된 글과 같아 보관 글은 저절로 지워진다. 다른 곳이 먼저 고쳐 거절돼도 글은 여기 남는다
      const unsentKeep = draftKeepOf(saver, latest.current);
      void flush();
      if (gone.current) return;
      if (wasEmpty && isEmpty()) {
        bridge.noteRemove(note.id);
        return;
      }
      const field = document.activeElement === titleRef.current ? 'title' : 'body';
      const el = field === 'title' ? titleRef.current : bodyRef.current;
      keepNote(note.id, {
        id: note.id,
        field,
        start: el?.selectionStart ?? 0,
        end: el?.selectionEnd ?? 0,
        scroll: Math.round(bodyRef.current?.scrollTop ?? 0),
        at: Date.now(),
        ...(unsentKeep ?? {}),
      });
    };
    // 큰 창을 숨겨도(창이 닫히지 않아 beforeunload 가 없다) 남은 고침을 바로 보낸다 (메인이 숨기기 직전에 알린다)
    const offHiding = bridge.onHiding(() => void flush());
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      offHiding();
      // 탭을 바꾸거나 다른 메모를 눌러 나갔다: 남은 것을 저장하고, 빈 새 메모는 지운다. 저장이 실패한 채면 글을 적어 둔다.
      // 같은 메모를 곧바로 다시 열어도 이 저장이 끝난 뒤에 읽도록 맡겨 둔다 (saveGate)
      keepDraft();
      saveGate.hold(note.id, flush());
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
          <button
            type="button"
            className="link"
            title={t('panel.note.toTodosHint', { ai: aiName })}
            disabled={!body.trim()}
            onClick={() => askAi('todos')}
          >
            {t('panel.note.toTodos')}
          </button>
          <button
            type="button"
            className="link"
            title={t('panel.note.summaryHint', { ai: aiName })}
            disabled={!body.trim()}
            onClick={() => askAi('summary')}
          >
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
              void flush();
              dropKept();
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
      {saveError && (
        <p className="hint error" role="alert">
          {saveError}
        </p>
      )}
      {stored && (
        <div className="note-stale">
          <div className="note-polish-actions">
            <button
              type="button"
              className="ghost small"
              aria-expanded={stored.shown}
              onClick={() => setStored({ ...stored, shown: !stored.shown })}
            >
              {stored.shown ? t('panel.note.staleHide') : t('panel.note.staleView')}
            </button>
            <button type="button" className="ghost small" onClick={takeSaved}>
              {t('panel.note.staleTake')}
            </button>
            <button type="button" className="primary small" onClick={overwriteStored}>
              {t('panel.note.staleOverwrite')}
            </button>
          </div>
          {stored.shown && <div className="note-polish-text note-stale-text">{stored.body}</div>}
        </div>
      )}
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
