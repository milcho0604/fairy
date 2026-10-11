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
import {
  type IllustEngine,
  LOCAL_DRAW_GB,
  setupStageOf,
  setupStagesFor,
} from '../../../shared/local-draw.ts';
import {
  clampToAlpha,
  contentBox,
  defringe,
  keepSure,
  keptMass,
  maskHints,
  petOnly,
  pickPet,
  REFINE_KEEP,
  refineBox,
  solidify,
  stroke,
  trimHalo,
} from '../../../shared/mask.ts';
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
import { escClosesWindow } from '../panel/keys.ts';
import { Pet3D } from '../pet3d.ts';
import { openDepth, predictDepth } from './depth.ts';
import { settleFur } from './fur-color.ts';
import { GeminiRoute } from './GeminiRoute.tsx';
import { backend, modelOpen, openModel, predictMask } from './removeBg.ts';
import { ShownError, shownErrorText } from './shown-error.ts';
import { FIGURE_LIMITS, RELIEF_LIMITS, Spinner } from './spin.ts';

const bridge = window.jjakkungMaker;
/** 다듬는 동안의 사진 크기 (긴 변). 모델 입력(1024)과 같게. */
const WORK_SIDE = 1024;
/** 펫으로 저장할 그림 크기 (긴 변) */
const OUT_SIDE = 512;
/** 오린 그림의 긴 변이 이보다 작으면 흐릿할 수 있다고 알린다 (펫 화면은 2배 화면에서 250px 쯤으로 그린다) */
const SMALL_CUT = 200;
/**
 * 작은 펫을 다시 오릴 때 원본에서 적어도 이만큼(가로 세로, 원본 픽셀)은 둘레째 자른다. 모델 입력(1024)까지 2배 넘게
 * 키우지 않게 (작게 잘라 7배로 흐리게 키우면 흰 아랫몸을 바탕으로 봤다, 2026-10-10)
 */
const REFINE_MIN_SRC = WORK_SIDE / 2;
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

type Step = 'pick' | 'setup' | 'illust' | 'model' | 'working' | 'edit' | 'name' | 'saving' | 'done';

/** 무료 서버가 오늘 더 못 그린다는 실패 (내 컴퓨터에서 그리기를 권한다) */
const CLOUD_STUCK = ['quota', 'refused', 'limit'];

/** AI 일러스트 한 번: 고른 사진(원본 파일, 보낼 JPEG, 진행 판 사진), 받은 그림, 그린 나이, 그리는 중인지 */
interface Illust {
  file: Blob;
  photo: string;
  thumb: string;
  image: string;
  age: AgeStage;
  busy: boolean;
  at: number;
  /** 지금(또는 마지막으로) 그린 곳 */
  engine: IllustEngine;
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
  /** 오린 그림이 작아서(SMALL_CUT) 흐릿할 수 있는지 */
  const [smallCut, setSmallCut] = useState(false);
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
  /** 그만두거나 실패하면 돌아갈 단계: 일러스트 화면에서 시작한 만들기는 그 화면으로 (받은 그림을 다시 그리지 않게) */
  const backRef = useRef<'pick' | 'illust'>('pick');
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
  /** 두 번째 보기: AI 가 사진과 그린 모습을 견줘 설계도를 한 번 고친다 (시간이 두 배쯤) */
  const [refine, setRefine] = useState(true);
  const [refining, setRefining] = useState(false);
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
  // 내 컴퓨터에서 그리기 (2026-10-10): 고른 곳(설정에 남는다), 준비 시작한 때, 준비가 끝나면 이어서 그릴 사진, 돌아갈 화면
  const [engine, setEngine] = useState<IllustEngine>('cloud');
  const [setupAt, setSetupAt] = useState(0);
  const pendingDraw = useRef<{ photo: string; age: AgeStage; wish: string }>(undefined);
  const setupBack = useRef<'pick' | 'illust'>('pick');
  // 무료 서버가 오늘 횟수 끝으로 막혔는지 (그림 화면에 내 컴퓨터에서 그리기 단추)
  const [cloudStuck, setCloudStuck] = useState(false);

  useEffect(() => {
    bridge.info().then((i) => {
      setInfo(i);
      setEngine(i.illustEngine);
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
  const canLocal = !!info?.localDraw.supported;
  /** 실제로 쓸 곳: 이 컴퓨터가 안 되면 저장된 값이 local 이어도 무료 서버 */
  const eng: IllustEngine = canLocal && engine === 'local' ? 'local' : 'cloud';
  const localReady = !!info?.localDraw.ready;
  const local = info?.localDraw;
  /** 이 컴퓨터에서 못 그리는 까닭 중 사용자가 알면 좋은 것 (운영체제가 아예 다른 것은 말하지 않는다) */
  const localWhy = !canLocal && local?.reason && local.reason !== 'os' ? local.reason : undefined;
  /** 준비 안내: mflux 는 받는 양과 남는 양이 다르고(원본을 줄여 저장), sd.cpp 는 받은 그대로 둔다 */
  const need = local?.need ?? LOCAL_DRAW_GB;
  const needsText =
    local?.engine === 'sdcpp'
      ? t('maker.engine.needsOnce', { download: need.download, free: need.free, memory: need.memory })
      : t('maker.engine.needs', {
          download: need.download,
          keep: need.keep,
          free: need.free,
          memory: need.memory,
        });
  /** 준비가 끝난 뒤: 이 컴퓨터에 남은 크기와 지우는 곳 */
  const keptText = t('maker.engine.kept', { keep: need.keep });
  /** 한 장 걸리는 시간 (엔진과 그래픽 칩마다), CPU 로 그리면 느리다는 말도 */
  const timeText = local?.minutes ? t('maker.engine.time', local.minutes) : '';
  const setupStages = setupStagesFor(local?.engine);

  const chooseEngine = (next: IllustEngine) => {
    setEngine(next);
    void bridge.setIllustEngine(next).catch(() => {});
  };

  /** 일러스트 그리기 (처음, 다시 그리기). 받은 그림이 보낸 사진과 거의 같으면 실패로 (그대로 돌려준 답) */
  const drawIllust = useCallback(
    async (photo: string, a: AgeStage, wishText: string, where: IllustEngine) => {
      const run = ++runRef.current;
      const at = performance.now();
      setError('');
      setNote('');
      setCloudStuck(false);
      // 내 컴퓨터는 진짜 진행률(4단계 두 번)이 온다. 무료 서버는 지난번 걸린 시간으로 어림
      setProgress(0);
      setIllustMs(loadExpected('illust', store()));
      // 앞 그림은 새 그림을 받을 때까지 둔다 (다시 그리다 쿼터에 걸려도 앞 그림을 고를 수 있게)
      setIllust((v) => v && { ...v, busy: true, at, engine: where });
      const r = await bridge.illustrate(
        photo,
        a,
        cleanWish(wishText).slice(0, ILLUST_WISH_MAX) || undefined,
        where,
      );
      if (runRef.current !== run) return;
      // 그리고 난 뒤의 상태로 (CPU 로 되돌렸으면 걸리는 시간과 CPU 안내가 바로 바뀌게)
      const fresh = r.localDraw;
      if (fresh) setInfo((v) => v && { ...v, localDraw: fresh });
      if (!r.ok) {
        setError(r.error);
        if (where === 'cloud' && CLOUD_STUCK.includes(r.kind)) setCloudStuck(true);
        // 준비가 깨졌으면(폴더를 지움 등) 다시 준비하기가 보이게
        if (where === 'local' && r.kind === 'notReady' && !fresh)
          setInfo((v) => v && { ...v, localDraw: { ...v.localDraw, ready: false } });
        setIllust((v) => v && { ...v, busy: false });
        return;
      }
      // 털 다듬기가 털색을 바꿨으면 되돌리거나 앞 그림 색에 맞춘다 (shared/color-match.ts)
      const image = r.before ? await settleFur(r.image, r.before) : r.image;
      if (runRef.current !== run) return;
      // 사진과 거의 같으면 알려 주되, 실제로 다시 그린 그림일 수도 있으니 고를 수는 있게 둔다
      const same = await sameAsPhoto(photo, image);
      if (runRef.current !== run) return;
      if (same) setError(t('maker.illust.same'));
      else if (where === 'cloud') saveDuration('illust', performance.now() - at, store());
      setIllust((v) => v && { ...v, image, age: a, busy: false });
    },
    [],
  );

  /**
   * 내 컴퓨터에서 그리기 준비 (처음 한 번 mflux 16GB, sd.cpp 5.2GB 쯤). 그만두면 돌아간다. 다 되면 기다리던 사진이 있으면 바로 그린다
   */
  const runSetup = useCallback(
    async (back: 'pick' | 'illust') => {
      const run = ++runRef.current;
      setupBack.current = back;
      setError('');
      setNote('');
      setProgress(0);
      setSetupAt(performance.now());
      setStep('setup');
      const r = await bridge.setupLocalDraw();
      if (runRef.current !== run) return;
      // 준비하며 CPU 로 바뀌었을 수 있어 메인이 준 새 상태로 (시간 안내가 맞게)
      const fresh = r.localDraw;
      if (fresh) setInfo((v) => v && { ...v, localDraw: fresh });
      if (!r.ok) {
        pendingDraw.current = undefined;
        setError(r.error);
        setStep(back);
        return;
      }
      if (!fresh) setInfo((v) => v && { ...v, localDraw: { ...v.localDraw, ready: true } });
      const p = pendingDraw.current;
      pendingDraw.current = undefined;
      if (p) {
        setStep('illust');
        await drawIllust(p.photo, p.age, p.wish, 'local');
        return;
      }
      setStep(back);
      setNote(t(back === 'pick' ? 'maker.engine.readyNote' : 'maker.engine.ready'));
    },
    [drawIllust],
  );

  /** 준비를 그만둔다 (메인이 받기와 설치를 멈춘다. 다음에 받은 데부터 이어서) */
  const stopSetup = () => {
    runRef.current++;
    pendingDraw.current = undefined;
    bridge.cancel();
    setError('');
    setNote(t('maker.progress.stopped'));
    setStep(setupBack.current);
  };

  /** 이 사진을 이 컴퓨터에서 그린다. 준비가 안 됐으면 준비부터 하고 이어서 */
  const drawLocal = useCallback(
    (photo: string, a: AgeStage, wishText: string, back: 'pick' | 'illust') => {
      if (localReady) {
        setStep('illust');
        void drawIllust(photo, a, wishText, 'local');
        return;
      }
      pendingDraw.current = { photo, age: a, wish: wishText };
      void runSetup(back);
    },
    [localReady, drawIllust, runSetup],
  );

  const start = useCallback(
    async (file: Blob, opts: { age?: AgeStage; plain?: boolean; back?: 'illust' } = {}) => {
      if (!info) return;
      setError('');
      setNote('');
      backRef.current = opts.back ?? 'pick';
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
          const jpeg = onWhite(photo).toDataURL('image/jpeg', 0.92);
          setIllust({
            file,
            photo: jpeg,
            thumb: thumbOf(photo),
            image: '',
            age,
            busy: eng === 'cloud' || localReady,
            at: 0,
            engine: eng,
          });
          if (eng === 'local') {
            drawLocal(jpeg, age, illustWish, 'pick');
            return;
          }
          setStep('illust');
          await drawIllust(jpeg, age, illustWish, 'cloud');
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
        const first = withPhotoAlpha(await predictMask(photo, info), photo);
        let next: Work = { photo, mask: first, w: photo.width, h: photo.height };
        if (!alive()) return;
        // 펫이 사진에서 작으면 그 둘레만 원본 크기로 잘라 한 번 더 오린다 (팔이 살고 바탕 얼룩이 빠지고 덜 흐릿하다).
        // 둘레는 펫으로 보이는 덩어리로 잡는다 (바깥 사진의 나무 줄처럼 따로 남은 바탕 띠는 빼고)
        const pick = pickPet(first, next.w, next.h);
        const cut = pick
          ? await cropPhoto(file, photo, (scale) =>
              refineBox(pick.box, next.w, next.h, 0.5, 0.2, REFINE_MIN_SRC / scale),
            )
          : undefined;
        if (!alive()) return;
        if (pick && cut) {
          const { crop, box } = cut;
          const second = withPhotoAlpha(await predictMask(crop, info), crop);
          if (!alive()) return;
          // 다시 오린 것이 처음 것이 확실히 남긴 펫 몸(알파 합)을 덜 남기면(흰 아랫몸이 빠짐, 칸 밖으로 잘린 꼬리) 처음 것을
          // 쓴다. 쓰더라도 처음 것이 확실히 남긴 몸이 뭉텅이로 빠진 곳은 되살린다 (mask.ts keptMass, keepSure)
          const pet = petOnly(first, pick);
          if (keptMass(pet, next.w, box, second, crop.width, crop.height) >= REFINE_KEEP)
            next = {
              photo: crop,
              mask: keepSure(pet, next.w, box, second, crop.width, crop.height),
              w: crop.width,
              h: crop.height,
            };
        }
        // 몸에서 떨어진 반투명 안개(작은 펫 둘레 회색 네모)를 걷는다
        next.mask = trimHalo(next.mask, next.w, next.h);
        // 흰 바탕 흰 펫, 반짝이는 그림의 살짝 비친 몸 속(190~245)을 꽉 채운다 (가장자리 털 끝은 그대로)
        next.mask = solidify(next.mask, next.w, next.h);
        setElapsed(Math.round(performance.now() - t0));
        saveDuration('cutout', performance.now() - cutStart, store());
        setWork(next);
        setBgDone(true);
        await sleep(DONE_MS);
        if (!alive()) return;
        setBgDone(false);
        setStep('edit');
      } catch (err) {
        if (!alive()) return;
        setError(shownErrorText(err, t('maker.err.bgFailed')));
        setStep(backRef.current);
      }
    },
    [info, how, age, illustWish, drawIllust, eng, localReady, drawLocal],
  );

  // 그리기가 끝나면 (진행 화면이 사라져 포커스가 body 로 빠진다) 다음에 누를 단추로
  const acceptRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const illustBusy = illust?.busy;
  useEffect(() => {
    if (step !== 'illust' || illustBusy !== false) return;
    (acceptRef.current ?? againRef.current)?.focus();
  }, [step, illustBusy]);

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
    await start(blob, { age: illust.age, back: 'illust' });
  };

  const saveToken = async (token: string | null) => {
    const r = await bridge.setHfToken(token);
    setInfo((v) => v && { ...v, hfToken: r.has });
    if (r.ok) {
      setTokenDraft('');
      // 토큰을 넣으라던 안내는 이제 맞지 않다
      if (token) setError('');
    }
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
    setStep(backRef.current);
  };

  /** 고르기 화면으로 (앞 화면의 오류와 안내는 지운다) */
  const toPick = () => {
    setError('');
    setNote('');
    setStep('pick');
  };

  const toName = () => {
    if (!work) return;
    const { url, side } = cutout(work);
    if (!url) {
      setError(t('maker.err.allErased'));
      return;
    }
    setError('');
    setPreview(url);
    setSmallCut(side < SMALL_CUT);
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
    const pick = walk === 'auto' ? undefined : walk;
    let r = await bridge.shape3d(from, asked, pick);
    if (shapeRun.current !== run) return;
    // 두 번째 보기: 설계도를 그려서 사진과 같이 보여 주고 한 번 고치게 한다. 실패하면 처음 것 그대로
    if (r.ok && refine && previewRef.current === from) {
      setRefining(true);
      const render = renderBlueprint(r.model);
      if (render) {
        const again = await bridge.refine3d(from, render, r.model, asked, pick);
        if (shapeRun.current !== run) return;
        if (again.ok) r = again;
      }
      setRefining(false);
    }
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

  // Esc 로 닫는다 (패널, 설정과 같게). 만드는 중에는 하던 일을 잃으니 고르기 전과 다 된 뒤에만
  useEffect(() => {
    if (step !== 'pick' && step !== 'done') return;
    const onKey = (e: KeyboardEvent) => {
      if (escClosesWindow(e)) bridge.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

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
    <details className="token" open={step === 'illust' && !!error}>
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
    [['pick', 'setup', 'illust', 'model', 'working'], t('maker.step.photo')],
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
                    {/* 이 컴퓨터가 되면 그리는 곳을 고른다: 무료 서버(하루 몇 번) 또는 이 컴퓨터 (횟수 제한 없음) */}
                    {canLocal && (
                      <fieldset className="segmented engine" aria-label={t('maker.engine.label')}>
                        {(['cloud', 'local'] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            aria-pressed={eng === k}
                            className={eng === k ? 'on' : ''}
                            onClick={() => chooseEngine(k)}
                          >
                            {t(`maker.engine.${k}`)}
                          </button>
                        ))}
                      </fieldset>
                    )}
                    {/* 못 그리면 왜인지 알린다 (로제타면 Apple 칩용 앱을 깔면 된다) */}
                    {localWhy && <small className="hint">{t(`maker.engine.why.${localWhy}`)}</small>}
                    <small className="hint">
                      {t(eng === 'local' ? 'maker.engine.localHint' : 'maker.illust.hint')}
                    </small>
                    {eng === 'local' && timeText && <small className="hint">{timeText}</small>}
                    {eng === 'local' && local?.tier === 'cpu' && (
                      <small className="hint">{t('maker.engine.cpuSlow')}</small>
                    )}
                    {/* 사진을 고르기 전에 보이게: 무료 서버는 사진이 밖으로 나가고, 이 컴퓨터는 나가지 않는다 */}
                    {eng === 'local' ? (
                      <p className="privacy">{t('maker.engine.localPrivacy')}</p>
                    ) : (
                      <p className="privacy out">{t('maker.illust.privacy')}</p>
                    )}
                    {eng === 'local' && localReady && <small className="hint">{keptText}</small>}
                    {eng === 'local' && !localReady && (
                      <div className="local-setup">
                        <small className="hint">{needsText}</small>
                        <small className="hint">{t('maker.engine.setupNote')}</small>
                        <button type="button" className="ghost" onClick={() => runSetup('pick')}>
                          {t('maker.engine.setup')}
                        </button>
                      </div>
                    )}
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
                    {eng === 'cloud' && tokenBox}
                    <GeminiRoute age={age} wish={illustWish} onImage={(b) => start(b, { age })} />
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

        {step === 'setup' && (
          <section className="busy">
            <MakeProgress
              key="setup"
              task="download"
              title={t('maker.engine.setupWorking')}
              startedAt={setupAt}
              ratio={progress}
              totalMb={need.download * 1000}
              stages={setupStages.map((s, i) => {
                const now = setupStages.findIndex((x) => x.id === setupStageOf(progress, setupStages));
                return {
                  label: t(`maker.engine.stage.${s.id}`),
                  state: i < now ? 'done' : i === now ? 'now' : 'next',
                };
              })}
              onStop={stopSetup}
            />
            <p className="hint">{t('maker.engine.setupNote')}</p>
          </section>
        )}

        {step === 'illust' && illust && (
          <section className="illust">
            {illust.busy ? (
              <MakeProgress
                // 그리는 곳이 바뀌면 시간을 새로 센다
                key={illust.engine}
                task="illust"
                title={t(illust.engine === 'local' ? 'maker.illust.workingLocal' : 'maker.illust.working')}
                startedAt={illust.at}
                // 이 컴퓨터는 진짜 진행률(그리기, 털 다듬기 4단계씩)
                ratio={illust.engine === 'local' ? progress : undefined}
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
                {/* 무료 서버가 오늘 막혔으면 이 컴퓨터에서 이어 그리기 (안 되는 컴퓨터는 보이지 않는다) */}
                {cloudStuck && canLocal && illust.engine === 'cloud' && (
                  <div className="local-setup">
                    <small className="hint">{t('maker.illust.tryLocalHint')}</small>
                    {timeText && <small className="hint">{timeText}</small>}
                    {!localReady && <small className="hint">{needsText}</small>}
                    <small className="hint">{t('maker.engine.localPrivacy')}</small>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        chooseEngine('local');
                        drawLocal(illust.photo, age, illustWish, 'illust');
                      }}
                    >
                      {t('maker.illust.tryLocal')}
                    </button>
                  </div>
                )}
                {/* 이 컴퓨터 준비가 안 됐거나 깨졌으면(notReady) 여기서 준비하기. 다 되면 이 사진을 바로 그린다 */}
                {eng === 'local' && !localReady && !(cloudStuck && illust.engine === 'cloud') && (
                  <div className="local-setup">
                    <small className="hint">{needsText}</small>
                    <small className="hint">{t('maker.engine.setupNote')}</small>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => drawLocal(illust.photo, age, illustWish, 'illust')}
                    >
                      {t('maker.engine.setup')}
                    </button>
                  </div>
                )}
                {eng === 'cloud' && <div className="how">{tokenBox}</div>}
                <GeminiRoute
                  age={age}
                  wish={illustWish}
                  photo={illust.photo}
                  stuck={cloudStuck}
                  onImage={(b) => start(b, { age, back: 'illust' })}
                />
                <div className="actions wrap">
                  <button type="button" className="ghost" onClick={toPick}>
                    {t('maker.illust.otherPhoto')}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => start(illust.file, { plain: true, back: 'illust' })}
                  >
                    {t('maker.illust.usePhoto')}
                  </button>
                  <button
                    ref={againRef}
                    type="button"
                    // 준비하기가 보이면 그것이 주 버튼
                    className={illust.image || (eng === 'local' && !localReady) ? 'ghost' : 'primary'}
                    onClick={() =>
                      eng === 'local'
                        ? drawLocal(illust.photo, age, illustWish, 'illust')
                        : drawIllust(illust.photo, age, illustWish, 'cloud')
                    }
                  >
                    {illust.image && illust.age !== age
                      ? t(`maker.illust.againAs.${age}`)
                      : t('maker.illust.again')}
                  </button>
                  {illust.image && (
                    <button ref={acceptRef} type="button" className="primary" onClick={acceptIllust}>
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
            onBack={() => {
              setError('');
              setNote('');
              setStep(backRef.current);
            }}
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
                    ? refining
                      ? t('maker.3d.refining')
                      : t('maker.3d.working')
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
              <div
                className={
                  (look === 'figure' && model) || (look === 'relief' && depth) ? 'stage' : 'stage split'
                }
              >
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
            {!animated && smallCut && step === 'name' && <p className="hint">{t('maker.name.smallCut')}</p>}
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
                      <label className="refine">
                        <input
                          type="checkbox"
                          checked={refine}
                          disabled={shaping}
                          onChange={(e) => setRefine(e.target.checked)}
                        />
                        {t('maker.refine.label')} <small>{t('maker.refine.hint')}</small>
                      </label>
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

/**
 * 설계도를 정면에서 한 장 그린다 (두 번째 보기에서 AI 에 보여 줄 그림, PNG data URL). 미리보기와 같은 Pet3D 를 쓰고
 * 그린 뒤 비운다. WebGL 을 못 쓰면 undefined
 */
function renderBlueprint(model: Blueprint): string | undefined {
  previewPet ??= Pet3D.create(() => {});
  const pet = previewPet;
  if (!pet) return undefined;
  const side = 320;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  try {
    pet.setBlueprint(model);
    pet.spin = 0;
    pet.tilt = 0;
    // 흰 바탕 (사진도 배경을 지운 흰 바탕이라 견주기 쉽다)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, side, side);
    const k = side / CANVAS_SIZE;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    pet.draw(ctx, { mood: 'idle', elapsed: 0, blink: -1 }, 0, 1, 1, undefined);
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  } finally {
    pet.clear();
  }
}

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
  // 붓 굵기 = 화면에서 보이는 지름(px). 반지름으로 쓰여 숫자보다 두 배 굵게 칠했다 (2026-10-11)
  const [size, setSize] = useState(40);
  const [, setVersion] = useState(0);
  // 안내(반투명, 따로 남은 것, 잘림)는 붓질을 마칠 때와 되돌릴 때 다시 잰다 (mask.ts maskHints)
  const [hints, setHints] = useState(() => maskHints(work.mask, work.w, work.h));
  const measure = useCallback(() => setHints(maskHints(work.mask, work.w, work.h)), [work]);
  useEffect(measure, [measure]);
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
      // 붉은빛은 지워지는 만큼 (반쯤 남는 곳은 반쯤 붉게). 128 에서 끊으면 반투명으로 저장될 곳이 다 남는 것처럼 보였다
      const k = 0.4 * (1 - a / 255);
      if (k > 0) {
        out.data[i * 4] = Math.round((out.data[i * 4] ?? 0) * (1 - k) + 255 * k);
        out.data[i * 4 + 1] = Math.round((out.data[i * 4 + 1] ?? 0) * (1 - k));
        out.data[i * 4 + 2] = Math.round((out.data[i * 4 + 2] ?? 0) * (1 - k));
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
  /** 붓 반지름 (작업 사진 칸) */
  const brushPx = (e: React.PointerEvent<HTMLCanvasElement>) =>
    (size / 2) * (work.w / e.currentTarget.getBoundingClientRect().width);

  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toWork(e);
    stroke(work.mask, work.w, work.h, last.current ?? p, p, brushPx(e), mode === 'erase' ? 0 : 255);
    last.current = p;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  };

  // 반쯤 비침 안내가 있거나 따로 남은 것이 있으면 속 빔 안내는 겹치니 빼고 (바탕 띠 사이 틈도 속이 빈 것처럼 잰다)
  const hollow = hints.hollow && !hints.half && hints.others === 0;
  const notes =
    Number(hints.half) +
    Number(hollow) +
    Number(hints.others > 0) +
    Number(hints.empty || hints.full) +
    Number(hints.cut && !hints.empty && !hints.full);

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
            min={8}
            max={120}
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
            measure();
          }}
        >
          {t('maker.edit.undo')}
        </button>
      </div>
      {/* 고칠 것 안내는 도구 바로 아래: 긴 설명 아래에 두면 작은 창(460x660)에서 아래 단추 줄에 가려 안 보였다 */}
      {hints.half && <p className="warn">{t('maker.edit.halfKept')}</p>}
      {hollow && <p className="warn">{t('maker.edit.hollow')}</p>}
      {hints.others > 0 && <p className="warn">{t('maker.edit.others')}</p>}
      {(hints.empty || hints.full) && (
        <p className="warn">
          {hints.empty ? t('maker.edit.almostAllErased') : t('maker.edit.barelyErased')}{' '}
          {t('maker.edit.tryAgain')}
        </p>
      )}
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          width={work.w}
          height={work.h}
          className={mode}
          // 아주 작은 사진, 아주 긴 사진도 칠할 만한 크기로 보인다 (maker.css .canvas-wrap canvas)
          style={
            {
              '--ar': work.w / work.h,
              // 안내 줄 수만큼 사진을 줄여 다 됐어 단추까지 한 화면에 (maker.css .canvas-wrap canvas)
              '--notes': notes,
              cursor: brushCursor(size),
            } as React.CSSProperties
          }
          aria-label={t('maker.edit.canvas')}
          onPointerDown={(e) => {
            // 오른쪽, 가운데 단추로는 칠하지 않는다
            if (e.button !== 0) return;
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
            measure();
          }}
        />
      </div>
      <p className="hint">
        {t('maker.edit.hint')} {note}
      </p>
      {hints.cut && !hints.empty && !hints.full && <p className="hint">{t('maker.edit.cutEdge')}</p>}
      <div className="actions edit-actions">
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

/**
 * 붓 모양 커서: 지름 d(px) 동그라미 (밝은 선 + 어두운 선이라 어느 바탕에서도 보인다). 브라우저 커서는 128px 까지라
 * 그보다 크면 십자로
 */
function brushCursor(d: number): string {
  const s = Math.ceil(d) + 4;
  if (s > 128) return 'crosshair';
  const c = s / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${c}" cy="${c}" r="${d / 2}" fill="none" stroke="white" stroke-width="2.5"/><circle cx="${c}" cy="${c}" r="${d / 2}" fill="none" stroke="black" stroke-width="1"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
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

/** 오려 둔 PNG 처럼 이미 투명한 곳은 마스크에서도 지운다 (mask.ts clampToAlpha) */
function withPhotoAlpha(mask: Uint8ClampedArray, photo: HTMLCanvasElement): Uint8ClampedArray {
  const g = photo.getContext('2d', { willReadFrequently: true });
  if (!g) return mask;
  const d = g.getImageData(0, 0, photo.width, photo.height).data;
  for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 255) < 255) return clampToAlpha(mask, d);
  return mask;
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

/**
 * 원본 파일에서 다시 오릴 자리를 원본 크기로 잘라 낸다 (긴 변 WORK_SIDE 이하). 작업 사진은 긴 변 1024 로
 * 줄인 것이라 작은 펫은 몇십 칸뿐이었다. 원본도 작으면 늘이지 않는다. boxFor 는 원본/작업 사진 배율을 받아 자리
 * (작업 사진 좌표)를 준다. 다시 오릴 자리가 없거나 못 읽으면 undefined
 */
async function cropPhoto(
  file: Blob,
  photo: HTMLCanvasElement,
  boxFor: (scale: number) => { x: number; y: number; width: number; height: number } | undefined,
): Promise<
  { crop: HTMLCanvasElement; box: { x: number; y: number; width: number; height: number } } | undefined
> {
  const bitmap = await createImageBitmap(file).catch(() => undefined);
  if (!bitmap) return undefined;
  try {
    const s = bitmap.width / photo.width;
    const box = boxFor(s);
    if (!box) return undefined;
    const sw = box.width * s;
    const sh = box.height * s;
    const k = Math.min(1, WORK_SIDE / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return undefined;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, box.x * s, box.y * s, sw, sh, 0, 0, c.width, c.height);
    return { crop: c, box };
  } finally {
    bitmap.close();
  }
}

/** 흰 바탕에 깐 사본 (투명한 PNG 를 JPEG 로 바꾸면 바탕이 검어진다. 그림 서버에는 밝은 바탕이 낫다) */
function onWhite(photo: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = photo.width;
  c.height = photo.height;
  const g = c.getContext('2d');
  if (!g) return photo;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(photo, 0, 0);
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

/** 마스크를 입혀 남긴 부분만 잘라 긴 변 512 PNG 로 (side 는 저장 그림의 긴 변). 다 지웠으면 빈 문자열. */
function cutout(work: Work): { url: string; side: number } {
  const none = { url: '', side: 0 };
  const box = contentBox(work.mask, work.w, work.h);
  if (!box) return none;
  const pg = work.photo.getContext('2d', { willReadFrequently: true });
  const src = pg?.getImageData(0, 0, work.w, work.h);
  if (!src) return none;
  const full = document.createElement('canvas');
  full.width = work.w;
  full.height = work.h;
  const fg = full.getContext('2d');
  if (!fg) return none;
  const img = fg.createImageData(work.w, work.h);
  img.data.set(src.data);
  // 털 끝에 섞인 바탕색을 뺀다 (어두운 화면에서 흰 테두리가 보이지 않게)
  // 바탕색에 가까운 반투명 가장자리 칸은 알파도 낮춘다 (밝은 벽 앞 어두운 펫의 밝은 테두리)
  const alpha = defringe(img.data, work.mask, work.w, work.h);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i] ?? 0;
  fg.putImageData(img, 0, 0);
  const k = Math.min(1, OUT_SIDE / Math.max(box.width, box.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(box.width * k));
  out.height = Math.max(1, Math.round(box.height * k));
  const og = out.getContext('2d');
  if (!og) return none;
  og.imageSmoothingQuality = 'high';
  og.drawImage(full, box.x, box.y, box.width, box.height, 0, 0, out.width, out.height);
  return { url: out.toDataURL('image/png'), side: Math.max(out.width, out.height) };
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
