import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX } from '../../../shared/note-store.ts';
import { draftHasText, mayGrabFocus } from './note-draft.ts';
import { onNoteFocus, takeNoteFocus } from './open-target.ts';

export type DraftField = 'title' | 'body';

/**
 * 큰 창 메모 구역에서 고른 메모가 없을 때의 빈 새 메모 칸. 편집기(NoteEditor)와 같은 모양이고,
 * 글이 한 글자라도 생기면 그때 메모를 만들어(onCreate) 그 메모의 편집기로 넘어간다. 안 쓰고 나가면 아무것도 안 남는다.
 * 한글 조합 중에는 조합이 끝날 때까지 기다린다 (조합 중에 칸을 바꾸면 쓰던 글자가 끊긴다)
 */
export function NoteDraft({
  onCreate,
}: {
  /** 지금 글을 읽는 함수와 글을 쓰던 칸으로 메모를 만든다. 못 만들면 false (글은 그대로 두고 다음 글자에 다시) */
  onCreate: (read: () => { title: string; body: string }, field: DraftField) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const latest = useRef({ title: '', body: '' });
  const making = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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

  const change = (field: DraftField, value: string, composing: boolean) => {
    latest.current = { ...latest.current, [field]: value };
    if (field === 'title') setTitle(value);
    else setBody(value);
    tryMake(field, composing);
  };
  const tryMake = (field: DraftField, composing: boolean) => {
    if (composing || making.current || !draftHasText(latest.current)) return;
    making.current = true;
    void onCreate(() => latest.current, field).then((made) => {
      // 만들었으면 이 칸은 곧 사라진다. 못 만들었으면 다음 글자에 다시 해 본다
      if (!made) making.current = false;
    });
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
        onCompositionEnd={(e) => change('title', e.currentTarget.value, false)}
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
        onCompositionEnd={(e) => change('body', e.currentTarget.value, false)}
      />
      <p className="note-saved" role="status" />
    </div>
  );
}
