import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../theme.css';
import './panel.css';
import { PetFace } from '../PetFace.tsx';

const bridge = window.jjakkungPanel;

/** 빠른 입력 (P2-04): 어디서든 단축키로 한 줄 적어 할 일로. Enter 넣기, Esc 닫기. */
function QuickAdd() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
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
        aria-label="할 일 한 줄"
        placeholder="할 일이나 일정 한 줄 (예: 내일 보고서 쓰기!, 금요일 3시 회의)"
        onChange={(e) => {
          setText(e.target.value);
          setMsg('');
        }}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
          const r = await bridge.add(text);
          if (!r.ok) {
            setMsg(r.error ?? '못 넣었어');
            return;
          }
          setText('');
          setMsg(r.kind === 'event' ? '일정에 넣었어' : '할 일에 넣었어');
          setTimeout(() => bridge.close(), 500);
        }}
      />
      {msg && <span className="quick-msg">{msg}</span>}
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root 가 없다');
createRoot(root).render(
  <StrictMode>
    <QuickAdd />
  </StrictMode>,
);
