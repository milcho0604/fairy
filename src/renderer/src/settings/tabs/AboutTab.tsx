import { t } from '../../../../shared/i18n/index.ts';
import { Stats } from '../Stats.tsx';
import { bridge, Section, type TabProps, Toggle } from '../ui.tsx';

/** 정보 탭: 업데이트, 내 기록(베타, 의견 보내기), 판 */
export function AboutTab({ snap, update, flash, searching }: TabProps & { searching: boolean }) {
  const s = snap.settings;
  return (
    <>
      <Section title={t('settings.update')}>
        <Toggle
          label={t('settings.updateCheck')}
          hint={t('settings.updateHint')}
          on={s.updateCheck}
          onChange={(v) => update({ updateCheck: v })}
        />
        <div className="action-row">
          <button type="button" className="ghost" onClick={async () => flash(await bridge.checkUpdate())}>
            {t('settings.checkNow')}
          </button>
        </div>
      </Section>
      <Stats onCopied={(ok) => flash(ok ? t('settings.statsCopied') : t('settings.copyFailed'), !ok)} />
      <Section title={t('settings.licenses')}>
        <small>{t('settings.licensesHint')}</small>
        <div className="action-row">
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              const ok = await bridge.openNotices().catch(() => false);
              if (!ok) flash(t('settings.licensesFailed'), true);
            }}
          >
            {t('settings.licensesOpen')}
          </button>
        </div>
      </Section>
      {/* 찾는 중에는 판 글을 숨긴다 (찾기 결과가 아니다) */}
      {!searching && <p className="version">{t('settings.version', { v: snap.version })}</p>}
    </>
  );
}
