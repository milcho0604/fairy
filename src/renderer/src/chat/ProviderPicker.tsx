import { useEffect, useRef, useState } from 'react';
import { TICKET_PROVIDER_ID } from '../../../shared/ai/providers.ts';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
import type { ChatState } from '../../../shared/chat-state.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ProviderView } from '../../../shared/ipc.ts';
import { dotOf, statusText } from './providerStatus.ts';

interface Props {
  providers: ProviderView[];
  status: Partial<Record<AiProvider, AiStatus>>;
  current: AiProvider;
  /** 채팅 이용권 줄 (메인이 준다). 늘 맨 위에 보이고, 못 쓰면 흐리게 두고 까닭을 적는다 */
  ticketGate?: ChatState['ticketGate'];
  disabled: boolean;
  onPick: (id: AiProvider) => void;
  onManage: () => void;
}

/** 대화할 AI 고르기. 깔려 있는 AI 를 먼저, 못 찾은 AI 는 아래에 흐리게. */
export function ProviderPicker({
  providers,
  status,
  current,
  ticketGate,
  disabled,
  onPick,
  onManage,
}: Props) {
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

  // 채팅 이용권은 아래 목록에서 빼고 맨 위 줄로 따로 그린다 (못 써도 늘 보인다)
  const sorted = providers
    .filter((p) => p.id !== TICKET_PROVIDER_ID)
    .sort((a, b) => Number(!status[a.id]?.installed) - Number(!status[b.id]?.installed));
  const block = ticketGate?.block;

  return (
    <div className={`picker${selected?.ticket ? ' ticket' : ''}`} ref={ref}>
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
        <span className="picker-label">
          {selected?.label ?? (current === TICKET_PROVIDER_ID ? t('ticket.label') : current)}
        </span>
        <svg className="caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="picker-menu" role="menu">
          {ticketGate && (
            <>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={current === TICKET_PROVIDER_ID}
                aria-disabled={block ? true : undefined}
                aria-describedby={block ? 'ticket-why' : undefined}
                className={`ticket-row${current === TICKET_PROVIDER_ID ? ' on' : ''}${block ? ' blocked' : ''}`}
                title={
                  block ? `${t(`ticket.why.${block}`)}. ${t(`ticket.how.${block}`)}` : t('ticket.detail')
                }
                onClick={() => {
                  if (block) return;
                  onPick(TICKET_PROVIDER_ID);
                  setOpen(false);
                }}
              >
                <span className={`dot ${block ? 'off' : 'ok'}`} aria-hidden="true" />
                <span className="name">{t('ticket.label')}</span>
                {!block && <span className="detail">{t('ticket.detail')}</span>}
                {ticketGate.tickets !== null && (
                  <span className="tag ticket-left">{t('ticket.leftTag', { n: ticketGate.tickets })}</span>
                )}
                {block && (
                  <span className="ticket-why" id="ticket-why">
                    <span>{t(`ticket.why.${block}`)}</span>
                    <span>{t(`ticket.how.${block}`)}</span>
                  </span>
                )}
              </button>
              <hr />
            </>
          )}
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
                {p.detail && <span className="detail">{p.detail}</span>}
                {!p.verified && (
                  <span className="tag" title={t('chat.notVerifiedTitle')}>
                    {t('chat.notVerified')}
                  </span>
                )}
                {s && !s.installed && <span className="tag">{t('chat.missing')}</span>}
                {s?.needsModel && <span className="tag">{t('chat.notDownloaded')}</span>}
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
            <span className="name">{t('chat.manageMenu')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
