import { capFps, idleWaitFactor } from '../../shared/battery.ts';
import { type Activity, nextDelay } from '../../shared/behavior.ts';
import { ENERGY_BLINK, ENERGY_PACE, type EnergyLook, energyLookOf, sameLook } from '../../shared/energy.ts';
import { BALL_SVG, type CarryToy, PICK_MS, pickPose } from '../../shared/fetch.ts';
import type { Gaze } from '../../shared/gaze.ts';
import type { Point } from '../../shared/geometry.ts';
import { GestureTracker, RubTracker } from '../../shared/gesture.ts';
import { t } from '../../shared/i18n/index.ts';
import { ageScale } from '../../shared/illustrate.ts';
import type { PetImages } from '../../shared/ipc.ts';
import {
  canMagnify,
  FOUND_MS,
  type LookMotion,
  magnifierFps,
  magnifierPose,
} from '../../shared/look-motion.ts';
import { bodyOfParts, isMove, MOVE_SPECS, type MoveAsk } from '../../shared/moves.ts';
import { petKeyOf } from '../../shared/pet-keys.ts';
import {
  canBlink,
  EXCITED_MS,
  INITIAL_INPUTS,
  isAnimated,
  moodOf,
  nextChangeAt,
  type PetInputs,
  type PetMood,
  TALK_MS,
} from '../../shared/pet-mood.ts';
import type { Blueprint, Gait } from '../../shared/pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from '../../shared/pet3d/defaults.ts';
import { standingBlueprint } from '../../shared/pet3d/stand.ts';
import type { PetKind, PetStyle, PoseKind } from '../../shared/settings.ts';
import { canPlay, type SoundKind } from '../../shared/sound.ts';
import { type PhotoEyes, STARTER_EYES } from '../../shared/starter-pets.ts';
import { NO_TOGETHER, type TogetherLook } from '../../shared/together.ts';
import { dressBlueprint, GROW_LOOK, type WearLook } from '../../shared/wear.ts';
import { AnimatedImage, frameSide, loadPetImage } from './animated.ts';
import {
  CANVAS_SIZE,
  type CarryDraw,
  CONFETTI_MS,
  type DrawState,
  drawPet,
  HEARTS_MS,
  motionSettling,
  noteOf,
  tapOf,
  workOf,
} from './draw.ts';
import { initLang } from './lang.ts';
import { LAND_MS, moveFps, SIT_MS, sitDown } from './move-pose.ts';
import { renderBody, renderFace } from './pet-face.ts';
import type { Pet3D } from './pet3d.ts';
import { quadKind, withGait } from './pet3d-gait.ts';
import { PoseBlend, type PoseKey, shouldBlend } from './pose-blend.ts';
import { playSound } from './sound.ts';
import { TAP_FPS, TAP_IN_MS, TAP_OUT_MS } from './together-draw.ts';
import { continueSeg, segSpeed, stepsAt, strideLen, type WalkSeg } from './walk-pace.ts';

initLang('common.title.pet');
const bridge = window.jjakkung;
function setupCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.getElementById('pet');
  if (!(el instanceof HTMLCanvasElement)) throw new Error('#pet canvas 가 없다');
  el.setAttribute('aria-label', t('common.appName'));
  // 마우스가 펫 위인지 픽셀로 판정하려고 자주 읽는다. 작은 캔버스라 CPU 쪽에 두는 편이 낫다.
  const context = el.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2d 컨텍스트를 못 얻었다');
  return [el, context];
}
const [canvas, cpuCtx] = setupCanvas();

/**
 * 입체 펫은 GPU 쪽 캔버스(#pet 바로 밑, 마우스는 #pet 이 받는다)에 그린다. 위 2D 캔버스는 CPU 쪽이라 WebGL 그림을
 * 옮겨 그리면 프레임마다 GPU 에서 읽어 와야 했다 (입체가 2D 보다 약 40% 비싼 까닭, docs/roadmap.md). GPU 캔버스끼리는
 * GPU 안에서 옮긴다. 2D 펫은 그대로 CPU 캔버스에 (작은 그림이라 CPU 쪽이 싸고 픽셀 판정도 싸다). 처음 쓸 때 만든다
 */
let gpuLayer: [HTMLCanvasElement, CanvasRenderingContext2D] | undefined;
/** 지금 그리는 캔버스 (2D 는 #pet, 입체는 gpuLayer) */
let ctx = cpuCtx;
/** 그린 틀 수 (픽셀 판정을 같은 틀 안에서 다시 읽지 않게) */
let drawn = 0;
/** 마지막 픽셀 판정. 입체(GPU 캔버스)는 읽을 때마다 GPU 를 기다려서 같은 틀, 같은 픽셀이면 다시 읽지 않는다 */
let hitCache: { frame: number; x: number; y: number; hit: boolean } | undefined;

function drawLayer(gpu: boolean): CanvasRenderingContext2D {
  if (gpu && !gpuLayer) {
    const el = document.createElement('canvas');
    el.id = 'pet-gpu';
    el.setAttribute('aria-hidden', 'true');
    const g = el.getContext('2d');
    if (!g) return cpuCtx;
    canvas.before(el);
    gpuLayer = [el, g];
    sizeLayer(el, g);
  }
  const want = gpu && gpuLayer ? gpuLayer[1] : cpuCtx;
  if (want !== ctx) {
    // 다른 캔버스로 옮기면 하던 캔버스는 비운다 (두 그림이 겹쳐 보이지 않게)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    ctx = want;
    if (gpuLayer) gpuLayer[0].hidden = ctx === cpuCtx;
    hitCache = undefined;
  }
  return ctx;
}

// ---- 그리기 루프 ----
// 정지 상태는 한 번 그리고 멈춘다. 계속 그리면 fps 와 무관하게 CPU 를 먹는다 (L10).

/**
 * 깜빡임은 네 틀(반쯤 감음, 감음, 반쯤 뜸, 뜸)로 그린다. 30fps 로는 일곱 틀이었고 첫 틀은 뜬 눈 그대로였다.
 * 쉬는 동안 그리는 틀 대부분이 깜빡임이라 대기 CPU 가 이만큼 준다 (2026-10-07 측정, docs/roadmap.md).
 * 기운(shared/energy.ts)대로: 보통 180ms 네 틀, 활발하면 조금 빨리 자주, 지치거나 졸리면 천천히(320, 460ms) 감았다 뜨고 드물게
 */
function blinkSpec() {
  return ENERGY_BLINK[energy?.stage ?? 'normal'];
}
const ANIMATED_FPS: Partial<Record<PetMood, number>> = { excited: 30, thinking: 8 };

let inputs: PetInputs = { ...INITIAL_INPUTS };
let mood: PetMood = moodOf(inputs, performance.now());
let moodSince = performance.now();
let blinkStart = -1;
let frameTimer: ReturnType<typeof setTimeout> | undefined;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let blinkTimer: ReturnType<typeof setTimeout> | undefined;
/** 개운함 반짝임을 시작한 시각 (기지개와 같은 길이). 없으면 -1 */
let freshStart = -1;
/** 큰 축하 색종이가 터진 시각 (오늘 할 일 다 끝냄, 만난 날 기념). 없으면 -1 */
let confettiStart = -1;
/** 들렸다가 놓인 때 (내려앉기). 없으면 -1 */
let landStart = -1;
const FRESH_MS = MOVE_SPECS.stretch.ms;
/** 기운 (PetStatus.energy, shared/energy.ts). 없으면 예전 모습 */
let energy: EnergyLook | undefined;

function setInputs(patch: Partial<PetInputs>) {
  inputs = { ...inputs, ...patch };
  // 신남, 말하기가 끝나는 시각에 한 번 다시 그린다.
  clearTimeout(changeTimer);
  const now = performance.now();
  const at = nextChangeAt(inputs, now);
  if (at !== undefined) changeTimer = setTimeout(requestFrame, at - now + 1);
  requestFrame();
}

function requestFrame() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(frame, 0);
}

function frame() {
  frameTimer = undefined;
  // 메인이 첫 상태(입체로 보기인지)를 알려 주기 전에는 그리지 않는다. 먼저 그리면 2D 로 쓰는 사람도
  // 입체 렌더러를 만들어 GPU 메모리 약 47MB 를 계속 쥐고 있었다 (2026-10-07 측정)
  if (!statusKnown) return;
  const now = performance.now();
  const next = moodOf(inputs, now);
  if (next !== mood) {
    // 들려 있다가(끌기, 던지기) 놓이면 살짝 떨어져 내려앉는다
    landStart = mood === 'grabbed' && next !== 'hidden' ? now : -1;
    mood = next;
    moodSince = now;
    blinkStart = -1;
    scheduleBlink();
    // 기본 상태가 아니게 되면(잡힘, 생각 중, 말하기 등) 하던 행동을 그만둔다.
    if (activity) stopActivity(true);
  }
  let blink = -1;
  if (blinkStart >= 0) {
    blink = (now - blinkStart) / blinkSpec().ms;
    if (blink >= 1) {
      blink = -1;
      blinkStart = -1;
    }
  }
  const trickT = trick ? (now - trick.start) / TRICK_MS[trick.type] : -1;
  if (trickT >= 1) trick = undefined;
  const hearts = heartsStart >= 0 ? now - heartsStart : -1;
  if (hearts >= HEARTS_MS) heartsStart = -1;
  const fresh = freshStart >= 0 ? (now - freshStart) / FRESH_MS : -1;
  if (fresh >= 1) freshStart = -1;
  const confetti = confettiStart >= 0 ? now - confettiStart : -1;
  if (confetti >= CONFETTI_MS) confettiStart = -1;
  const landed = landStart >= 0 ? now - landStart : -1;
  if (landed >= LAND_MS) landStart = -1;
  // 입체가 되면 사진 대신 입체로 (AI 가 만든 설계도가 있는 사진 펫, 또는 기본 펫)
  const m3d = current3d();
  // 입체 그리기 모듈을 불러오는 중이면 기다린다 (불러오면 다시 그린다). 2D 를 먼저 그리면 깜빡인다
  if (m3d === 'loading') return;
  const img = m3d ? undefined : pickImage(mood, inputs.hungry);
  drawLayer(!!m3d);
  drawn++;
  const looking = peerAt(now);
  const picking = !!carry && now - carry.start < PICK_MS;
  // 2.5D 그림 펫은 가만히 있어도 숨을 쉰다: 부스트 모드(전원 연결)일 때만 8fps (평소엔 다른 움직임이 있을 때만).
  // 숨을 쉬지 않는 동안은 숨과 흔들림을 멈춘다 (깜빡일 때만 그려 몸이 툭툭 튀었다). 움직임 줄이기면 쉬지 않는다
  const breathes =
    boost && use3d && model3dOf instanceof HTMLImageElement && canBlink(mood) && !reducedMotion.matches;
  const state: DrawState = {
    mood,
    elapsed: now - moodSince,
    breathe: breathes,
    blink,
    viewSize,
    // 매운맛 토라짐 3단계: 등 돌리고 앉아 있다 (몸짓도 앉기만, 커서도 안 본다)
    activity: activityPose(now) ?? (backTurned() ? { type: 'sit' as const } : undefined),
    hungry: inputs.hungry,
    photo: img instanceof AnimatedImage ? img.frameAt(now) : img,
    photoScale,
    // 눈 자리는 원래 그림 것이다 (포즈 그림이면 눈이 다른 데 있다). 입체 판(2.5D)도 원래 그림이라 같이 준다
    photoEyes: img === undefined || img === photo ? photoEyes : undefined,
    kind: petKind,
    sulk: inputs.sulkLevel,
    pout: inputs.pout,
    hearts: heartsStart >= 0 ? hearts : -1,
    cushion,
    model3d: m3d,
    gaze: backTurned() ? undefined : (gaze ?? undefined),
    trick: trick ? { type: trick.type, t: trickT } : undefined,
    flower,
    // 철마다 옷과 성장은 기본 펫만 (사진 펫은 그대로)
    ...(img || photo ? {} : { wear: wear?.outfit, grow: GROW_LOOK[wear?.stage ?? 'adult'].scale }),
    calm: reducedMotion.matches,
    peer: looking?.peer,
    gait: gaitPick,
    carry: carryDraw(now),
    energy,
    fresh: freshStart >= 0 ? fresh : -1,
    confetti: confettiStart >= 0 ? confetti : -1,
    land: landStart >= 0 ? landed : -1,
    ...togetherDraw(now),
    now,
  };
  // 자세가 바뀐 틀이면 지난 그림을 떠 두고 짧게 겹쳐 바꾼다 (pose-blend.ts). 처음 그림은 겹치지 않는다
  const key: PoseKey = {
    mood,
    tap: !!tapOf(state, state.activity),
    note: !!noteOf(state, state.activity),
    work: workOf(state) !== undefined,
    trick: trick?.type ?? '',
    back: backTurned(),
  };
  if (firstShown && shouldBlend(poseKey, key, { calm: reducedMotion.matches, saver })) blend.snap(ctx, now);
  else if (!poseKey || poseKey.mood !== key.mood) blend.stop();
  poseKey = key;
  const ball = drawPet(ctx, state);
  if (feetLog && m3d) {
    const a = state.activity;
    feetLog.push({
      t: now,
      walk: a?.type === 'walk' ? { dir: a.dir, steps: a.steps ?? 0, stride: a.stride ?? 0 } : null,
      feet: m3d.debugFeet() ?? [],
      screenX: window.screenX,
      view: viewSize,
    });
    if (feetLog.length > 20000) feetLog.shift();
  }
  blend.over(ctx, now);
  carriedAt = ball;
  // 얼굴과 집 그림은 첫 그림이 화면에 나간 뒤에 (둘 다 그린 것을 읽어 와 GPU 를 기다려서 켤 때 첫 그림을 늦췄다)
  if (firstShown) {
    syncFace(m3d);
    syncSprites(m3d);
  } else afterFirstShown();
  syncBody(m3d, img);

  const walking = activity?.type === 'walk';
  // 제자리 몸짓(하품, 기지개, 꼬리 흔들기 등)은 하는 동안 20~30fps (moveFps), 앉기는 앉고 일어나는 동안만 20fps
  const sitting = activity?.type === 'sit' ? now - activity.start : -1;
  const moving =
    (!!activity && isMove(activity.type)) ||
    (sitting >= 0 && activity !== undefined && (sitting < SIT_MS || sitting > activity.ms - SIT_MS));
  // 움직이는 그림은 잠, 바쁨일 때 멈춘다 (L10: 계속 그리면 CPU 를 먹는다). 12fps 까지만.
  const animatedPhoto = img instanceof AnimatedImage && canBlink(mood) ? Math.min(12, img.fps) : 0;
  const breathing = breathes ? 8 : 0;
  // 부스트 모드면 움직임(신남, 몸짓, 하트, 걷기, 하품)을 두 배로 촘촘히 그린다. 깜빡임과 움직이는 그림은 그대로
  const k = boost ? 2 : 1;
  const fps =
    trick || picking
      ? 30 * k
      : isAnimated(mood)
        ? (ANIMATED_FPS[mood] ?? 30) * k
        : heartsStart >= 0 || freshStart >= 0 || confettiStart >= 0 || landStart >= 0
          ? 30 * k
          : blinkStart >= 0
            ? (1000 * blinkSpec().frames) / blinkSpec().ms
            : walking
              ? WALK_FPS * k
              : moving
                ? (activity && isMove(activity.type) ? moveFps(activity.type) : 20) * k
                : Math.max(animatedPhoto, breathing);
  // 이 틀 안에서 requestFrame 이 불렸으면(행동 멈춤 등) 그 타이머를 지운다. 안 지우면 루프가 두 겹이 돈다
  // (2026-10-07 점검: 신남이 30fps 가 아니라 57fps)
  clearTimeout(frameTimer);
  // 돋보기를 든 동안은 그 빠르기로 (부스트면 두 배)
  // 돌아서기, 고개 돌리기, 걷기 풀기가 아직 따라가는 중이면 끝까지 그린다 (draw.ts motionSettling)
  // 배터리 절약이면 15fps 까지만 (shared/battery.ts). 멈춘 그림(0)은 그대로 그리지 않는다
  const all = capFps(
    Math.max(
      fps,
      (looking?.fps ?? 0) * k,
      motionSettling() || blend.active ? 30 * k : 0,
      togetherFps(now) * k,
    ),
    saver,
  );
  frameTimer = all > 0 ? setTimeout(frame, 1000 / all) : undefined;
}

/** 점검용 발 기록 (__pet.debugFeetLog). 틀마다 발바닥 자리와 걸음 */
let feetLog: unknown[] | undefined;

/** 자세 바꾸기 겹침 (pose-blend.ts): 지난 틀의 자세와 겹치는 중인 그림 */
const blend = new PoseBlend();
let poseKey: PoseKey | undefined;

/** 첫 그림이 화면에 나갔는지 (얼굴과 집 그림은 그 뒤에 그린다) */
let firstShown = false;
let firstShowWait = false;
function afterFirstShown() {
  if (firstShowWait) return;
  firstShowWait = true;
  const go = () => {
    if (firstShown) return;
    firstShown = true;
    requestFrame();
  };
  // 다음 화면 갱신 뒤. 창이 숨어 있으면 화면 갱신이 오지 않아 1초 뒤에는 그냥 한다
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 1000);
}

// ---- 같이 보기 돋보기 (shared/look-motion.ts) ----
// 메인이 단계(고르는 중, 찾았다)를 알려 준다. 그림이 붙은 질문에 AI 가 답하는 동안은 스스로 돋보기로 훑는다.
// 잠, 바쁨, 잡힘에서는 들지 않는다 (canMagnify). 끝나면 모션이 남지 않게 지운다.
let look: (LookMotion & { start: number }) | undefined;
let lookEnd: ReturnType<typeof setTimeout> | undefined;
/** 생각 중인 질문에 그림이 붙었는지 */
let aiWithImage = false;

bridge.onLook((m) => {
  const now = performance.now();
  clearTimeout(lookEnd);
  if (!m) {
    look = undefined;
    requestFrame();
    return;
  }
  const fresh = !look || look.phase !== m.phase;
  look = { ...m, start: fresh ? now : (look?.start ?? now) };
  if (fresh && m.phase === 'aim') {
    // 하던 행동과 몸짓을 멈추고, 끌던 중이면 놓는다 (메인이 끌기를 이미 끝냈다. 메인에 다시 알리지 않는다)
    if (activity) stopActivity(true);
    trick = undefined;
    gesture.cancel();
    // 사용자가 방금 불렀으니 졸던 펫은 깬다. 집중 중이면 그대로 잔다
    setInputs({ grabbed: false, ...(inputs.focusTimer ? {} : { userIdleMs: 0 }) });
  }
  // 메인의 끝 알림이 늦거나 오지 않아도 찾았다는 시간이 지나면 지운다
  if (m.phase === 'found')
    lookEnd = setTimeout(() => {
      if (look?.phase === 'found') look = undefined;
      requestFrame();
    }, FOUND_MS + 50);
  requestFrame();
});

/** 지금 그릴 같이 보기 자세와 그리는 빠르기. 없으면 undefined */
function peerAt(now: number) {
  const calm = reducedMotion.matches;
  const study = mood === 'thinking' && aiWithImage;
  if (!canMagnify(mood) || (!look && !study)) return undefined;
  const kind = look ? look.phase : 'study';
  const ms = look ? now - look.start : now - moodSince;
  const dir = look ? look.dir : { x: 0, y: 0.5 };
  const tool = look ? look.tool : true;
  if (kind === 'found' && ms >= FOUND_MS) return undefined;
  const pose = tool ? magnifierPose(kind, ms, dir, calm) : undefined;
  return { peer: { dir, pose }, fps: tool ? magnifierFps(kind, ms, calm) : 0 };
}

// ---- 공 물어 오기 (shared/fetch.ts) ----
// 네 발 펫은 공놀이에서 공을 입에 물어 온다. 메인이 물라고 하면 고개를 숙여 바닥 공을 물고, 그 뒤로는 입 자리에 공을 그린다.
// 메인은 화면이 그리는 몸(네 발인지, 꼬리)을 보고 물어 올지 정한다 (바뀔 때만 알린다)
let carry: { toy: CarryToy; from: Point; r: number; start: number } | undefined;
/** 마지막으로 그린 문 공 가운데 (160 기준) */
let carriedAt: Point | undefined;
const toyImages: Partial<Record<CarryToy, HTMLImageElement>> = {};
function toyImage(toy: CarryToy): HTMLImageElement {
  let img = toyImages[toy];
  if (!img) {
    img = new Image();
    img.onload = () => requestFrame();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(BALL_SVG(toy === 'yarn'))}`;
    toyImages[toy] = img;
  }
  return img;
}

function carryDraw(now: number): CarryDraw | undefined {
  if (!carry) return undefined;
  const { dip, grab } = pickPose((now - carry.start) / PICK_MS);
  return { image: toyImage(carry.toy), r: carry.r, from: carry.from, dip, grab };
}

bridge.onCarry((m) => {
  if (m?.kind === 'where') {
    bridge.carried(
      carry && carriedAt ? { x: carriedAt.x / CANVAS_SIZE, y: carriedAt.y / CANVAS_SIZE } : null,
    );
    return;
  }
  if (m?.kind === 'pick') {
    const size = Number.isFinite(m.size) ? Math.min(0.6, Math.max(0.05, m.size)) : 0.2;
    // 하던 몸짓은 그만두고 공 앞에 선다 (걷기는 메인이 이미 끝냈다)
    if (activity) stopActivity(false);
    carry = {
      toy: m.toy === 'yarn' ? 'yarn' : 'ball',
      from: { x: m.from.x * CANVAS_SIZE, y: m.from.y * CANVAS_SIZE },
      r: (size * CANVAS_SIZE) / 2,
      start: performance.now(),
    };
    toyImage(carry.toy);
    // 고개를 다 든 마지막 모습을 한 번 더 그린다 (물기 동안만 30fps 로 그린다)
    setTimeout(requestFrame, PICK_MS + 20);
  } else carry = undefined;
  carriedAt = undefined;
  requestFrame();
});

let sentBody = '';
/** 그리는 몸이 바뀌면 메인에 알린다: 입체는 조립한 몸, 2D 기본 펫은 모양과 고른 걸음새, 사진은 두 발 */
function syncBody(m3d: Pet3D | undefined, img: PetImage | undefined) {
  const quad = m3d ? m3d.fourLegged : !img && quadKind(petKind, gaitPick);
  const body = { quad, tail: moveAsk().tail };
  const key = `${body.quad}/${body.tail}`;
  if (key === sentBody) return;
  sentBody = key;
  bridge.body(body);
}

// ---- 같이 지내는 느낌 (shared/together.ts) ----
// 같이 타자 치기: 메인이 "사용자가 입력하는 중"(키 내용은 모른다)을 알려 주면 작은 키보드를 꺼내 앞발로 두드린다.
// 나오고 들어가는 동안만 조금 더 촘촘히, 두드리는 동안은 12fps. 움직임 줄이기면 손을 키보드에 얹고 가만히 (한 번만 그린다)
// 같이 일하는 표정: AI 도구가 짝꿍 MCP 를 부른 뒤 잠깐 집중한 눈썹과 연필, 반짝이. 든 쪽지: 매일 쪽지를 몸 앞에 든다
let together: TogetherLook = NO_TOGETHER;
/** 키보드가 나오고 들어가기: on 나오는 중이나 나옴, at 바뀐 때, from 그때 나와 있던 정도 */
let tapEdge = { on: false, at: -1, from: 0 };
/** 두드리기 시작한 때 (박자 기준) */
let tapStart = 0;
/** 같이 일하는 표정이 시작된 때. 없으면 -1 */
let workStart = -1;

function tapK(now: number): number {
  if (tapEdge.at < 0) return 0;
  if (reducedMotion.matches) return tapEdge.on ? 1 : 0;
  const dt = now - tapEdge.at;
  return tapEdge.on
    ? Math.min(1, tapEdge.from + dt / TAP_IN_MS)
    : Math.max(0, tapEdge.from - dt / TAP_OUT_MS);
}
const tapOn = () => tapEdge.on || tapK(performance.now()) > 0;
/** 같이 타자 치기를 그릴 수 있는 몸 상태 (draw.ts tapOf 와 같은 뜻: 한가하거나 말하는 중, 걷지 않을 때) */
const canTap = () =>
  (mood === 'idle' || mood === 'talking') && (!activity || activity.type === 'sit') && !look && !carry;

function togetherDraw(now: number) {
  const k = tapK(now);
  return {
    ...(k > 0 ? { tap: { k, ms: reducedMotion.matches ? 0 : now - tapStart } } : {}),
    work: workStart >= 0 ? now - workStart : -1,
    ...(together.note ? { note: together.note } : {}),
  };
}

/** 같이 지내는 모습을 그리는 빠르기: 키보드가 나오고 들어가는 동안 24, 두드리는 동안 12, 반짝이는 8. 가만히면 0 */
function togetherFps(now: number): number {
  if (!canTap() && workStart < 0) return 0;
  const k = tapK(now);
  const calm = reducedMotion.matches;
  if (canTap() && k > 0 && (tapEdge.on ? k < 1 : true) && !calm) return 24;
  if (canTap() && k > 0 && !calm) return TAP_FPS;
  if (workStart >= 0 && !calm && mood !== 'sleeping' && mood !== 'dozing') return 8;
  return 0;
}

bridge.onTogether((next) => {
  const now = performance.now();
  if (next.typing !== tapEdge.on) {
    const from = tapK(now);
    if (next.typing && from <= 0) tapStart = now;
    tapEdge = { on: next.typing, at: now, from };
    // 두드리기 시작하면 하던 앉기 말고 다른 몸짓(하품, 두리번)은 그만둔다
    if (next.typing && activity && activity.type !== 'sit' && activity.type !== 'walk') stopActivity(false);
  }
  if (next.working !== workStart >= 0) workStart = next.working ? now : -1;
  together = next;
  requestFrame();
});

// ---- 기본 행동 (P1-06) ----
// 25~70초에 한 번, 한가하면 메인에 행동을 골라 달라고 한다. 걷기만 계속 그리고(12fps) 앉기, 두리번은 한 번 그린다.

const WALK_FPS = 12;
/** 걷기는 seg 에 지금 토막(메인이 보낸 walk 하나)을 둔다. 같은 쪽으로 이어 받으면 토막만 바뀐다 (walk-pace.ts) */
let activity: (Activity & { start: number; seg?: WalkSeg }) | undefined;
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let activityEnd: ReturnType<typeof setTimeout> | undefined;

function scheduleActivity() {
  clearTimeout(activityTimer);
  // 활발하면 자주, 졸리면 드물게 움직인다 (shared/energy.ts)
  // 배터리 절약이면 더 드물게 (shared/battery.ts)
  const wait = (energy ? ENERGY_PACE[energy.stage].wait : 1) * idleWaitFactor(saver);
  activityTimer = setTimeout(() => {
    // 같이 타자 치거나 같이 일하는 동안은 돌아다니지 않는다 (옆에서 같이 한다)
    const together = tapOn() || workStart >= 0;
    if (
      mood === 'idle' &&
      !activity &&
      !look &&
      !carry &&
      !bubbleId &&
      !overPet &&
      !gesture.dragging &&
      !together
    )
      bridge.activityRequest(moveAsk());
    scheduleActivity();
  }, nextDelay(Math.random) * wait);
}

/** 걷기 토막 (debugActivity 처럼 seg 없이 넣은 걷기는 처음부터 한 토막) */
function walkSeg(a: Extract<Activity, { type: 'walk' }> & { start: number; seg?: WalkSeg }): WalkSeg {
  return a.seg ?? { start: a.start, dx: a.dx, ms: a.ms, linear: a.linear, steps0: 0 };
}

function stopActivity(tellMain: boolean) {
  const wasWalking = activity?.type === 'walk';
  activity = undefined;
  clearTimeout(activityEnd);
  clearTimeout(activityWake);
  if (tellMain && wasWalking) bridge.activityStop();
  requestFrame();
}

/** 매운맛 토라짐 3단계: 등 돌리고 앉았다 (같이 보기 중에는 그쪽을 본다) */
function backTurned(): boolean {
  return mood === 'sulky' && inputs.pout >= 3 && !look;
}

function activityPose(now: number) {
  if (!activity) return undefined;
  if (activity.type === 'walk') {
    // 걸음은 간 거리만큼 (시간으로 세면 출발과 멈출 때, 빨리 달릴 때 발이 미끄러졌다)
    const seg = walkSeg(activity);
    return {
      type: 'walk' as const,
      dir: (activity.dx < 0 ? -1 : 1) as -1 | 1,
      phase: stepsAt(seg, now) % 1,
      steps: stepsAt(seg, now),
      ...(activity.facing ? { facing: activity.facing } : {}),
      // 출발은 처음 걷기부터, 멈춤은 지금 토막 끝(start + ms, 이어 받으면 늘어난다)에서 잰다
      since: now - activity.start,
      left: activity.start + activity.ms - now,
      segMs: seg.ms,
      // 한 걸음 길이 (펫 그림 160 기준). 입체 네 발은 디딘 발이 이만큼 뒤로 밀리게 보폭을 맞춘다
      stride: (strideLen(segSpeed(seg)) * CANVAS_SIZE) / Math.max(1, viewSize),
    };
  }
  if (activity.type === 'look') return { type: 'look' as const, dir: activity.dir };
  if (activity.type === 'sit')
    return { type: 'sit' as const, down: sitDown(now - activity.start, activity.ms) };
  if (activity.type === 'yawn' || activity.type === 'stretch')
    return { type: activity.type, t: (now - activity.start) / activity.ms };
  return { type: activity.type, t: (now - activity.start) / activity.ms, dir: activity.dir ?? 1 };
}

/** 앉아 있다가 일어나기 시작할 때 다시 그리기를 깨우는 타이머 (앉아 있는 동안은 그리지 않는다) */
let activityWake: ReturnType<typeof setTimeout> | undefined;

/**
 * 메인이 제자리 몸짓을 고를 때 쓸 펫 몸과 상태 (shared/moves.ts). 꼬리와 귀는 그려지는 몸에 있을 때만:
 * 입체는 설계도에 그 부위가 있을 때, 2D 는 냥이와 멍멍이 꼬리, 냥이, 토순이, 멍멍이 귀. 사진 펫은 몸 전체만
 */
function moveAsk(): MoveAsk {
  const calm = reducedMotion.matches;
  const hungry = inputs.hungry;
  const still = photo instanceof HTMLImageElement;
  const bp = (still ? photoModel : undefined) ?? (photo ? undefined : builtinBlueprint());
  // 기운 단계 (shared/energy.ts): 메인이 몸짓 무게, 걷기 확률과 빠르기를 정한다
  const more = energy ? { energy: energy.stage } : {};
  if (use3d && !broken3d && bp) {
    return { ...bodyOfParts(bp.parts), photo: false, calm, hungry, ...more };
  }
  if (photo) return { tail: false, ears: false, photo: true, calm, hungry, ...more };
  return {
    tail: petKind === 'cat' || petKind === 'dog',
    ears: petKind === 'cat' || petKind === 'bunny' || petKind === 'dog',
    photo: false,
    calm,
    hungry,
    ...more,
  };
}

// 사진 펫 그림 (P1-08). 없으면 기본 펫. gif, webp 는 움직이는 그림 (v1). 상태별 포즈 그림 (v1).
type PetImage = HTMLImageElement | AnimatedImage;
let photo: PetImage | undefined;
/** 지금 펫 그림의 data URL (기본 그림과 포즈). 포즈는 처음 쓸 때 푼다 (움직이는 그림 넷을 미리 다 풀면 수백 MB) */
let photoUrl: string | undefined;
let poseUrls: Partial<Record<PoseKind, string>> = {};
/** 바꾸는 중인 다음 그림 묶음의 data URL */
let nextUrls: Set<string> | undefined;
/** 풀어 둔 그림 (data URL 별). 같은 그림을 여러 포즈에 써도 한 번만 푼다. 못 풀었으면 null */
const decoded = new Map<string, PetImage | null>();
/** 푸는 중인 그림 */
const decoding = new Map<string, Promise<PetImage | undefined>>();
let petKind: PetKind = 'kong';
let cushion = false;
/** 머리에 꽃 (친밀도 600) */
let flower = false;
/** 성장 단계와 오늘 옷 (기본 펫만, shared/wear.ts) */
let wear: WearLook | undefined;
/** 입체 모습마다 옷을 털 밖으로 내는 길이 (실사, 복슬복슬은 털이 길다) */
const WEAR_PUFF: Record<PetStyle, number> = { figure: 0, game: 0.006, real: 0.018, fluffy: 0.07 };
/** 기본 펫 설계도에 성장과 옷을 입힌 것. 같은 값이면 같은 것을 돌려줘 다시 조립하지 않는다 */
let dressed: { key: string; bp: Blueprint } | undefined;
function builtinBlueprint(): Blueprint {
  const key = `${petKind}|${style3d}|${wear?.stage ?? ''}|${wear?.outfit ?? ''}`;
  if (dressed?.key !== key)
    dressed = { key, bp: dressBlueprint(DEFAULT_BLUEPRINTS[petKind], wear, WEAR_PUFF[style3d]) };
  return dressed.bp;
}
/** 효과음 (설정) */
let sounds = false;
/** 부스트 모드 (설정, 배터리면 메인이 끈다) */
let boost = false;
/** 배터리 절약 (설정 편의, 배터리나 저전력이면 메인이 켠다) */
let saver = false;
/** 말풍선 읽어 주기 (설정 편의). 친구 펫은 끔 */
let readAloud = false;
/** 친밀도로 열린 몸짓. 끝나면 지운다 */
let trick: { type: 'wave' | 'dance'; start: number } | undefined;
const TRICK_MS = { wave: 1800, dance: 1400 } as const;
/** 움직임 줄이기 (운영체제 설정). 빙글 춤은 건너뛰고 신남은 살짝만 들썩인다. 걷기와 창 옮기기는 그대로 */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change', () => requestFrame());
let imageLoad = 0;
/** AI 일러스트 나이 배율 (아기, 청소년은 작게. 사용자 크기 설정 위에 곱한다, illustrate.ts) */
let photoScale = 1;
/** 사진 속 눈 자리 (밀크, 초코 그림만. photo-eyes.ts). 잠, 졸음, 깜빡임에 사진 눈을 감긴다 */
let photoEyes: PhotoEyes | undefined;
function wantedUrl(url: string): boolean {
  return url === photoUrl || Object.values(poseUrls).includes(url) || !!nextUrls?.has(url);
}
function release(img: PetImage | null | undefined) {
  if (img instanceof AnimatedImage) img.close();
}
/** 움직이는 그림을 풀 크기: 지금 펫 크기와 화면 배율에 맞춘다 */
function frameSideNow(): number {
  return frameSide(viewSize, window.devicePixelRatio || 1);
}
/** 다 푼 그림을 넣어 둔다. replacing 은 더 선명하게 다시 푼 그림이 갈아 끼울 옛 그림 */
function settle(url: string, img: PetImage | undefined, replacing?: PetImage): PetImage | undefined {
  decoding.delete(url);
  const cur = decoded.get(url);
  if (replacing && !img) return replacing;
  if (!wantedUrl(url) || (cur !== undefined && cur !== replacing)) {
    release(img);
    return wantedUrl(url) ? (cur ?? undefined) : undefined;
  }
  decoded.set(url, img ?? null);
  if (replacing) {
    if (photo === replacing) photo = img;
    release(replacing);
    requestFrame();
  }
  return img;
}
/** data URL 을 풀어 둔다 (이미 풀었거나 푸는 중이면 그것을) */
function acquire(url: string): Promise<PetImage | undefined> {
  const have = decoded.get(url);
  if (have !== undefined) return Promise.resolve(have ?? undefined);
  let p = decoding.get(url);
  if (!p) {
    p = loadPetImage(url, frameSideNow()).then((img) => settle(url, img));
    decoding.set(url, p);
  }
  return p;
}
/** 펫을 키우거나 레티나 화면으로 옮겨 줄여 둔 움직이는 그림이 흐려지면 그 크기로 다시 푼다 */
function sharpenImages() {
  const side = frameSideNow();
  for (const [url, img] of decoded) {
    if (!(img instanceof AnimatedImage) || !img.reduced || decoding.has(url)) continue;
    // 예산 때문에 바란 것보다 작게 풀린 그림은 더 큰 크기를 바랄 때만 다시 (같은 크기로 또 풀지 않게)
    if (Math.max(img.width, img.height) * 1.2 >= side || img.asked * 1.2 >= side) continue;
    decoding.set(
      url,
      loadPetImage(url, side).then((next) => settle(url, next, img)),
    );
  }
}
/** 포즈 그림. 아직 안 풀었으면 풀기 시작하고 undefined (그동안은 기본 그림) */
function poseImage(k: PoseKind): PetImage | undefined {
  const url = poseUrls[k];
  if (!url) return undefined;
  if (url === photoUrl) return photo;
  const img = decoded.get(url);
  if (img === undefined && !decoding.has(url)) void acquire(url).then(() => requestFrame());
  return img ?? undefined;
}
bridge.onImage(async (images: PetImages) => {
  const mine = ++imageLoad;
  const next = new Set<string>();
  if (images.main) next.add(images.main);
  for (const url of Object.values(images.poses)) if (url) next.add(url);
  nextUrls = next;
  const [main, depthImg] = await Promise.all([
    images.main ? acquire(images.main) : Promise.resolve(undefined),
    images.depth ? loadPetImage(images.depth) : Promise.resolve(undefined),
  ]);
  if (mine !== imageLoad) {
    // 그사이 또 바뀌었다 (풀어 둔 기본 그림은 다음 묶음이 정리한다)
    release(depthImg);
    return;
  }
  nextUrls = undefined;
  photoUrl = images.main ?? undefined;
  poseUrls = { ...images.poses };
  photo = main;
  photoModel = images.model ?? undefined;
  photoDepth = depthImg instanceof HTMLImageElement ? depthImg : undefined;
  if (!photoDepth) release(depthImg);
  photoScale = ageScale(images.age);
  photoEyes = images.starter ? STARTER_EYES[images.starter] : undefined;
  // 이제 안 쓰는 그림은 돌려준다
  for (const [url, img] of decoded)
    if (!wantedUrl(url)) {
      decoded.delete(url);
      release(img);
    }
  requestFrame();
});

/**
 * 지금 상태에 맞는 그림: 신남 → 기쁨 포즈, 잠과 졸음 → 졸림 포즈, 배고픈 기본 상태 → 배고픔 포즈.
 * 기운이 졸림인 기본 상태도 졸림 포즈 (사진은 눈을 바꿀 수 없어서)
 */
function pickImage(m: PetMood, hungry: boolean): PetImage | undefined {
  if (!photo) return undefined;
  // 포즈는 고른 것만 푼다 (poseImage)
  if (m === 'excited') return poseImage('happy') ?? photo;
  if (m === 'sleeping' || m === 'dozing') return poseImage('sleepy') ?? photo;
  if (m === 'idle' && energy?.stage === 'sleepy' && !activity && poseUrls.sleepy) {
    const sleepy = poseImage('sleepy');
    if (sleepy) return sleepy;
  }
  if (m === 'idle' && hungry) return poseImage('hungry') ?? photo;
  return photo;
}

// 입체 펫 (6단계). 처음 그릴 때 만들고, WebGL 을 못 쓰거나 잃으면 2D 그림으로 돌아간다.
// three.js 가 든 모듈은 입체를 쓸 때만 불러온다 (2D 로 쓰는 사람은 펫 화면 JS 힙 2.4MB 를 아낀다)
let statusKnown = false;
let use3d = false;
let pet3dModule: typeof import('./pet3d.ts') | undefined;
let pet3dLoading = false;
let model3d: Pet3D | undefined;
/** 지금 조립해 둔 것 (설계도, 또는 2.5D 깊이 그림) */
let model3dOf: Blueprint | HTMLImageElement | undefined;
/** 사진 펫을 AI 가 입체로 만든 설계도 (6단계) */
let photoModel: Blueprint | undefined;
/** 사진 펫의 2.5D 깊이 그림 (6단계) */
let photoDepth: HTMLImageElement | undefined;
let broken3d = false;
/** 입체 모습 (설정, PetStatus.look) */
let style3d: PetStyle = 'figure';
/** 사용자가 고른 걸음새 (설정, PetStatus.gait). 없으면 자동 */
let gaitPick: Gait | undefined;
/** 사진 동물 페어리를 네 발로 선 피규어로 보는지 (설정, PetStatus.stand) */
let standPick = false;
/** 고른 걸음새를 덮은 설계도. 같은 설계도와 같은 값이면 같은 것을 돌려줘 다시 조립하지 않는다 */
let picked: { from: Blueprint; gait: Gait | undefined; stand: boolean; bp: Blueprint } | undefined;
function pickedBlueprint(bp: Blueprint | undefined): Blueprint | undefined {
  if (!bp) return undefined;
  if (picked?.from !== bp || picked.gait !== gaitPick || picked.stand !== standPick) {
    // 네 발로 서기는 사진 펫 설계도에만 (기본 펫과 밀크, 초코는 그대로)
    const stood = standPick && bp === photoModel ? standingBlueprint(bp) : undefined;
    picked = { from: bp, gait: gaitPick, stand: standPick, bp: stood ?? withGait(bp, gaitPick) };
  }
  return picked.bp;
}
function current3d(): Pet3D | 'loading' | undefined {
  // 사진 펫은 설계도나 깊이 그림이 있을 때만 입체로. 움직이는 그림은 입체 판으로 만들지 않는다
  const still = photo instanceof HTMLImageElement;
  const bp = pickedBlueprint((still ? photoModel : undefined) ?? (photo ? undefined : builtinBlueprint()));
  const relief = !bp && still ? photoDepth : undefined;
  if (!use3d || broken3d || (!bp && !relief)) {
    // 입체를 안 쓰면 모양만 내린다. 렌더러는 버리지 않고 다시 쓴다(버리고 새로 만들면 컨텍스트가 샌다)
    if (model3dOf) model3d?.clear();
    model3dOf = undefined;
    return undefined;
  }
  if (!pet3dModule) {
    if (!pet3dLoading) {
      pet3dLoading = true;
      import('./pet3d.ts').then(
        (m) => {
          pet3dModule = m;
          requestFrame();
        },
        () => {
          broken3d = true;
          requestFrame();
        },
      );
    }
    return 'loading';
  }
  model3d ??= pet3dModule.Pet3D.create(() => {
    broken3d = true;
    requestFrame();
  });
  // 복슬복슬 털이 다 붙으면 다시 그린다 (몸은 프레임 사이에 조금씩 만든다)
  if (model3d) model3d.onUpdate = requestFrame;
  if (!model3d) {
    broken3d = true;
    return undefined;
  }
  // 나이 배율은 사진 펫에만 (기본 펫 설계도는 그대로)
  model3d.setSizeScale(photo ? photoScale : GROW_LOOK[wear?.stage ?? 'adult'].scale);
  const want = bp ?? relief;
  // 모습을 바꾸면 털, 테두리, 눈을 다시 붙여야 해서 다시 조립한다
  if (model3d.setStyle(style3d)) model3dOf = undefined;
  if (model3dOf !== want) {
    if (bp) model3d.setBlueprint(bp);
    else if (relief && photo instanceof HTMLImageElement) model3d.setRelief(photo, relief);
    model3dOf = want;
  }
  return model3d;
}

// 이름 옆 얼굴 (shared/face.ts). 모습(종류, 입체 여부, 사진, 설계도)이 바뀐 뒤 처음 그릴 때 한 번 그려 메인에 준다.
// 펫이 지금 무엇을 하든 얼굴은 쉬는 모습, 뜬 눈으로. 쓰는 렌더러는 펫 화면 것 하나 그대로다
let wantFace = false;
let faceKey: unknown[] = [];
function syncFace(m3d: Pet3D | undefined) {
  if (!wantFace) return;
  // 입체 모습(피규어, 게임, 실사)을 바꿔도 다시 (같은 설계도라 입체와 설계도는 그대로다)
  const key = [m3d, m3d ? model3dOf : undefined, m3d ? style3d : undefined, m3d?.version, photo, petKind];
  if (key.length === faceKey.length && key.every((v, i) => v === faceKey[i])) return;
  faceKey = key;
  const still = photo instanceof AnimatedImage ? photo.frameAt(0) : photo;
  const url = renderFace({
    kind: petKind,
    photo: m3d ? undefined : still,
    model3d: m3d,
    relief: !!m3d && model3dOf instanceof HTMLImageElement,
  });
  if (url) bridge.face(url);
}

// 집 안 그림 (집에서 쉬기, shared/house-room.ts): 문으로 걸어 들어가고 나오는 깬 몸, 침대 베개 위 자는 얼굴.
// 얼굴과 같이 모습이 바뀐 뒤 처음 그릴 때 한 번만 그려 메인에 준다 (메인이 집 창에 넣는다)
let spriteKey: unknown[] = [];
function syncSprites(m3d: Pet3D | undefined) {
  if (!wantFace) return;
  // 입체 모습(피규어, 게임, 실사)을 바꿔도 다시 (같은 설계도라 입체와 설계도는 그대로다)
  const key = [
    m3d,
    m3d ? model3dOf : undefined,
    m3d ? style3d : undefined,
    m3d?.version,
    photo,
    petKind,
    photoScale,
    photoEyes,
  ];
  if (key.length === spriteKey.length && key.every((v, i) => v === spriteKey[i])) return;
  spriteKey = key;
  const still = photo instanceof AnimatedImage ? photo.frameAt(0) : photo;
  const src = {
    kind: petKind,
    photo: m3d ? undefined : still,
    model3d: m3d,
    relief: !!m3d && model3dOf instanceof HTMLImageElement,
    photoScale,
    eyes: photoEyes,
  };
  const body = renderBody(src);
  const sleep = renderFace(src, 128, 'sleeping');
  if (body && sleep) bridge.sprites({ awake: body.url, sleep, box: body.box });
}

bridge.onStatus((status) => {
  petKind = status.kind;
  wantFace = status.face === true;
  // 입체를 다시 켜면 한 번 더 해 본다 (그래픽 오류로 2D 가 됐어도)
  if (status.pet3d && !use3d && broken3d) {
    broken3d = false;
    // 잃은 렌더러도 놓는다 (안 놓으면 다시 만들 때마다 컨텍스트가 쌓인다)
    model3d?.dispose();
    model3d = undefined;
    model3dOf = undefined;
  }
  use3d = status.pet3d;
  if ((status.style ?? 'figure') !== style3d) {
    style3d = status.style ?? 'figure';
    requestFrame();
  }
  // 걸음새를 바꾸면 펫 창을 다시 켜지 않고 다음 그림부터 (설계도를 덮어 다시 조립한다)
  if (status.gait !== gaitPick || !!status.stand !== standPick) {
    gaitPick = status.gait;
    standPick = !!status.stand;
    requestFrame();
  }
  statusKnown = true;
  cushion = status.cushion;
  flower = status.flower;
  if (JSON.stringify(status.wear) !== JSON.stringify(wear)) {
    wear = status.wear;
    requestFrame();
  }
  sounds = status.sounds;
  boost = status.boost;
  readAloud = status.readAloud === true;
  if ((status.saver === true) !== saver) {
    saver = status.saver === true;
    scheduleActivity();
    requestFrame();
  }
  // 기운은 단계나 녹초가 바뀔 때만 다시 그린다 (1분에 한 번 이하, 메인이 같은 상태면 보내지도 않는다)
  const nextEnergy = energyLookOf(status.energy);
  if (!sameLook(nextEnergy, energy)) {
    energy = nextEnergy;
    scheduleBlink();
    scheduleActivity();
  }
  const pout = status.pout ?? 0;
  // 등 돌리고 앉는 단계가 되면 하던 걷기와 몸짓을 그만둔다 (앉기는 그대로)
  if (pout >= 3 && inputs.pout < 3 && activity && activity.type !== 'sit') stopActivity(true);
  setInputs({ hungry: status.hungry, focusTimer: status.focus, sulkLevel: status.sulk, pout });
});
// 커서 바라보기: 방향 칸이 바뀔 때만 온다. 한가한 모습(기본, 앉기)일 때만 한 번 다시 그린다
let gaze: Gaze | null = null;
bridge.onGaze((g) => {
  gaze = g;
  if (mood === 'idle' && (!activity || activity.type === 'sit')) requestFrame();
});
// 던져져 날아가는 동안은 잡힌 얼굴 (> <)
bridge.onFlight((flying) => setInputs({ grabbed: flying }));
// 할 일을 끝내거나 밥을 먹으면 신나서 통통 튄다.
// 친밀도로 열린 몸짓: 돌아오면 손 흔들기(100), 할 일을 끝내면 빙글 춤(300)
bridge.onReact((kind) => {
  const now = performance.now();
  if (kind === 'love') {
    // 친구 펫과 만났다: 하트만 (통통 튀면 마주 본 모습이 깨진다)
    heartsStart = now;
    sound('purr');
    requestFrame();
    return;
  }
  if (kind === 'wave') {
    trick = { type: 'wave', start: now };
    // 돌아왔으니 잠에서 깬다 (메인의 다음 알림을 기다리지 않고)
    setInputs({ userIdleMs: 0 });
    sound('wave');
    return;
  }
  if (kind === 'fresh') {
    refreshed(now);
    return;
  }
  if (kind === 'cheer') {
    // 큰 축하: 색종이가 터지고 통통 튄다. 움직임 줄이기면 색종이 대신 하트만
    if (reducedMotion.matches) heartsStart = now;
    else confettiStart = now;
    setInputs({ excitedUntil: now + EXCITED_MS });
    sound('happy');
    requestFrame();
    return;
  }
  if (kind === 'dance' && !reducedMotion.matches) trick = { type: 'dance', start: now };
  setInputs({ excitedUntil: now + EXCITED_MS });
  sound(kind === 'fed' ? 'fed' : kind === 'dance' ? 'dance' : 'happy');
});

/**
 * 개운함 (shared/energy.ts): 지쳤다가 쉬고 왔다. 돌아왔으니 깨고, 한가하면 기지개를 쭉 켜며 머리 둘레가 반짝인다.
 * 걷던 중이면 반짝임만. 집중 중(잠)이면 깨우지 않는다 (메인이 집중 중에는 보내지 않는다)
 */
function refreshed(now: number) {
  if (!inputs.focusTimer) setInputs({ userIdleMs: 0 });
  freshStart = now;
  const m = moodOf(inputs, now);
  if ((m === 'idle' || m === 'sulky') && activity?.type !== 'walk' && !look && !carry) {
    activity = { type: 'stretch', ms: MOVE_SPECS.stretch.ms, start: now };
    clearTimeout(activityEnd);
    clearTimeout(activityWake);
    activityEnd = setTimeout(() => stopActivity(false), MOVE_SPECS.stretch.ms);
  }
  sound('happy');
  requestFrame();
}

/** 효과음 (설정, 기본 끔). 집중, 잠, 바쁨 중에는 안 낸다 */
function sound(kind: SoundKind) {
  if (canPlay({ enabled: sounds, focus: inputs.focusTimer, mood })) playSound(kind);
}
// 놀이 효과음 (방울 터짐, 간식): 메인이 알려 주면 같은 규칙으로 낸다
bridge.onSound((kind) => sound(kind));

bridge.onActivity((a) => {
  // 같이 보기 중에는 그쪽만 본다
  if (look) {
    if (a.type === 'walk') bridge.activityStop();
    return;
  }
  // 삐져 있어도 걷고 논다 (모습만 삐진 얼굴). 매운맛 토라짐 3단계는 등 돌리고 앉아 혼자 돌아다니지 않는다 (앉기만).
  // 사용자가 부른 걸음(놀기, 산책, 집 드나들기)은 간다: 막으면 놀아서 달래기가 3단계에서 안 된다
  const sulkBlocks = backTurned() && a.type !== 'sit' && !(a.type === 'walk' && !a.idle);
  if ((mood !== 'idle' && mood !== 'sulky') || sulkBlocks) {
    if (a.type === 'walk') bridge.activityStop();
    return;
  }
  const now = performance.now();
  // 같은 쪽으로 걷던 중에 이어 받은 걷기 (따라 달리기는 1초마다 이어 보낸다): 출발과 돌아서기를 다시 하지 않고
  // 걸음도 끊기지 않게 잇는다. 예전엔 받을 때마다 처음부터 다시 걸어 1초마다 정면으로 돌아섰다
  const prev = activity?.type === 'walk' ? activity : undefined;
  const seg =
    a.type === 'walk' && prev
      ? continueSeg(walkSeg(prev), { start: now, dx: a.dx, ms: a.ms, linear: a.linear })
      : undefined;
  activity =
    seg && prev && a.type === 'walk'
      ? { ...a, start: prev.start, ms: now - prev.start + a.ms, seg }
      : { ...a, start: now };
  clearTimeout(activityEnd);
  clearTimeout(activityWake);
  activityEnd = setTimeout(() => stopActivity(false), a.ms);
  // 앉기는 앉은 뒤 그리기를 멈췄다가 일어날 때 다시 깨운다
  if (a.type === 'sit' && a.ms > SIT_MS * 2) activityWake = setTimeout(requestFrame, a.ms - SIT_MS);
  requestFrame();
});

/** 3~7초에 한 번 깜빡인다 (기운대로 더 잦거나 드물게). 깜빡일 수 없는 상태(잠, 바쁨)에서는 타이머도 걸지 않는다. */
function scheduleBlink() {
  clearTimeout(blinkTimer);
  if (!canBlink(mood)) return;
  const b = blinkSpec();
  blinkTimer = setTimeout(
    () => {
      if (canBlink(mood)) {
        blinkStart = performance.now();
        // 첫 틀(t=0)은 뜬 눈 그대로라 건너뛴다. 이미 그리는 중이면(걷기 등) 그 흐름이 깜빡임도 그린다
        frameTimer ??= setTimeout(frame, blinkSpec().ms / blinkSpec().frames);
      }
      scheduleBlink();
    },
    b.every + Math.random() * b.spread,
  );
}

// ---- 화면 배율과 펫 크기 ----
// 모니터를 옮기면 화면 배율(1, 2)이, 크기를 조절하면 창 크기가 바뀐다. 둘 다 캔버스 해상도를 맞춰 다시 그린다.
// 그리기는 늘 160 기준 좌표로 하고 변환으로 키운다.
// 말풍선이 뜨면 창이 펫보다 커진다. 메인이 창 안 펫 자리(petBox)를 알려 준다.
let petBox = { x: 0, y: 0, size: window.innerWidth || CANVAS_SIZE };
let viewSize = petBox.size;

function fitToScreen() {
  viewSize = petBox.size;
  // 줄여 풀어 둔 움직이는 그림이 이제 작으면 다시 푼다 (펫 크기, 화면 배율)
  sharpenImages();
  const resized = sizeLayer(canvas, cpuCtx);
  if (gpuLayer && sizeLayer(...gpuLayer) && ctx !== cpuCtx) hitCache = undefined;
  if (!resized) {
    requestFrame();
    return;
  }
  // 캔버스 크기를 바꾸면 그림이 지워진다. 다음 틀을 기다리면 빈 캔버스가 한 번 화면에 나가
  // 커지고 작아지는 동안(집 문 드나들기, 두더지) 펫이 깜빡였다. 바로 다시 그린다
  clearTimeout(frameTimer);
  frame();
}

/** 캔버스 자리와 해상도를 펫 칸에 맞춘다. 해상도를 바꿨으면 true (그림이 지워졌다) */
function sizeLayer(el: HTMLCanvasElement, g: CanvasRenderingContext2D): boolean {
  const dpr = window.devicePixelRatio || 1;
  Object.assign(el.style, {
    left: `${petBox.x}px`,
    top: `${petBox.y}px`,
    width: `${viewSize}px`,
    height: `${viewSize}px`,
  });
  const px = Math.round(viewSize * dpr);
  if (el.width === px && el.height === px) return false;
  el.width = px;
  el.height = px;
  const k = (dpr * viewSize) / CANVAS_SIZE;
  g.setTransform(k, 0, 0, k, 0, 0);
  return true;
}

function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener(
    'change',
    () => {
      fitToScreen();
      watchPixelRatio();
    },
    { once: true },
  );
}
// 메인이 알려 주기 전(처음 켤 때)에는 창 = 펫이다.
window.addEventListener('resize', () => {
  if (!bubbleShown) petBox = { x: 0, y: 0, size: window.innerWidth || CANVAS_SIZE };
  fitToScreen();
});
watchPixelRatio();
fitToScreen();
scheduleBlink();
scheduleActivity();

// ---- 마우스 ----

const gesture = new GestureTracker();
let overPet = false;

/** 커서 아래 픽셀이 비어 있지 않으면 펫 위다. 투명한 곳은 클릭을 아래 앱으로 넘긴다. */
function hitTest(wx: number, wy: number): boolean {
  const x = wx - petBox.x;
  const y = wy - petBox.y;
  if (x < 0 || y < 0 || x >= viewSize || y >= viewSize) return false;
  const g = ctx;
  const dpr = g.canvas.width / viewSize;
  const px = Math.floor(x * dpr);
  const py = Math.floor(y * dpr);
  const c = hitCache;
  if (c && c.frame === drawn && c.x === px && c.y === py) return c.hit;
  const hit = (g.getImageData(px, py, 1, 1).data[3] ?? 0) > 16;
  hitCache = { frame: drawn, x: px, y: py, hit };
  return hit;
}

function setOverPet(hit: boolean) {
  if (hit === overPet) return;
  overPet = hit;
  bridge.hover(hit);
}

// 창이 클릭을 통과시키는 동안에도 forward 옵션 덕분에 마우스 이동은 들어온다.
// 쓰다듬기 (v1): 버튼 없이 펫 위에서 좌우로 문지르면 하트가 뜨고 메인에 알린다.
const rub = new RubTracker();
let heartsStart = -1;

window.addEventListener('mousemove', (e) => {
  if (gesture.dragging) return;
  // 말풍선 위도 클릭을 받아야 버튼을 누를 수 있다.
  const overBubble = bubbleShown && bubbleEl.contains(document.elementFromPoint(e.clientX, e.clientY));
  const onPet = !overBubble && hitTest(e.clientX, e.clientY);
  setOverPet(overBubble || onPet);
  setBubbleHover(overBubble);
  if (!onPet || e.buttons !== 0) rub.reset();
  else if (rub.move(e.screenX, performance.now())) {
    heartsStart = performance.now();
    bridge.petted();
    sound('purr');
    requestFrame();
  }
});
document.addEventListener('mouseleave', () => {
  rub.reset();
  if (!gesture.dragging) setOverPet(false);
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return;
  canvas.setPointerCapture(e.pointerId);
  gesture.down(e.button, e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  const event = gesture.move(e.clientX, e.clientY);
  if (!event) return;
  setInputs({ grabbed: true });
  bridge.gesture(event);
});

canvas.addEventListener('pointerup', (e) => {
  const event = gesture.up(e.button);
  if (!event) return;
  bridge.gesture(event);
  if (event.type === 'drag-end') setInputs({ grabbed: false });
  // 클릭하면 메인이 채팅 창을 연다(패널은 2단계). 펫은 반가워서 잠깐 신난다.
  else setInputs({ excitedUntil: performance.now() + EXCITED_MS });
});

canvas.addEventListener('lostpointercapture', () => {
  const event = gesture.cancel();
  if (!event) return;
  bridge.gesture(event);
  setInputs({ grabbed: false });
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (hitTest(e.clientX, e.clientY)) bridge.contextMenu();
});

// 펫 위 휠: Cmd(Ctrl) + 휠이나 트랙패드 핀치(ctrlKey 로 온다)는 크기 조절, 그냥 휠은 아래 창으로.
// 트랙패드는 이벤트가 잘게 많이 오므로 한 프레임(16ms) 동안 모아서 보낸다.
let wheelDelta = 0;
let wheelZoom = false;
let wheelTimer: ReturnType<typeof setTimeout> | undefined;
canvas.addEventListener(
  'wheel',
  (e) => {
    const zoom = e.ctrlKey || e.metaKey;
    if (zoom) e.preventDefault();
    if (wheelTimer && zoom !== wheelZoom) return;
    wheelZoom = zoom;
    wheelDelta += e.deltaY;
    wheelTimer ??= setTimeout(() => {
      bridge.wheel(wheelDelta, wheelZoom);
      wheelDelta = 0;
      wheelTimer = undefined;
    }, 16);
  },
  { passive: false },
);

// ---- 말풍선 ----
// 메인이 띄우라고 하면: 그려서 크기를 재 메인에 알리고, 메인이 창을 키운 뒤 자리를 알려 주면 보인다.
// 8초(마우스를 올리면 멈춤) 뒤나 누르면 닫힌다.

const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
const bubbleText = bubbleEl.querySelector('p') as HTMLParagraphElement;
const bubbleImage = bubbleEl.querySelector('img') as HTMLImageElement;
const bubbleActions = bubbleEl.querySelector('.actions') as HTMLDivElement;
let bubbleShown = false;
let bubbleId = '';
let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
let bubbleLeft = 0;
let bubbleHover = false;
/** 그림자가 창 끝에서 잘리지 않게 말풍선 둘레에 남길 여백 */
const BUBBLE_MARGIN = 6;

function closeBubble(action: string) {
  if (!bubbleId) return;
  const id = bubbleId;
  hideBubble();
  bridge.bubbleClosed(id, action);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  bubbleId = '';
  bubbleShown = false;
  bubbleHover = false;
  bubbleEl.hidden = true;
  bubbleEl.classList.remove('shown');
  setInputs({ talkingUntil: 0 });
}

function startBubbleTimer() {
  clearTimeout(bubbleTimer);
  if (bubbleLeft > 0) bubbleTimer = setTimeout(() => closeBubble('timeout'), bubbleLeft);
}

function setBubbleHover(on: boolean) {
  if (!bubbleId || on === bubbleHover) return;
  bubbleHover = on;
  if (on) clearTimeout(bubbleTimer);
  else startBubbleTimer();
}

bridge.onBubble((b) => {
  if (!b) {
    hideBubble();
    return;
  }
  bubbleId = b.id;
  bubbleLeft = b.ttlMs;
  if (b.kind === 'schedule') sound('bell');
  bubbleText.textContent = b.text;
  // 펼친 쪽지는 종이 모양 (pet.css)
  if (b.paper) bubbleEl.dataset.paper = b.paper;
  else delete bubbleEl.dataset.paper;
  if (readAloud) announce(b.text);
  bubbleImage.hidden = !b.image;
  if (b.image) bubbleImage.src = b.image;
  else bubbleImage.removeAttribute('src');
  bubbleActions.replaceChildren(
    ...b.buttons.map((btn) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = btn.label;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        closeBubble(btn.id);
      });
      return el;
    }),
  );
  bubbleActions.hidden = b.buttons.length === 0;
  // 보이지 않게 그려서 잰다. 자리는 메인이 창을 키운 뒤 정한다.
  bubbleEl.hidden = false;
  bubbleEl.classList.remove('shown');
  const r = bubbleEl.getBoundingClientRect();
  bridge.bubbleSize(b.id, r.width + BUBBLE_MARGIN * 2, r.height + BUBBLE_MARGIN * 2);
  setInputs({ talkingUntil: performance.now() + b.ttlMs + 60_000 });
});

bridge.onLayout((layout) => {
  petBox = { x: layout.pet.x, y: layout.pet.y, size: layout.pet.size };
  bubbleShown = !!layout.bubble && !!bubbleId;
  if (layout.bubble && bubbleId) {
    Object.assign(bubbleEl.style, {
      left: `${layout.bubble.x + BUBBLE_MARGIN}px`,
      top: `${layout.bubble.y + BUBBLE_MARGIN}px`,
    });
    bubbleEl.style.setProperty('--tail-x', `${layout.bubble.tailX - BUBBLE_MARGIN}px`);
    bubbleEl.dataset.side = layout.bubble.side;
    bubbleEl.classList.add('shown');
    startBubbleTimer();
  }
  fitToScreen();
});

// 말풍선 몸통을 누르면 닫는다(버튼은 위에서 따로 처리).
bubbleEl.addEventListener('click', () => closeBubble('dismiss'));

// ---- 접근성: 읽어 주기, 키보드로 펫 다루기 ----
// 말풍선은 숨겼다 보였다 하며 글을 바꿔서 화면 읽기 프로그램이 놓치기 쉽다. 늘 있는 보이지 않는 알림 칸(aria-live)에
// 같은 글을 옮겨 적는다. 같은 말이 다시 와도 읽게 한 번 비우고 다음 틀에 넣는다
const liveEl = document.getElementById('sr-live') as HTMLDivElement;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
function announce(text: string) {
  clearTimeout(liveTimer);
  liveEl.textContent = '';
  liveTimer = setTimeout(() => {
    liveEl.textContent = text;
  }, 60);
}
let keysOn = false;
bridge.onKeys((name) => {
  const on = name !== null;
  keysOn = on;
  canvas.classList.toggle('keys', on);
  canvas.tabIndex = on ? 0 : -1;
  if (name !== null) {
    canvas.setAttribute('aria-label', t('pet.keys.label', { name }));
    canvas.focus({ preventScroll: true });
    announce(t('pet.keys.focused', { name }));
  } else {
    canvas.setAttribute('aria-label', t('common.appName'));
    canvas.blur();
  }
});
canvas.addEventListener('keydown', (e) => {
  if (!keysOn) return;
  const key = petKeyOf(e);
  if (!key) return;
  e.preventDefault();
  bridge.petKey(key);
});
canvas.addEventListener('blur', () => {
  if (keysOn) bridge.petKey('leave');
});

// ---- 메인이 알려 주는 환경 ----
// 5초마다 온다. 기분이 그대로면 값만 바꾸고 다시 그리지 않는다 (잠, 바쁨에서 쓸데없이 그렸다)
bridge.onEnv((env) => {
  const next = { ...inputs, systemBusy: env.systemBusy, userIdleMs: env.userIdleMs };
  if (moodOf(next, performance.now()) === mood) inputs = next;
  else setInputs({ systemBusy: env.systemBusy, userIdleMs: env.userIdleMs });
});
// AI 답을 기다리는 동안 생각 중, 답이 오면 잠깐 말하기 동작.
bridge.onAi((ai) => {
  aiWithImage = ai.thinking && ai.withImage === true;
  setInputs({ thinking: ai.thinking, ...(ai.answered ? { talkingUntil: performance.now() + TALK_MS } : {}) });
});

// 개발용: DevTools 에서 상태를 바꿔 보는 손잡이. 빌드에도 남지만 외부에서 부를 길은 없다.
Object.assign(window, {
  __pet: {
    setInputs,
    requestActivity: () => bridge.activityRequest(moveAsk()),
    moveAsk,
    /** 기운을 바로 넣는다 (그림 점검용, 메인을 거치지 않는다). undefined 면 예전 모습 */
    debugEnergy: (e?: EnergyLook) => {
      energy = energyLookOf(e);
      scheduleBlink();
      requestFrame();
    },
    /** 복슬복슬 털 녹이기를 바로 끝낸다 (그림 점검용: 녹이는 중에 찍으면 매끈한 몸이 찍힌다). 몸이 바뀐 횟수를 돌려준다 */
    debugSettle3d: () => {
      model3d?.finishFuse();
      requestFrame();
      return model3d?.version;
    },
    /** 개운함 반짝임을 진행 at(0~1) 자리에서 멈춰 그린다 (그림 점검용) */
    debugFresh: (at = 0.4) => {
      freshStart = performance.now() - FRESH_MS * at;
      requestFrame();
    },
    get energy() {
      return energy;
    },
    /** 행동을 바로 넣는다. at 은 진행 정도 0~1 (하품, 기지개 가운데를 찍을 때). 없으면 그만 */
    debugActivity: (a?: Activity, at = 0) => {
      activity = a ? { ...a, start: performance.now() - a.ms * at } : undefined;
      requestFrame();
    },
    /** 몸짓을 바로 넣는다. at 은 진행 정도 0~1 (디자인 점검 때 가운데를 찍으려고) */
    debugTrick: (type: 'wave' | 'dance', at = 0.3) => {
      trick = { type, start: performance.now() - TRICK_MS[type] * at };
      requestFrame();
    },
    /** 같이 보기 자세를 바로 넣는다. at 은 단계에 들어온 뒤 흐른 시간(ms). null 이면 그만 (메인을 거치지 않는 그림 점검용) */
    debugLook: (m: LookMotion | null, at = 0) => {
      clearTimeout(lookEnd);
      look = m ? { ...m, start: performance.now() - at } : undefined;
      requestFrame();
    },
    get look() {
      return look;
    },
    /** 다음 그리기가 걸려 있는지 (끝난 뒤 타이머가 남지 않았는지 볼 때) */
    get framePending() {
      return frameTimer !== undefined;
    },
    get mood() {
      return mood;
    },
    /** 같이 지내는 모습을 바로 넣는다 (메인을 거치지 않는 그림 점검용). at 은 두드린 시간(ms) */
    debugTogether: (next: TogetherLook, at = 0) => {
      const now = performance.now();
      together = next;
      tapEdge = next.typing ? { on: true, at: now - TAP_IN_MS, from: 0 } : { on: false, at: -1, from: 0 };
      tapStart = now - at;
      workStart = next.working ? now - at : -1;
      requestFrame();
    },
    get together() {
      return { ...together, tapK: tapK(performance.now()), canTap: canTap() };
    },
    get inputs() {
      return inputs;
    },
    /** 발 기록을 켜고(true) 끄고(false) 모은 것을 돌려준다 (네 발로 선 입체 몸의 디딘 발 미끄러짐 재기) */
    debugFeetLog: (on: boolean) => {
      const got = feetLog ?? [];
      feetLog = on ? [] : undefined;
      return got;
    },
    /**
     * 그림 점검용: 지금 펫(입체면 입체)을 주어진 상태로 한 장씩 그려 PNG data URL 로 돌려준다. 시각(now)을 넣지 않아
     * 따라가기 없이 늘 같은 그림이 나온다 (바꾸기 전후 픽셀 비교). scale 은 그리는 배율 (기본 2)
     */
    debugRender: (states: Partial<DrawState>[], scale = 2): string[] => {
      const m3d = current3d();
      const c = document.createElement('canvas');
      c.width = CANVAS_SIZE * scale;
      c.height = CANVAS_SIZE * scale;
      const g = c.getContext('2d');
      if (!g || m3d === 'loading') return [];
      return states.map((st) => {
        g.setTransform(scale, 0, 0, scale, 0, 0);
        drawPet(g, {
          mood: 'idle',
          elapsed: 0,
          blink: -1,
          viewSize: CANVAS_SIZE,
          kind: petKind,
          model3d: m3d,
          photoEyes,
          ...st,
        });
        return c.toDataURL('image/png');
      });
    },
  },
});
