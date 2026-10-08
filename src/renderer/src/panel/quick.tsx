import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import './panel.css';
import { t } from '../../../shared/i18n/index.ts';
import { localDay } from '../../../shared/todo-store.ts';
import { initLang } from '../lang.ts';
import { PetFace } from '../PetFace.tsx';
import { addedText } from './format.ts';
import { escClosesWindow, isEsc, takeEsc } from './keys.ts';

const bridge = window.jjakkungPanel;
/** 넣은 뒤 닫기까지. 어디에 언제로 넣었는지 읽을 만큼 (그새 다시 쓰기 시작하면 닫지 않는다) */
const CLOSE_MS = 1500;

/**
 * 빠른 입력 (P2-04): 어디서든 단축키로 한 줄 적어 할 일로.
 * Enter 는 넣고 닫기, Shift+Enter 는 넣고 창을 남겨 다음 줄, Esc 는 쓰던 글 지우기 그다음 닫기.
 */
function QuickAdd() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [failed, setFailed] = useState(false);
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
    if (!r.ok) {
      setMsg(r.error ?? t('panel.add.failed'));
      setFailed(true);
      return;
    }
    if (value === text) setText('');
    setFailed(false);
    setMsg(addedText(r, localDay(Date.now())));
    clearTimeout(closeTimer.current);
    if (!stay) closeTimer.current = setTimeout(() => bridge.close(), CLOSE_MS);
  };
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
    <div className="quick card-window">
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
      {msg && (
        <span className={`quick-msg ${failed ? 'error' : ''}`} title={msg}>
          {msg}
        </span>
      )}
    </div>
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
