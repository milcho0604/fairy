import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import './panel.css';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelAddResult } from '../../../shared/ipc.ts';
import { memoBody } from '../../../shared/quick-add.ts';
import { localDay } from '../../../shared/todo-store.ts';
import { initLang } from '../lang.ts';
import { PetFace } from '../PetFace.tsx';
import { useDraft } from './draft.ts';
import { addedText, timeOf, whenLabel } from './format.ts';
import { escClosesWindow, isEsc, takeEsc } from './keys.ts';

const bridge = window.jjakkungPanel;
/**
 * 넣은 뒤 닫기까지. 결과 문장을 읽고 되돌리기, 분류 바꾸기를 누를 만큼 (예전 1.5초는 읽기도 전에 닫혔다, #145).
 * 마우스를 올리거나 단추에 포커스가 있는 동안, 다시 쓰기 시작한 동안은 닫지 않는다
 */
const CLOSE_MS = 6000;
/** 시간이 겹치거나 오후로 읽은 일정은 읽을 것이 더 있다 */
const CLOSE_LONG_MS = 9000;
/** 마우스를 올렸다 떼면 이만큼 더 둔다 */
const LINGER_MS = 2500;
/** 붙여 넣은 목록 미리 보기에 보이는 줄 수 */
const PREVIEW_LINES = 4;

type Kind = 'todo' | 'event' | 'note';
/** 방금 넣은 것 (되돌리기와 분류 바꾸기의 대상) */
interface Result {
  kind: Kind | 'many';
  id?: number;
  /** 되돌리면 칸에 돌려놓을 글. 메모는 머리말을 뗀 본문 */
  text: string;
  items?: { kind: Kind; id: number }[];
  msg: string;
  /** 오후로 읽은 일정: 오전으로 바꾸는 시각 */
  am?: { startAt: number; endAt: number | null };
}

const KIND_LABEL = {
  todo: 'keep.quick.asTodo',
  event: 'keep.quick.asEvent',
  note: 'keep.quick.asNote',
} as const;

const linesOf = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** 넣은 것을 지운다 (휴지통, 되돌릴 수 있다) */
function removeItem(kind: Kind, id: number) {
  if (kind === 'todo') bridge.remove(id);
  else if (kind === 'event') bridge.eventRemove(id);
  else bridge.noteRemove(id);
}

/**
 * 빠른 입력 (P2-04): 어디서든 단축키로 한 줄 적어 할 일로.
 * Enter 는 넣고, Shift+Enter 는 넣고 창을 남겨 다음 줄, Esc 는 쓰던 글 지우기 그다음 닫기.
 * 넣은 뒤에는 결과(어디에 언제로)를 한 줄 아래에 그대로 보이고 되돌리기와 분류 바꾸기(할 일, 일정, 메모) 단추를 둔다.
 * 여러 줄을 붙여 넣으면 넣을 목록을 먼저 보여 준다. "메모: ..." 머리말은 메모로 넣는다.
 */
function QuickAdd() {
  // 쓰던 글 (#145): 다른 곳을 눌러 닫혀도 메인이 들고 있다가 다시 열면 돌려준다
  const [text, setText] = useDraft('quick');
  const [error, setError] = useState('');
  const [res, setRes] = useState<Result>();
  /** 붙여 넣은 여러 줄 (넣기 전 확인) */
  const [paste, setPaste] = useState<string[]>();
  const ref = useRef<HTMLInputElement>(null);
  const extraRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** 넣는 중 (Enter 를 빨리 두 번 눌러 두 번 들어가지 않게) */
  const busy = useRef(false);

  const armClose = (ms: number) => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      // 마우스가 올라가 있거나(mouseenter 가 안 온 채 처음부터 올라간 경우) 단추에 포커스가 있으면 조금 더 둔다
      const el = extraRef.current;
      if (el && (el.matches(':hover') || el.contains(document.activeElement))) armClose(LINGER_MS);
      else bridge.close();
    }, ms);
  };
  const stopClose = () => clearTimeout(closeTimer.current);

  const today = () => localDay(Date.now());

  const submit = async (value: string, stay: boolean) => {
    if (busy.current || !value.trim()) return;
    busy.current = true;
    const r = await bridge.add(value, { quick: true }).finally(() => {
      busy.current = false;
    });
    if (!r.ok) {
      // 실패하면 붙인 목록은 그대로 둔다 (줄여서 다시 넣을 수 있게)
      setError(r.error ?? t('panel.add.failed'));
      setRes(undefined);
      return;
    }
    setPaste(undefined);
    if (value === text) setText('');
    setError('');
    const next = resultOf(r, value);
    setRes(next);
    // 시간이 겹치는 일정이나 오후로 읽은 일정은 읽을 시간을 더 준다
    const long = r.kind === 'event' && (r.clash || r.am);
    if (!stay) armClose(long ? CLOSE_LONG_MS : CLOSE_MS);
    else stopClose();
  };

  /** 서버가 돌려준 결과를 화면에 보일 모양으로 */
  const resultOf = (r: Extract<PanelAddResult, { ok: true }>, value: string): Result => {
    const base = addedText(r, today());
    if (r.kind === 'many') return { kind: 'many', text: value, items: r.items, msg: base };
    if (r.kind === 'note')
      return { kind: 'note', id: r.id, text: memoBody(value) ?? value.trim(), msg: base };
    if (r.kind === 'event') {
      const clash = r.clash
        ? ` ${t('assist.clash', { time: timeOf(r.clash.startAt), title: r.clash.title })}`
        : '';
      const guess = r.am ? ` ${t('panel.toast.pmGuess')}` : '';
      return {
        kind: 'event',
        id: r.id,
        text: value.trim(),
        msg: base + guess + clash,
        ...(r.am ? { am: r.am } : {}),
      };
    }
    return { kind: 'todo', id: r.id, text: value.trim(), msg: base };
  };

  const toAm = () => {
    if (res?.kind !== 'event' || res.id === undefined || !res.am) return;
    const at = res.am;
    bridge.eventUpdate(res.id, at);
    setRes({ ...res, am: undefined, msg: t('panel.quick.event', { when: whenLabel(at.startAt, today()) }) });
    armClose(CLOSE_MS);
  };

  /** 방금 넣은 것을 되돌린다. 글은 칸(여러 줄이면 붙여 넣기 확인)으로 돌려놓는다 */
  const undo = () => {
    if (!res) return;
    if (res.kind === 'many') {
      for (const it of res.items ?? []) removeItem(it.kind, it.id);
      setPaste(linesOf(res.text));
    } else if (res.id !== undefined) {
      removeItem(res.kind, res.id);
      setText(res.text);
    }
    setRes(undefined);
    setError('');
    stopClose();
    ref.current?.focus();
  };

  /** 방금 넣은 것을 다른 분류로 바꾼다: 새로 넣고 성공하면 옛것을 지운다 */
  const reclass = async (to: Kind) => {
    if (!res || res.kind === 'many' || res.id === undefined || busy.current) return;
    busy.current = true;
    const from = { kind: res.kind, id: res.id, text: res.text };
    try {
      let made: Result | undefined;
      if (to === 'todo') {
        const r = await bridge.add(from.text, { as: 'todo' });
        if (r.ok && r.kind === 'todo')
          made = { kind: 'todo', id: r.id, text: from.text, msg: addedText(r, today()) };
        else if (!r.ok) setError(r.error ?? t('panel.add.failed'));
      } else if (to === 'event') {
        const r = await bridge.eventAdd(from.text);
        if (r.ok && r.event)
          made = {
            kind: 'event',
            id: r.event.id,
            text: from.text,
            msg:
              t('panel.quick.event', { when: whenLabel(r.event.startAt, today()) }) +
              (r.clash
                ? ` ${t('assist.clash', { time: timeOf(r.clash.startAt), title: r.clash.title })}`
                : ''),
          };
        else setError(r.error ?? t('panel.add.failed'));
      } else {
        const n = await bridge.noteAdd(from.text);
        made = { kind: 'note', id: n.id, text: from.text, msg: t('keep.quick.note') };
      }
      if (made) {
        removeItem(from.kind, from.id);
        setError('');
        setRes(made);
      }
      armClose(CLOSE_MS);
    } finally {
      busy.current = false;
    }
  };

  const confirmPaste = () => {
    if (paste) void submit(paste.join('\n'), false);
  };

  // 창 높이를 내용에 맞춘다: 큰 글씨(확대)에서 64 창이 입력칸 위아래를 잘랐고, 결과 줄과 붙여 넣기 목록이 생기면 더 늘어난다.
  // 줄들의 높이를 더하고 테두리(2), 창 여백(위아래 6), 숨 쉴 자리(위아래 8)를 더한다. 보통 크기에 한 줄이면 64 그대로 (메인이 확대 배율을 곱한다)
  const cardRef = useRef<HTMLElement>(null);
  // 줄이 생기고 사라지니 그릴 때마다 지켜보는 줄을 다시 건다
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rows = [...card.children].filter((c) => !c.classList.contains('sr-only'));
    const fit = () => {
      const total =
        rows.reduce((sum, c) => sum + c.getBoundingClientRect().height, 0) + 6 * Math.max(0, rows.length - 1);
      bridge.quickFit(Math.ceil(total) + 2 + 12 + 16);
    };
    fit();
    const ro = new ResizeObserver(fit);
    for (const c of rows) ro.observe(c);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  });
  useEffect(() => {
    ref.current?.focus();
    window.addEventListener('focus', () => ref.current?.focus());
    // 입력칸이 먼저 Esc 를 처리한다(쓰던 글 지우기, 붙여 넣기 취소). 한글 조합 중 Esc 는 조합만 끝낸다
    const onKey = (e: KeyboardEvent) => {
      if (escClosesWindow(e)) bridge.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const preview = paste
    ? paste.slice(0, PREVIEW_LINES).map((line, n) => ({ line, key: `${n}:${line}` }))
    : [];
  const others =
    res && res.kind !== 'many' ? (['todo', 'event', 'note'] as const).filter((k) => k !== res.kind) : [];

  return (
    <main className="quick card-window" ref={cardRef}>
      <h1 className="sr-only">{t('common.title.quick')}</h1>
      <div className="quick-row">
        <PetFace />
        <input
          ref={ref}
          value={text}
          aria-label={t('panel.quick.label')}
          placeholder={t('panel.quick.placeholder')}
          title={t('panel.quick.hint')}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
            setRes(undefined);
            // 넣고 닫히기 전에 다시 쓰기 시작했다: 닫지 않는다
            stopClose();
          }}
          onKeyDown={(e) => {
            if (isEsc(e) && paste) {
              takeEsc(e);
              setPaste(undefined);
              return;
            }
            if (isEsc(e) && text) {
              takeEsc(e);
              setText('');
              setError('');
              setRes(undefined);
              return;
            }
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            // 붙여 넣은 목록을 보고 있으면 Enter 가 그 목록을 넣는다
            if (paste) {
              confirmPaste();
              return;
            }
            // 넣은 결과를 읽던 중 빈 칸에서 Enter: 닫는다
            if (!text.trim() && res) {
              bridge.close();
              return;
            }
            void submit(text, e.shiftKey);
          }}
          onPaste={(e) => {
            // 여러 줄을 붙여 넣으면 바로 넣지 않고 넣을 목록을 먼저 보여 준다 (메일을 보며 옮겨 적다 한 번에 많이 들어가지 않게)
            const pasted = e.clipboardData.getData('text');
            const lines = linesOf(pasted);
            if (lines.length < 2) return;
            e.preventDefault();
            setPaste(lines);
            setRes(undefined);
            setError('');
            stopClose();
          }}
        />
      </div>
      {paste && (
        // 붙여 넣은 여러 줄: 넣을 목록. 넣기(Enter), 취소(Esc)
        <section
          className="quick-extra quick-paste"
          aria-label={t('keep.quick.pasteTitle', { n: paste.length })}
        >
          <p className="quick-paste-title">{t('keep.quick.pasteTitle', { n: paste.length })}</p>
          <ul>
            {preview.map((p) => (
              <li key={p.key} title={p.line}>
                {p.line}
              </li>
            ))}
            {paste.length > PREVIEW_LINES && (
              <li className="quick-paste-more">
                {t('keep.quick.pasteMore', { n: paste.length - PREVIEW_LINES })}
              </li>
            )}
          </ul>
          <div className="quick-actions">
            <button type="button" className="quick-btn primary" onClick={confirmPaste}>
              {t('keep.quick.confirm')}
            </button>
            <button
              type="button"
              className="quick-btn"
              onClick={() => {
                setPaste(undefined);
                ref.current?.focus();
              }}
            >
              {t('keep.quick.cancel')}
            </button>
          </div>
        </section>
      )}
      {/* 화면 읽기 프로그램도 넣은 결과(어디에, 언제로)와 실패를 읽게 (패널 알림과 같은 status, 실패는 alert) */}
      {error && (
        <div className="quick-extra">
          <span className="quick-msg error" role="alert">
            {error}
          </span>
        </div>
      )}
      {res && (
        <div className="quick-extra" ref={extraRef}>
          <span className="quick-msg" role="status">
            {res.msg}
          </span>
          <div className="quick-actions">
            <button type="button" className="quick-btn" onClick={undo}>
              {res.kind === 'many' ? t('keep.quick.undoAll') : t('panel.undo')}
            </button>
            {res.am && (
              <button type="button" className="quick-btn quick-am" onClick={toAm}>
                {t('panel.toast.toAm')}
              </button>
            )}
            {others.length > 0 && (
              <fieldset className="quick-move" aria-label={t('keep.quick.moveLabel')}>
                {others.map((k) => (
                  <button key={k} type="button" className="quick-btn" onClick={() => void reclass(k)}>
                    {t(KIND_LABEL[k])}
                  </button>
                ))}
              </fieldset>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

initLang('common.title.quick');
const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <QuickAdd />
  </StrictMode>,
);
