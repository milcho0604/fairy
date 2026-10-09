import { useEffect, useState } from 'react';
import { t } from '../../shared/i18n/index.ts';
import { DEFAULT_MEET, type MeetTime, overnight, type Routine } from '../../shared/routine.ts';
import './routine-picker.css';

/** 분 → "09:00" (시각 칸 값) */
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "09:00" → 분. 비었거나(지우는 중) 모양이 틀리면 undefined */
function minuteOf(value: string): number | undefined {
  const [h, m] = value.split(':').map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? (h ?? 0) * 60 + (m ?? 0) : undefined;
}

/** 고른 요일이 모두 같은 시간이면 그 시간 */
function sharedTime(week: Routine['week']): MeetTime | undefined {
  const on = week.filter((m): m is MeetTime => m !== null);
  const first = on[0];
  return first && on.every((m) => m.start === first.start && m.end === first.end) ? first : undefined;
}

interface Props {
  routine: Routine;
  onChange: (next: Routine) => void;
  /** 저장할 수 없는 값 (시작과 끝이 같음) */
  onError: (message: string) => void;
}

/**
 * 만나는 요일과 시간 고르기 (설정과 첫 실행 안내가 같이 쓴다). 요일 단추 일곱 개, 시간은 "같은 시간"이면 한 줄,
 * "요일마다"면 고른 요일마다 한 줄. 시각 칸은 운영체제 시각 칸(theme.css 가 아이콘과 강조색을 맞춘다)
 */
export function RoutinePicker({ routine, onChange, onError }: Props) {
  const shared = sharedTime(routine.week);
  const [each, setEach] = useState(() => shared === undefined && routine.week.some((m) => m !== null));
  // 요일을 껐다 다시 켜면 그 요일에 쓰던 시간으로 (창을 닫으면 잊는다)
  const [kept, setKept] = useState<Record<number, MeetTime>>({});
  // 다른 창(설정과 첫 안내)에서 요일마다 다른 시간이 되면 요일마다 보기로 (같은 시간 한 줄로는 다 못 보인다)
  const mixed = shared === undefined && routine.week.some((m) => m !== null);
  useEffect(() => {
    if (mixed) setEach(true);
  }, [mixed]);
  const names = t('settings.weekdays').split(',');
  const chosen = routine.week.flatMap((m, i) => (m ? [i] : []));
  /** 새로 켠 요일에 줄 시간: 쓰던 시간, 아니면 고른 요일의 같은 시간, 아니면 9시~18시 */
  const fallback = shared ?? routine.week.find((m) => m !== null) ?? DEFAULT_MEET;

  const setDay = (i: number, m: MeetTime | null) => {
    if (m && m.start === m.end) {
      onError(t('routine.set.sameTime'));
      return;
    }
    const week = [...routine.week];
    week[i] = m;
    onChange({ ...routine, week });
  };

  const toggleDay = (i: number) => {
    const cur = routine.week[i];
    if (cur) {
      setKept((k) => ({ ...k, [i]: cur }));
      setDay(i, null);
    } else setDay(i, (each ? kept[i] : undefined) ?? fallback);
  };

  /** 같은 시간: 고른 요일 모두에 */
  const setAll = (patch: Partial<MeetTime>) => {
    const next = { ...fallback, ...patch };
    if (next.start === next.end) {
      onError(t('routine.set.sameTime'));
      return;
    }
    onChange({ ...routine, week: routine.week.map((m) => (m ? next : null)) });
  };

  /** 시간 한 줄. 요일마다 보기에서는 칸 이름을 첫 줄에만 단다 (다음 날 헤어지는 줄은 늘 알린다) */
  const timeRow = (m: MeetTime, set: (patch: Partial<MeetTime>) => void, label?: string, named = true) => (
    <div className={`rp-times${named || overnight(m) ? ' named' : ''}`}>
      {label && <span className="rp-day">{label}</span>}
      <label className="rp-time">
        {named ? <small>{t('routine.set.start')}</small> : overnight(m) && <small>&nbsp;</small>}
        <input
          type="time"
          value={hhmm(m.start)}
          onChange={(e) => {
            const v = minuteOf(e.target.value);
            if (v !== undefined) set({ start: v });
          }}
        />
      </label>
      <span className="rp-dash" aria-hidden="true">
        ~
      </span>
      <label className="rp-time">
        {(named || overnight(m)) && (
          <small>{overnight(m) ? t('routine.set.overnight') : t('routine.set.end')}</small>
        )}
        <input
          type="time"
          className={overnight(m) ? 'next-day' : ''}
          value={hhmm(m.end)}
          onChange={(e) => {
            const v = minuteOf(e.target.value);
            if (v !== undefined) set({ end: v });
          }}
        />
      </label>
    </div>
  );

  return (
    <div className="rp">
      <div className="rp-block">
        <span className="rp-label">{t('routine.set.days')}</span>
        <fieldset className="rp-week" aria-label={t('routine.set.daysAria')}>
          {names.map((d, i) => {
            const on = routine.week[i] !== null;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                className={on ? 'on' : ''}
                onClick={() => toggleDay(i)}
              >
                {d}
              </button>
            );
          })}
        </fieldset>
      </div>

      {chosen.length > 0 && (
        <div className="rp-block">
          <fieldset className="rp-mode" aria-label={t('routine.set.timesAria')}>
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={each === v}
                className={each === v ? 'on' : ''}
                onClick={() => {
                  setEach(v);
                  // 같은 시간으로 돌아오면 첫 요일 시간으로 맞춘다
                  if (!v && !shared) setAll({});
                }}
              >
                {v ? t('routine.set.each') : t('routine.set.same')}
              </button>
            ))}
          </fieldset>
          {each ? (
            <div className="rp-list">
              {chosen.map((i) => {
                const m = routine.week[i] as MeetTime;
                return (
                  <div key={i}>
                    {timeRow(m, (patch) => setDay(i, { ...m, ...patch }), names[i], i === chosen[0])}
                  </div>
                );
              })}
            </div>
          ) : (
            timeRow(fallback, setAll)
          )}
        </div>
      )}
      <small className="rp-note">
        {chosen.length === 0 ? t('routine.set.noDays') : t('routine.set.restNote')}
      </small>
    </div>
  );
}
