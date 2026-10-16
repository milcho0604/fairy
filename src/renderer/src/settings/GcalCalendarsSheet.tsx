// 구글 캘린더 옵션 창 (설정 창 안 시트): 캘린더마다 "가져오기" 체크, 페어리 일정을 보낼 캘린더 하나(라디오)와 "보내지 않기".
// 연결 직후 자동으로 열리고, 설정 구글 칸의 "캘린더 고르기"로도 연다. 고르면 바로 저장한다 (설정 창의 다른 칸과 같다).
// 예전 연결(캘린더 목록 권한 없음)이면 목록 대신 다시 연결 안내와, 지금처럼 기본 캘린더와 직접 넣은 캘린더 ID 줄만 보인다.
import { useEffect, useId, useRef, useState } from 'react';
import { cleanCalendarId, type GcalStatus } from '../../../shared/gcal.ts';
import { type CalRow, calendarRows, listState } from '../../../shared/gcal-cals.ts';
import { t } from '../../../shared/i18n/index.ts';
import { isEsc, takeEsc } from '../panel/keys.ts';

const gcal = () => window.jjakkungGcal;

/** 줄에 보일 이름. 목록을 못 읽은 기본 캘린더는 id(primary) 대신 "기본 캘린더" */
export const rowName = (r: Pick<CalRow, 'name' | 'kind' | 'primary'>): string =>
  r.primary && !r.kind ? t('gcal.sheet.kind.primary') : r.name;

export function GcalCalendarsSheet({
  s,
  onStatus,
  onClose,
  onReconnect,
  onMsg,
}: {
  s: GcalStatus;
  onStatus: (v: GcalStatus) => void;
  onClose: () => void;
  onReconnect: () => void;
  onMsg: (m: string) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');

  // 열 때 목록을 새로 읽는다 (이름, 색, 새 캘린더). 포커스는 시트 안으로, Esc 로 닫기
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열 때 한 번
  useEffect(() => {
    sheetRef.current?.focus();
    void gcal()
      .listCalendars()
      .then((v) => v && onStatus(v));
  }, []);
  useEffect(() => {
    // 창 전체 Esc(설정 창 닫기)보다 먼저 받아 시트만 닫는다
    const onKey = (e: KeyboardEvent) => {
      if (!isEsc(e)) return;
      takeEsc(e);
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const state = listState({ connected: s.connected, listScope: s.listScope, calendars: s.calendars });
  const rows = calendarRows({ calendars: s.calendars, pull: s.pullCals, push: s.push ? s.calendarId : null });

  const save = async (pull: string[], push: string | null) => {
    setBusy(true);
    try {
      const v = await gcal().setCalendars({ pull, push });
      if (v) onStatus(v);
    } finally {
      setBusy(false);
    }
  };
  const push = s.push ? s.calendarId : null;
  const togglePull = (r: CalRow) =>
    void save(r.pull ? s.pullCals.filter((id) => id !== r.id) : [...s.pullCals, r.id], push);
  const addCustom = () => {
    const id = cleanCalendarId(custom);
    if (!custom.trim() || !id) {
      onMsg(t('gcal.calendarBad'));
      return;
    }
    setCustom('');
    if (!s.pullCals.includes(id)) void save([...s.pullCals, id], push);
  };

  return (
    // 바탕을 누르면 닫는다 (키보드는 Esc, 닫기 단추)
    // biome-ignore lint/a11y/noStaticElementInteractions: 바탕 누르기는 보조 수단
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc 와 닫기 단추가 있다
    <div
      className="gcal-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="gcal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="gcal-sheet-head">
          <strong id={titleId}>{t('gcal.sheet.title')}</strong>
          <button type="button" className="link" onClick={onClose}>
            {t('gcal.sheet.done')}
          </button>
        </div>
        <div className="gcal-sheet-body">
          <small>{t('gcal.sheet.intro')}</small>
          {state === 'relink' && (
            <div className="gcal-relink" role="note">
              <strong>{t('gcal.sheet.relinkTitle')}</strong>
              <small>{t('gcal.sheet.relink')}</small>
              <div className="action-row">
                <button type="button" className="primary" disabled={s.connecting} onClick={onReconnect}>
                  {t('gcal.sheet.relinkBtn')}
                </button>
              </div>
            </div>
          )}
          {state === 'loading' &&
            (s.listing ? (
              <small className="gcal-loading" role="status">
                {t('gcal.sheet.loading')}
              </small>
            ) : (
              <div className="gcal-relink">
                <small className="warn">{t('gcal.sheet.listFailed')}</small>
                <div className="action-row">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      void gcal()
                        .listCalendars()
                        .then((v) => v && onStatus(v))
                    }
                  >
                    {t('gcal.sheet.retry')}
                  </button>
                </div>
              </div>
            ))}
          <fieldset className="gcal-cals">
            <legend className="sr-only">{t('gcal.sheet.title')}</legend>
            <div className="gcal-cal-row gcal-cal-head" aria-hidden="true">
              <span>{t('gcal.sheet.colCal')}</span>
              <span>{t('gcal.sheet.colPull')}</span>
              <span>{t('gcal.sheet.colPush')}</span>
            </div>
            {rows.map((r) => {
              const listed = s.calendars?.find((c) => c.id === r.id);
              const failed = s.pullFailed.includes(r.id) && r.pull;
              return (
                <div key={r.id} className="gcal-cal-row">
                  <span className="gcal-cal-name">
                    <i
                      className="gcal-dot"
                      style={r.color ? { background: r.color } : undefined}
                      aria-hidden="true"
                    />
                    <span className="gcal-cal-text">
                      <span className="name" title={r.id} dir="auto">
                        {rowName(r)}
                      </span>
                      <small>
                        {/* 목록을 못 읽은 기본 캘린더는 이름이 곧 "기본 캘린더"라 한 번만 */}
                        {r.primary
                          ? r.kind
                            ? t('gcal.sheet.kind.primary')
                            : ''
                          : r.kind
                            ? t(`gcal.sheet.kind.${r.kind}`)
                            : t('gcal.sheet.custom')}
                        {listed?.hidden ? `, ${t('gcal.sheet.hidden')}` : ''}
                        {failed && <span className="warn">, {t('gcal.sheet.failed')}</span>}
                      </small>
                    </span>
                  </span>
                  <span className="gcal-cell">
                    <input
                      className="gcal-check"
                      type="checkbox"
                      checked={r.pull}
                      disabled={busy}
                      aria-label={t('gcal.sheet.pullOf', { name: r.name })}
                      onChange={() => togglePull(r)}
                    />
                  </span>
                  <span className="gcal-cell" title={r.canPush ? undefined : t('gcal.sheet.readOnlyTip')}>
                    <input
                      className="gcal-check"
                      type="radio"
                      name="gcal-push"
                      checked={r.push}
                      disabled={busy || !r.canPush}
                      aria-label={t('gcal.sheet.pushTo', { name: r.name })}
                      aria-description={r.canPush ? undefined : t('gcal.sheet.readOnlyTip')}
                      onChange={() => void save(s.pullCals, r.id)}
                    />
                  </span>
                </div>
              );
            })}
            <label className="gcal-cal-row gcal-no-push">
              <span className="gcal-cal-text">
                <span className="name">{t('gcal.sheet.noPush')}</span>
                <small>{t('gcal.sheet.noPushHint')}</small>
              </span>
              <span className="gcal-cell">
                <input
                  className="gcal-check"
                  type="radio"
                  name="gcal-push"
                  checked={!s.push}
                  disabled={busy}
                  onChange={() => void save(s.pullCals, null)}
                />
              </span>
            </label>
          </fieldset>
          <small>{t('gcal.sheet.pushMoves')}</small>
          <label className="field">
            <span>{t('gcal.sheet.addId')}</span>
            <span className="row">
              <input
                type="text"
                value={custom}
                placeholder="name@group.calendar.google.com"
                spellCheck={false}
                autoComplete="off"
                maxLength={254}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) addCustom();
                }}
              />
              <button
                type="button"
                className="ghost gcal-id-add"
                disabled={busy || !custom.trim()}
                onClick={addCustom}
              >
                {t('gcal.sheet.add')}
              </button>
            </span>
            <small>{t('gcal.calendarHint')}</small>
          </label>
        </div>
      </div>
    </div>
  );
}
