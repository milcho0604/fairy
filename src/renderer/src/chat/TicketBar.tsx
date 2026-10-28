import { useState } from 'react';
import type { ChatState } from '../../../shared/chat-state.ts';
import { t } from '../../../shared/i18n/index.ts';

const bridge = window.jjakkungChat;

/**
 * AI 대화권 머리 줄 (#100, 기획서 8절). "AI 와 대화 중" 은 늘 보인다(Anthropic 조건의 필수, 인공지능기본법 고지).
 * 남은 수, 처음에는 국외 이전 안내와 "알겠어" 단추 (누르기 전에는 보내지 않는다)
 */
export function TicketBar({ ticket }: { ticket: NonNullable<ChatState['ticket']> }) {
  return (
    <section className="ticket-bar" aria-label={t('ticket.label')}>
      <p className="ticket-ai">
        <span className="ticket-badge" aria-hidden="true">
          AI
        </span>
        <span>{t('ticket.aiNow')}</span>
      </p>
      <p className="ticket-count">
        {ticket.tickets === null ? t('ticket.countUnknown') : t('ticket.count', { n: ticket.tickets })}
      </p>
      {!ticket.agreed && (
        <div className="ticket-notice">
          <ul className="ticket-points">
            <li>{t('ticket.notice.sent')}</li>
            <li>{t('ticket.notice.kept')}</li>
            <li>{t('ticket.notice.skip')}</li>
          </ul>
          <button type="button" className="primary" onClick={() => bridge.agreeTicket()}>
            {t('ticket.agree')}
          </button>
        </div>
      )}
    </section>
  );
}

/** 대화권 답 아래 "신고". 무엇이 가는지 보여 주고 따로 확인을 받은 뒤 보낸다 (기획서 8절, 13절) */
export function TicketReport({ id }: { id: string }) {
  const [step, setStep] = useState<'idle' | 'ask' | 'sending' | 'sent' | 'failed'>('idle');
  if (step === 'sent' || step === 'failed')
    return (
      <p className={`ticket-report-done ${step}`} role="status">
        {t(step === 'sent' ? 'ticket.reportSent' : 'ticket.reportFailed')}
      </p>
    );
  if (step === 'idle')
    return (
      <button
        type="button"
        className="ticket-report-open"
        title={t('ticket.reportTitle')}
        onClick={() => setStep('ask')}
      >
        {t('ticket.report')}
      </button>
    );
  return (
    <div className="ticket-report action-row">
      <p className="grow">{t('ticket.reportAsk')}</p>
      <button
        type="button"
        className="ghost"
        disabled={step === 'sending'}
        onClick={async () => {
          setStep('sending');
          setStep((await bridge.reportTicket(id)) ? 'sent' : 'failed');
        }}
      >
        {t('ticket.reportSend')}
      </button>
      <button type="button" className="ghost" disabled={step === 'sending'} onClick={() => setStep('idle')}>
        {t('common.cancel')}
      </button>
    </div>
  );
}
