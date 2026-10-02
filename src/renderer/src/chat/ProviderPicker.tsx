import { useEffect, useRef, useState } from 'react';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
import type { ProviderView } from '../../../shared/ipc.ts';
import { dotOf, statusText } from './providerStatus.ts';

interface Props {
  providers: ProviderView[];
  status: Partial<Record<AiProvider, AiStatus>>;
  current: AiProvider;
  disabled: boolean;
  onPick: (id: AiProvider) => void;
  onManage: () => void;
}

/** 대화할 AI 고르기. 깔려 있는 AI 를 먼저, 못 찾은 AI 는 아래에 흐리게. */
export function ProviderPicker({ providers, status, current, disabled, onPick, onManage }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = providers.find((p) => p.id === current);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const sorted = [...providers].sort(
    (a, b) => Number(!status[a.id]?.installed) - Number(!status[b.id]?.installed),
  );

  return (
    <div className="picker" ref={ref}>
      <button
        type="button"
        className="picker-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={selected ? statusText(selected, status[current]) : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`dot ${dotOf(status[current])}`} aria-hidden="true" />
        {selected?.label ?? current}
        <svg className="caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="picker-menu" role="menu">
          {sorted.map((p) => {
            const s = status[p.id];
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={p.id === current}
                className={`${p.id === current ? 'on' : ''} ${s && !s.installed ? 'missing' : ''}`}
                title={statusText(p, s)}
                onClick={() => {
                  onPick(p.id);
                  setOpen(false);
                }}
              >
                <span className={`dot ${dotOf(s)}`} aria-hidden="true" />
                <span className="name">{p.label}</span>
                {!p.verified && <span className="tag">확인 전</span>}
                {s && !s.installed && <span className="tag">없음</span>}
              </button>
            );
          })}
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <span className="name">AI 추가, 관리</span>
          </button>
        </div>
      )}
    </div>
  );
}
