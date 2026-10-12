// 지난 대화 목록의 날짜: 오늘이면 시각, 어제, 올해면 월일, 그 전이면 연월일
import { locale, t } from '../../../shared/i18n/index.ts';

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function threadDate(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const days = Math.round((dayOf(n) - dayOf(d)) / 86_400_000);
  if (days === 0) {
    const time = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return `${t('chat.list.today')} ${time.format(d)}`;
  }
  if (days === 1) return t('chat.list.yesterday');
  const sameYear = d.getFullYear() === n.getFullYear();
  return new Intl.DateTimeFormat(locale(), {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(d);
}
