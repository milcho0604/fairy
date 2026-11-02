import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, type Note } from '../../../shared/note-store.ts';
import { draftHasText, mayGrabFocus } from './note-draft.ts';
import { onNoteFocus, takeNoteFocus } from './open-target.ts';

export type DraftField = 'title' | 'body';
export type DraftText = { title: string; body: string };
/** 편집기로 넘어갈 때 이어 갈 칸과 커서 */
export type DraftSel = { field: DraftField; start: number; end: number };

/** 마지막 글자를 친 뒤 이만큼 조용하면 편집기로 넘어간다 */
const QUIET_MS = 600;

/**
 * 큰 창 메모 구역에서 고른 메모가 없을 때의 빈 새 메모 칸. 편집기(NoteEditor)와 같은 모양이다.
 * 글이 한 글자라도 생기면 그때 메모를 만들고(add), 그 뒤 고침은 이 칸이 그대로 받아 저장한다(save).
 * 칸은 갈아 끼우지 않는다: 조합 중이거나 방금 친 글이 있으면 그대로 두고, 한동안 조용하고 저장된 글과 같을 때만 편집기로 넘긴다(settle).
 * 그래서 만드는 사이에 친 글자도, 한글 조합도 끊기지 않는다. 안 쓰고 나가면 아무것도 안 남는다.
 */
export function NoteDraft({
  add,
  save,
  get,
  settle,
}: {
  /** 첫 글로 메모를 만든다. 못 만들면 undefined (글은 그대로 두고 다음 글자에 다시) */
  add: (first: DraftText) => Promise<{ id: number } | undefined>;
  /** 만든 메모에 지금 글을 저장한다. 저장되면 true */
  save: (id: number, text: DraftText) => Promise<boolean>;
  /** 편집기로 넘길 메모를 읽는다 */
  get: (id: number) => Promise<Note | undefined>;
  /** 편집기로 넘긴다 (이 칸은 사라진다) */
  settle: (note: Note, sel: DraftSel) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const latest = useRef<DraftText>({ title: '', body: '' });
  /** 만든 메모의 번호와 마지막으로 저장된 글 */
  const made = useRef<{ id: number; saved: DraftText }>(undefined);
  const making = useRef(false);
  const syncing = useRef(false);
  const composing = useRef(false);
  const lastField = useRef<DraftField>('body');
  const lastAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dead = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const same = (a: DraftText, b: DraftText) => a.title === b.title && a.body === b.body;

  useEffect(() => {
    const go = () => {
      if (!takeNoteFocus()) return;
      const a = document.activeElement;
      const editable =
        a instanceof HTMLInputElement ||
        a instanceof HTMLTextAreaElement ||
        (a instanceof HTMLElement && a.isContentEditable);
      if (
        mayGrabFocus({
          windowFocused: document.hasFocus(),
          activeEditable: editable && a !== bodyRef.current,
        })
      )
        bodyRef.current?.focus();
    };
    go();
    return onNoteFocus(go);
  }, []);

  /** 만들고, 저장되지 않은 글을 보내고, 조용해지면 넘긴다. 한 번에 하나만 돈다 */
  const sync = async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      for (let guard = 0; guard < 50; guard++) {
        if (!draftHasText(latest.current) && !made.current) return;
        if (!made.current) {
          if (composing.current && !dead.current) return;
          const first = { ...latest.current };
          making.current = true;
          const n = await add(first).catch(() => undefined);
          making.current = false;
          if (!n) return;
          made.current = { id: n.id, saved: first };
          continue;
        }
        const m = made.current;
        const now = { ...latest.current };
        if (!same(now, m.saved)) {
          if (composing.current && !dead.current) return;
          if (!(await save(m.id, now).catch(() => false))) return;
          m.saved = now;
          continue;
        }
        // 저장된 글과 같다. 조합 중이거나 방금 쳤으면 기다린다
        if (dead.current) return;
        if (composing.current || Date.now() - lastAt.current < QUIET_MS) {
          schedule();
          return;
        }
        const note = await get(m.id).catch(() => undefined);
        // 읽는 사이 글이 바뀌었으면 처음부터 다시 본다. 아니면 기다림 없이 바로 넘긴다
        if (dead.current) return;
        if (!note || !same(latest.current, m.saved) || composing.current) continue;
        const el = lastField.current === 'title' ? titleRef.current : bodyRef.current;
        // 저장소는 제목을 trim 해 돌려준다. 끝 공백을 이어 칠 수 있게 쓰던 글을 그대로 넘긴다
        settle(
          { ...note, title: latest.current.title },
          {
            field: lastField.current,
            start: el?.selectionStart ?? latest.current[lastField.current].length,
            end: el?.selectionEnd ?? latest.current[lastField.current].length,
          },
        );
        return;
      }
    } finally {
      syncing.current = false;
    }
  };
  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void sync(), QUIET_MS);
  };
  // 다른 메모를 고르거나 구역을 나가 칸이 사라진다: 만들지 못했거나 못 보낸 글이 있으면 마저 보낸다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 사라질 때 한 번만
  useEffect(
    () => () => {
      dead.current = true;
      clearTimeout(timer.current);
      composing.current = false;
      void sync();
    },
    [],
  );

  const change = (field: DraftField, value: string, isComposing: boolean) => {
    latest.current = { ...latest.current, [field]: value };
    lastField.current = field;
    lastAt.current = Date.now();
    composing.current = isComposing;
    if (field === 'title') setTitle(value);
    else setBody(value);
    void sync();
    if (made.current || making.current) schedule();
  };
  const compEnd = (field: DraftField, value: string) => {
    composing.current = false;
    change(field, value, false);
  };

  return (
    <div className="note-editor note-draft">
      <div className="note-bar">
        <span className="note-ai">
          <button type="button" className="link" disabled>
            {t('panel.note.toTodos')}
          </button>
          <button type="button" className="link" disabled>
            {t('panel.note.summary')}
          </button>
          <button type="button" className="link" disabled>
            {t('panel.note.polish')}
          </button>
        </span>
      </div>
      <input
        ref={titleRef}
        className="note-title-input"
        value={title}
        maxLength={NOTE_TITLE_MAX}
        aria-label={t('panel.note.titleLabel')}
        placeholder={t('panel.note.titlePlaceholder')}
        onChange={(e) =>
          change('title', e.target.value, e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing)
        }
        onCompositionEnd={(e) => compEnd('title', e.currentTarget.value)}
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
        onChange={(e) =>
          change('body', e.target.value, e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing)
        }
        onCompositionEnd={(e) => compEnd('body', e.currentTarget.value)}
      />
      <p className="note-saved" role="status" />
    </div>
  );
}
