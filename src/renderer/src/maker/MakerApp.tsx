import { type ClipboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/index.ts';
import {
  AGE_STAGES,
  type AgeStage,
  COMPARE_SIDE,
  DEFAULT_AGE,
  ILLUST_WISH_MAX,
  nearlySame,
  toGray,
} from '../../../shared/illustrate.ts';
import { DEPTH_URL, type MakerInfo, MODEL_URL, type PetLook } from '../../../shared/ipc.ts';
import { contentBox, keptRatio, stroke } from '../../../shared/mask.ts';
import type { Blueprint } from '../../../shared/pet3d/blueprint.ts';
import { cleanWish, WISH_MAX } from '../../../shared/pet3d/prompt.ts';
import {
  cleanPetName,
  GAIT_PICKS,
  type GaitPick,
  PET_NAME_MAX,
  POSE_KINDS,
} from '../../../shared/settings.ts';
import { CANVAS_SIZE } from '../draw.ts';
import { MakeProgress, type ProgressStage } from '../MakeProgress.tsx';
import { browserStore, loadExpected, saveDuration } from '../make-progress.ts';
import { PetNameInput } from '../PetNameInput.tsx';
import { Pet3D } from '../pet3d.ts';
import { openDepth, predictDepth } from './depth.ts';
import { backend, modelOpen, openModel, predictMask } from './removeBg.ts';
import { ShownError, shownErrorText } from './shown-error.ts';
import { FIGURE_LIMITS, RELIEF_LIMITS, Spinner } from './spin.ts';

const bridge = window.jjakkungMaker;
/** 다듬는 동안의 사진 크기 (긴 변). 모델 입력(1024)과 같게. */
const WORK_SIDE = 1024;
/** 펫으로 저장할 그림 크기 (긴 변) */
const OUT_SIDE = 512;
const UNDO_LIMIT = 20;
/** 요청사항 칸 아래 예시 (눌러서 더한다) */
const WISH_CHIPS = ['sleepy', 'sparkle', 'chubby', 'tail', 'ribbon', 'calm'] as const;
/** 끝나면 100% 와 "다 됐어"를 이만큼 보여 주고 다음 화면으로 */
const DONE_MS = 520;
/** 진행 표시에 쓰는 사진 크기 (긴 변, 190px 판의 두 배) */
const THUMB_SIDE = 380;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 지난번 걸린 시간을 두는 곳 (못 쓰면 기본 예상 시간) */
const store = browserStore;

type Step = 'pick' | 'illust' | 'model' | 'working' | 'edit' | 'name' | 'saving' | 'done';

/** AI 일러스트 한 번: 고른 사진(원본 파일, 보낼 JPEG, 진행 판 사진), 받은 그림, 그린 나이, 그리는 중인지 */
interface Illust {
  file: Blob;
  photo: string;
  thumb: string;
  image: string;
  age: AgeStage;
  busy: boolean;
  at: number;
}

interface Work {
  photo: HTMLCanvasElement;
  mask: Uint8ClampedArray;
  w: number;
  h: number;
}

export function MakerApp() {
  const [info, setInfo] = useState<MakerInfo>();
  const [step, setStep] = useState<Step>('pick');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [work, setWork] = useState<Work>();
  const [name, setName] = useState('');
  /** 이름이 12자를 넘어 뒤를 뗐을 때 한 줄 */
  const [nameNote, setNameNote] = useState('');
  const [preview, setPreview] = useState('');
  const [elapsed, setElapsed] = useState(0);
  // 진행 표시: 지금 단계를 시작한 때, 진행 판에 보일 사진, 이번에 모델을 받았는지, 끝나서 100% 를 보여 주는 중인지
  const [stageAt, setStageAt] = useState(0);
  const [thumb, setThumb] = useState('');
  const [fetched, setFetched] = useState(false);
  const [bgDone, setBgDone] = useState(false);
  const [cutoutMs, setCutoutMs] = useState(0);
  // 그만두기 뒤 한 줄 (오류가 아니라 부드러운 안내)
  const [note, setNote] = useState('');
  // 사진 고르기부터 다듬기 전까지 한 번의 시도. 그만두면 번호가 바뀌어 늦게 온 결과를 버린다
  const runRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // 입체로 만들기 (6단계): AI 가 사진을 보고 설계도를 만든다
  // 2.5D (6단계): 사진을 볼 AI 가 없어도 이 창 안에서 깊이를 재서 사진을 입체 판으로
  const [look, setLook] = useState<'photo' | 'figure' | 'relief'>('photo');
  const [model, setModel] = useState<Blueprint>();
  const [depth, setDepth] = useState('');
  const [shaping, setShaping] = useState(false);
  // 입체 피규어 요청사항 (선택). 만든 뒤 고쳐서 다시 만들 수 있게 마지막으로 보낸 요청을 기억한다
  const [wish, setWish] = useState('');
  // 걸음새: 자동이면 AI 가 사진을 보고, 두 발이나 네 발이면 처음부터 그 몸으로 만든다
  const [gait, setGait] = useState<GaitPick>('auto');
  // 지금 설계도를 만든 요청사항과 걸음새 (바꾸면 단추가 "요청대로 다시 만들기", 저장하면 요청사항을 같이 둔다)
  const [madeWith, setMadeWith] = useState<{ wish: string; gait: GaitPick }>();
  // 입체 만들기 진행: 무엇을(AI 피규어, 2.5D 받기, 2.5D 깊이 재기), 언제 시작했는지, 예상 시간, 끝났는지
  const [shapeTask, setShapeTask] = useState<'figure' | 'reliefDownload' | 'relief'>('figure');
  const [shapeAt, setShapeAt] = useState(0);
  const [shapeMs, setShapeMs] = useState(0);
  const [shapeDone, setShapeDone] = useState(false);
  // 이번 2.5D 에서 깊이 모델을 받았는지 (받았으면 받기와 깊이 재기 두 단계 점)
  const [fetchedDepth, setFetchedDepth] = useState(false);
  const shapeRun = useRef(0);
  // AI 일러스트로 다시 그리기 (2026-10-09): 고르면 사진을 Hugging Face 무료 서버로 보낸다 (펫 본 그림만)
  const [how, setHow] = useState<'photo' | 'illust'>('photo');
  const [age, setAge] = useState<AgeStage>(DEFAULT_AGE);
  const [illustWish, setIllustWish] = useState('');
  const [illust, setIllust] = useState<Illust>();
  const [illustMs, setIllustMs] = useState(0);
  // 이번 펫 그림이 일러스트에서 왔으면 그 나이 (저장할 때 같이 둔다)
  const [madeAge, setMadeAge] = useState<AgeStage>();
  // 일러스트를 받아들이면 다듬기 뒤 2.5D 를 저절로 만든다
  const autoRelief = useRef(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [tokenNote, setTokenNote] = useState('');

  useEffect(() => {
    bridge.info().then((i) => {
      setInfo(i);
      // 이름 칸은 비워 둔다: 지금 펫 이름을 미리 채우면 보관함에 같은 이름이 쌓였다. 비우면 newPetName 이 붙는다
      setName('');
      // AI 확인(CLI 상태)은 몇 초 걸릴 수 있어 따로 받는다. 그동안 사진 고르기는 막지 않는다
      void bridge.visionAi().then((visionAi) => setInfo((v) => v && { ...v, visionAi }));
    });
    bridge.onProgress(setProgress);
    if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
  }, []);

  const isFood = info?.target === 'food';
  const isPose = !!info && info.target !== 'main' && !isFood;
  const poseLabel = POSE_KINDS.find((p) => p.id === info?.target)?.label ?? '';
  const [animated, setAnimated] = useState(false);
  /** 입체로 만들기는 펫 본 그림(움직이지 않는 사진)에만 */
  const can3d = info?.target === 'main' && !animated;
  const isMain = info?.target === 'main';

  /** 일러스트 그리기 (처음, 다시 그리기). 받은 그림이 보낸 사진과 거의 같으면 실패로 (그대로 돌려준 답) */
  const drawIllust = useCallback(async (photo: string, a: AgeStage, wishText: string) => {
    const run = ++runRef.current;
    const at = performance.now();
    setError('');
    setNote('');
    setIllustMs(loadExpected('illust', store()));
    setIllust((v) => v && { ...v, image: '', age: a, busy: true, at });
    const r = await bridge.illustrate(photo, a, cleanWish(wishText).slice(0, ILLUST_WISH_MAX) || undefined);
    if (runRef.current !== run) return;
    if (r.ok && !(await sameAsPhoto(photo, r.image))) {
      if (runRef.current !== run) return;
      saveDuration('illust', performance.now() - at, store());
      setIllust((v) => v && { ...v, image: r.image, busy: false });
      return;
    }
    if (runRef.current !== run) return;
    setError(r.ok ? t('maker.illust.same') : r.error);
    setIllust((v) => v && { ...v, busy: false });
  }, []);

  const start = useCallback(
    async (file: Blob, opts: { age?: AgeStage; plain?: boolean } = {}) => {
      if (!info) return;
      setError('');
      setNote('');
      const run = ++runRef.current;
      const alive = () => runRef.current === run;
      try {
        // 움직이는 그림(gif, webp 여러 장)은 배경을 지우지 않고 그대로 쓴다 (v1).
        if (await isAnimated(file)) {
          if (!alive()) return;
          if (file.size > ANIMATED_MAX) throw new ShownError(t('maker.err.animatedTooBig'));
          setAnimated(true);
          setMadeAge(undefined);
          autoRelief.current = false;
          // 앞 사진으로 만든 입체 모습은 버린다 (움직이는 그림은 입체로 만들지 않는다)
          setLook('photo');
          setModel(undefined);
          setDepth('');
          setPreview(await toDataUrl(file));
          setStep('name');
          return;
        }
        setAnimated(false);
        const photo = await loadPhoto(file);
        if (!alive()) return;
        // AI 일러스트: 사진을 JPEG 로 보내 그림을 받고, 사용자가 고르면 그 그림으로 다시 시작한다
        if (how === 'illust' && info.target === 'main' && !opts.plain && !opts.age) {
          const jpeg = photo.toDataURL('image/jpeg', 0.92);
          setIllust({ file, photo: jpeg, thumb: thumbOf(photo), image: '', age, busy: true, at: 0 });
          setStep('illust');
          await drawIllust(jpeg, age, illustWish);
          return;
        }
        setMadeAge(opts.age);
        autoRelief.current = !!opts.age;
        setThumb(thumbOf(photo));
        // 받을 모델이 있으면 받기부터 (진짜 진행률), 있으면 바로 배경 지우기 (해시 맞춰 보기도 여기에 넣는다)
        const download = !info.modelReady;
        setFetched(download);
        setProgress(0);
        setBgDone(false);
        setCutoutMs(loadExpected('cutout', store()));
        let cutStart = performance.now();
        setStageAt(cutStart);
        setStep(download ? 'model' : 'working');
        const r = await bridge.ensureModel();
        if (!alive()) return;
        if (!r.ok) throw new ShownError(r.error);
        setInfo((v) => v && { ...v, modelReady: true });
        if (download) {
          cutStart = performance.now();
          setStageAt(cutStart);
          setStep('working');
        }
        if (!modelOpen()) {
          const res = await fetch(MODEL_URL);
          if (!res.ok) throw new ShownError(t('maker.err.modelRead'));
          await openModel(await res.arrayBuffer());
        }
        if (!alive()) return;
        const t0 = performance.now();
        const mask = await predictMask(photo, info);
        if (!alive()) return;
        setElapsed(Math.round(performance.now() - t0));
        saveDuration('cutout', performance.now() - cutStart, store());
        setWork({ photo, mask, w: photo.width, h: photo.height });
        setBgDone(true);
        await sleep(DONE_MS);
        if (!alive()) return;
        setBgDone(false);
        setStep('edit');
      } catch (err) {
        if (!alive()) return;
        setError(shownErrorText(err, t('maker.err.bgFailed')));
        setStep('pick');
      }
    },
    [info, how, age, illustWish, drawIllust],
  );

  /** 일러스트 그리기를 그만둔다 (메인이 멈춘다). 사진은 그대로 두고 다시 그리거나 사진 그대로 쓸 수 있다 */
  const stopIllust = () => {
    runRef.current++;
    bridge.cancel();
    setIllust((v) => v && { ...v, busy: false });
    setError('');
    setNote(t('maker.progress.stopped'));
  };

  /** 받은 일러스트로 배경 지우기부터 */
  const acceptIllust = async () => {
    if (!illust?.image) return;
    const blob = await (await fetch(illust.image)).blob();
    await start(blob, { age: illust.age });
  };

  const saveToken = async (token: string | null) => {
    const r = await bridge.setHfToken(token);
    setInfo((v) => v && { ...v, hfToken: r.has });
    if (r.ok) setTokenDraft('');
    setTokenNote(
      r.ok ? (token ? t('maker.illust.token.saved') : t('maker.illust.token.removed')) : (r.error ?? ''),
    );
  };

  // 창 어디에 끌어다 놓거나 붙여 넣어도 시작한다.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f && step === 'pick') start(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [start, step]);

  const onPaste = (e: ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
    if (f && step === 'pick') start(f);
  };

  /** 받기나 배경 지우기를 그만둔다. 받기는 메인이 멈추고, 지우기는 결과를 버린다 */
  const stopPhoto = () => {
    runRef.current++;
    bridge.cancel();
    setBgDone(false);
    setError('');
    setNote(t('maker.progress.stopped'));
    setStep('pick');
  };

  const toName = () => {
    if (!work) return;
    const url = cutout(work);
    if (!url) {
      setError(t('maker.err.allErased'));
      return;
    }
    setError('');
    setPreview(url);
    setModel(undefined);
    setDepth('');
    // 일러스트에서 왔으면 2.5D 를 골라 두고 저절로 만든다 (아래 효과)
    if (autoRelief.current) setLook('relief');
    setStep('name');
  };

  // 만드는 사이 사진을 다시 다듬었으면 옛 결과는 버린다
  const previewRef = useRef(preview);
  previewRef.current = preview;

  /** 입체 만들기 진행 표시를 (다시) 시작한다. 번호(shapeRun)가 바뀌면(그만두기) 늦게 온 결과를 버린다 */
  const beginShape = (task: 'figure' | 'reliefDownload' | 'relief') => {
    setShapeTask(task);
    setShapeAt(performance.now());
    setShapeMs(loadExpected(task === 'figure' ? 'figure' : 'relief', store()));
    setShapeDone(false);
  };

  /** 다 됐으면 100% 를 잠깐 보여 주고 결과를 놓는다. 그사이 그만뒀으면 false */
  const finishShape = async (run: number) => {
    setShapeDone(true);
    await sleep(DONE_MS);
    setShapeDone(false);
    return shapeRun.current === run;
  };

  /** 입체 만들기를 그만둔다. AI 에 묻던 것과 받던 깊이 모델은 메인이 멈춘다 */
  const stopShape = () => {
    shapeRun.current++;
    bridge.cancel();
    setShaping(false);
    setShapeDone(false);
    setError('');
    setNote(t('maker.progress.stopped'));
  };

  const shape = async () => {
    if (shaping) return;
    const from = preview;
    const asked = cleanWish(wish);
    const walk = gait;
    const run = ++shapeRun.current;
    setShaping(true);
    setError('');
    setNote('');
    const at = performance.now();
    beginShape('figure');
    const r = await bridge.shape3d(from, asked, walk === 'auto' ? undefined : walk);
    if (shapeRun.current !== run) return;
    if (r.ok && previewRef.current === from) {
      saveDuration('figure', performance.now() - at, store());
      if (!(await finishShape(run))) return;
    }
    setShaping(false);
    if (previewRef.current !== from) return;
    if (r.ok) {
      setModel(r.model);
      setMadeWith({ wish: asked, gait: walk });
    } else setError(r.error);
  };

  /** 예시를 눌러 칸 끝에 더한다. 이미 있으면 뺀다. 칸 상한을 넘으면 더하지 않는다 */
  const toggleChip = (chip: string) => {
    const now = wish.trim();
    if (now.includes(chip)) {
      setWish(
        now
          .split(chip)
          .join('')
          .replace(/\s*,(\s*,)+/g, ',')
          .replace(/^[,\s]+|[,\s]+$/g, ''),
      );
      return;
    }
    const next = now ? `${now.replace(/[,.\s]+$/, '')}, ${chip}` : chip;
    if (next.length <= WISH_MAX) setWish(next);
  };

  const makeRelief = async () => {
    if (!info || shaping) return;
    const from = preview;
    const run = ++shapeRun.current;
    const alive = () => shapeRun.current === run;
    setShaping(true);
    setError('');
    setNote('');
    setProgress(0);
    // 깊이 모델이 없으면 받기(진짜 진행률)부터, 있으면 바로 깊이 재기
    setFetchedDepth(!info.depth.ready);
    beginShape(info.depth.ready ? 'relief' : 'reliefDownload');
    try {
      const r = await bridge.ensureDepth();
      if (!alive()) return;
      if (!r.ok) throw new ShownError(r.error);
      setInfo((v) => v && { ...v, depth: { ...v.depth, ready: true } });
      beginShape('relief');
      const at = performance.now();
      const res = await fetch(DEPTH_URL);
      if (!res.ok) throw new ShownError(t('maker.err.modelRead'));
      await openDepth(await res.arrayBuffer());
      const d = await predictDepth(await loadImage(from), info.depth);
      if (!alive()) return;
      saveDuration('relief', performance.now() - at, store());
      if (previewRef.current === from && !(await finishShape(run))) return;
      if (previewRef.current === from) setDepth(d);
      setShaping(false);
    } catch (err) {
      if (!alive()) return;
      setError(shownErrorText(err, t('maker.err.depthFailed')));
      setShaping(false);
    }
  };

  // 일러스트를 받아들인 뒤 처음 이름 단계에 오면 2.5D 를 한 번 만든다
  // biome-ignore lint/correctness/useExhaustiveDependencies: makeRelief 는 렌더마다 새로 만들어져 넣지 않는다
  useEffect(() => {
    if (step !== 'name' || !autoRelief.current || look !== 'relief' || depth || shaping || !preview) return;
    autoRelief.current = false;
    void makeRelief();
  }, [step, look, depth, shaping, preview]);

  const chosen: PetLook | undefined =
    look === 'figure' && model
      ? { model, ...(madeWith?.wish ? { wish: madeWith.wish } : {}) }
      : look === 'relief' && depth
        ? { depth }
        : undefined;

  const canSave = step === 'name' && !shaping && (look === 'photo' || !!chosen);

  const save = async () => {
    // Enter 로도 오니 단추와 같은 조건을 본다 (만드는 중 Enter 가 평면으로 저장했다)
    if (!canSave) return;
    setStep('saving');
    // 일러스트로 만든 펫은 나이 단계를 같이 (보관함 표시, 화면 크기)
    const r = await bridge.save(
      preview,
      name,
      madeAge && !animated ? { ...(chosen ?? {}), age: madeAge } : chosen,
    );
    if (!r.ok) {
      setError(r.error ?? t('maker.err.saveFailed'));
      setStep('name');
      return;
    }
    setStep('done');
    setTimeout(() => bridge.close(), 1400);
  };

  // 무료 Hugging Face 토큰 칸 (고르기 화면, 쿼터에 걸린 뒤 그림 화면). 토큰 글은 메인에만 있고 창은 있는지만 안다
  const tokenBox = (
    <details className="token" open={step === 'illust' && !!error && !illust?.image}>
      <summary>
        {t('maker.illust.token.summary')}
        {info?.hfToken && <span className="token-on"> ✓</span>}
      </summary>
      <small className="hint">{t('maker.illust.token.how')}</small>
      {info?.hfToken ? (
        <div className="token-row">
          <span className="hint">{t('maker.illust.token.has')}</span>
          <button type="button" className="ghost" onClick={() => saveToken(null)}>
            {t('maker.illust.token.remove')}
          </button>
        </div>
      ) : (
        <div className="token-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('maker.illust.token.label')}
            placeholder={t('maker.illust.token.placeholder')}
            value={tokenDraft}
            maxLength={200}
            onChange={(e) => setTokenDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tokenDraft.trim()) saveToken(tokenDraft);
            }}
          />
          <button
            type="button"
            className="ghost"
            disabled={!tokenDraft.trim()}
            onClick={() => saveToken(tokenDraft)}
          >
            {t('maker.illust.token.save')}
          </button>
        </div>
      )}
      {tokenNote && (
        <small className="hint" role="status">
          {tokenNote}
        </small>
      )}
    </details>
  );

  // 사진 단계 진행 점: (받았으면) 도구 받기, 배경 지우기, 다듬기
  const photoStages: ProgressStage[] = [
    ...(fetched
      ? [{ label: t('maker.progress.stage.download'), state: step === 'model' ? 'now' : 'done' } as const]
      : []),
    {
      label: t('maker.progress.stage.cutout'),
      state: step === 'model' ? 'next' : bgDone ? 'done' : 'now',
    },
    { label: t('maker.progress.stage.edit'), state: 'next' },
  ];

  const steps: [Step[], string][] = [
    [['pick', 'illust', 'model', 'working'], t('maker.step.photo')],
    [['edit'], t('maker.step.edit')],
    [['name', 'saving', 'done'], isPose ? t('maker.step.confirm') : t('maker.step.name')],
  ];
  const title = isFood
    ? t('maker.title.food')
    : isPose
      ? t('maker.title.pose', { pose: poseLabel })
      : t('maker.title.pet');

  return (
    <div className="maker" onPaste={onPaste}>
      <header>
        <strong>{title}</strong>
        <ol className="steps">
          {steps.map(([group, label], i) => (
            <li key={label} className={group.includes(step) ? 'on' : ''}>
              <span>{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      <main>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {note && !error && (
          <p className="note" role="status">
            {note}
          </p>
        )}

        {step === 'pick' && (
          <section className="pick">
            {isMain && (
              <div className="how">
                <fieldset className="segmented" aria-label={t('maker.how.label')}>
                  {(['photo', 'illust'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={how === k}
                      className={how === k ? 'on' : ''}
                      onClick={() => setHow(k)}
                    >
                      {t(`maker.how.${k}`)}
                    </button>
                  ))}
                </fieldset>
                {how === 'illust' && (
                  <div className="wish illust-opts">
                    <small className="hint">{t('maker.illust.hint')}</small>
                    {/* 사진을 고르기 전에 보이게: 이걸 고르면 사진이 밖으로 나간다 */}
                    <p className="privacy out">{t('maker.illust.privacy')}</p>
                    <AgePicker age={age} onAge={setAge} />
                    <label className="wish-label" htmlFor="maker-illust-wish">
                      {t('maker.illust.wish')} <small>{t('maker.wish.optional')}</small>
                    </label>
                    <div className="wish-box">
                      <input
                        id="maker-illust-wish"
                        value={illustWish}
                        maxLength={ILLUST_WISH_MAX}
                        placeholder={t('maker.illust.wishPlaceholder')}
                        onChange={(e) => setIllustWish(e.target.value)}
                      />
                      <span className="wish-count" aria-hidden="true">
                        {t('maker.wish.count', { n: illustWish.length, max: ILLUST_WISH_MAX })}
                      </span>
                    </div>
                    {tokenBox}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className={`drop${isMain ? ' short' : ''}`}
              onClick={() => fileRef.current?.click()}
            >
              <span className="big">{t('maker.pick.title')}</span>
              <span>{t('maker.pick.how')}</span>
              <span className="hint">
                {isFood
                  ? t('maker.pick.food', { cost: info?.foodCost ?? 50 })
                  : isPose
                    ? t('maker.pick.pose', { pose: poseLabel })
                    : t('maker.pick.pet')}
              </span>
              <span className="hint">{t('maker.pick.animated')}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) start(f);
                e.target.value = '';
              }}
            />
            {/* 일러스트 안내는 위 옵션 칸에 있다. 그 밖에는 사진이 이 컴퓨터를 떠나지 않는다 */}
            {!(isMain && how === 'illust') && <p className="privacy">{t('maker.pick.privacy')}</p>}
            {!isFood && (isPose ? info?.hasPose : info?.hasPhotoPet) && (
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  await bridge.resetToDefault();
                  setInfo((v) => v && { ...v, hasPhotoPet: isPose ? v.hasPhotoPet : false, hasPose: false });
                }}
              >
                {isPose ? t('maker.pick.removePose') : t('maker.pick.resetPet')}
              </button>
            )}
          </section>
        )}

        {step === 'illust' && illust && (
          <section className="illust">
            {illust.busy ? (
              <MakeProgress
                task="illust"
                title={t('maker.illust.working')}
                startedAt={illust.at}
                expectedMs={illustMs}
                image={illust.thumb}
                onStop={stopIllust}
              />
            ) : (
              <>
                {illust.image && <p className="illust-title">{t('maker.illust.preview')}</p>}
                <div className="illust-pair">
                  <figure className="before">
                    <img src={illust.thumb} alt="" />
                    <figcaption>{t('maker.illust.before')}</figcaption>
                  </figure>
                  {illust.image && (
                    <figure className="after">
                      <img src={illust.image} alt={t('maker.illust.after')} />
                      <figcaption>
                        {t('maker.illust.after')}, {t(`maker.illust.age.${illust.age}`)}
                      </figcaption>
                    </figure>
                  )}
                </div>
                <AgePicker age={age} onAge={setAge} />
                {illust.image && <p className="hint">{t('maker.illust.next')}</p>}
                {!illust.image && <div className="how">{tokenBox}</div>}
                <div className="actions wrap">
                  <button type="button" className="ghost" onClick={() => setStep('pick')}>
                    {t('maker.illust.otherPhoto')}
                  </button>
                  <button type="button" className="ghost" onClick={() => start(illust.file, { plain: true })}>
                    {t('maker.illust.usePhoto')}
                  </button>
                  <button
                    type="button"
                    className={illust.image ? 'ghost' : 'primary'}
                    onClick={() => drawIllust(illust.photo, age, illustWish)}
                  >
                    {illust.image && illust.age !== age
                      ? t(`maker.illust.againAs.${age}`)
                      : t('maker.illust.again')}
                  </button>
                  {illust.image && (
                    <button type="button" className="primary" onClick={acceptIllust}>
                      {t('maker.illust.accept')}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {(step === 'model' || step === 'working') && (
          <section className="busy">
            <MakeProgress
              // 단계가 바뀌면 시간을 새로 센다
              key={step}
              task={step === 'model' ? 'download' : 'cutout'}
              title={
                step === 'model'
                  ? t('maker.model.downloading', { mb: info?.modelMB ?? 0 })
                  : t('maker.working.title')
              }
              startedAt={stageAt}
              ratio={step === 'model' ? progress : undefined}
              totalMb={step === 'model' ? info?.modelMB : undefined}
              expectedMs={cutoutMs}
              image={thumb}
              stages={photoStages}
              done={bgDone}
              onStop={stopPhoto}
            />
          </section>
        )}

        {step === 'edit' && work && (
          <Editor
            work={work}
            note={t('maker.edit.took', { backend, sec: (elapsed / 1000).toFixed(1) })}
            onBack={() => setStep('pick')}
            onNext={toName}
          />
        )}

        {(step === 'name' || step === 'saving' || step === 'done') && (
          <section className="name">
            {shaping ? (
              <MakeProgress
                key={shapeTask}
                task={
                  shapeTask === 'figure' ? 'figure' : shapeTask === 'reliefDownload' ? 'download' : 'relief'
                }
                title={
                  shapeTask === 'figure'
                    ? t('maker.3d.working')
                    : shapeTask === 'reliefDownload'
                      ? t('maker.relief.downloading', { mb: info?.depth.mb ?? 27 })
                      : t('maker.relief.working')
                }
                startedAt={shapeAt}
                ratio={shapeTask === 'reliefDownload' ? progress : undefined}
                totalMb={shapeTask === 'reliefDownload' ? info?.depth.mb : undefined}
                expectedMs={shapeMs}
                image={preview}
                silhouette
                stages={
                  shapeTask !== 'figure' && fetchedDepth
                    ? [
                        {
                          label: t('maker.progress.stage.download'),
                          state: shapeTask === 'reliefDownload' ? 'now' : 'done',
                        },
                        {
                          label: t('maker.progress.stage.depth'),
                          state: shapeTask === 'relief' ? (shapeDone ? 'done' : 'now') : 'next',
                        },
                      ]
                    : undefined
                }
                done={shapeDone}
                onStop={stopShape}
              />
            ) : (
              <div className="stage">
                {look === 'figure' && model ? (
                  <Spin3D model={model} interactive={step === 'name'} />
                ) : look === 'relief' && depth ? (
                  <Spin3D photo={preview} depth={depth} interactive={step === 'name'} />
                ) : (
                  <img className="bounce" src={preview} alt={t('maker.name.alt')} />
                )}
              </div>
            )}
            {animated && step === 'name' && <p className="hint">{t('maker.name.animatedNote')}</p>}
            {can3d && step === 'name' && (
              <div className="look3d">
                <fieldset className="segmented" aria-label={t('maker.3d.look')}>
                  {(info?.visionAi
                    ? (['photo', 'figure', 'relief'] as const)
                    : (['photo', 'relief'] as const)
                  ).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={look === k}
                      className={look === k ? 'on' : ''}
                      disabled={shaping}
                      onClick={() => setLook(k)}
                    >
                      {k === 'photo'
                        ? t('maker.3d.photo')
                        : k === 'figure'
                          ? t('maker.3d.figure')
                          : t('maker.3d.relief')}
                    </button>
                  ))}
                </fieldset>
                {look === 'photo' && (
                  <p className="hint">
                    {info?.visionAi ? t('maker.3d.photoNote') : t('maker.3d.photoNoteRelief')}
                  </p>
                )}
                {look === 'relief' && (
                  <>
                    {/* 만드는 중에는 진행 표시가 같은 말을 한다 */}
                    {!shaping && (
                      <p className="hint">
                        {depth
                          ? t('maker.relief.ready')
                          : t('maker.relief.hint', { mb: info?.depth.mb ?? 27 })}
                      </p>
                    )}
                    {!shaping && !depth && (
                      <button type="button" className="ghost" onClick={makeRelief}>
                        {t('maker.relief.make')}
                      </button>
                    )}
                  </>
                )}
                {look === 'figure' && (
                  <>
                    {!shaping && <p className="hint">{model ? t('maker.3d.ready') : t('maker.3d.hint')}</p>}
                    <div className="wish">
                      <div className="gait-row">
                        <span className="wish-label" id="maker-gait">
                          {t('maker.gait.label')}
                        </span>
                        <fieldset className="segmented" aria-labelledby="maker-gait">
                          {GAIT_PICKS.map((g) => (
                            <button
                              key={g}
                              type="button"
                              aria-pressed={gait === g}
                              className={gait === g ? 'on' : ''}
                              disabled={shaping}
                              onClick={() => setGait(g)}
                            >
                              {t(`maker.gait.${g}`)}
                            </button>
                          ))}
                        </fieldset>
                      </div>
                      <small className="hint">{t(`maker.gait.${gait}Hint`)}</small>
                      <label className="wish-label" htmlFor="maker-wish">
                        {t('maker.wish.label')} <small>{t('maker.wish.optional')}</small>
                      </label>
                      <div className="wish-box">
                        <input
                          id="maker-wish"
                          value={wish}
                          maxLength={WISH_MAX}
                          placeholder={t('maker.wish.placeholder')}
                          disabled={shaping}
                          aria-describedby="maker-wish-note"
                          onChange={(e) => setWish(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              void shape();
                            }
                          }}
                        />
                        <span className="wish-count" aria-hidden="true">
                          {t('maker.wish.count', { n: wish.length, max: WISH_MAX })}
                        </span>
                      </div>
                      <fieldset className="chips" aria-label={t('maker.wish.chips')}>
                        {WISH_CHIPS.map((id) => {
                          const chip = t(`maker.wish.chip.${id}`);
                          const on = wish.includes(chip);
                          return (
                            <button
                              key={id}
                              type="button"
                              className={`chip${on ? ' on' : ''}`}
                              aria-pressed={on}
                              disabled={shaping}
                              onClick={() => toggleChip(chip)}
                            >
                              {on ? '✓ ' : '+ '}
                              {chip}
                            </button>
                          );
                        })}
                      </fieldset>
                      <small id="maker-wish-note" className="hint">
                        {t('maker.wish.note')}
                      </small>
                    </div>
                    {!shaping && (
                      <button type="button" className="ghost" onClick={shape}>
                        {!model
                          ? t('maker.3d.make')
                          : cleanWish(wish) !== madeWith?.wish || gait !== madeWith.gait
                            ? t('maker.wish.remake')
                            : t('maker.3d.again')}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {step === 'done' ? (
              <p className="done">
                {isFood
                  ? t('maker.done.food', { name: name.trim() })
                  : isPose
                    ? t('maker.done.pose', { pose: poseLabel })
                    : t('maker.done.pet', {
                        name: cleanPetName(name) || info?.newPetName || t('common.appName'),
                      })}
              </p>
            ) : (
              <>
                {isFood ? (
                  <label>
                    {t('maker.name.foodLabel')}
                    <input
                      value={name}
                      maxLength={PET_NAME_MAX * 2}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
                      }}
                    />
                  </label>
                ) : (
                  <label hidden={isPose}>
                    {t('maker.name.label')}
                    <PetNameInput
                      value={name}
                      placeholder={info?.newPetName}
                      onValue={(v) => {
                        setName(v);
                        setNameNote('');
                      }}
                      onLimit={() => setNameNote(t('maker.name.max', { max: PET_NAME_MAX }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
                      }}
                    />
                  </label>
                )}
                {!isPose && !isFood && (
                  <p className="hint" role="status">
                    {nameNote || t('maker.name.blankHint', { name: info?.newPetName ?? '' })}
                  </p>
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="ghost"
                    disabled={shaping}
                    onClick={() => setStep(animated ? 'pick' : 'edit')}
                  >
                    {animated ? t('maker.name.otherImage') : t('maker.name.reedit')}
                  </button>
                  <button type="button" className="primary" disabled={!canSave} onClick={save}>
                    {step === 'saving'
                      ? t('maker.name.saving')
                      : isFood
                        ? t('maker.name.makeFood', { cost: info?.foodCost ?? 50 })
                        : isPose
                          ? t('maker.name.usePose')
                          : t('maker.name.choosePet')}
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

/** 나이 고르기 (아기, 청소년, 어른) */
function AgePicker({ age, onAge }: { age: AgeStage; onAge: (a: AgeStage) => void }) {
  return (
    <>
      <div className="gait-row">
        <span className="wish-label" id="maker-age">
          {t('maker.illust.age')}
        </span>
        <fieldset className="segmented" aria-labelledby="maker-age">
          {AGE_STAGES.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={age === a}
              className={age === a ? 'on' : ''}
              onClick={() => onAge(a)}
            >
              {t(`maker.illust.age.${a}`)}
            </button>
          ))}
        </fieldset>
      </div>
      <small className="hint">{t(`maker.illust.ageHint.${age}`)}</small>
    </>
  );
}

let previewPet: Pet3D | undefined;

/** 미리보기 판(220px)에 펫 캔버스(160)를 이만큼 줄여 그린다. 옆으로 돌면 긴 몸이 판 밖으로 잘려서 */
const SPIN_ZOOM = 0.88;
/** 움직일 때와 멈춰 있을 때(눈 깜빡임만)의 그리기 간격 */
const MOVING_MS = 1000 / 30;
const STILL_MS = 1000 / 12;

/**
 * 입체 펫을 돌려 보여 준다. AI 설계도(model)는 끌어서 360도, 2.5D(사진과 깊이 그림)는 좌우 25도까지.
 * 놓으면 조금 더 돌다 멈추고, 자동 회전과 정면 단추, 화살표 키도 된다 (spin.ts)
 */
function Spin3D({
  model,
  photo,
  depth,
  interactive,
}: {
  model?: Blueprint;
  photo?: string;
  depth?: string;
  /** 단추와 키보드를 보일지 (저장 중, 다 됐을 때는 보여 주기만) */
  interactive: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const limits = model ? FIGURE_LIMITS : RELIEF_LIMITS;
  const spinRef = useRef<Spinner>(undefined);
  // 다시 만들기로 설계도만 바뀌면 보던 각도 그대로. 피규어와 2.5D 를 오가면 새로
  if (spinRef.current?.limits !== limits)
    spinRef.current = new Spinner(limits, !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const spin = spinRef.current;
  const [auto, setAuto] = useState(spin.auto);
  const [view, setView] = useState({ deg: 0, side: 'front' as ReturnType<Spinner['side']> });

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    // 미리보기마다 새로 만들면 컨텍스트가 새서 창에 하나만 두고 다시 쓴다
    previewPet ??= Pet3D.create(() => {});
    const pet = previewPet;
    if (!canvas || !ctx || !pet) return;
    let alive = true;
    if (model) pet.setBlueprint(model);
    else if (photo && depth)
      void Promise.all([loadImage(photo), loadImage(depth)]).then(([p, d]) => {
        if (alive) pet.setRelief(p, d);
      });
    const side = 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = side * dpr;
    canvas.height = side * dpr;
    const k = ((side * dpr) / CANVAS_SIZE) * SPIN_ZOOM;
    const off = (side * dpr * (1 - SPIN_ZOOM)) / 2;
    const t0 = performance.now();
    let raf = 0;
    let last = -Infinity;
    let stepped = t0;
    // 피규어와 2.5D 를 오가면 이 컴포넌트를 다시 쓰고 Spinner 만 바뀌니 단추와 읽어 주는 각도도 새로
    let shownAuto = spin.auto;
    let shownDeg = spin.degrees();
    setAuto(spin.auto);
    setView({ deg: shownDeg, side: spin.side() });
    let moving = true;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // 화면 주사율(120Hz)대로 그리지 않고 움직일 때 30fps, 멈춰 있으면 12fps 로 묶는다
      if (now - last < (moving ? MOVING_MS : STILL_MS) - 1) return;
      last = now;
      moving = spin.step(now - stepped);
      stepped = now;
      if (spin.auto !== shownAuto) {
        shownAuto = spin.auto;
        setAuto(spin.auto);
      }
      // 읽어 주는 각도는 손으로 돌릴 때만 바꾼다 (자동 회전 중에 계속 읽으면 시끄럽다)
      if (!spin.auto && spin.degrees() !== shownDeg) {
        shownDeg = spin.degrees();
        setView({ deg: shownDeg, side: spin.side() });
      }
      const ms = now - t0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, off, off);
      pet.spin = spin.yaw;
      pet.tilt = spin.pitch;
      // 가끔 눈 깜빡
      const blink = ms % 3800 < 180 ? (ms % 3800) / 180 : -1;
      pet.draw(ctx, { mood: 'idle', elapsed: ms, blink }, 0, 1, 1, undefined);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      // 같은 Pet3D 를 다음 미리보기가 다시 쓰니 각도를 되돌려 둔다
      pet.spin = 0;
      pet.tilt = 0;
      pet.clear();
    };
  }, [model, photo, depth, spin]);

  const toggleAuto = () => {
    spin.setAuto(!spin.auto);
    setAuto(spin.auto);
  };
  const front = () => {
    spin.front();
    setAuto(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => spin.nudge('yaw', -1),
      ArrowRight: () => spin.nudge('yaw', 1),
      ArrowUp: () => spin.nudge('pitch', 1),
      ArrowDown: () => spin.nudge('pitch', -1),
      Home: front,
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
    setAuto(false);
  };
  const release = (e: React.PointerEvent) => spin.release(e.timeStamp);
  const sideText = t(`maker.spin.side.${view.side}`);
  return (
    <>
      <canvas
        ref={ref}
        className={`spin3d${interactive ? ' grab' : ''}`}
        style={{ width: 220, height: 220 }}
        aria-label={interactive ? t('maker.spin.label') : t('maker.name.alt')}
        {...(interactive
          ? {
              role: 'slider',
              tabIndex: 0,
              'aria-valuemin': model ? 0 : -25,
              'aria-valuemax': model ? 359 : 25,
              'aria-valuenow': view.deg,
              'aria-valuetext': t('maker.spin.value', { deg: view.deg, side: sideText }),
              'aria-describedby': 'maker-spin-how',
              onKeyDown: onKey,
              onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                spin.grab(e.clientX, e.clientY, e.timeStamp);
                setAuto(false);
              },
              onPointerMove: (e: React.PointerEvent) => spin.move(e.clientX, e.clientY, e.timeStamp),
              onPointerUp: release,
              onPointerCancel: release,
              onLostPointerCapture: release,
            }
          : {})}
      />
      {interactive && (
        <div className="spin-tools">
          <button
            type="button"
            className={`spin-btn${auto ? ' on' : ''}`}
            aria-pressed={auto}
            onClick={toggleAuto}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4" />
            </svg>
            {t('maker.spin.auto')}
          </button>
          <button type="button" className="spin-btn" onClick={front}>
            {t('maker.spin.front')}
          </button>
          <span id="maker-spin-how" hidden>
            {model ? t('maker.spin.how') : t('maker.spin.howRelief')}
          </span>
        </div>
      )}
    </>
  );
}

/** 지우개와 복원 붓으로 마스크를 다듬는다. 지운 곳은 흐리게 보여서 되살릴 곳을 찾기 쉽다. */
function Editor({
  work,
  note,
  onBack,
  onNext,
}: {
  work: Work;
  note: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'erase' | 'restore'>('erase');
  const [size, setSize] = useState(24);
  const [, setVersion] = useState(0);
  const undo = useRef<Uint8ClampedArray[]>([]);
  const last = useRef<{ x: number; y: number }>(undefined);
  const raf = useRef(0);
  const pixels = useRef<ImageData>(undefined);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    if (!pixels.current) {
      const pg = work.photo.getContext('2d', { willReadFrequently: true });
      pixels.current = pg?.getImageData(0, 0, work.w, work.h);
    }
    const src = pixels.current;
    if (!src) return;
    const out = g.createImageData(work.w, work.h);
    for (let i = 0; i < work.mask.length; i++) {
      const a = work.mask[i] ?? 0;
      out.data[i * 4] = src.data[i * 4] ?? 0;
      out.data[i * 4 + 1] = src.data[i * 4 + 1] ?? 0;
      out.data[i * 4 + 2] = src.data[i * 4 + 2] ?? 0;
      // 지운 곳도 20% 로 남겨 보인다 (저장할 때는 마스크 그대로)
      out.data[i * 4 + 3] = Math.max(a, 50);
      if (a < 128) {
        out.data[i * 4] = Math.round((out.data[i * 4] ?? 0) * 0.6 + 255 * 0.4);
        out.data[i * 4 + 1] = Math.round((out.data[i * 4 + 1] ?? 0) * 0.6);
        out.data[i * 4 + 2] = Math.round((out.data[i * 4 + 2] ?? 0) * 0.6);
      }
    }
    g.putImageData(out, 0, 0);
  }, [work]);

  useEffect(() => {
    draw();
  }, [draw]);

  const toWork = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * work.w, y: ((e.clientY - r.top) / r.height) * work.h };
  };
  const brushPx = (e: React.PointerEvent<HTMLCanvasElement>) =>
    (size * work.w) / e.currentTarget.getBoundingClientRect().width;

  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toWork(e);
    stroke(work.mask, work.w, work.h, last.current ?? p, p, brushPx(e), mode === 'erase' ? 0 : 255);
    last.current = p;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  };

  const kept = keptRatio(work.mask);

  return (
    <section className="edit">
      <div className="tools">
        <fieldset className="segmented" aria-label={t('maker.edit.brush')}>
          <button
            type="button"
            aria-pressed={mode === 'erase'}
            className={mode === 'erase' ? 'on' : ''}
            onClick={() => setMode('erase')}
          >
            {t('maker.edit.eraser')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'restore'}
            className={mode === 'restore' ? 'on' : ''}
            onClick={() => setMode('restore')}
          >
            {t('maker.edit.restore')}
          </button>
        </fieldset>
        <label className="size">
          {t('maker.edit.size')}
          <input
            type="range"
            min={6}
            max={80}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="ghost"
          disabled={undo.current.length === 0}
          onClick={() => {
            const prev = undo.current.pop();
            if (prev) work.mask.set(prev);
            draw();
            setVersion((v) => v + 1);
          }}
        >
          {t('maker.edit.undo')}
        </button>
      </div>
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          width={work.w}
          height={work.h}
          className={mode}
          style={{ '--brush': `${size}px` } as React.CSSProperties}
          aria-label={t('maker.edit.canvas')}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            undo.current.push(work.mask.slice());
            if (undo.current.length > UNDO_LIMIT) undo.current.shift();
            last.current = undefined;
            paint(e);
            setVersion((v) => v + 1);
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) paint(e);
          }}
          onPointerUp={() => {
            last.current = undefined;
          }}
        />
      </div>
      <p className="hint">
        {t('maker.edit.hint')} {note}
      </p>
      {(kept < 0.02 || kept > 0.97) && (
        <p className="warn">
          {kept < 0.02 ? t('maker.edit.almostAllErased') : t('maker.edit.barelyErased')}{' '}
          {t('maker.edit.tryAgain')}
        </p>
      )}
      <div className="actions">
        <button type="button" className="ghost" onClick={onBack}>
          {t('maker.edit.otherPhoto')}
        </button>
        <button type="button" className="primary" onClick={onNext}>
          {t('maker.edit.next')}
        </button>
      </div>
    </section>
  );
}

const ANIMATED_MAX = 8 * 1024 * 1024;

/** 여러 장짜리 gif, webp 인지 (ImageDecoder 로 프레임 수를 본다) */
async function isAnimated(file: Blob): Promise<boolean> {
  if (!/^image\/(gif|webp)$/.test(file.type) || !('ImageDecoder' in window)) return false;
  try {
    const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const n = decoder.tracks.selectedTrack?.frameCount ?? 1;
    decoder.close();
    return n > 1;
  } catch {
    return false;
  }
}

function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new ShownError(t('maker.err.imageRead')));
    r.readAsDataURL(file);
  });
}

/** 파일을 작업 크기(긴 변 1024 이하) 캔버스로 */
async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  // 그림이 아닌 파일, 깨진 파일은 "could not be decoded" 같은 원문 대신 사진을 못 읽었다고
  const bitmap = await createImageBitmap(file).catch((err: unknown) => {
    console.warn('maker', err);
    throw new ShownError(t('maker.err.photoRead'));
  });
  const k = Math.min(1, WORK_SIDE / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new ShownError(t('maker.err.photoRead'));
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return c;
}

/** 진행 표시에 보일 작은 사진 (긴 변 THUMB_SIDE). 투명한 곳이 있는 그림도 있어 webp 로 */
function thumbOf(photo: HTMLCanvasElement): string {
  const k = Math.min(1, THUMB_SIDE / Math.max(photo.width, photo.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(photo.width * k));
  c.height = Math.max(1, Math.round(photo.height * k));
  const g = c.getContext('2d');
  if (!g) return '';
  g.imageSmoothingQuality = 'high';
  g.drawImage(photo, 0, 0, c.width, c.height);
  return c.toDataURL('image/webp', 0.86);
}

/** 마스크를 입혀 남긴 부분만 잘라 긴 변 512 PNG 로. 다 지웠으면 빈 문자열. */
function cutout(work: Work): string {
  const box = contentBox(work.mask, work.w, work.h);
  if (!box) return '';
  const pg = work.photo.getContext('2d', { willReadFrequently: true });
  const src = pg?.getImageData(0, 0, work.w, work.h);
  if (!src) return '';
  const full = document.createElement('canvas');
  full.width = work.w;
  full.height = work.h;
  const fg = full.getContext('2d');
  if (!fg) return '';
  const img = fg.createImageData(work.w, work.h);
  img.data.set(src.data);
  for (let i = 0; i < work.mask.length; i++) img.data[i * 4 + 3] = work.mask[i] ?? 0;
  fg.putImageData(img, 0, 0);
  const k = Math.min(1, OUT_SIDE / Math.max(box.width, box.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * k));
  out.height = Math.max(1, Math.round(box.height * k));
  const og = out.getContext('2d');
  if (!og) return '';
  og.imageSmoothingQuality = 'high';
  og.drawImage(full, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** 두 그림(data URL)을 작게 줄인 회색으로 견준다. 받은 그림이 보낸 사진 그대로면 true (illustrate.ts nearlySame) */
async function sameAsPhoto(sent: string, got: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([loadImage(sent), loadImage(got)]);
    const gray = (img: HTMLImageElement) => {
      const c = document.createElement('canvas');
      c.width = COMPARE_SIDE;
      c.height = COMPARE_SIDE;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return undefined;
      g.drawImage(img, 0, 0, COMPARE_SIDE, COMPARE_SIDE);
      return toGray(g.getImageData(0, 0, COMPARE_SIDE, COMPARE_SIDE).data, COMPARE_SIDE, COMPARE_SIDE);
    };
    const ga = gray(a);
    const gb = gray(b);
    if (!ga || !gb) return false;
    return nearlySame(
      ga,
      gb,
      { w: a.naturalWidth, h: a.naturalHeight },
      { w: b.naturalWidth, h: b.naturalHeight },
    );
  } catch {
    return false;
  }
}

/** data URL 그림을 연다 */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
