import { useState } from 'react';
import { t } from '../../../../shared/i18n/index.ts';
import type { UpdateStatus } from '../../../../shared/ipc.ts';
import { HelpBox } from '../HelpBox.tsx';
import { Stats } from '../Stats.tsx';
import { bridge, isMac, Section, type TabProps, Toggle } from '../ui.tsx';

/** 정보 탭: 업데이트, 내 기록(베타), 도움 보내기, 판 */
export function AboutTab({ snap, update, flash, searching }: TabProps & { searching: boolean }) {
  const s = snap.settings;
  // 확인 결과는 단추 옆에 남긴다. 위 저장 알림(초록)으로 띄우면 "확인할 수 없어" 도 잘된 것처럼 보였다
  const [status, setStatus] = useState<UpdateStatus>();
  const [checking, setChecking] = useState(false);
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
          <button
            type="button"
            className="ghost"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                setStatus(await bridge.checkUpdate());
              } catch {
                setStatus({ text: t('main.update.offline'), tone: 'error' });
              } finally {
                setChecking(false);
              }
            }}
          >
            {t('settings.checkNow')}
          </button>
          {status?.text && (
            <span className={`update-status ${status.tone}`} role="status">
              {status.text}
            </span>
          )}
        </div>
      </Section>
      <Stats onCopied={(ok) => flash(ok ? t('settings.statsCopied') : t('settings.copyFailed'), !ok)} />
      {/* 도움 보내기 (이슈 #126): 진단 묶음을 가려서 미리 보여 주고, 복사나 저장은 사용자가 직접 */}
      <Section title={t('help.title')}>
        <HelpBox shortcut={isMac(snap) ? '⌘⇧H' : 'Ctrl+Shift+H'} />
      </Section>
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
