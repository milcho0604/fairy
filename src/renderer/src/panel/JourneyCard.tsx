import { useEffect, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { PanelState } from '../../../shared/ipc.ts';
import { JOURNEY_COINS, type JourneyStep, type JourneyView } from '../../../shared/journey.ts';
import { WeekCardDialog } from './WeekCard.tsx';

// 첫 7일 여정 칸 (오늘 탭, shared/journey.ts): 이레 칸, 오늘 해 볼 것 하나와 "해 보기", 그만 보기.
// 여정 밖(오래 쓴 사람, 끝남, 그만 봄)이면 아무것도 안 그린다

const bridge = window.jjakkungBond;

export function JourneyCard({ s }: { s: PanelState }) {
  const [view, setView] = useState<JourneyView>();
  const [card, setCard] = useState(false);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    void bridge.journeyGet().then(setView);
    bridge.onJourney(setView);
  }, []);
  if (!view) return null;
  const go = (step: JourneyStep) => {
    if (step === 'week') {
      setCard(true);
      bridge.journeyTried('week');
    } else bridge.journeyGo(step);
  };
  const step = view.today;
  return (
    <section className="journey" aria-labelledby="journey-title">
      <h3>
        <span id="journey-title">{t('bond.journey.title', { day: view.day })}</span>
        {!view.finishedToday && (
          <button
            type="button"
            className={`link${sure ? ' danger' : ''}`}
            onClick={() => {
              if (!sure) return setSure(true);
              bridge.journeySkip();
            }}
            onBlur={() => setSure(false)}
          >
            {sure ? t('bond.journey.skipSure') : t('bond.journey.skip')}
          </button>
        )}
      </h3>
      <ol
        className="journey-track"
        aria-label={t('bond.journey.progress', { n: view.steps.filter((x) => x.tried).length })}
      >
        {view.steps.map((x, i) => {
          const label = t(`bond.journey.step.${x.id}`);
          const state = x.tried ? 'done' : x.id === step ? 'now' : x.open ? 'open' : 'later';
          // 모양 이름에는 jd- 를 붙인다 (패널의 .done 은 끝낸 할 일 모양이다)
          return (
            <li key={x.id} className={`journey-dot jd-${state}`} title={`${i + 1}. ${label}`}>
              <span aria-hidden="true">
                {x.tried ? (
                  <svg viewBox="0 0 12 10" width="11" height="9" aria-hidden="true">
                    <path
                      d="M1.5 5.2 4.5 8 10.5 1.8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <small className="sr">{`${label}: ${t(`bond.journey.state.${state}`)}`}</small>
            </li>
          );
        })}
      </ol>
      {view.finishedToday ? (
        <p className="journey-now done">
          {t('bond.journey.allDone', { name: s.petName, coins: view.coins })}
        </p>
      ) : step ? (
        <div className="journey-now">
          <div className="journey-text">
            <strong>{t(`bond.journey.step.${step}`)}</strong>
            <small>{t(`bond.journey.hint.${step}`, { name: s.petName })}</small>
          </div>
          <button type="button" className="primary journey-go" onClick={() => go(step)}>
            {t('bond.journey.try')}
            <span className="journey-coin">+{JOURNEY_COINS}</span>
          </button>
        </div>
      ) : (
        <p className="journey-now rest">{t('bond.journey.restToday', { name: s.petName })}</p>
      )}
      {card && <WeekCardDialog s={s} onClose={() => setCard(false)} />}
    </section>
  );
}
