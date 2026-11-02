// 설정 > 일반: 알림과 소리. 시스템 알림, 말 안 하는 시간, 효과음 (페어리가 안 보일 때와 쉬는 시간)
import { t } from '../../../shared/i18n/index.ts';
import { Section, type TabProps, Toggle } from './ui.tsx';

const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minuteOf = (value: string): number | undefined => {
  const [h, m] = value.split(':').map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? (h ?? 0) * 60 + (m ?? 0) : undefined;
};

export function NotifyBox({ snap, update }: Pick<TabProps, 'snap' | 'update'>) {
  const s = snap.settings;
  return (
    <Section title={t('settings.notify')}>
      <Toggle
        label={t('settings.osNotify')}
        hint={t('settings.osNotifyHint')}
        on={s.osNotify}
        onChange={(v) => update({ osNotify: v })}
      />
      <Toggle
        label={t('settings.dueSoonAlert')}
        hint={t('settings.dueSoonAlertHint')}
        on={s.dueSoonAlert}
        onChange={(v) => update({ dueSoonAlert: v })}
      />
      <Toggle
        label={t('settings.quietOn')}
        hint={t('settings.quietHint')}
        on={s.quietHours.on}
        onChange={(v) => update({ quietHours: { ...s.quietHours, on: v } })}
      />
      {s.quietHours.on && (
        <div className="quiet-times">
          <label className="field">
            <span>{t('settings.quietFrom')}</span>
            <input
              type="time"
              value={clock(s.quietHours.from)}
              onChange={(e) => {
                const m = minuteOf(e.target.value);
                if (m !== undefined) update({ quietHours: { ...s.quietHours, from: m } });
              }}
            />
          </label>
          <label className="field">
            <span>{t('settings.quietTo')}</span>
            <input
              type="time"
              value={clock(s.quietHours.to)}
              onChange={(e) => {
                const m = minuteOf(e.target.value);
                if (m !== undefined) update({ quietHours: { ...s.quietHours, to: m } });
              }}
            />
          </label>
        </div>
      )}
      <Toggle
        label={t('settings.quietWeekend')}
        hint={t('settings.quietWeekendHint')}
        on={s.quietHours.weekend}
        onChange={(v) => update({ quietHours: { ...s.quietHours, weekend: v } })}
      />
      <Toggle
        label={t('settings.sounds')}
        hint={t('settings.soundsHint')}
        on={s.sounds}
        onChange={(v) => update({ sounds: v })}
      />
    </Section>
  );
}
