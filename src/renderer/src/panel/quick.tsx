import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import './panel.css';
import { t } from '../../../shared/i18n/index.ts';
import { localDay } from '../../../shared/todo-store.ts';
import { initLang } from '../lang.ts';
import { PetFace } from '../PetFace.tsx';
import { useDraft } from './draft.ts';
import { addedText, timeOf, whenLabel } from './format.ts';
import { escClosesWindow, isEsc, takeEsc } from './keys.ts';

const bridge = window.jjakkungPanel;
/** 넣은 뒤 닫기까지. 어디에 언제로 넣었는지 읽을 만큼 (그새 다시 쓰기 시작하면 닫지 않는다) */
const CLOSE_MS = 1500;

/**
 * 빠른 입력 (P2-04): 어디서든 단축키로 한 줄 적어 할 일로.
 * Enter 는 넣고 닫기, Shift+Enter 는 넣고 창을 남겨 다음 줄, Esc 는 쓰던 글 지우기 그다음 닫기.
 */
function QuickAdd() {
  // 쓰던 글 (#145): 다른 곳을 눌러 닫혀도 메인이 들고 있다가 다시 열면 돌려준다
  const [text, setText] = useDraft('quick');
  const [msg, setMsg] = useState('');
  const [failed, setFailed] = useState(false);
  /** 오후로 읽은 일정: 오전으로 바꾸는 단추 (shared/event-store.ts parseQuickEventInfo) */
  const [am, setAm] = useState<{ id: number; startAt: number; endAt: number | null }>();
  const ref = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** 넣는 중 (Enter 를 빨리 두 번 눌러 두 번 들어가지 않게) */
  const busy = useRef(false);
  const submit = async (value: string, stay: boolean) => {
    if (busy.current || !value.trim()) return;
    busy.current = true;
    const r = await bridge.add(value).finally(() => {
      busy.current = false;
    });
    setAm(undefined);
    if (!r.ok) {
      setMsg(r.error ?? t('panel.add.failed'));
      setFailed(true);
      return;
    }
    if (value === text) setText('');
    setFailed(false);
    // 시간이 겹치는 일정이 있으면 같이 알리고 읽을 시간을 더 준다
    const clash =
      r.kind === 'event' && r.clash
        ? ` ${t('assist.clash', { time: timeOf(r.clash.startAt), title: r.clash.title })}`
        : '';
    const guess = r.kind === 'event' && r.am ? ` ${t('panel.toast.pmGuess')}` : '';
    if (r.kind === 'event' && r.am) setAm({ id: r.id, ...r.am });
    setMsg(addedText(r, localDay(Date.now())) + guess + clash);
    clearTimeout(closeTimer.current);
    // 오전으로 바꿀 수 있으면 누를 시간을 더 준다
    // 지난 날, 매달 반복으로 넣었다는 말도 읽을 시간을 준다
    const flagged = r.kind === 'todo' && (r.past || r.monthly);
    const wait = guess ? CLOSE_MS * 3 : clash || flagged ? CLOSE_MS * 2 : CLOSE_MS;
    if (!stay) closeTimer.current = setTimeout(() => bridge.close(), wait);
  };
  const toAm = () => {
    if (!am) return;
    const { id, ...at } = am;
    bridge.eventUpdate(id, at);
    setAm(undefined);
    setMsg(t('panel.quick.event', { when: whenLabel(at.startAt, localDay(Date.now())) }));
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => bridge.close(), CLOSE_MS);
  };
  // 창 높이를 내용에 맞춘다: 큰 글씨(확대)에서 64 창이 입력칸 위아래를 잘랐다. 가장 큰 줄 높이에 테두리(2),
  // 창 여백(위아래 6), 숨 쉴 자리(위아래 8)를 더한다. 보통 크기면 64 그대로 (메인이 확대 배율을 곱한다)
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const fit = () => {
      const tallest = Math.max(0, ...[...card.children].map((c) => c.getBoundingClientRect().height));
      bridge.quickFit(Math.ceil(tallest) + 2 + 12 + 16);
    };
    fit();
    const ro = new ResizeObserver(fit);
    for (const c of card.children) ro.observe(c);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);
  useEffect(() => {
    ref.current?.focus();
    window.addEventListener('focus', () => ref.current?.focus());
    // 입력칸이 먼저 Esc 를 처리한다(쓰던 글 지우기). 한글 조합 중 Esc 는 조합만 끝낸다
    const onKey = (e: KeyboardEvent) => {
      if (escClosesWindow(e)) bridge.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <main className="quick card-window" ref={cardRef}>
      <h1 className="sr-only">{t('common.title.quick')}</h1>
      <PetFace />
      <input
        ref={ref}
        value={text}
        aria-label={t('panel.quick.label')}
        placeholder={t('panel.quick.placeholder')}
        title={t('panel.quick.hint')}
        onChange={(e) => {
          setText(e.target.value);
          setMsg('');
          setAm(undefined);
          // 넣고 닫히기 전에 다시 쓰기 시작했다: 닫지 않는다
          clearTimeout(closeTimer.current);
        }}
        onKeyDown={(e) => {
          if (isEsc(e) && text) {
            takeEsc(e);
            setText('');
            setMsg('');
            return;
          }
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          void submit(text, e.shiftKey);
        }}
        onPaste={(e) => {
          // 여러 줄을 붙여 넣으면 줄마다 하나씩 넣고 "할 일 3개 넣었어"
          const pasted = e.clipboardData.getData('text');
          if (pasted.split(/\r?\n/).filter((l) => l.trim()).length < 2) return;
          e.preventDefault();
          void submit(pasted, false);
        }}
      />
      {/* 화면 읽기 프로그램도 넣은 결과(어디에, 언제로)와 실패를 읽게 (패널 알림과 같은 status, 실패는 alert) */}
      {msg && (
        <span className={`quick-msg ${failed ? 'error' : ''}`} title={msg} role={failed ? 'alert' : 'status'}>
          {msg}
        </span>
      )}
      {am && (
        <button type="button" className="quick-am" onClick={toAm}>
          {t('panel.toast.toAm')}
        </button>
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
