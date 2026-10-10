import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../../../shared/bytes.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { OnboardAi, OnboardSnapshot } from '../../../shared/ipc.ts';
import { cleanPetName, PET_KINDS, PET_NAME_MAX } from '../../../shared/settings.ts';
import { acceleratorLabel } from '../../../shared/shortcut.ts';
import { PetFace } from '../PetFace.tsx';
import { PetNameInput } from '../PetNameInput.tsx';
import { PetShot } from '../PetShot.tsx';
import { RoutinePicker } from '../RoutinePicker.tsx';
import { pageByKey } from './page-keys.ts';

const bridge = window.jjakkungOnboard;
const PAGES = 4;

/** 첫 실행 안내 (v1): 펫 정하기, 만나는 시간, 같이 보기 권한, 알아 두면 좋은 것 */
export function OnboardingApp() {
  const [snap, setSnap] = useState<OnboardSnapshot>();
  const [page, setPage] = useState(0);
  const [name, setName] = useState('');
  // 이름 칸을 고쳤는지 (고치지 않았으면 모습을 고를 때 이름이 그 모습의 기본 이름을 따라간다)
  const typed = useRef(false);
  /** 이름 칸 아래 한 줄 (비었을 때, 글자 수가 넘쳤을 때) */
  const [nameNote, setNameNote] = useState('');
  /** 만나는 시간 칸 아래 한 줄 (시작과 끝이 같을 때) */
  const [routineNote, setRoutineNote] = useState('');
  /** 설치된 AI 확인은 몇 초 걸릴 수 있어 따로 받는다. 오기 전에는 원래 안내를 보인다 */
  const [ai, setAi] = useState<OnboardAi>();

  const refresh = () =>
    bridge.get().then((s) => {
      setSnap(s);
      // 펫 만들기에서 돌아오면 사진 펫 이름을 받는다. 고치던 이름은 그대로 둔다
      if (!typed.current) setName(s.settings.petName);
    });

  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만 건다
  useEffect(() => {
    refresh();
    bridge
      .ai()
      .then(setAi)
      .catch(() => {});
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
    // 시스템 설정에서 권한을 주고 돌아오면 다시 읽는다
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // 이름 칸에서 바로 창을 닫아도 쓴 이름을 남긴다 (blur 때만 저장해서 잃었다, 설정 창과 같은 방식)
  const nameNow = useRef({ name, saved: '' });
  nameNow.current = { name, saved: snap?.settings.petName ?? '' };
  useEffect(() => {
    const flush = () => {
      if (!typed.current) return;
      const clean = cleanPetName(nameNow.current.name);
      if (clean && clean !== nameNow.current.saved) void bridge.set({ petName: clean, petNameEdited: true });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // ← → 로 쪽 넘기기 (입력칸 밖에서만)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const inField =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      setPage((p) => pageByKey(e, p, PAGES, inField) ?? p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!snap) return <div className="onboard" />;
  const s = snap.settings;
  const mac = snap.platform === 'darwin';
  // 단축키는 설정에서 바꿀 수 있어 지금 값을 보인다
  const keys = (acc: string) =>
    acceleratorLabel(acc, mac).map((k, i) => (
      <span key={k}>
        {i > 0 && ' '}
        <kbd>{k}</kbd>
      </span>
    ));
  const petName = cleanPetName(name) ?? s.petName;

  // 비우면 저장하지 않고 원래 이름으로 돌린다. 바꾼 이름만 "손댄 이름"으로 저장한다
  const saveName = async () => {
    if (!typed.current) return;
    typed.current = false;
    const clean = cleanPetName(name);
    if (!clean) {
      setName(s.petName);
      setNameNote(t('onboarding.hello.nameEmpty'));
      return;
    }
    setName(clean);
    if (clean === s.petName) return;
    const next = await bridge.set({ petName: clean, petNameEdited: true });
    setName(next.petName);
    setSnap((v) => v && { ...v, settings: next });
  };

  const setRoutine = async (routine: typeof s.routine) => {
    setRoutineNote('');
    const next = await bridge.set({ routine });
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
              {/* 기본 펫은 화면 위 펫, 설정 썸네일과 같은 몸 전체 그림 (팔다리 포함). 사진 펫은 얼굴 그림 */}
              {s.petImage ? (
                <PetFace />
              ) : (
                <PetShot
                  className="face body"
                  kind={s.petKind}
                  use3d={s.pet3d}
                  style={s.petStyle}
                  side={112}
                />
              )}
            </div>
            <h1>{t('onboarding.hello.title')}</h1>
            <p className="lead">{t('onboarding.hello.lead')}</p>
            <label className="field">
              <span>{t('onboarding.hello.name')}</span>
              <PetNameInput
                value={name}
                onValue={(v) => {
                  typed.current = true;
                  setName(v);
                  setNameNote('');
                }}
                onLimit={() => setNameNote(t('onboarding.hello.nameMax', { max: PET_NAME_MAX }))}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                }}
              />
              {nameNote && (
                <small className="name-note" role="status">
                  {nameNote}
                </small>
              )}
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
                      // 이름을 손대지 않았으면 메인이 고른 모습의 기본 이름(냥이 등)으로 바꿔 둔다
                      if (!typed.current) setName(next.petName);
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
            <h1>{t('routine.onb.title', { name: petName })}</h1>
            <p className="lead">{t('routine.onb.lead')}</p>
            <fieldset className="pick-two" aria-label={t('routine.set.title')}>
              {([true, false] as const).map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  aria-pressed={s.routine.on === on}
                  className={s.routine.on === on ? 'on' : ''}
                  onClick={() => setRoutine({ ...s.routine, on })}
                >
                  <strong>{on ? t('routine.onb.set') : t('routine.onb.free')}</strong>
                  <small>{on ? t('routine.onb.setHint') : t('routine.onb.freeHint')}</small>
                </button>
              ))}
            </fieldset>
            {s.routine.on && (
              <RoutinePicker routine={s.routine} onChange={setRoutine} onError={setRoutineNote} />
            )}
            {routineNote && (
              <small className="routine-note" role="status">
                {routineNote}
              </small>
            )}
            <p className="hint">{t('routine.onb.later')}</p>
          </section>
        )}

        {page === 2 && (
          <section>
            <h1>{t('onboarding.look.title')}</h1>
            <p className="lead">{t('onboarding.look.lead', { name: petName })}</p>
            {mac ? (
              <div className={`perm ${snap.screen === 'granted' ? 'ok' : ''}`}>
                <strong>
                  {snap.screen === 'granted' ? t('onboarding.look.granted') : t('onboarding.look.needed')}
                </strong>
                {/* 권한이 이미 있으면 켜는 방법은 필요 없다 */}
                {snap.screen !== 'granted' && (
                  <>
                    <small>{t('onboarding.look.howTo')}</small>
                    <button type="button" className="ghost" onClick={() => bridge.openScreenSettings()}>
                      {t('onboarding.look.openSettings')}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="perm ok">
                <strong>{t('onboarding.look.windows')}</strong>
              </div>
            )}
            <p className="hint">
              {ai && !ai.hasCli
                ? t('onboarding.look.aiFree', { size: formatBytes(ai.freeModelBytes) })
                : t('onboarding.look.ai')}
            </p>
          </section>
        )}

        {page === 3 && (
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
              {/* 끈 단축키(빈 키)는 보이지 않는다 */}
              {s.shortcuts.quickAdd && (
                <>
                  <dt>{keys(s.shortcuts.quickAdd)}</dt>
                  <dd>{t('onboarding.tips.quickDesc')}</dd>
                </>
              )}
              {s.shortcuts.chat && (
                <>
                  <dt>{keys(s.shortcuts.chat)}</dt>
                  <dd>{t('onboarding.tips.chatDesc')}</dd>
                </>
              )}
              {s.shortcuts.hide && (
                <>
                  <dt>{keys(s.shortcuts.hide)}</dt>
                  <dd>{t('onboarding.tips.hideDesc')}</dd>
                </>
              )}
              <dt>{t('onboarding.tips.settings')}</dt>
              <dd>{t('onboarding.tips.settingsDesc', { mac })}</dd>
            </dl>
          </section>
        )}
      </main>

      <footer>
        {page > 0 ? (
          <button
            type="button"
            className="ghost"
            title={t('onboarding.keys')}
            aria-keyshortcuts="ArrowLeft"
            onClick={() => setPage(page - 1)}
          >
            {t('onboarding.prev')}
          </button>
        ) : (
          <button type="button" className="link" onClick={() => bridge.finish()}>
            {t('onboarding.skip')}
          </button>
        )}
        {page < PAGES - 1 ? (
          <button
            type="button"
            className="primary"
            title={t('onboarding.keys')}
            aria-keyshortcuts="ArrowRight"
            onClick={() => setPage(page + 1)}
          >
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
