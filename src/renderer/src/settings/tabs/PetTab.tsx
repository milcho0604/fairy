import { useEffect, useRef, useState } from 'react';
import { t } from '../../../../shared/i18n/index.ts';
import { restDaysOf } from '../../../../shared/routine.ts';
import {
  cleanPetName,
  isPersonalPet,
  PET_NAME_MAX,
  PET_STYLES,
  POSE_KINDS,
  petNameLength,
  starterStand,
} from '../../../../shared/settings.ts';
import { MAX_SCALE, MIN_SCALE } from '../../../../shared/size.ts';
import { PetNameInput } from '../../PetNameInput.tsx';
import { Friends } from '../Friends.tsx';
import { GaitPicker } from '../GaitPicker.tsx';
import { Gallery } from '../Gallery.tsx';
import { PetPicker } from '../PetPicker.tsx';
import { bridge, isMac, Section, type TabProps, Toggle } from '../ui.tsx';
import { WearBox } from '../WearBox.tsx';

/** 만나는 시간을 켰을 때 삐짐 칸의 안내: 만나지 않는 요일을 이름으로 (일, 토) */
const restByRoutine = (days: readonly number[]): string => {
  const names = t('settings.weekdays').split(',');
  return days.length === 0
    ? t('settings.restDaysByRoutineNone')
    : t('settings.restDaysByRoutine', { days: days.map((d) => names[d] ?? '').join(', ') });
};

/** 펫 탭: 펫(이름, 모습, 크기, 움직임), 친구 펫, 삐짐 */
export function PetTab({ snap, setSnap, update, flash }: TabProps) {
  const s = snap.settings;
  const mac = isMac(snap);
  const mod = mac ? 'Cmd' : 'Ctrl';
  const [name, setName] = useState(s.petName);
  const [scale, setScale] = useState(snap.scale);
  // 이름 칸에서 나가지 않고 창을 닫아도 고친 이름을 잃지 않게 (닫을 때 저장).
  // 사용자가 칸을 고쳤을 때만 저장한다. 다른 곳(펫 만들기, 가져오기)에서 바뀐 이름은 칸에 받아 온다
  const nameEdited = useRef(false);
  const nameDraft = useRef(name);
  nameDraft.current = name;
  const savedName = useRef('');
  savedName.current = snap?.settings.petName ?? '';
  useEffect(() => {
    const flush = () => {
      // 비었거나 그대로면 저장하지 않는다 (saveName 과 같은 기준)
      const next = cleanPetName(nameDraft.current);
      if (nameEdited.current && next && next !== savedName.current)
        void bridge.set({ petName: next, petNameEdited: true });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);
  // 다른 곳(펫 만들기, 가져오기)에서 바뀐 이름은 고치는 중이 아닐 때 칸에 받아 온다
  useEffect(() => {
    if (!nameEdited.current) setName(s.petName);
  }, [s.petName]);
  useEffect(() => {
    // 펫 크기는 펫 위에서 휠, 손가락으로도 바뀐다. 이 창으로 돌아오면 다시 받는다 (밀대가 옛 값으로 펫을 되돌렸다)
    const onFocus = () => void bridge.get().then((v) => setScale(v.scale));
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // 비우면 저장하지 않고 원래 이름으로 돌린다 ("이름을 바꿨어"가 떴지만 실제로는 그대로였다).
  // 그대로면 아무 말 없이 넘어간다. 바꾸면 손댄 이름이라 모습을 바꿔도 따라가지 않는다
  const saveName = async () => {
    if (!nameEdited.current) return;
    nameEdited.current = false;
    const clean = cleanPetName(name);
    if (!clean) {
      setName(s.petName);
      flash(t('settings.nameEmpty'), true);
      return;
    }
    if (clean === s.petName) {
      setName(clean);
      return;
    }
    const next = await update({ petName: clean, petNameEdited: true }, t('settings.nameChanged'));
    setName(next.petName);
  };

  const preview = cleanPetName(name) ?? s.petName;

  return (
    <>
      <Section title={t('settings.pet')}>
        <label className="field">
          <span>{t('settings.name')}</span>
          <div className="row">
            <PetNameInput
              value={name}
              onValue={(v) => {
                nameEdited.current = true;
                setName(v);
              }}
              onLimit={() => flash(t('settings.nameMax', { max: PET_NAME_MAX }), true)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <small>
            {t('settings.nameHint', { name: preview, n: petNameLength(name.trim()), max: PET_NAME_MAX })}
          </small>
        </label>

        <div className="field">
          <span>{t('settings.look')}</span>
          <PetPicker
            snap={snap}
            onPick={async (choice) => {
              const library = await bridge.choosePet(choice);
              const next = await bridge.get();
              setSnap({ ...next, library });
              setName(next.settings.petName);
              flash(t('settings.saved'));
            }}
            onRemove={async (id) => {
              const library = await bridge.removeSavedPet(id);
              setSnap((v) => v && { ...v, library });
              flash(t('settings.pets.removed'));
            }}
          />
          <div className="action-row">
            <button type="button" className="ghost" onClick={() => bridge.openMaker()}>
              {t('settings.makePhotoPet')}
            </button>
          </div>
          <small>{t('settings.pets.hint')}</small>
        </div>

        {s.petImage && (
          <div className="field">
            <span>{t('settings.poses')}</span>
            <div className="action-row">
              {POSE_KINDS.map((p) => (
                <button key={p.id} type="button" className="ghost" onClick={() => bridge.openMaker(p.id)}>
                  {s.petPoses[p.id]
                    ? t('settings.poseChange', { label: p.label })
                    : t('settings.posePhoto', { label: p.label })}
                </button>
              ))}
            </div>
            <small>{t('settings.posesHint')}</small>
          </div>
        )}

        <label className="field">
          <span>
            {t('settings.size')} <b>{Math.round(scale * 100)}%</b>
          </span>
          <input
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.05}
            value={scale}
            onChange={(e) => {
              const v = Number(e.target.value);
              setScale(v);
              bridge.setScale(v);
            }}
          />
          <small>{t('settings.sizeHint', { mod })}</small>
        </label>

        {/* 밀크, 초코는 네 발로 선 피규어를 켰을 때만 입체 (끄면 사진 그대로라 입체로 보기가 쓸모없다) */}
        {(!s.petImage || s.petModel || s.petDepth || starterStand(s)) && (
          <Toggle
            label={t('settings.pet3d')}
            hint={t('settings.pet3dHint')}
            on={s.pet3d}
            onChange={(v) => update({ pet3d: v })}
          />
        )}
        {(!s.petImage || s.petModel) && s.pet3d && (
          <div className="field">
            <span>{t('settings.petStyle')}</span>
            <fieldset className="segmented wrap" aria-label={t('settings.petStyle')}>
              {PET_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={s.petStyle === style}
                  className={s.petStyle === style ? 'on' : ''}
                  onClick={() => update({ petStyle: style })}
                >
                  {t(`settings.petStyle.${style}`)}
                </button>
              ))}
            </fieldset>
            <small>{t(`settings.petStyleHint.${s.petStyle}`)}</small>
          </div>
        )}

        <GaitPicker snap={snap} update={update} flash={flash} />

        <Toggle
          label={t('settings.wander')}
          hint={t('settings.wanderHint')}
          on={s.wander}
          onChange={(v) => update({ wander: v })}
        />
        <Toggle
          label={t('settings.lookAtCursor')}
          hint={t('settings.lookAtCursorHint')}
          on={s.lookAtCursor}
          onChange={(v) => update({ lookAtCursor: v })}
        />
        <Toggle
          label={t('settings.dayRhythm')}
          hint={t('settings.dayRhythmHint')}
          on={s.dayRhythm}
          onChange={(v) => update({ dayRhythm: v })}
        />
        <Toggle
          label={t('settings.typeAlong')}
          hint={t('settings.typeAlongHint')}
          on={s.typeAlong}
          onChange={(v) => update({ typeAlong: v })}
        />
        <Toggle
          label={t('settings.dailyNotes')}
          hint={t('settings.dailyNotesHint')}
          on={s.dailyNotes}
          onChange={(v) => update({ dailyNotes: v })}
        />
        <Toggle
          label={t('settings.sounds')}
          hint={t('settings.soundsHint')}
          on={s.sounds}
          onChange={(v) => update({ sounds: v })}
        />
        <Toggle
          label={t('settings.boost')}
          hint={t('settings.boostHint')}
          on={s.boost}
          note={s.boost && snap.onBattery ? t('settings.boostResting') : undefined}
          onChange={(v) => update({ boost: v })}
        />
        <Toggle
          label={t(mac ? 'settings.sysMonitor' : 'settings.sysMonitorWin')}
          hint={t(mac ? 'settings.sysMonitorHint' : 'settings.sysMonitorWinHint')}
          on={s.sysMonitor}
          onChange={(v) => update({ sysMonitor: v })}
        />
      </Section>

      <WearBox snap={snap} update={update} />

      <Section title={t('settings.friends')}>
        <Friends
          list={s.friends}
          petName={s.petName}
          onMsg={flash}
          onChange={(friends) => update({ friends }, t('settings.friendsChanged'))}
          onMakeMain={async (id) => {
            const main = s.petName;
            const name = s.friends.find((f) => f.id === id)?.name ?? '';
            const library = await bridge.choosePet({ friend: id });
            const next = await bridge.get();
            setSnap({ ...next, library });
            setName(next.settings.petName);
            flash(t('settings.friends.madeMain', { name, main }));
          }}
          onImport={async () => {
            const r = await bridge.importFriend();
            if (r.message) flash(r.message, !r.ok);
          }}
        />
      </Section>

      <Section title={t('settings.gallery')}>
        <Gallery onMsg={flash} meta={snap.current?.meta} personal={isPersonalPet(snap.settings)} />
      </Section>

      <Section title={t('settings.sulk')}>
        {/* 만나는 시간을 켜면 쉬는 날은 거기서 정한다 (만나지 않는 요일). restDays 는 지우지 않고 꺼지면 다시 쓴다 */}
        {s.routine.on ? (
          <div className="field">
            <span>{t('settings.restDaysAria')}</span>
            <small>{restByRoutine(restDaysOf(s))}</small>
          </div>
        ) : (
          <div className="field">
            <span>{t('settings.restDays')}</span>
            <fieldset className="days" aria-label={t('settings.restDaysAria')}>
              {t('settings.weekdays')
                .split(',')
                .map((d, i) => {
                  const on = s.restDays.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      className={on ? 'on' : ''}
                      onClick={() =>
                        update({ restDays: on ? s.restDays.filter((x) => x !== i) : [...s.restDays, i] })
                      }
                    >
                      {d}
                    </button>
                  );
                })}
            </fieldset>
          </div>
        )}
        <Toggle
          label={t('settings.spicy')}
          hint={t('settings.spicyHint')}
          on={s.spicy}
          onChange={(v) => update({ spicy: v })}
        />
      </Section>
    </>
  );
}
