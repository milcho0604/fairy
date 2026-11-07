// 할 일도 구글 캘린더에 올리기 (docs/gcal-todo-plan.md 2절, 9절): 설정 창 안 시트 둘.
// - GcalTodoSheet: 켤 때 올릴 곳 고르기 (페어리 할 일 캘린더 새로 만들기 / 기존 캘린더)
// - GcalConfirmSheet: 되돌릴 수 없는 일 앞의 확인 (OS 창이 아니라 앱 안 시트)
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { GcalStatus } from '../../../shared/gcal.ts';
import {
  chooseOutcome,
  grantKey,
  mixesWithEvents,
  pickable,
  suggestsPick,
} from '../../../shared/gcal-todo-view.ts';
import { t } from '../../../shared/i18n/index.ts';
import { useReturnFocus } from '../focus-return.ts';
import { isEsc, takeEsc } from '../panel/keys.ts';
import { rowName } from './GcalCalendarsSheet.tsx';

const gcal = () => window.jjakkungGcal;

/** 시트 바깥틀: 바탕, Esc, 포커스. 창 전체 Esc(설정 창 닫기)보다 먼저 받아 시트만 닫는다 */
function SheetFrame({
  title,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}) {
  useReturnFocus(true);
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isEsc(e)) return;
      takeEsc(e);
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
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
          <strong id={titleId}>{title}</strong>
          <button type="button" className="link" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <div className="gcal-sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function GcalTodoSheet({
  s,
  onStatus,
  onClose,
  onReconnect,
}: {
  s: GcalStatus;
  onStatus: (v: GcalStatus) => void;
  onClose: () => void;
  onReconnect: () => void;
}) {
  const list = pickable(s.calendars);
  const saved = s.todos?.target === 'pick' ? s.todos.calendarId : null;
  const [choice, setChoice] = useState<'fairy' | 'pick'>(
    saved && list.some((c) => c.id === saved) ? 'pick' : 'fairy',
  );
  const [pickId, setPickId] = useState<string>(saved ?? '');
  const [busy, setBusy] = useState(false);
  // 시도한 뒤에만 막힌 까닭을 보인다 (지난번 까닭이 열자마자 보이지 않게)
  const [tried, setTried] = useState(false);

  // 열 때 캘린더 목록을 새로 읽는다 (기존 캘린더 고르기에 쓴다)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열 때 한 번
  useEffect(() => {
    void gcal()
      .listCalendars()
      .then((v) => v && onStatus(v));
  }, []);

  const chosen = list.some((c) => c.id === pickId) ? pickId : (list.find((c) => c.primary) ?? list[0])?.id;
  const grant = tried ? (s.todos?.grant ?? null) : null;
  const waiting = busy && s.connecting;
  const cancelled = useRef(false);
  // 하는 중에 닫으면 허락 기다림도 그만두고, 끝난 뒤에도 켜지 않는다
  const close = () => {
    cancelled.current = true;
    if (busy) gcal().cancel();
    onClose();
  };

  const go = async () => {
    if (busy) return;
    if (choice === 'pick' && !chosen) return;
    cancelled.current = false;
    setBusy(true);
    setTried(true);
    try {
      const v = await gcal().chooseTodoTarget(
        choice === 'fairy' ? { target: 'fairy' } : { target: 'pick', calendarId: chosen ?? '' },
      );
      if (!v) return;
      onStatus(v);
      if (cancelled.current || chooseOutcome(v, choice, chosen) !== 'ok') return;
      const on = await gcal().setTodoOn(true);
      if (on) onStatus(on);
      if (!cancelled.current) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetFrame title={t('gcal.todo.sheet.title')} onClose={close} closeLabel={t('gcal.cancel')}>
      <small>{t('gcal.todo.sheet.intro')}</small>
      <fieldset className="gcal-opts">
        <legend className="sr-only">{t('gcal.todo.sheet.title')}</legend>
        <label className={`gcal-opt${choice === 'fairy' ? ' on' : ''}`}>
          <input
            className="gcal-check"
            type="radio"
            name="gcal-todo-target"
            checked={choice === 'fairy'}
            disabled={busy}
            onChange={() => setChoice('fairy')}
          />
          <span className="gcal-cal-text">
            <span className="name">{t('gcal.todo.sheet.fairy')}</span>
            <small>{t('gcal.todo.sheet.fairyHint')}</small>
          </span>
        </label>
        <label className={`gcal-opt${choice === 'pick' ? ' on' : ''}`}>
          <input
            className="gcal-check"
            type="radio"
            name="gcal-todo-target"
            checked={choice === 'pick'}
            disabled={busy}
            onChange={() => setChoice('pick')}
          />
          <span className="gcal-cal-text">
            <span className="name">{t('gcal.todo.sheet.pick')}</span>
            <small>{t('gcal.todo.sheet.pickHint')}</small>
          </span>
        </label>
      </fieldset>
      {choice === 'pick' &&
        (list.length === 0 ? (
          <div className="gcal-relink" role="status">
            <small>
              {t(s.listScope === false ? 'gcal.todo.sheet.pickRelink' : 'gcal.todo.sheet.pickNone')}
            </small>
            {s.listScope === false && (
              <div className="action-row">
                <button type="button" className="primary" disabled={s.connecting} onClick={onReconnect}>
                  {t('gcal.sheet.relinkBtn')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <fieldset className="gcal-cals">
              <legend className="sr-only">{t('gcal.todo.sheet.pick')}</legend>
              {list.map((c) => (
                <label key={c.id} className="gcal-cal-row gcal-cal-pick">
                  <span className="gcal-cal-name">
                    <i
                      className="gcal-dot"
                      style={c.color ? { background: c.color } : undefined}
                      aria-hidden="true"
                    />
                    <span className="gcal-cal-text">
                      <span className="name" title={c.id} dir="auto">
                        {rowName({ name: c.name, kind: undefined, primary: c.primary })}
                      </span>
                    </span>
                  </span>
                  <span className="gcal-cell">
                    <input
                      className="gcal-check"
                      type="radio"
                      name="gcal-todo-cal"
                      checked={chosen === c.id}
                      disabled={busy}
                      aria-label={t('gcal.todo.sheet.pickOf', { name: c.name })}
                      onChange={() => setPickId(c.id)}
                    />
                  </span>
                </label>
              ))}
            </fieldset>
            {chosen && mixesWithEvents(chosen, s) && (
              <small className="toggle-note">{t('gcal.todo.sheet.mix')}</small>
            )}
          </>
        ))}
      {waiting && (
        <div className="gcal-relink" role="status">
          <small>{t('gcal.todo.sheet.waiting')}</small>
          <div className="action-row">
            <button type="button" className="ghost" onClick={() => gcal().cancel()}>
              {t('gcal.cancel')}
            </button>
          </div>
        </div>
      )}
      {grant && !waiting && (
        <div className="gcal-relink" role="alert">
          <small className="warn">{t(grantKey(grant))}</small>
          {suggestsPick(grant) && (
            <div className="action-row">
              <button type="button" className="ghost" onClick={() => setChoice('pick')}>
                {t('gcal.todo.sheet.usePick')}
              </button>
            </div>
          )}
        </div>
      )}
      <small>{t('gcal.todo.sheet.privacy')}</small>
      <div className="action-row">
        <button
          type="button"
          className="primary"
          disabled={busy || (choice === 'pick' && !chosen)}
          onClick={() => void go()}
        >
          {t('gcal.todo.sheet.go')}
        </button>
        <button type="button" className="link" onClick={close}>
          {t('gcal.cancel')}
        </button>
      </div>
    </SheetFrame>
  );
}

/** 확인 시트: 하는 일을 글로 말하고, 누르면 한다. 하는 동안은 단추를 잠그고, 허락을 기다리면 안내와 그만두기를 보인다 */
export function GcalConfirmSheet({
  title,
  body,
  confirm,
  waiting,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  /** 구글 허락을 기다리는 중 (연결 상태의 connecting) */
  waiting: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    setBusy(false);
    onClose();
  };
  const close = () => {
    if (busy && waiting) gcal().cancel();
    onClose();
  };
  return (
    <SheetFrame title={title} onClose={busy && !waiting ? () => {} : close} closeLabel={t('gcal.cancel')}>
      <small className="gcal-confirm-body">{body}</small>
      {busy && waiting && (
        <div className="gcal-relink" role="status">
          <small>{t('gcal.todo.sheet.waiting')}</small>
        </div>
      )}
      {failed && (
        <small className="warn" role="alert">
          {t('gcal.todo.confirmFailed')}
        </small>
      )}
      <div className="action-row">
        <button type="button" className="ghost danger" disabled={busy} onClick={() => void run()}>
          {confirm}
        </button>
        <button type="button" className="link" disabled={busy && !waiting} onClick={close}>
          {t('gcal.cancel')}
        </button>
      </div>
    </SheetFrame>
  );
}
