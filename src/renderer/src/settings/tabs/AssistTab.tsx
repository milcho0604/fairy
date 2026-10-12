import { useState } from 'react';
import { type ChatterLevel, LEVEL_LABEL, MAX_PER_HOUR } from '../../../../shared/chatter.ts';
import { t } from '../../../../shared/i18n/index.ts';
import { RoutinePicker } from '../../RoutinePicker.tsx';
import { GoogleCalendarBox } from '../GoogleCalendarBox.tsx';
import { icsInput } from '../ics-input.ts';
import { Section, type TabProps, Toggle } from '../ui.tsx';

const chatterHint = (level: ChatterLevel): string =>
  level === 'quiet'
    ? t('settings.chatterHint.quiet')
    : level === 'normal'
      ? t('settings.chatterHint.normal', { n: MAX_PER_HOUR.normal })
      : t('settings.chatterHint.chatty', { n: MAX_PER_HOUR.chatty });

/** 비서 탭: 말풍선과 알림, 만나는 시간, 하루 회고, 캘린더 */
export function AssistTab({ snap, update, flash }: TabProps) {
  const s = snap.settings;
  return (
    <>
      <Section title={t('settings.bubbles')}>
        <fieldset className="segmented" aria-label={t('settings.bubblesAria')}>
          {(['quiet', 'normal', 'chatty'] as const).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={s.chatter === level}
              className={s.chatter === level ? 'on' : ''}
              onClick={() => update({ chatter: level })}
            >
              {LEVEL_LABEL[level]}
            </button>
          ))}
        </fieldset>
        <small className="below">{chatterHint(s.chatter)}</small>
        <Toggle
          label={t('settings.osNotify')}
          hint={t('settings.osNotifyHint')}
          on={s.osNotify}
          onChange={(v) => update({ osNotify: v })}
        />
      </Section>
      <Section title={t('routine.set.title')}>
        <Toggle
          label={t('routine.set.on', { name: s.petName })}
          hint={t('routine.set.onHint')}
          on={s.routine.on}
          onChange={(v) => update({ routine: { ...s.routine, on: v } })}
        />
        {s.routine.on && (
          <>
            <RoutinePicker
              routine={s.routine}
              onChange={(routine) => update({ routine })}
              onError={(m) => flash(m, true)}
            />
            {s.review && <small>{t('routine.set.reviewNote')}</small>}
          </>
        )}
      </Section>

      <Section title={t('settings.review')}>
        <Toggle
          label={t('settings.reviewOn')}
          hint={t('settings.reviewOnHint')}
          on={s.review}
          onChange={(v) => update({ review: v })}
        />
        <label className="field">
          <span>{t('settings.reviewTime')}</span>
          <input
            type="time"
            disabled={!s.review}
            value={`${String(Math.floor(s.reviewMinute / 60)).padStart(2, '0')}:${String(s.reviewMinute % 60).padStart(2, '0')}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (Number.isInteger(h) && Number.isInteger(m))
                update({ reviewMinute: (h ?? 0) * 60 + (m ?? 0) });
            }}
          />
          <small>{t('settings.reviewHint')}</small>
        </label>
      </Section>

      <Section title={t('settings.calendar')}>
        <CalendarSetup
          url={s.icsUrl ?? ''}
          last={snap.calendarLast}
          onSave={(v) => update({ icsUrl: v || null } as never)}
          onMsg={flash}
        />
      </Section>
      <GoogleCalendarBox onMsg={flash} />
    </>
  );
}

/** 캘린더 주소 넣기 (v2): 구글 캘린더 설정 > 내 캘린더 > 캘린더 통합 > iCal 형식의 비공개 주소 */
function CalendarSetup({
  url,
  last,
  onSave,
  onMsg,
}: {
  url: string;
  last: string;
  onSave: (v: string) => Promise<unknown>;
  onMsg: (m: string, error?: boolean) => void;
}) {
  const [value, setValue] = useState(url);
  const [result, setResult] = useState(last);
  /**
   * 칸의 글을 저장한다. https 가 아니면 저장하지 않고 빨간 글씨로 알린다 (설정 검사가 조용히 버려 "저장했어"만 떴다).
   * webcal 은 https 로 바꿔 저장하고 칸에도 그 주소를 보인다. 저장할 수 있었으면 true
   */
  const commit = async (): Promise<boolean> => {
    const r = icsInput(value, url || undefined);
    if (r.kind === 'bad') {
      onMsg(t('settings.cal.bad'), true);
      return false;
    }
    if (r.kind === 'clear') await onSave('');
    if (r.kind === 'save') {
      setValue(r.url);
      await onSave(r.url);
    }
    return true;
  };
  return (
    <>
      <label className="field">
        <span>{t('settings.cal.url')}</span>
        <input
          type="url"
          value={value}
          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
        />
        <small>{t('settings.cal.hint')}</small>
      </label>
      <div className="action-row">
        <button
          type="button"
          className="ghost"
          disabled={!value.trim()}
          onClick={async () => {
            // 틀린 주소면 가져오지 않는다 (예전에는 칸과 다른 옛 주소로 가져왔다)
            if (!(await commit())) return;
            const r = await window.jjakkungSettings.syncCalendar();
            setResult(r);
            onMsg(r);
          }}
        >
          {t('settings.cal.fetch')}
        </button>
        {url && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setValue('');
              void onSave('');
            }}
          >
            {t('settings.cal.clear')}
          </button>
        )}
      </div>
      {result && <small>{result}</small>}
    </>
  );
}
