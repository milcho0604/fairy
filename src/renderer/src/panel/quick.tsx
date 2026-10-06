import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import './panel.css';
import { t } from '../../../shared/i18n/index.ts';
import { initLang } from '../lang.ts';
import { PetFace } from '../PetFace.tsx';

const bridge = window.jjakkungPanel;

/** 빠른 입력 (P2-04): 어디서든 단축키로 한 줄 적어 할 일로. Enter 넣기, Esc 닫기. */
function QuickAdd() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    window.addEventListener('focus', () => ref.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') bridge.close();
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
        onChange={(e) => {
          setText(e.target.value);
          setMsg('');
        }}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
          const r = await bridge.add(text);
          if (!r.ok) {
            setMsg(r.error ?? t('panel.add.failed'));
            setFailed(true);
            return;
          }
          setText('');
          setFailed(false);
          setMsg(r.kind === 'event' ? t('panel.quick.event') : t('panel.quick.todo'));
          setTimeout(() => bridge.close(), 500);
        }}
      />
      {msg && <span className={`quick-msg ${failed ? 'error' : ''}`}>{msg}</span>}
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
