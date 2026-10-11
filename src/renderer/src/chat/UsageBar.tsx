import { useEffect, useState } from 'react';
import { type AiUsage, resetText, usageLevel } from '../../../shared/ai/usage.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ProviderView } from '../../../shared/ipc.ts';

/** 고른 AI 의 남은 사용량. 마지막 답에서 읽은 값이라 오래됐으면 언제 기준인지 같이 쓴다. */
/** hidden: 설치 안 된 AI 처럼 위에 더 중요한 안내가 있을 때 */
export function UsageBar({
  usage,
  spec,
  hidden,
  asked,
}: {
  usage?: AiUsage;
  spec?: ProviderView;
  hidden?: boolean;
  /** 이 대화에서 물어본 적이 있다. 사용량을 안 알려 주는 AI 의 안내는 그 뒤에만 (처음 화면부터 뜨면 쓸데없는 말이다) */
  asked?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!spec || hidden) return null;
  if (!spec.usage) {
    if (!asked) return null;
    return (
      <p className="usage empty-usage">
        {t('chat.usage.none', { label: spec.label })}
        {!spec.verified && t('chat.usage.unverified')}
      </p>
    );
  }
  if (!usage) {
    return <p className="usage empty-usage">{t('chat.usage.afterFirst', { label: spec.label })}</p>;
  }
  const ageMin = Math.round((now - usage.checkedAt) / 60_000);
  return (
    <div className="usage" title={usage.plan ? t('chat.usage.plan', { plan: usage.plan }) : undefined}>
      {usage.windows.map((w, i) => {
        const level = usageLevel(w.usedPercent);
        const last = i === usage.windows.length - 1;
        return (
          <div key={w.label} className={`meter ${level}`}>
            <span className="label">{w.label}</span>
            <span className="track" aria-hidden="true">
              <span className="fill" style={{ width: `${Math.min(100, w.usedPercent)}%` }} />
            </span>
            <span className="pct">{Math.round(w.usedPercent)}%</span>
            <span className="reset">
              {resetText(w.resetsAt, now)}
              {last && ageMin >= 2 && (
                <span className="age">
                  {' '}
                  ({ageMin < 60 ? t('chat.usage.minutesAgo', { n: ageMin }) : t('chat.usage.longAgo')})
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
