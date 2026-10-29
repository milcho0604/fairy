import { t } from '../../../shared/i18n/index.ts';
import { MailIcon } from './icons.tsx';
import { openMail, useMailBox } from './mail-state.ts';
import './mail.css';

// 오늘 탭의 새 쪽지 카드 (feat/mailbox): 안 읽은 쪽지가 있을 때만 한 줄로 알리고 쪽지함을 연다.
// 목록과 읽기는 쪽지함 화면(MailView)에서 한다. 쪽지가 하나도 없고 꺼져 있으면 아무것도 안 그린다.
export function MailCard() {
  const box = useMailBox();
  if (!box || (box.items.length === 0 && !box.on)) return null;
  if (box.unread === 0)
    return (
      <p className="mail-card quiet">
        <button type="button" className="link" onClick={openMail}>
          {t('mail.cardOpen')}
        </button>
      </p>
    );
  return (
    <section className="mail-card" aria-label={t('mail.title')}>
      <MailIcon dot />
      <span className="mail-card-text">{t('mail.card', { n: box.unread })}</span>
      <button type="button" className="mail-card-open" onClick={openMail}>
        {t('mail.cardOpen')}
      </button>
    </section>
  );
}
