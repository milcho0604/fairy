import { useEffect, useState } from 'react';
import { type AiUsage, resetText, usageLevel } from '../../../shared/ai/usage.ts';
import type { ProviderView } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';

/** 고른 AI 의 남은 사용량. 마지막 답에서 읽은 값이라 오래됐으면 언제 기준인지 같이 쓴다. */
export function UsageBar({ usage, spec }: { usage?: AiUsage; spec?: ProviderView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!spec) return null;
  if (!spec.usage) {
    return (
      <p className="usage empty-usage">
        {withParticle(spec.label, '은')} 사용량을 알려 주지 않아.
        {!spec.verified && ' 아직 실제로 써 보지 않은 연결이라 안 되면 알려 줘.'}
      </p>
    );
  }
  if (!usage) {
    return <p className="usage empty-usage">{spec.label} 사용량은 첫 답을 받으면 보여 줄게.</p>;
  }
  const ageMin = Math.round((now - usage.checkedAt) / 60_000);
  return (
    <div className="usage" title={usage.plan ? `요금제 ${usage.plan}` : undefined}>
      {usage.windows.map((w) => {
        const level = usageLevel(w.usedPercent);
        return (
          <div key={w.label} className={`meter ${level}`}>
            <span className="label">{w.label}</span>
            <span className="track" aria-hidden="true">
              <span className="fill" style={{ width: `${Math.min(100, w.usedPercent)}%` }} />
            </span>
            <span className="pct">{Math.round(w.usedPercent)}%</span>
            <span className="reset">{resetText(w.resetsAt, now)}</span>
          </div>
        );
      })}
      {ageMin >= 2 && <span className="age">{ageMin < 60 ? `${ageMin}분 전 기준` : '한참 전 기준'}</span>}
    </div>
  );
}
