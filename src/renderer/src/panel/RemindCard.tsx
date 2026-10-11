import { useEffect, useState } from 'react';
import type { RecentRemind } from '../../../shared/day-ipc.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import type { SnoozeChoice } from '../../../shared/snooze.ts';
import { whenLabel } from './format.ts';
import './day.css';

const day = window.jjakkungDay;
/** 미뤘다는 글을 보이는 시간 */
const DONE_MS = 4000;

/**
 * 방금 울린 알림 (오늘 탭 맨 위): 10분 뒤, 1시간 뒤, 내일 아침으로 미루기. 시스템 알림에 단추가 없는 곳(리눅스)이나
 * 알림을 눌러 패널을 연 사람이 여기서 미룬다. 30분이 지나거나 확인하면 사라진다
 */
export function RemindCard({ s }: { s: PanelState }) {
  const [recent, setRecent] = useState<RecentRemind>();
  const [done, setDone] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: 패널 상태(s)가 바뀔 때마다 다시 읽는다
  useEffect(() => {
    let alive = true;
    day
      .remind()
      .then((r) => alive && setRecent(r ?? undefined))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [s]);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(''), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  if (done)
    return (
      <section className="remind-card" role="status">
        <span>{done}</span>
      </section>
    );
  if (!recent) return null;
  const first = recent.titles[0] ?? '';
  const title =
    recent.titles.length > 1 ? t('snooze.card.more', { title: first, n: recent.titles.length - 1 }) : first;
  const snooze = async (choice: SnoozeChoice) => {
    const at = await day.remindSnooze(choice).catch(() => undefined);
    setRecent(undefined);
    setDone(
      at === undefined ? t('snooze.card.fail') : t('snooze.card.done', { when: whenLabel(at, s.today) }),
    );
  };
  return (
    <section className="remind-card" aria-label={t('snooze.card.title')}>
      <div className="remind-card-text">
        <small>{t('snooze.card.title')}</small>
        <strong title={recent.titles.join('\n')}>{title}</strong>
      </div>
      <div className="remind-card-actions">
        {recent.choices.map((c) => (
          <button key={c} type="button" className="len-chip" onClick={() => snooze(c)}>
            {t(`snooze.${c}`)}
          </button>
        ))}
        <button
          type="button"
          className="link"
          onClick={() => {
            day.remindDismiss();
            setRecent(undefined);
          }}
        >
          {t('snooze.card.ok')}
        </button>
      </div>
    </section>
  );
}
