// 구글 캘린더 (6단계 보내기, 이슈 #54 가져오기): 설정 창 칸. 연결, 끊기, 보내기와 가져오기 켜고 끄기, AI 가 구글 일정 보기, 캘린더.
// 창은 상태(GcalStatus)만 받는다. 토큰과 네트워크는 메인(main/gcal.ts)에만 있다.
import { useEffect, useState } from 'react';
import { cleanCalendarId, GCAL_PRIMARY, type GcalBridge, type GcalStatus } from '../../../shared/gcal.ts';
import { locale, t } from '../../../shared/i18n/index.ts';

declare global {
  interface Window {
    jjakkungGcal: GcalBridge;
  }
}

const gcal = () => window.jjakkungGcal;

export function GoogleCalendarBox({ onMsg }: { onMsg: (m: string) => void }) {
  const [s, setS] = useState<GcalStatus | null>(null);
  const [cal, setCal] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void gcal()
      .status()
      .then((v) => {
        if (!live || !v) return;
        setS(v);
        setCal(v.calendarId === GCAL_PRIMARY ? '' : v.calendarId);
      });
    const off = gcal().onChanged((v) => {
      if (live) setS(v);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  // 구글 클라이언트 없이 만든 판에서는 칸을 통째로 숨긴다 (사용자가 할 수 있는 게 없고, 개발자 안내만 보였다)
  if (!s?.configured) return null;

  const run = async (f: () => Promise<GcalStatus>, done?: (v: GcalStatus) => string | undefined) => {
    setBusy(true);
    try {
      const v = await f();
      if (v) {
        setS(v);
        const m = done?.(v);
        if (m) onMsg(m);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveCalendar = () => {
    const shown = s.calendarId === GCAL_PRIMARY ? '' : s.calendarId;
    if (cal.trim() === shown) return;
    if (!cleanCalendarId(cal)) {
      onMsg(t('gcal.calendarBad'));
      return;
    }
    void run(() => gcal().setCalendar(cal.trim()));
  };

  const stateLine = !s.push
    ? undefined
    : s.pending > 0
      ? t('gcal.state.pending', { n: s.pending })
      : s.lastSyncAt
        ? t('gcal.state.synced', {
            when: new Date(s.lastSyncAt).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }),
          })
        : t('gcal.state.idle');
  const when = (ms: number) =>
    new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
  const pullLine = !s.pull
    ? undefined
    : s.lastPullAt
      ? t('gcal.state.pulled', { n: s.pulled, when: when(s.lastPullAt) })
      : t('gcal.state.pullIdle');
  // 연결 전에는 연결하면 둘 다 켜지니 가져오기 안내를 보인다
  const twoWay = !s.connected || s.pull;

  return (
    <section>
      <h2>{t('gcal.title')}</h2>
      <div className="card">
        <small>{t('gcal.intro')}</small>
        <small className="gcal-one-way">{t(twoWay ? 'gcal.twoWay' : 'gcal.oneWay')}</small>
        {!s.connected ? (
          <>
            <div className="action-row">
              <button
                type="button"
                className="ghost"
                disabled={s.connecting || busy}
                onClick={() =>
                  void run(
                    () => gcal().connect(),
                    (v) => (v.connected ? t('gcal.connected') : undefined),
                  )
                }
              >
                {t('gcal.connect')}
              </button>
              {s.connecting && (
                <button type="button" className="link" onClick={() => gcal().cancel()}>
                  {t('gcal.cancel')}
                </button>
              )}
            </div>
            {s.connecting && <small>{t('gcal.connecting')}</small>}
            {s.problem && <small className="warn">{t(`gcal.problem.${s.problem}`)}</small>}
            <small>{t('gcal.privacy')}</small>
          </>
        ) : (
          <>
            <div className="toggle">
              <div className="text">
                <span>{t('gcal.push')}</span>
                {stateLine && <small className="toggle-note">{stateLine}</small>}
                <small>{t('gcal.pushHint')}</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.push}
                aria-label={t('gcal.push')}
                className={s.push ? 'on' : ''}
                disabled={busy}
                onClick={() => void run(() => gcal().setPush(!s.push))}
              >
                <i />
              </button>
            </div>
            <div className="toggle">
              <div className="text">
                <span>{t('gcal.pull')}</span>
                {pullLine && <small className="toggle-note">{pullLine}</small>}
                <small>{t('gcal.pullHint')}</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.pull}
                aria-label={t('gcal.pull')}
                className={s.pull ? 'on' : ''}
                disabled={busy}
                onClick={() => void run(() => gcal().setPull(!s.pull))}
              >
                <i />
              </button>
            </div>
            {s.pull && (
              <div className="toggle">
                <div className="text">
                  <span>{t('gcal.ai')}</span>
                  <small>{t('gcal.aiHint')}</small>
                  {s.ai && <small className="toggle-note">{t('gcal.aiOnNote')}</small>}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.ai}
                  aria-label={t('gcal.ai')}
                  className={s.ai ? 'on' : ''}
                  disabled={busy}
                  onClick={() => void run(() => gcal().setAi(!s.ai))}
                >
                  <i />
                </button>
              </div>
            )}
            <label className="field">
              <span>{t('gcal.calendar')}</span>
              <input
                type="text"
                value={cal}
                placeholder={GCAL_PRIMARY}
                spellCheck={false}
                autoComplete="off"
                maxLength={254}
                onChange={(e) => setCal(e.target.value)}
                onBlur={saveCalendar}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCalendar();
                }}
              />
              <small>{t('gcal.calendarHint')}</small>
            </label>
            {s.problem && <small className="warn">{t(`gcal.problem.${s.problem}`)}</small>}
            <div className="action-row">
              <button
                type="button"
                className="ghost"
                disabled={!(s.push || s.pull) || busy}
                onClick={() => void run(() => gcal().syncNow())}
              >
                {t(s.push && s.pull ? 'gcal.syncBoth' : s.pull ? 'gcal.pullNow' : 'gcal.syncNow')}
              </button>
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => gcal().disconnect(),
                    () => t('gcal.disconnected'),
                  )
                }
              >
                {t('gcal.disconnect')}
              </button>
            </div>
            <small>{t('gcal.privacy')}</small>
          </>
        )}
      </div>
    </section>
  );
}
