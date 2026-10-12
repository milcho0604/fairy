import { useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import {
  cleanPetName,
  FRIENDS_MAX,
  type Friend,
  GAIT_PICKS,
  type GaitPick,
  PET_KINDS,
  PET_NAME_MAX,
  type PetKind,
} from '../../../shared/settings.ts';
import { PetNameInput } from '../PetNameInput.tsx';

/** 친구 펫 (v2 여러 마리): 이름과 모양을 정해 데려오고, 집에 보낸다. 3마리까지 */
export function Friends({
  list,
  petName,
  onChange,
  onImport,
  onMakeMain,
  onMsg,
}: {
  list: Friend[];
  /** 기본 펫 이름 (같은 이름 경고에 쓴다) */
  petName: string;
  onChange: (next: Friend[]) => void;
  onImport: () => void;
  /** 이 친구를 기본 페어리로 (지금 기본 페어리는 이 친구 자리로, friend-swap.ts) */
  onMakeMain: (id: string) => void;
  onMsg: (m: string, error?: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PetKind>('cat');
  // 같은 이름이면 한 번 알리고, 그래도 데려오기를 다시 누르면 데려온다 (막지는 않는다)
  const [dupe, setDupe] = useState('');
  // 집에 보내기는 두 번 눌러 확인 (보관한 펫 지우기와 같은 방식)
  const [sure, setSure] = useState('');
  const full = list.length >= FRIENDS_MAX;
  const clean = cleanPetName(name);
  const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const taken = !!clean && [petName, ...list.map((f) => f.name)].some((n) => same(n, clean));
  const add = () => {
    if (!clean || full) return;
    if (taken && dupe !== clean) {
      setDupe(clean);
      return;
    }
    onChange([...list, { id: `f-${Date.now().toString(36)}`, name: clean, kind }]);
    setName('');
    setDupe('');
  };
  const leaving = list.find((f) => f.id === sure);
  return (
    <>
      <small>{t('settings.friends.hint', { max: FRIENDS_MAX })}</small>
      {list.length > 0 && (
        <ul className="friends">
          {list.map((f) => (
            <li key={f.id}>
              <b>{f.name}</b>
              <small>
                {f.image
                  ? t('settings.friends.photo')
                  : (PET_KINDS.find((k) => k.id === f.kind)?.label ?? '')}
              </small>
              {/* 걸음새는 다리가 있는 몸(기본 펫, 입체 설계도가 있는 사진 친구)만. 친구마다 따로 */}
              {(!f.image || f.model) && (
                <select
                  className="friend-gait"
                  value={f.gait ?? 'auto'}
                  aria-label={t('settings.gait.friendAria', { name: f.name })}
                  onChange={(e) => {
                    const pick = e.target.value as GaitPick;
                    onChange(
                      list.map((x) => {
                        if (x.id !== f.id) return x;
                        const { gait: _, ...rest } = x;
                        return pick === 'auto' ? rest : { ...rest, gait: pick };
                      }),
                    );
                  }}
                >
                  {/* 칸 이름이 따로 없어 "자동"만 보이면 무엇인지 모른다. 고른 값 앞에 "걸음새"를 붙인다 */}
                  {GAIT_PICKS.map((g) => (
                    <option key={g} value={g}>
                      {`${t('settings.gait')}: ${t(`settings.gait.${g}`)}`}
                    </option>
                  ))}
                </select>
              )}
              {/* 두 단추는 한 묶음으로 (좁은 창에서 따로 떨어지지 않게) */}
              <span className="friend-acts">
                {/* 서로 바꾸기라 되돌릴 수 있다: 한 번에 바꾼다. 줄 자리(순서)는 그대로 */}
                <button
                  type="button"
                  className="link make-main"
                  aria-label={t('settings.friends.makeMainAria', { name: f.name, main: petName })}
                  title={t('settings.friends.makeMainAria', { name: f.name, main: petName })}
                  onClick={() => onMakeMain(f.id)}
                >
                  {t('settings.friends.makeMain')}
                </button>
                <button
                  type="button"
                  className={`link${sure === f.id ? ' sure' : ''}`}
                  aria-label={
                    sure === f.id
                      ? t('settings.friends.sendHomeSureAria', { name: f.name })
                      : t('settings.friends.sendHomeAria', { name: f.name })
                  }
                  onClick={() => {
                    if (sure !== f.id) {
                      setSure(f.id);
                      return;
                    }
                    setSure('');
                    onChange(list.filter((x) => x.id !== f.id));
                  }}
                  onBlur={() => setSure('')}
                >
                  {sure === f.id ? t('settings.friends.sendHomeSure') : t('settings.friends.sendHome')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {leaving?.image && (
        <small className="below warn" role="status">
          {t('settings.friends.photoGone', { name: leaving.name })}
        </small>
      )}
      {!full && (
        <div className="friend-add">
          <PetNameInput
            value={name}
            placeholder={t('settings.friends.name')}
            aria-label={t('settings.friends.name')}
            onValue={(v) => {
              setName(v);
              setDupe('');
            }}
            onLimit={() => onMsg(t('settings.nameMax', { max: PET_NAME_MAX }), true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
            }}
          />
          <select
            value={kind}
            aria-label={t('settings.friends.kind')}
            onChange={(e) => setKind(e.target.value as PetKind)}
          >
            {PET_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <button type="button" className="ghost" disabled={!clean} onClick={add}>
            {dupe && dupe === clean ? t('settings.friends.addAnyway') : t('settings.friends.add')}
          </button>
        </div>
      )}
      {!full && dupe && dupe === clean && (
        <small className="below warn" role="status">
          {t('settings.friends.dupe', { name: clean })}
        </small>
      )}
      {!full && (
        <div className="action-row">
          <button type="button" className="link" onClick={onImport}>
            {t('settings.friends.import')}
          </button>
        </div>
      )}
    </>
  );
}
