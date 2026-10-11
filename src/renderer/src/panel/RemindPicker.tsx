// 미리 알림 고르기 (8판). 줄 끝 종 단추를 누르면 줄 아래에 펼쳐진다: 칩 여러 개를 켜고 끄고, 직접 넣고, 할 일은 마감 시각도.
// 선택 상자와 체크 상자는 쓰지 않는다 (작은 칸에서 화살표, 체크 모양이 깨져 보였다). 칩은 눌린 상태(aria-pressed)가 있는 단추다.
// 펼친 자리는 줄 아래라 목록 끝에서도 잘리지 않고, 좁은 창에서는 칩이 다음 줄로 넘어간다.
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import {
  DATE_CHOICES,
  DAY_MIN,
  dayBefore,
  MAX_REMINDS,
  MORNING_MIN,
  normalizeReminds,
  TIMED_CHOICES,
} from '../../../shared/remind.ts';
import { remindLabel, remindSummary } from '../../../shared/remind-text.ts';
import { BellIcon } from './icons.tsx';
import { isEsc } from './keys.ts';
import './remind.css';

/** 줄 끝 종 단추. 알림 수를 작게 보인다 (하나면 숫자 없이) */
export function RemindButton({
  reminds,
  dateOnly,
  allDay,
  open,
  controls,
  onToggle,
}: {
  reminds: readonly number[];
  dateOnly: boolean;
  allDay?: boolean;
  open: boolean;
  /** 펼친 칸의 id (aria-controls) */
  controls: string;
  onToggle: () => void;
}) {
  const label = t('remind.button', { list: remindSummary(reminds, dateOnly, allDay) });
  return (
    <button
      type="button"
      className={`remind-btn ${reminds.length === 0 ? 'off' : ''} ${open ? 'open' : ''}`}
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <BellIcon />
      {reminds.length > 1 && <span className="remind-count">{reminds.length}</span>}
    </button>
  );
}

type Unit = 'min' | 'hour' | 'day';
const UNIT_MIN: Record<Unit, number> = { min: 1, hour: 60, day: DAY_MIN };

/** 줄 아래 펼친 고르기 칸 */
export function RemindSheet({
  id,
  reminds,
  dateOnly,
  allDay,
  onChange,
  onClose,
  dueTime,
}: {
  id: string;
  reminds: readonly number[];
  /** 날짜 기준 (종일 일정, 마감 시각 없는 할 일) */
  dateOnly: boolean;
  allDay?: boolean;
  onChange: (next: number[]) => void;
  onClose: () => void;
  /** 할 일만: 마감 시각 고르기. due 가 없으면 알림이 울리지 않는다고 알린다 */
  dueTime?: { due: string | null; minute: number | null; onChange: (minute: number | null) => void };
}) {
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>('hour');
  const [error, setError] = useState('');
  const timeId = useId();
  const ref = useRef<HTMLFieldSetElement>(null);
  // 펼치면 목록 안에서 칸 전체가 보이게 (아래쪽 줄에서 열면 닫기 단추가 가려졌다)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  // 펼쳐 있으면 Esc 는 (커서가 종 단추나 다른 곳에 있어도) 이 칸부터 닫는다. 패널 닫기는 그다음 Esc
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isEsc(e) || e.defaultPrevented) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const base = dateOnly ? DATE_CHOICES : TIMED_CHOICES;
  // 고르기 칸에 없는 값(직접 넣은 것, 빠른 입력으로 넣은 것)도 칩으로 보인다. 이른 것부터
  const choices = [...new Set([...base, ...reminds])].sort((a, b) => b - a);

  const toggle = (b: number) => {
    setError('');
    if (reminds.includes(b)) return onChange(reminds.filter((x) => x !== b));
    if (reminds.length >= MAX_REMINDS) return setError(t('remind.max', { n: MAX_REMINDS }));
    onChange(normalizeReminds([...reminds, b], dateOnly));
  };

  const addCustom = () => {
    const n = Number(amount.trim());
    const before =
      !Number.isInteger(n) || n < 1 ? Number.NaN : dateOnly ? dayBefore(n, MORNING_MIN) : n * UNIT_MIN[unit];
    const ok = normalizeReminds([before], dateOnly);
    if (ok.length === 0 || (dateOnly && n > 30)) return setError(t('remind.bad'));
    if (reminds.includes(before)) {
      setAmount('');
      return setError('');
    }
    if (reminds.length >= MAX_REMINDS) return setError(t('remind.max', { n: MAX_REMINDS }));
    setAmount('');
    setError('');
    onChange(normalizeReminds([...reminds, before], dateOnly));
  };

  const hint = allDay ? t('remind.allDayHint') : dueTime && dateOnly ? t('remind.dateHint') : '';

  return (
    <fieldset ref={ref} id={id} className="remind-sheet" aria-label={t('remind.title')}>
      {dueTime && !dueTime.due && <p className="rs-hint">{t('remind.needDue')}</p>}
      {dueTime?.due && (
        <div className="rs-time">
          <label htmlFor={timeId}>{t('remind.dueTime')}</label>
          <input
            id={timeId}
            type="time"
            value={
              dueTime.minute === null
                ? ''
                : `${String(Math.floor(dueTime.minute / 60)).padStart(2, '0')}:${String(dueTime.minute % 60).padStart(2, '0')}`
            }
            onChange={(e) => {
              const m = /^(\d{2}):(\d{2})/.exec(e.target.value);
              dueTime.onChange(m ? Number(m[1]) * 60 + Number(m[2]) : null);
            }}
          />
          {dueTime.minute !== null && (
            <button type="button" className="rs-link" onClick={() => dueTime.onChange(null)}>
              {t('remind.clearTime')}
            </button>
          )}
        </div>
      )}
      <div className="rs-chips">
        {choices.map((b) => {
          const on = reminds.includes(b);
          return (
            <button
              key={b}
              type="button"
              className={`rs-chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              onClick={() => toggle(b)}
            >
              {remindLabel(b, dateOnly)}
            </button>
          );
        })}
      </div>
      <div className="rs-custom">
        <span className="rs-label">{t('remind.custom')}</span>
        <input
          className="rs-amount"
          inputMode="numeric"
          maxLength={3}
          value={amount}
          aria-label={t('remind.amount')}
          placeholder="1"
          onChange={(e) => {
            setAmount(e.target.value.replace(/\D/g, ''));
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) addCustom();
          }}
        />
        {dateOnly ? (
          <span className="rs-unit-text">{t('remind.dayHint')}</span>
        ) : (
          <fieldset className="rs-units" aria-label={t('remind.unit')}>
            {(['min', 'hour', 'day'] as const).map((u) => (
              <button
                key={u}
                type="button"
                className={`rs-unit ${unit === u ? 'on' : ''}`}
                aria-pressed={unit === u}
                onClick={() => setUnit(u)}
              >
                {t(`remind.unit.${u}`)}
              </button>
            ))}
          </fieldset>
        )}
        <button type="button" className="rs-add" disabled={!amount} onClick={addCustom}>
          {t('remind.add')}
        </button>
      </div>
      {error && (
        <p className="rs-hint error" role="alert">
          {error}
        </p>
      )}
      <div className="rs-foot">
        <span className="rs-hint">{hint}</span>
        <button type="button" className="rs-close" onClick={onClose}>
          {t('remind.close')}
        </button>
      </div>
    </fieldset>
  );
}
