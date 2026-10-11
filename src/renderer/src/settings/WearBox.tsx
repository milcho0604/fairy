import { useEffect, useState } from 'react';
import type { GrowInfo } from '../../../shared/bond-ipc.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import type { Settings } from '../../../shared/settings.ts';
import { Section, Toggle } from './ui.tsx';

// 설정 펫 탭: 자라는 모습(지금 단계, 다음 단계까지)과 철마다 옷 켜고 끄기 (shared/wear.ts)

export function WearBox({
  snap,
  update,
}: {
  snap: SettingsSnapshot;
  update: (patch: Partial<Settings>, message?: string) => Promise<Settings>;
}) {
  const s = snap.settings;
  const [info, setInfo] = useState<GrowInfo>();
  // 펫을 바꾸거나 옷을 켜고 끄면 다시 묻는다 (사진 펫이면 안내가 바뀐다)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 바뀐 것을 계기로만 쓴다
  useEffect(() => {
    void window.jjakkungBond?.growGet().then(setInfo);
  }, [s.petImage, s.seasonWear]);
  const stage = info ? t(`bond.grow.stage.${info.stage}`) : '';
  return (
    <Section title={t('bond.grow.section')}>
      {info && (
        <div className="field">
          <span>{t('bond.grow.now', { stage, days: info.days })}</span>
          <small>
            {info.next
              ? t(info.next.stage === 'kid' ? 'bond.grow.nextKid' : 'bond.grow.nextAdult', {
                  days: info.next.days,
                  affection: info.next.affection,
                })
              : t('bond.grow.grown')}
          </small>
          {info.photo && <small>{t('bond.grow.photo')}</small>}
        </div>
      )}
      <Toggle
        label={t('bond.wear.toggle')}
        hint={t('bond.wear.hint', { today: info ? t(`bond.wear.outfit.${info.outfit}`) : '' })}
        on={s.seasonWear}
        onChange={(v) => update({ seasonWear: v })}
      />
    </Section>
  );
}
