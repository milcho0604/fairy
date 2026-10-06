import { useEffect, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { OnboardSnapshot } from '../../../shared/ipc.ts';
import { PET_KINDS, PET_NAME_MAX } from '../../../shared/settings.ts';
import { PetFace } from '../PetFace.tsx';

const bridge = window.jjakkungOnboard;
const PAGES = 3;

/** 첫 실행 안내 (v1): 펫 정하기, 같이 보기 권한, 알아 두면 좋은 것 */
export function OnboardingApp() {
  const [snap, setSnap] = useState<OnboardSnapshot>();
  const [page, setPage] = useState(0);
  const [name, setName] = useState('');

  const refresh = () =>
    bridge.get().then((s) => {
      setSnap(s);
      setName((n) => n || s.settings.petName);
    });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만 건다
  useEffect(() => {
    refresh();
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
    // 시스템 설정에서 권한을 주고 돌아오면 다시 읽는다
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (!snap) return <div className="onboard" />;
  const s = snap.settings;
  const mac = snap.platform === 'darwin';
  const mod = mac ? 'Cmd' : 'Ctrl';
  const alt = mac ? 'Option' : 'Alt';
  const petName = name.trim() || s.petName;

  const saveName = async () => {
    const next = await bridge.set({ petName: name });
    setName(next.petName);
    setSnap((v) => v && { ...v, settings: next });
  };

  return (
    <div className="onboard">
      <header>
        <ol className="dots" aria-label={t('onboarding.pages', { page: page + 1, total: PAGES })}>
          {Array.from({ length: PAGES }, (_, i) => (
            <li key={String(i)} className={i === page ? 'on' : i < page ? 'done' : ''} />
          ))}
        </ol>
      </header>

      <main>
        {page === 0 && (
          <section>
            <div className="hero">
              <PetFace />
            </div>
            <h1>{t('onboarding.hello.title')}</h1>
            <p className="lead">{t('onboarding.hello.lead')}</p>
            <label className="field">
              <span>{t('onboarding.hello.name')}</span>
              <input
                value={name}
                maxLength={PET_NAME_MAX * 2}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <div className="field">
              <span>{t('onboarding.hello.look')}</span>
              <fieldset className="choice" aria-label={t('onboarding.hello.kinds')}>
                {PET_KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={s.petKind === k.id && !s.petImage}
                    className={s.petKind === k.id && !s.petImage ? 'on' : ''}
                    onClick={async () => {
                      const next = await bridge.set({ petKind: k.id, petImage: null } as never);
                      setSnap((v) => v && { ...v, settings: next });
                    }}
                  >
                    {k.label}
                  </button>
                ))}
                <button type="button" className={s.petImage ? 'on' : ''} onClick={() => bridge.openMaker()}>
                  {t('onboarding.hello.photo')}
                </button>
              </fieldset>
              <small>{t('onboarding.hello.photoHint')}</small>
            </div>
          </section>
        )}

        {page === 1 && (
          <section>
            <h1>{t('onboarding.look.title')}</h1>
            <p className="lead">{t('onboarding.look.lead', { name: petName })}</p>
            {mac ? (
              <div className={`perm ${snap.screen === 'granted' ? 'ok' : ''}`}>
                <strong>
                  {snap.screen === 'granted' ? t('onboarding.look.granted') : t('onboarding.look.needed')}
                </strong>
                <small>{t('onboarding.look.howTo')}</small>
                {snap.screen !== 'granted' && (
                  <button type="button" className="ghost" onClick={() => bridge.openScreenSettings()}>
                    {t('onboarding.look.openSettings')}
                  </button>
                )}
              </div>
            ) : (
              <div className="perm ok">
                <strong>{t('onboarding.look.windows')}</strong>
              </div>
            )}
            <p className="hint">{t('onboarding.look.ai')}</p>
          </section>
        )}

        {page === 2 && (
          <section>
            <h1>{t('onboarding.tips.title')}</h1>
            <dl className="tips">
              <dt>{t('onboarding.tips.click', { name: petName })}</dt>
              <dd>{t('onboarding.tips.clickDesc')}</dd>
              <dt>{t('onboarding.tips.right')}</dt>
              <dd>{t('onboarding.tips.rightDesc')}</dd>
              <dt>{t('onboarding.tips.rub')}</dt>
              <dd>{t('onboarding.tips.rubDesc')}</dd>
              <dt>{t('onboarding.tips.throw')}</dt>
              <dd>{t('onboarding.tips.throwDesc')}</dd>
              <dt>
                <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>Shift</kbd> <kbd>N</kbd>
              </dt>
              <dd>{t('onboarding.tips.quickDesc')}</dd>
              <dt>
                <kbd>{mod}</kbd> <kbd>{alt}</kbd> <kbd>Shift</kbd> <kbd>H</kbd>
              </dt>
              <dd>{t('onboarding.tips.hideDesc')}</dd>
            </dl>
          </section>
        )}
      </main>

      <footer>
        {page > 0 ? (
          <button type="button" className="ghost" onClick={() => setPage(page - 1)}>
            {t('onboarding.prev')}
          </button>
        ) : (
          <button type="button" className="link" onClick={() => bridge.finish()}>
            {t('onboarding.skip')}
          </button>
        )}
        {page < PAGES - 1 ? (
          <button type="button" className="primary" onClick={() => setPage(page + 1)}>
            {t('onboarding.next')}
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => bridge.finish()}>
            {t('onboarding.start')}
          </button>
        )}
      </footer>
    </div>
  );
}
