import { useEffect, useRef, useState } from 'react';
import type { NoteAiKind, PanelState } from '../../../shared/ipc.ts';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type Note } from '../../../shared/note-store.ts';
import { ago } from './format.ts';

const bridge = window.jjakkungPanel;
const SAVE_MS = 400;

/** 메모 (v1): 목록과 고치기. 고치면 잠깐 뒤 저절로 저장한다. */
export function NoteTab({ s, onRemoved }: { s: PanelState; onRemoved: (id: number) => void }) {
  const [open, setOpen] = useState<Note>();
  const [query, setQuery] = useState('');
  const now = Date.now();

  if (open) return <NoteEditor note={open} onBack={() => setOpen(undefined)} onRemoved={onRemoved} />;

  const q = query.trim().toLowerCase();
  const list = q ? s.notes.filter((n) => `${n.title} ${n.preview}`.toLowerCase().includes(q)) : s.notes;
  return (
    <>
      <div className="add row">
        <input
          value={query}
          aria-label="메모 찾기"
          placeholder={s.notes.length > 0 ? `메모 ${s.notes.length}개에서 찾기` : '메모 찾기'}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const n = await bridge.noteAdd();
            setOpen(n);
          }}
        >
          새 메모
        </button>
      </div>
      <ul className="notes scroll">
        {list.length === 0 && (
          <li className="empty">
            {q ? '찾는 메모가 없어.' : '메모가 없어. "새 메모"를 눌러 적어 봐. AI 답도 메모로 남길 수 있어.'}
          </li>
        )}
        {list.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={async () => {
                const full = await bridge.noteGet(n.id);
                if (full) setOpen(full);
              }}
            >
              <span className="note-title">
                {n.source === 'ai' && <i className="tag">AI</i>}
                {n.title}
              </span>
              <span className="note-meta">
                <span className="when">{ago(n.updatedAt, now)}</span>
                {n.preview && n.preview !== n.title && <span className="preview">{n.preview}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function NoteEditor({
  note,
  onBack,
  onRemoved,
}: {
  note: Note;
  onBack: () => void;
  onRemoved: (id: number) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ title?: string; body?: string }>({});
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [aiNote, setAiNote] = useState('');
  /** AI 로 정리: 채팅 창이 열리고 답이 그리로 온다. 답 아래 "할 일로"로 넣는다 */
  const askAi = async (kind: NoteAiKind) => {
    flush();
    if (!(await bridge.noteAi(note.id, kind))) {
      setAiNote('AI 가 다른 답을 하는 중이야. 끝나면 다시 눌러 줘.');
      setTimeout(() => setAiNote(''), 3000);
    }
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: 메모를 열 때 한 번만 건다
  useEffect(() => {
    if (!note.title && !note.body) bodyRef.current?.focus();
    // 창이 닫히기 전에 남은 것을 저장한다.
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  return (
    <div className="note-editor">
      <div className="note-bar">
        <button
          type="button"
          className="link back"
          onClick={() => {
            flush();
            onBack();
          }}
        >
          ‹ 메모
        </button>
        <span className="note-ai">
          <button type="button" className="link" disabled={!body.trim()} onClick={() => askAi('todos')}>
            할 일로 쪼개기
          </button>
          <button type="button" className="link" disabled={!body.trim()} onClick={() => askAi('summary')}>
            요약
          </button>
        </span>
        <button
          type="button"
          className="link danger"
          onClick={() => {
            flush();
            bridge.noteRemove(note.id);
            onRemoved(note.id);
            onBack();
          }}
        >
          지우기
        </button>
      </div>
      {aiNote && <p className="hint error">{aiNote}</p>}
      <input
        className="note-title-input"
        value={title}
        maxLength={NOTE_TITLE_MAX}
        aria-label="메모 제목"
        placeholder="제목 (비우면 첫 줄)"
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
        aria-label="메모 내용"
        placeholder="적어 봐. # 제목, - 목록 같은 마크다운도 돼."
        onChange={(e) => {
          setBody(e.target.value);
          save({ body: e.target.value });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            flush();
            onBack();
          }
        }}
      />
    </div>
  );
}
