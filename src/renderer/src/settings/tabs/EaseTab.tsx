import { useState } from 'react';
import { SAVER_MODES } from '../../../../shared/battery.ts';
import { t } from '../../../../shared/i18n/index.ts';
import {
  acceleratorLabel,
  NO_SHORTCUT,
  SHORTCUT_DEFAULTS,
  SHORTCUT_IDS,
  SHORTCUT_LABEL,
  type ShortcutId,
  shortcutClash,
  toAccelerator,
} from '../../../../shared/shortcut.ts';
import { bridge, isMac, Section, type TabProps, Toggle } from '../ui.tsx';

/** 편의 탭: 단축키, 다른 앱에서 부르기, 배터리 절약, 접근성, 언어, 시작 */
export function EaseTab({ snap, update, flash }: TabProps) {
  const s = snap.settings;
  const mac = isMac(snap);
  const mod = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Option' : 'Alt';
  // 언어를 바꾸면 다시 켜야 보인다. 바꾼 뒤에만 다시 켜기 버튼을 보여 준다
  const [langChanged, setLangChanged] = useState(false);
  return (
    <>
      <Section title={t('settings.shortcuts')}>
        <dl className="keys">
          {SHORTCUT_IDS.map((id) => (
            <ShortcutRow
              key={id}
              id={id}
              value={s.shortcuts[id]}
              mac={mac}
              onSave={(acc) => {
                // 다른 단축키와 같으면 저장하지 않고 알린다 (설정 검사가 조용히 버려 "바꿨어"만 떴다)
                const next = { ...s.shortcuts, [id]: acc };
                const clash = shortcutClash(next);
                if (clash) {
                  const other = clash[0] === id ? clash[1] : clash[0];
                  flash(t('settings.shortcut.taken', { name: SHORTCUT_LABEL[other] }), true);
                  return;
                }
                void update(
                  { shortcuts: next },
                  acc === NO_SHORTCUT ? t('settings.shortcutOff') : t('settings.shortcutChanged'),
                );
              }}
              onError={(m) => flash(m, true)}
            />
          ))}
          <dt>{t('settings.zoomKeys')}</dt>
          <dd>
            <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd>
          </dd>
          {/* 패널 안에서만 듣는 키 (바꿀 수 없다, 알려 주기만) */}
          <dt>{t('settings.panelTabKeys')}</dt>
          <dd>
            <kbd>{mod}</kbd> <kbd>1</kbd> ~ <kbd>5</kbd>
          </dd>
          <dt>{t('settings.panelUndoKeys')}</dt>
          <dd>
            <kbd>{mod}</kbd> <kbd>Z</kbd>
          </dd>
          {/* 이 창 안에서만 듣는 키 */}
          <dt>{t('settings.tabKeys')}</dt>
          <dd>
            <kbd>{mod}</kbd> <kbd>[</kbd> / <kbd>]</kbd>, <kbd>{mod}</kbd> <kbd>1</kbd> ~ <kbd>6</kbd>
          </dd>
        </dl>
      </Section>
      <Section title={t('settings.panelSection')}>
        <Toggle
          label={t('settings.panelPin')}
          hint={t('settings.panelPinHint')}
          on={s.panelPin}
          onChange={(v) => update({ panelPin: v })}
        />
      </Section>
      <Section title={t('settings.lang')}>
        <fieldset className="segmented" aria-label={t('settings.langAria')}>
          {(['auto', 'ko', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={s.lang === l}
              className={s.lang === l ? 'on' : ''}
              onClick={async () => {
                if (s.lang === l) return;
                await update({ lang: l });
                setLangChanged(true);
              }}
            >
              {t(`settings.lang.${l}`)}
            </button>
          ))}
        </fieldset>
        {langChanged ? (
          <div className="action-row notice" role="status">
            <small className="grow">{t('settings.langRestart')}</small>
            <button type="button" className="primary" onClick={() => bridge.relaunch()}>
              {t('settings.restart')}
            </button>
          </div>
        ) : (
          <small className="below">{t('settings.langHint')}</small>
        )}
        {/* 어두운 모드는 따로 고르지 않고 운영체제를 따른다. 찾기에서 "다크", "theme" 로도 나오게 낱말을 숨겨 둔다 */}
        <p className="theme-note">
          {t('settings.themeNote')}
          <span hidden>{t('settings.themeKeywords')}</span>
        </p>
      </Section>

      <Section title={t('settings.integrations')}>
        <Toggle
          label={t('settings.urlScheme')}
          hint={t('settings.urlSchemeHint')}
          on={s.urlScheme}
          onChange={(v) => update({ urlScheme: v })}
        />
        {s.urlScheme && (
          <small className="below">
            <code>{t('settings.urlSchemeExample')}</code>
          </small>
        )}
      </Section>

      <Section title={t('settings.power')}>
        <fieldset className="segmented" aria-label={t('settings.saverAria')}>
          {SAVER_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={s.batterySaver === m}
              className={s.batterySaver === m ? 'on' : ''}
              onClick={() => s.batterySaver !== m && update({ batterySaver: m })}
            >
              {t(`settings.saver.${m}`)}
            </button>
          ))}
        </fieldset>
        <small className="below">
          {(s.batterySaver === 'always' || (s.batterySaver === 'auto' && snap.onBattery)) && (
            <>{t('settings.saverNow')} </>
          )}
          {t('settings.saverHint')}
        </small>
      </Section>

      <Section title={t('settings.access')}>
        <Toggle
          label={t('settings.readAloud')}
          hint={t('settings.readAloudHint')}
          on={s.readAloud}
          onChange={(v) => update({ readAloud: v })}
        />
        {mac && (
          <Toggle
            label={t('settings.trayTitle')}
            hint={t('settings.trayTitleHint')}
            on={s.trayTitle}
            onChange={(v) => update({ trayTitle: v })}
          />
        )}
        {s.shortcuts.pet !== NO_SHORTCUT && (
          <small className="below">
            {t('settings.petKeysHint', { keys: acceleratorLabel(s.shortcuts.pet, mac).join('+') })}
          </small>
        )}
      </Section>

      <Section title={t('settings.start')}>
        <Toggle
          label={t('settings.launchAtLogin')}
          hint={snap.packaged ? t('settings.launchPackaged') : t('settings.launchDev')}
          on={s.launchAtLogin}
          disabled={!snap.packaged}
          onChange={(v) => update({ launchAtLogin: v })}
        />
        {/* 시작 안내는 업데이트가 아니라 시작 칸에 (예전엔 업데이트 칸 안에 있었다) */}
        <div className="action-row">
          <button type="button" className="ghost" onClick={() => bridge.openOnboarding()}>
            {t('settings.onboardingAgain')}
          </button>
        </div>
      </Section>
    </>
  );
}

/** 단축키 한 줄: 누르면 기록 모드, 키 조합을 누르면 저장 (v2 단축키 바꾸기) */
function ShortcutRow({
  id,
  value,
  mac,
  onSave,
  onError,
}: {
  id: ShortcutId;
  value: string;
  mac: boolean;
  onSave: (acc: string) => void;
  onError: (m: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  return (
    <>
      <dt>{SHORTCUT_LABEL[id]}</dt>
      <dd className="shortcut">
        <span className="keys-line">
          {recording ? (
            <span className="recording">{t('settings.shortcut.recording')}</span>
          ) : value === NO_SHORTCUT ? (
            // 새 기본 키가 쓰던 키와 겹쳐 비워 둔 단축키. "바꾸기"로 새 키를 넣는다
            <span className="none">{t('settings.shortcut.none')}</span>
          ) : (
            acceleratorLabel(value, mac).map((k) => <kbd key={k}>{k}</kbd>)
          )}
        </span>
        <button
          type="button"
          className="ghost small"
          aria-pressed={recording}
          onClick={() => setRecording((v) => !v)}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault();
            if (e.key === 'Escape') {
              setRecording(false);
              return;
            }
            const r = toAccelerator(e, mac);
            if (!r) return;
            if ('error' in r) {
              onError(r.error);
              return;
            }
            setRecording(false);
            onSave(r.accelerator);
          }}
          onBlur={() => setRecording(false)}
        >
          {recording ? t('settings.shortcut.recordingBtn') : t('settings.shortcut.change')}
        </button>
        {value !== SHORTCUT_DEFAULTS[id] && !recording && (
          <button type="button" className="link" onClick={() => onSave(SHORTCUT_DEFAULTS[id])}>
            {t('settings.shortcut.default')}
          </button>
        )}
        {/* 맥은 다른 앱과 겹쳐도 알 수 없어(L18) 끌 수 있게 둔다 */}
        {value !== NO_SHORTCUT && !recording && (
          <button type="button" className="link" onClick={() => onSave(NO_SHORTCUT)}>
            {t('settings.shortcut.off')}
          </button>
        )}
      </dd>
    </>
  );
}
