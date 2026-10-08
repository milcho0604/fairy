import { type Activity, nextDelay } from '../../shared/behavior.ts';
import type { Gaze } from '../../shared/gaze.ts';
import { GestureTracker, RubTracker } from '../../shared/gesture.ts';
import { t } from '../../shared/i18n/index.ts';
import type { PetImages } from '../../shared/ipc.ts';
import {
  canMagnify,
  FOUND_MS,
  type LookMotion,
  magnifierFps,
  magnifierPose,
} from '../../shared/look-motion.ts';
import { bodyOfParts, isMove, type MoveAsk } from '../../shared/moves.ts';
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
import type { PetKind, PoseKind } from '../../shared/settings.ts';
import { canPlay, type SoundKind } from '../../shared/sound.ts';
import { AnimatedImage, loadPetImage } from './animated.ts';
import { CANVAS_SIZE, drawPet, HEARTS_MS } from './draw.ts';
import { initLang } from './lang.ts';
import { moveFps, SIT_MS, sitDown } from './move-pose.ts';
import { renderFace } from './pet-face.ts';
import type { Pet3D } from './pet3d.ts';
import { withGait } from './pet3d-gait.ts';
import { playSound } from './sound.ts';

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
const [canvas, ctx] = setupCanvas();

// ---- 그리기 루프 ----
// 정지 상태는 한 번 그리고 멈춘다. 계속 그리면 fps 와 무관하게 CPU 를 먹는다 (L10).

const BLINK_MS = 180;
/**
 * 깜빡임은 네 틀(반쯤 감음, 감음, 반쯤 뜸, 뜸)로 그린다. 30fps 로는 일곱 틀이었고 첫 틀은 뜬 눈 그대로였다.
 * 쉬는 동안 그리는 틀 대부분이 깜빡임이라 대기 CPU 가 이만큼 준다 (2026-10-07 측정, docs/roadmap.md)
 */
const BLINK_FPS = 4000 / BLINK_MS;
const ANIMATED_FPS: Partial<Record<PetMood, number>> = { excited: 30, thinking: 8 };

let inputs: PetInputs = { ...INITIAL_INPUTS };
let mood: PetMood = moodOf(inputs, performance.now());
let moodSince = performance.now();
let blinkStart = -1;
let frameTimer: ReturnType<typeof setTimeout> | undefined;
let changeTimer: ReturnType<typeof setTimeout> | undefined;
let blinkTimer: ReturnType<typeof setTimeout> | undefined;

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
    mood = next;
    moodSince = now;
    blinkStart = -1;
    scheduleBlink();
    // 기본 상태가 아니게 되면(잡힘, 생각 중, 말하기 등) 하던 행동을 그만둔다.
    if (activity) stopActivity(true);
  }
  let blink = -1;
  if (blinkStart >= 0) {
    blink = (now - blinkStart) / BLINK_MS;
    if (blink >= 1) {
      blink = -1;
      blinkStart = -1;
    }
  }
  const trickT = trick ? (now - trick.start) / TRICK_MS[trick.type] : -1;
  if (trickT >= 1) trick = undefined;
  const hearts = heartsStart >= 0 ? now - heartsStart : -1;
  if (hearts >= HEARTS_MS) heartsStart = -1;
  // 입체가 되면 사진 대신 입체로 (AI 가 만든 설계도가 있는 사진 펫, 또는 기본 펫)
  const m3d = current3d();
  // 입체 그리기 모듈을 불러오는 중이면 기다린다 (불러오면 다시 그린다). 2D 를 먼저 그리면 깜빡인다
  if (m3d === 'loading') return;
  const img = m3d ? undefined : pickImage(mood, inputs.hungry);
  const looking = peerAt(now);
  drawPet(ctx, {
    mood,
    elapsed: now - moodSince,
    blink,
    viewSize,
    activity: activityPose(now),
    hungry: inputs.hungry,
    photo: img instanceof AnimatedImage ? img.frameAt(now) : img,
    kind: petKind,
    sulk: inputs.sulkLevel,
    hearts: heartsStart >= 0 ? hearts : -1,
    cushion,
    model3d: m3d,
    gaze: gaze ?? undefined,
    trick: trick ? { type: trick.type, t: trickT } : undefined,
    flower,
    calm: reducedMotion.matches,
    peer: looking?.peer,
    gait: gaitPick,
  });
  syncFace(m3d);

  const walking = activity?.type === 'walk';
  // 제자리 몸짓(하품, 기지개, 꼬리 흔들기 등)은 하는 동안 20~30fps (moveFps), 앉기는 앉고 일어나는 동안만 20fps
  const sitting = activity?.type === 'sit' ? now - activity.start : -1;
  const moving =
    (!!activity && isMove(activity.type)) ||
    (sitting >= 0 && activity !== undefined && (sitting < SIT_MS || sitting > activity.ms - SIT_MS));
  // 움직이는 그림은 잠, 바쁨일 때 멈춘다 (L10: 계속 그리면 CPU 를 먹는다). 12fps 까지만.
  const animatedPhoto = img instanceof AnimatedImage && canBlink(mood) ? Math.min(12, img.fps) : 0;
  // 부스트 모드면 움직임(신남, 몸짓, 하트, 걷기, 하품)을 두 배로 촘촘히 그린다. 깜빡임과 움직이는 그림은 그대로
  const k = boost ? 2 : 1;
  const fps = trick
    ? 30 * k
    : isAnimated(mood)
      ? (ANIMATED_FPS[mood] ?? 30) * k
      : heartsStart >= 0
        ? 30 * k
        : blinkStart >= 0
          ? BLINK_FPS
          : walking
            ? WALK_FPS * k
            : moving
              ? (activity && isMove(activity.type) ? moveFps(activity.type) : 20) * k
              : animatedPhoto;
  // 이 틀 안에서 requestFrame 이 불렸으면(행동 멈춤 등) 그 타이머를 지운다. 안 지우면 루프가 두 겹이 돈다
  // (2026-10-07 점검: 신남이 30fps 가 아니라 57fps)
  clearTimeout(frameTimer);
  // 돋보기를 든 동안은 그 빠르기로 (부스트면 두 배)
  const all = Math.max(fps, (looking?.fps ?? 0) * k);
  frameTimer = all > 0 ? setTimeout(frame, 1000 / all) : undefined;
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

// ---- 기본 행동 (P1-06) ----
// 25~70초에 한 번, 한가하면 메인에 행동을 골라 달라고 한다. 걷기만 계속 그리고(12fps) 앉기, 두리번은 한 번 그린다.

const WALK_FPS = 12;
/** 한 걸음(발 한 번씩) 시간 */
const STEP_MS = 520;
let activity: (Activity & { start: number }) | undefined;
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let activityEnd: ReturnType<typeof setTimeout> | undefined;

function scheduleActivity() {
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    if (mood === 'idle' && !activity && !look && !bubbleId && !overPet && !gesture.dragging)
      bridge.activityRequest(moveAsk());
    scheduleActivity();
  }, nextDelay(Math.random));
}

function stopActivity(tellMain: boolean) {
  const wasWalking = activity?.type === 'walk';
  activity = undefined;
  clearTimeout(activityEnd);
  clearTimeout(activityWake);
  if (tellMain && wasWalking) bridge.activityStop();
  requestFrame();
}

function activityPose(now: number) {
  if (!activity) return undefined;
  if (activity.type === 'walk') {
    return {
      type: 'walk' as const,
      dir: (activity.dx < 0 ? -1 : 1) as -1 | 1,
      phase: ((now - activity.start) / STEP_MS) % 1,
      along: (now - activity.start) / activity.ms,
      ms: activity.ms,
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
  const bp = (still ? photoModel : undefined) ?? (photo ? undefined : DEFAULT_BLUEPRINTS[petKind]);
  if (use3d && !broken3d && bp) {
    return { ...bodyOfParts(bp.parts), photo: false, calm, hungry };
  }
  if (photo) return { tail: false, ears: false, photo: true, calm, hungry };
  return {
    tail: petKind === 'cat' || petKind === 'dog',
    ears: petKind === 'cat' || petKind === 'bunny' || petKind === 'dog',
    photo: false,
    calm,
    hungry,
  };
}

// 사진 펫 그림 (P1-08). 없으면 기본 펫. gif, webp 는 움직이는 그림 (v1). 상태별 포즈 그림 (v1).
type PetImage = HTMLImageElement | AnimatedImage;
let photo: PetImage | undefined;
let poses: Partial<Record<PoseKind, PetImage>> = {};
let petKind: PetKind = 'kong';
let cushion = false;
/** 머리에 꽃 (친밀도 600) */
let flower = false;
/** 효과음 (설정) */
let sounds = false;
/** 부스트 모드 (설정, 배터리면 메인이 끈다) */
let boost = false;
/** 친밀도로 열린 몸짓. 끝나면 지운다 */
let trick: { type: 'wave' | 'dance'; start: number } | undefined;
const TRICK_MS = { wave: 1800, dance: 1400 } as const;
/** 움직임 줄이기 (운영체제 설정). 빙글 춤은 건너뛰고 신남은 살짝만 들썩인다. 걷기와 창 옮기기는 그대로 */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change', () => requestFrame());
let imageLoad = 0;
bridge.onImage(async (images: PetImages) => {
  const mine = ++imageLoad;
  const [main, depthImg, ...rest] = await Promise.all([
    images.main ? loadPetImage(images.main) : Promise.resolve(undefined),
    images.depth ? loadPetImage(images.depth) : Promise.resolve(undefined),
    ...(['happy', 'sleepy', 'hungry'] as const).map((k) =>
      images.poses[k] ? loadPetImage(images.poses[k] as string) : Promise.resolve(undefined),
    ),
  ]);
  if (mine !== imageLoad) return; // 그사이 또 바뀌었다
  photo = main;
  photoModel = images.model ?? undefined;
  photoDepth = depthImg instanceof HTMLImageElement ? depthImg : undefined;
  poses = { happy: rest[0], sleepy: rest[1], hungry: rest[2] };
  requestFrame();
});

/** 지금 상태에 맞는 그림: 신남 → 기쁨 포즈, 잠과 졸음 → 졸림 포즈, 배고픈 기본 상태 → 배고픔 포즈 */
function pickImage(m: PetMood, hungry: boolean): PetImage | undefined {
  if (!photo) return undefined;
  if (m === 'excited' && poses.happy) return poses.happy;
  if ((m === 'sleeping' || m === 'dozing') && poses.sleepy) return poses.sleepy;
  if (m === 'idle' && hungry && poses.hungry) return poses.hungry;
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
/** 실사처럼 그리기 (설정, PetStatus.real) */
let real3d = false;
/** 사용자가 고른 걸음새 (설정, PetStatus.gait). 없으면 자동 */
let gaitPick: Gait | undefined;
/** 고른 걸음새를 덮은 설계도. 같은 설계도와 같은 값이면 같은 것을 돌려줘 다시 조립하지 않는다 */
let picked: { from: Blueprint; gait: Gait | undefined; bp: Blueprint } | undefined;
function pickedBlueprint(bp: Blueprint | undefined): Blueprint | undefined {
  if (!bp) return undefined;
  if (picked?.from !== bp || picked.gait !== gaitPick)
    picked = { from: bp, gait: gaitPick, bp: withGait(bp, gaitPick) };
  return picked.bp;
}
function current3d(): Pet3D | 'loading' | undefined {
  // 사진 펫은 설계도나 깊이 그림이 있을 때만 입체로. 움직이는 그림은 입체 판으로 만들지 않는다
  const still = photo instanceof HTMLImageElement;
  const bp = pickedBlueprint(
    (still ? photoModel : undefined) ?? (photo ? undefined : DEFAULT_BLUEPRINTS[petKind]),
  );
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
  if (!model3d) {
    broken3d = true;
    return undefined;
  }
  const want = bp ?? relief;
  // 실사를 켜고 끄면 털과 눈을 다시 붙여야 해서 다시 조립한다
  if (model3d.setReal(real3d)) model3dOf = undefined;
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
  const key = [m3d, m3d ? model3dOf : undefined, photo, petKind];
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
  if ((status.real === true) !== real3d) {
    real3d = status.real === true;
    requestFrame();
  }
  // 걸음새를 바꾸면 펫 창을 다시 켜지 않고 다음 그림부터 (설계도를 덮어 다시 조립한다)
  if (status.gait !== gaitPick) {
    gaitPick = status.gait;
    requestFrame();
  }
  statusKnown = true;
  cushion = status.cushion;
  flower = status.flower;
  sounds = status.sounds;
  boost = status.boost;
  setInputs({ hungry: status.hungry, focusTimer: status.focus, sulkLevel: status.sulk });
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
  if (kind === 'dance' && !reducedMotion.matches) trick = { type: 'dance', start: now };
  setInputs({ excitedUntil: now + EXCITED_MS });
  sound(kind === 'fed' ? 'fed' : kind === 'dance' ? 'dance' : 'happy');
});

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
  // 삐져 있어도 걷고 논다 (모습만 삐진 얼굴)
  if (mood !== 'idle' && mood !== 'sulky') {
    if (a.type === 'walk') bridge.activityStop();
    return;
  }
  activity = { ...a, start: performance.now() };
  clearTimeout(activityEnd);
  clearTimeout(activityWake);
  activityEnd = setTimeout(() => stopActivity(false), a.ms);
  // 앉기는 앉은 뒤 그리기를 멈췄다가 일어날 때 다시 깨운다
  if (a.type === 'sit' && a.ms > SIT_MS * 2) activityWake = setTimeout(requestFrame, a.ms - SIT_MS);
  requestFrame();
});

/** 3~7초에 한 번 깜빡인다. 깜빡일 수 없는 상태(잠, 바쁨)에서는 타이머도 걸지 않는다. */
function scheduleBlink() {
  clearTimeout(blinkTimer);
  if (!canBlink(mood)) return;
  blinkTimer = setTimeout(
    () => {
      if (canBlink(mood)) {
        blinkStart = performance.now();
        // 첫 틀(t=0)은 뜬 눈 그대로라 건너뛴다. 이미 그리는 중이면(걷기 등) 그 흐름이 깜빡임도 그린다
        frameTimer ??= setTimeout(frame, BLINK_MS / 4);
      }
      scheduleBlink();
    },
    3000 + Math.random() * 4000,
  );
}

// ---- 화면 배율과 펫 크기 ----
// 모니터를 옮기면 화면 배율(1, 2)이, 크기를 조절하면 창 크기가 바뀐다. 둘 다 캔버스 해상도를 맞춰 다시 그린다.
// 그리기는 늘 160 기준 좌표로 하고 변환으로 키운다.
// 말풍선이 뜨면 창이 펫보다 커진다. 메인이 창 안 펫 자리(petBox)를 알려 준다.
let petBox = { x: 0, y: 0, size: window.innerWidth || CANVAS_SIZE };
let viewSize = petBox.size;

function fitToScreen() {
  const dpr = window.devicePixelRatio || 1;
  viewSize = petBox.size;
  Object.assign(canvas.style, {
    left: `${petBox.x}px`,
    top: `${petBox.y}px`,
    width: `${viewSize}px`,
    height: `${viewSize}px`,
  });
  canvas.width = Math.round(viewSize * dpr);
  canvas.height = Math.round(viewSize * dpr);
  const k = (dpr * viewSize) / CANVAS_SIZE;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  requestFrame();
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
  const dpr = canvas.width / viewSize;
  const alpha = ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data[3] ?? 0;
  return alpha > 16;
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
    get inputs() {
      return inputs;
    },
  },
});
