import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import type { Gait } from '../../../shared/pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from '../../../shared/pet3d/defaults.ts';
import { canStand } from '../../../shared/pet3d/stand.ts';
import {
  GAIT_PICKS,
  type GaitPick,
  gaitPatch,
  pickedGait,
  pickedStand,
  type Settings,
  standPatch,
} from '../../../shared/settings.ts';
import { MakeProgress } from '../MakeProgress.tsx';
import { browserStore, loadExpected, saveDuration } from '../make-progress.ts';
import { gaitMismatch, shapeOf } from '../pet3d-gait.ts';
import { bridge, Toggle } from './ui.tsx';

/**
 * 걸음새 고르기 (자동, 두 발, 네 발). 지금 펫에만 적용하고 펫(몸)마다 따로 기억한다 (settings.petGaits).
 * 기본 펫은 2D 와 입체 모두 바로 바꾼다. 입체 피규어 사진 펫은 몸 모양과 다른 걸음새를 고르면 바로 바꾸지 않고
 * "이 걸음새에 맞게 다시 만들기"(같은 사진, 같은 요청사항)와 "그냥 바꾸기"를 같이 보여 준다.
 * 다리가 없는 사진 펫(평면, 2.5D, 입체로 보기 꺼짐)은 흐리게 두고 이유를 적는다
 */
export function GaitPicker({
  snap,
  update,
  flash,
}: {
  snap: SettingsSnapshot;
  update: (patch: Partial<Settings>, message?: string) => Promise<Settings>;
  flash: (message: string, error?: boolean) => void;
}) {
  const s = snap.settings;
  // 고르는 중인 걸음새 (몸과 달라 물어보는 중), 다시 만드는 중인 걸음새, 다시 만들기 실패 글
  const [ask, setAsk] = useState<Gait>();
  const [busy, setBusy] = useState<Gait>();
  // 다시 만들기 진행 표시: 시작한 때, 예상 시간(지난번 걸린 시간), 끝나서 100% 를 잠깐 보여 주는 중
  const [busyAt, setBusyAt] = useState(0);
  const [busyMs, setBusyMs] = useState(0);
  const [busyDone, setBusyDone] = useState(false);
  // 그만두기를 눌렀으면 "멈췄어"를 오류처럼 띄우지 않고 묻던 칸으로 조용히 돌아간다
  const stopped = useRef(false);
  const [error, setError] = useState('');
  const figure = s.petImage && snap.current?.look === 'figure' ? snap.current.model : undefined;
  // 몸 모양: 기본 펫은 기본 설계도, 사진 펫은 그 설계도 (고른 값을 덮기 전)
  const shape: Gait | undefined = !s.petImage
    ? shapeOf(DEFAULT_BLUEPRINTS[s.petKind])
    : figure && s.pet3d
      ? shapeOf(figure)
      : undefined;
  const why = shape ? '' : figure ? t('settings.gait.off3d') : t('settings.gait.flat');
  const picked = shape ? pickedGait(s) : undefined;
  const now: GaitPick = picked ?? 'auto';
  const canRemake = !!figure;
  // 펫을 바꾸면 묻던 것을 접는다
  const petKey = `${s.petImage ?? s.petKind}|${s.petModel ?? ''}`;
  const lastPet = useRef(petKey);
  useEffect(() => {
    if (lastPet.current === petKey) return;
    lastPet.current = petKey;
    setAsk(undefined);
    setError('');
  }, [petKey]);

  const apply = async (pick: GaitPick) => {
    const patch = gaitPatch(s, pick);
    setAsk(undefined);
    setError('');
    if (patch) await update(patch);
  };
  const choose = (pick: GaitPick) => {
    if (!shape || busy) return;
    if (pick === now) {
      setAsk(undefined);
      return;
    }
    if (pick !== 'auto' && canRemake && gaitMismatch(pick, shape)) {
      setAsk(pick);
      setError('');
      return;
    }
    void apply(pick);
  };
  const remake = async (pick: Gait) => {
    const at = performance.now();
    setBusy(pick);
    setBusyAt(at);
    setBusyMs(loadExpected('figure', browserStore()));
    setBusyDone(false);
    setError('');
    stopped.current = false;
    const r = await bridge.remakeBody(pick);
    if (!r.ok && stopped.current) {
      setBusy(undefined);
      return;
    }
    if (r.ok) {
      saveDuration('figure', performance.now() - at, browserStore());
      setBusyDone(true);
      await new Promise((done) => setTimeout(done, 520));
      setBusyDone(false);
    }
    setBusy(undefined);
    if (r.ok) {
      setAsk(undefined);
      flash(t('settings.gait.remade', { name: s.petName }));
    } else setError(r.error);
  };
  const walk = (g: Gait) => t(`settings.gait.${g}`);
  const body = (g: Gait) => t(`settings.gait.body.${g}`);
  const odd = !!shape && !!picked && gaitMismatch(picked, shape);

  return (
    <div className="field">
      <span id="gait-label">{t('settings.gait')}</span>
      <fieldset className="segmented" aria-labelledby="gait-label" disabled={!shape || !!busy}>
        {GAIT_PICKS.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={now === g}
            className={now === g && shape ? 'on' : ''}
            onClick={() => choose(g)}
          >
            {t(`settings.gait.${g}`)}
          </button>
        ))}
      </fieldset>
      {!shape ? (
        <small>{why}</small>
      ) : busy ? (
        <div className="notice">
          <MakeProgress
            compact
            task="remake"
            title={t('settings.gait.remaking', { pick: walk(busy) })}
            startedAt={busyAt}
            expectedMs={busyMs}
            image={snap.current?.thumb}
            silhouette
            done={busyDone}
            onStop={() => {
              stopped.current = true;
              bridge.cancelRemake();
            }}
          />
        </div>
      ) : ask ? (
        <div className="notice gait-ask" role="status">
          <small>
            {t('settings.gait.mismatch', { name: s.petName, body: body(shape), pick: walk(ask) })}
          </small>
          <div className="action-row">
            <button type="button" className="primary" onClick={() => void remake(ask)}>
              {t('settings.gait.remake', { pick: walk(ask) })}
            </button>
            <button type="button" className="ghost" onClick={() => void apply(ask)}>
              {t('settings.gait.justSwitch', { pick: walk(ask) })}
            </button>
            <button type="button" className="link" onClick={() => setAsk(undefined)}>
              {t('settings.gait.keep')}
            </button>
          </div>
          <small className="muted">{t('settings.gait.remakeHint')}</small>
          {error && (
            <small className="warn" role="alert">
              {error}
            </small>
          )}
        </div>
      ) : odd && picked ? (
        <div className="action-row">
          <small className="grow">{t('settings.gait.odd', { name: s.petName, body: body(shape) })}</small>
          {canRemake && (
            <button type="button" className="link" onClick={() => setAsk(picked)}>
              {t('settings.gait.remake', { pick: walk(picked) })}
            </button>
          )}
        </div>
      ) : (
        <small>{picked ? t('settings.gait.kept') : t('settings.gait.autoNow', { gait: walk(shape) })}</small>
      )}
      {/* 사진 동물 페어리를 밀크, 초코처럼 네 발로 선 피규어로 (AI 를 다시 부르지 않는다, shared/pet3d/stand.ts) */}
      {figure && s.pet3d && canStand(figure) && (
        <Toggle
          label={t('settings.stand.toggle')}
          hint={t('settings.stand.hint', { name: s.petName })}
          on={pickedStand(s)}
          disabled={!!busy}
          onChange={(v) => {
            const patch = standPatch(s, v);
            if (patch) void update(patch);
          }}
        />
      )}
    </div>
  );
}
