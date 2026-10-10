import { useEffect, useRef, useState } from 'react';
import { type BetaReport, goalsMet, TARGET } from '../../../shared/beta-stats.ts';
import { t } from '../../../shared/i18n/index.ts';
import { FeedbackBox } from './FeedbackBox.tsx';
import { bridge } from './ui.tsx';

/**
 * 베타 기록 (P4-04). 기획서 성공 기준 다섯 가지를 지금 값과 목표로 보여 준다.
 * 메뉴 막대 "의견 보내기"로 열리면 이 칸으로 바로 내려온다.
 */
export function Stats({ onCopied }: { onCopied: (ok: boolean) => void }) {
  const [report, setReport] = useState<BetaReport>();
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const load = () => bridge.stats().then(setReport);
    const show = () => {
      load();
      setFocus(true);
      setTimeout(() => setFocus(false), 1600);
    };
    load();
    bridge.onFocus(show);
    if (location.hash === '#stats') show();
    // 창을 다시 볼 때 숫자를 새로 읽는다 (1분마다 쌓인다).
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    // 숫자를 읽기 전에는 칸이 없어서, 읽은 뒤에 내려간다.
    if (focus && report) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus, report]);

  if (!report) return null;
  const started = report.dayNumber > 0;
  // 기록이 없으면 달성 표시를 하지 않는다 (켜 둔 시간 0 인데 숨김 0%, 멈춤 0회가 달성으로 떴다)
  const met = goalsMet(report);
  const rows: { label: string; value: string; goal: string; ok: boolean | undefined }[] = [
    {
      label: t('settings.stats.daysUsed'),
      value: started
        ? t(report.daysUsed === 1 ? 'settings.stats.dayValueOne' : 'settings.stats.dayValue', {
            day: report.dayNumber,
            used: report.daysUsed,
          })
        : t('settings.stats.fromToday'),
      goal: t('settings.stats.daysGoal'),
      ok: started ? report.dayNumber >= 14 || undefined : undefined,
    },
    {
      label: t('settings.stats.doneMedian'),
      value: t('settings.stats.count', { n: report.doneMedian }),
      goal: t('settings.stats.countAtLeast', { n: TARGET.doneMedian }),
      ok: met.done,
    },
    {
      label: t('settings.stats.hidden'),
      value: `${Math.round(report.hiddenRatio * 100)}%`,
      goal: t('settings.stats.under', { n: TARGET.hiddenRatio * 100 }),
      ok: met.hidden,
    },
    {
      label: t('settings.stats.look'),
      value: t('settings.stats.times', { n: report.look7 }),
      goal: t('settings.stats.timesAtLeast', { n: TARGET.look7 }),
      ok: met.look,
    },
    {
      label: t('settings.stats.crash'),
      value: t('settings.stats.times', { n: report.crash7 }),
      goal: t('settings.stats.times', { n: TARGET.crash7 }),
      ok: met.crash,
    },
  ];

  return (
    <section ref={ref} id="stats" className={focus ? 'focus' : ''}>
      <h2>{t('settings.stats.title')}</h2>
      <div className="card">
        <small>{t('settings.stats.intro')}</small>
        <table className="stats">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>
                  <b>{r.value}</b>
                  <small>
                    {t('settings.stats.goal', { goal: r.goal })}
                    {r.ok === true && <i className="met"> {t('settings.stats.met')}</i>}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="action-row">
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              onCopied(await bridge.copyStats().catch(() => false));
            }}
          >
            {t('settings.stats.copy')}
          </button>
        </div>
        <small>{t('settings.stats.privacy')}</small>
        <FeedbackBox />
      </div>
    </section>
  );
}
