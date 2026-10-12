import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import type { SettingsSnapshot } from '../../../shared/ipc.ts';
import type { Gait } from '../../../shared/pet3d/blueprint.ts';
import { canStand, oddBody } from '../../../shared/pet3d/stand.ts';
import {
  GAIT_PICKS,
  type GaitPick,
  gaitPatch,
  pickedStand,
  type Settings,
  standPatch,
  starterStand,
} from '../../../shared/settings.ts';
import { MakeProgress } from '../MakeProgress.tsx';
import { browserStore, loadExpected, saveDuration } from '../make-progress.ts';
import { gaitMismatch } from '../pet3d-gait.ts';
import { gaitView } from './gait-view.ts';
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
  // 몸 모양, 네 발로 선 몸인지, 고른 값, 켜져 보일 단추 (settings/gait-view.ts). 네 발로 선 몸은 흐린 채 "네 발"이 켜진다
  const { shape, stands, picked, on } = gaitView(s, figure);
  // 밀크, 초코 그림이면 네 발로 선 피규어를 켰는지 (기본 꺼짐, 사진 그대로). 다른 펫이면 undefined
  const starter = starterStand(s);
  const why = shape
    ? ''
    : stands
      ? t('settings.gait.stand', { name: s.petName })
      : starter === false
        ? t('settings.gait.starterPhoto', { name: s.petName })
        : figure
          ? t('settings.gait.off3d')
          : t('settings.gait.flat');
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
  // 네 발로 서기를 켜는 등으로 고를 수 없게 되면 묻던 것도 접는다 (나중에 끄면 옛 물음이 다시 뜨지 않게)
  useEffect(() => {
    if (!shape) setAsk(undefined);
  }, [shape]);
  // 물음이 뜨면 단추 바로 아래 물음 칸이 보이게 (설정 창 아래쪽이라 가려져 눌러도 안 된 것처럼 보였다, #28)
  const askRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ask) askRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [ask]);

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
  // 아직 바뀌지 않고 물어보거나 다시 만드는 중인 걸음새
  const pending = shape ? (busy ?? ask) : undefined;

  return (
    <div className="field">
      <span id="gait-label">{t('settings.gait')}</span>
      <fieldset className="segmented" aria-labelledby="gait-label" disabled={!shape || !!busy}>
        {GAIT_PICKS.map((g) => (
          <button
            key={g}
            type="button"
            // 켜진 단추는 펫이 실제로 걷는 걸음새 (네 발로 선 몸은 흐린 채 네 발). 물어보는 중인 단추는 점선 테두리로
            aria-pressed={on === g}
            aria-describedby={pending === g ? 'gait-ask' : undefined}
            className={[on === g ? 'on' : '', pending === g ? 'pending' : ''].join(' ').trim() || undefined}
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
        <div ref={askRef} id="gait-ask" className="notice gait-ask" role="status" aria-live="polite">
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
      {/* 뼈대에 맞지 않는 몸의 사진 동물(토끼, 햄스터)은 끈 채로 흐리게 두고 이유를 적는다. 코 없는 캐릭터는 숨긴 그대로 */}
      {figure && s.pet3d && (canStand(figure) || (oddBody(figure) && figure.face.nose?.shape !== 'none')) && (
        <Toggle
          label={t('settings.stand.toggle')}
          hint={t(canStand(figure) ? 'settings.stand.hint' : 'settings.stand.odd', { name: s.petName })}
          on={pickedStand(s) && canStand(figure)}
          disabled={!!busy || !canStand(figure)}
          onChange={(v) => {
            const patch = standPatch(s, v);
            if (patch) void update(patch);
          }}
        />
      )}
      {/* 밀크, 초코: 기본은 사진 그대로, 켜면 앱에 든 네 발 피규어 (0.4.1 사용자 결정, shared/pet3d/starters.ts starterFigureOf) */}
      {starter !== undefined && (
        <Toggle
          label={t('settings.stand.starter')}
          hint={t('settings.stand.starterHint', { name: s.petName })}
          on={starter}
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
