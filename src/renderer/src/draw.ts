// 코드로 그린 기본 펫. 콩, 냥이, 삐약이 세 가지 (v1, D6 그림 대신). 사진 펫(P1-08)이면 몸통 대신 사진.

import type { Gaze } from '../../shared/gaze.ts';
import { t } from '../../shared/i18n/index.ts';
import { lensSide, type MagnifierPose } from '../../shared/look-motion.ts';
import type { MoveType } from '../../shared/moves.ts';
import type { PetMood } from '../../shared/pet-mood.ts';
import type { PetKind } from '../../shared/settings.ts';
import { drawMagnifier } from './magnifier.ts';
import { type MovePose, movePose } from './move-pose.ts';
import { isQuadKind } from './pet3d-gait.ts';

export const CANVAS_SIZE = 160;

const INK = '#1f2328';
const BLUSH = 'rgba(255, 140, 140, 0.45)';
const SULK = '#e07a5f';
const HEART = '#ff6b8a';

/** 기본 펫 색 */
const COLORS: Record<PetKind, { body: string; line: string }> = {
  kong: { body: '#ffd8a8', line: '#c4854a' },
  cat: { body: '#ece6df', line: '#8d8178' },
  chick: { body: '#ffe27a', line: '#d29d00' },
  dog: { body: '#f0cfa0', line: '#a8743f' },
  bunny: { body: '#f6f0f2', line: '#a3949a' },
};
let BODY = COLORS.kong.body;
let LINE = COLORS.kong.line;

export interface DrawState {
  mood: PetMood;
  /** 지금 상태에 들어온 뒤 흐른 시간(ms). 신남, 생각 중 동작에 쓴다. */
  elapsed: number;
  /** 깜빡임 진행 0~1. 깜빡이지 않으면 -1. */
  blink: number;
  /** 화면에 그려지는 펫 크기(px). 작으면 글씨를 빼서 뭉개지지 않게 한다. */
  viewSize?: number;
  /** 배고프면 기본 상태에서 입 모양만 바뀐다 */
  hungry?: boolean;
  /** 사진 펫 그림 (P1-08). 있으면 기본 몸통, 얼굴, 발 대신 그린다 */
  photo?: CanvasImageSource & { width: number; height: number };
  /**
   * 기본 상태에서 하는 행동 (P1-06). phase 는 걷기 걸음 진행 0~1.
   * 걷기의 along 은 걷기 전체 진행 0~1, ms 는 걷기 전체 시간 (네 발 펫의 출발과 멈춤, pet3d-gait.ts).
   * t 라고 쓰지 않는다: 제자리 몸짓은 't' in act 로 가린다 (movePoseOf)
   */
  activity?:
    | { type: 'walk'; dir: -1 | 1; phase: number; along?: number; ms?: number }
    | { type: 'sit'; down?: number }
    | { type: 'look'; dir: -1 | 1 }
    | { type: 'yawn'; t: number }
    | { type: 'stretch'; t: number }
    // 제자리 몸짓 (꼬리 흔들기, 몸 털기, 점프 등. move-pose.ts). sit 의 down 은 앉은 정도 0~1 (없으면 다 앉음)
    | { type: Exclude<MoveType, 'yawn' | 'stretch'>; t: number; dir: -1 | 1 };
  /** 기본 펫 모양 (v1) */
  kind?: PetKind;
  /** 삐짐 칸 수 (v1). 1 이상이면 머리 위에 칸 막대 */
  sulk?: number;
  /** 쓰다듬은 뒤 흐른 시간(ms). 하트가 떠오른다. 없으면 -1 */
  hearts?: number;
  /** 쿠션이 있으면 앉을 때 깔고 앉는다 (v1 장난감) */
  cushion?: boolean;
  /** 입체 펫 (6단계). 있으면 기본 몸 대신 이것이 그린다. 사진 펫이 먼저다 */
  model3d?: Model3D;
  /** 커서 쪽 방향 (x -1~1, y -1~1). 한가한 모습(기본, 앉기)일 때만 쓴다 */
  gaze?: Gaze;
  /** 친밀도로 열린 몸짓 (손 흔들기, 빙글 춤). t 는 진행 0~1 */
  trick?: Trick;
  /** 머리에 꽃 (친밀도 600) */
  flower?: boolean;
  /** 움직임 줄이기 (운영체제 설정 prefers-reduced-motion). 신나서 크게 튀지 않고 살짝만 들썩인다 */
  calm?: boolean;
  /** 이름 옆 얼굴 그림용 (pet-face.ts). 발은 그리지 않는다: 얼굴 아이콘은 얼굴만 */
  face?: boolean;
  /** 같이 보기 (shared/look-motion.ts): 그쪽을 보고, pose 가 있으면 돋보기를 든다 */
  peer?: { dir: Gaze; pose?: MagnifierPose };
}

export interface Trick {
  type: 'wave' | 'dance';
  t: number;
}

/** 몸짓을 보일지: 잠, 졸음, 바쁨, 잡힘, 숨김에서는 안 한다. 삐져 있으면 손은 안 흔든다 */
export function trickOf(s: DrawState): Trick | undefined {
  if (!s.trick || ['sleeping', 'dozing', 'busy', 'grabbed', 'hidden'].includes(s.mood)) return undefined;
  if (s.trick.type === 'wave' && s.mood === 'sulky') return undefined;
  // 움직임 줄이기면 빙글 춤(몸 전체를 크게 흔든다)은 안 한다. 손 흔들기는 작아서 둔다
  if (s.trick.type === 'dance' && s.calm) return undefined;
  return s.trick;
}

/** 신나서 통통 튀기: 600ms 마다 한 번. 움직임 줄이기면 18px 대신 3px, 착지 찌그러짐 없이 */
export function excitedBounce(elapsed: number, calm = false): { lift: number; squash: number } {
  const phase = (elapsed % 600) / 600;
  return {
    lift: Math.sin(phase * Math.PI) * (calm ? 3 : 18),
    squash: !calm && (phase < 0.12 || phase > 0.88) ? 0.08 : 0,
  };
}

/** 빙글 춤의 몸 기울기 (좌우로 두 번 흔든다) */
export function danceTilt(t: number): number {
  return Math.sin(t * Math.PI * 4) * 0.24 * (1 - t * 0.4);
}

/** 손 흔들기의 손 각도 (네 번 흔든다) */
export function waveSwing(t: number): number {
  return Math.sin(t * Math.PI * 8) * Math.min(1, t * 6, (1 - t) * 6);
}

/** 제자리 몸짓의 지금 자세 (move-pose.ts). 걷기, 앉기, 두리번, 하품, 기지개면 undefined */
export function movePoseOf(act: DrawState['activity'], calm?: boolean): MovePose | undefined {
  if (!act || !('t' in act) || act.type === 'yawn' || act.type === 'stretch') return undefined;
  return movePose(act.type, act.t, act.dir, calm);
}

/** 지금 커서를 볼지: 기본 상태에서 아무것도 안 하거나 앉아 있을 때만 */
export function gazeOf(s: DrawState, act: DrawState['activity']): Gaze | undefined {
  if (s.peer) return s.peer.dir;
  if (s.mood !== 'idle' || !s.gaze || (act && act.type !== 'sit')) return undefined;
  return s.gaze;
}

/** 입체 펫 그리기 (pet3d.ts). 2D 와 같은 몸짓 값(lift, sx, sy)을 받아 그리고 머리 꼭대기 y 를 돌려준다 */
export interface Model3D {
  draw(
    ctx: CanvasRenderingContext2D,
    s: DrawState,
    lift: number,
    sx: number,
    sy: number,
    act: DrawState['activity'],
  ): number | undefined;
  /** 방금 그린 그림에서 side 쪽 눈 가운데 (같이 보기 돋보기 자리). 모르면 undefined */
  eye?(side: -1 | 1): { x: number; y: number } | undefined;
}

/** 하트가 떠올라 사라지는 시간 */
export const HEARTS_MS = 1500;

/** 이보다 작게 그려지면 글씨표(바쁨)를 그리지 않는다. 12px 글씨가 9px 아래로 줄어드는 크기 */
const MIN_SIZE_FOR_TEXT = 120;

const CX = 80;
/** 몸 꼭대기 위로 귀나 깃털이 나온 높이 (2D) */
const EAR_TOP: Record<PetKind, number> = { kong: 0, cat: 14, chick: 14, dog: 0, bunny: 44 };
const GROUND = 154;
const RX = 58;
const RY = 50;

export function drawPet(ctx: CanvasRenderingContext2D, s: DrawState): void {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (s.mood === 'hidden') return;
  const kind = s.kind ?? 'kong';
  BODY = COLORS[kind].body;
  LINE = COLORS[kind].line;

  // 몸 모양: 신남은 통통 튀고 착지할 때 찌그러진다. 잡힘은 늘어난다.
  let lift = 0;
  let sx = 1;
  let sy = 1;
  if (s.mood === 'excited') {
    const bounce = excitedBounce(s.elapsed, s.calm);
    lift = bounce.lift;
    const squash = bounce.squash;
    sx = 1 + squash;
    sy = 1 - squash;
  } else if (s.mood === 'grabbed') {
    // 들려 있으니 몸을 조금 올려 늘어진 발이 캔버스 아래로 잘리지 않게 한다.
    lift = 6;
    sx = 0.94;
    sy = 1.08;
  }
  const act = s.mood === 'idle' || s.mood === 'sulky' ? s.activity : undefined;
  if (act?.type === 'walk') lift = Math.abs(Math.sin(act.phase * Math.PI * 2)) * 3;
  if (s.peer?.pose) lift += s.peer.pose.hop;
  // 앉기: 처음에 천천히 앉고 끝에 일어난다 (down 0 서 있음 ~ 1 앉음)
  const sitK = act?.type === 'sit' ? (act.down ?? 1) : 0;
  if (act?.type === 'sit') {
    sx = 1 + 0.06 * sitK;
    sy = 1 - 0.1 * sitK;
  }
  // 하품은 몸을 살짝 늘이고, 기지개는 위로 쭉 (가운데에서 가장 길게)
  if (act?.type === 'yawn') {
    const k = Math.sin(Math.min(1, act.t) * Math.PI);
    sy = 1 + 0.05 * k;
  }
  if (act?.type === 'stretch') {
    const k = Math.sin(Math.min(1, act.t) * Math.PI);
    sx = 1 - 0.08 * k;
    sy = 1 + 0.12 * k;
  }
  // 제자리 몸짓 (꼬리 흔들기, 몸 털기, 점프 등): 뛰기와 찌그러짐은 2D, 사진, 입체 모두 같이
  const mv = movePoseOf(act, s.calm);
  if (mv) {
    lift += mv.lift;
    sx *= mv.sx;
    sy *= mv.sy;
  }

  if (s.cushion && (act?.type === 'sit' || s.mood === 'sleeping' || s.mood === 'dozing')) drawCushion(ctx);

  if (s.photo) {
    const top = drawPhoto(ctx, s, s.photo, lift, sx, sy, act);
    drawPeer(ctx, s, top, GROUND - lift, PHOTO_EYE_AT);
    drawExtras(ctx, s, top);
    return;
  }
  if (s.model3d) {
    const top = s.model3d.draw(ctx, s, lift, sx, sy, act);
    if (top !== undefined) {
      drawPeer(ctx, s, top, GROUND - lift, MODEL_EYE_AT, s.model3d);
      drawExtras(ctx, s, top);
      return;
    }
  }

  // 발: 몸통보다 먼저 그려서 몸 아래로 조금 나오게. 걸을 때는 번갈아 든다. 매달리면 늘어진다.
  // 얼굴 그림에서는 빼고 둥근 몸만 (몸통이 닫힌 타원이라 발 자리에 틈이 생기지 않는다)
  // 폴짝 뛰어도 귀 끝이 캔버스 위로 잘리지 않게 (토순이 귀는 몸 위로 44 나온다)
  if (mv) lift = Math.min(lift, GROUND - (RY * 2 + EAR_TOP[kind]) * sy - 4);
  // 기지개로 몸을 늘여도 귀 끝이 잘리지 않게 (토순이)
  if (act) sy = Math.min(sy, (GROUND - 4 - lift) / (RY * 2 + EAR_TOP[kind]));
  // 옆으로 누우면(뒹굴기) 귀, 발, 꼬리까지 바닥 위에 오게 띄운다
  if (mv) lift += 10 * Math.abs(Math.sin(mv.turn * 0.7));
  // 뒹굴기, 몸 털기는 발까지 같이 몸 가운데 둘레로 돌린다
  ctx.save();
  if (mv) {
    const py = GROUND - lift - RY * sy;
    ctx.translate(CX + mv.dx, py);
    // 2D 는 얼굴이 몸에 그려져 다 누우면 얼굴이 옆으로 누워 알아보기 어렵다. 반쯤 누워 발을 버둥거린다.
    // 토순이는 귀가 길어 더 덜 눕는다 (귀가 캔버스 밖으로 잘리지 않게)
    ctx.rotate(mv.turn * (kind === 'bunny' ? 0.55 : 0.7) + mv.twist * 0.35);
    ctx.translate(-CX, -py);
  }
  if (!s.face) {
    const spread = 24 + 8 * sitK;
    const step = act?.type === 'walk' ? Math.sin(act.phase * Math.PI * 2) * 4 : 0;
    const dangle = s.mood === 'grabbed' ? 6 : 0;
    // 네 발 동물(냥이, 멍멍이, 토순이)은 걸을 때 뒷발 둘이 가는 반대쪽 뒤에 보인다 (pet3d-gait.ts)
    if (act?.type === 'walk' && isQuadKind(kind)) drawHindFeet(ctx, act.dir, step, lift);
    ctx.fillStyle = BODY;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    for (const [side, up] of [
      [-1, Math.max(0, step) + (mv ? mv.legs[0] * 10 : 0)],
      [1, Math.max(0, -step) + (mv ? mv.legs[1] * 10 : 0)],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(CX + side * spread, GROUND - 2 - lift - up + dangle, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  const trick = trickOf(s);
  ctx.save();
  ctx.translate(CX, GROUND - lift);
  if (trick?.type === 'dance') ctx.rotate(danceTilt(trick.t));
  // 고개 갸웃: 2D 는 몸이 곧 머리라 몸을 반만큼 기울인다
  if (mv) ctx.rotate(mv.tilt * 0.5);
  ctx.scale(sx, sy);
  ctx.translate(0, -RY);

  // 꼬리는 평소 몸 뒤에 숨어 있다가 흔들 때 옆으로 나온다 (냥이, 멍멍이)
  if (mv && mv.tailOut > 0 && (kind === 'cat' || kind === 'dog')) drawTail(ctx, kind, mv.tail, mv.tailOut);
  if (kind === 'cat') drawCatEars(ctx, mv?.ears);
  if (kind === 'bunny') drawBunnyEars(ctx, mv?.ears);

  // 몸통
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = BODY;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE;
  ctx.stroke();
  if (kind === 'dog') drawDogEars(ctx, mv?.ears);
  // 손 흔들기 팔은 몸과 귀 다음, 얼굴 전에 (얼굴을 가리지 않게)
  if (trick?.type === 'wave') drawWavingHand(ctx, trick.t);

  // 볼
  // 얼굴을 옆으로: 삐지면 고개를 돌리고, 걷거나 두리번거리면 그쪽을 본다.
  const g = gazeOf(s, act);
  const look =
    s.mood === 'sulky' && !s.peer
      ? 12
      : act?.type === 'walk'
        ? act.dir * 6
        : act?.type === 'look'
          ? act.dir * 8
          : mv
            ? mv.look * 8
            : g
              ? g.x * 8
              : 0;
  // 위아래를 보면 얼굴 전체(볼, 눈, 입)가 그쪽으로 조금. 고개를 숙이면(킁킁, 꾸벅) 더 아래로
  ctx.save();
  ctx.translate(0, (g ? g.y * 2.5 : 0) + (mv ? mv.pitch * 22 : 0));
  ctx.fillStyle = BLUSH;
  for (const x of [-32, 32]) {
    ctx.beginPath();
    ctx.ellipse(x + look, 10, s.mood === 'sulky' && x > 0 ? 11 : 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (kind === 'chick') drawTuft(ctx);
  if (kind === 'cat') drawWhiskers(ctx, look);

  const yawning = act?.type === 'yawn' && act.t > 0.15 && act.t < 0.85;
  // 몸짓 눈: 질끈(잠든 눈), 웃는 눈(신남), 반쯤(졸음), 동그랗게(조금 크게)
  const moveEyes: PetMood | undefined =
    mv?.eyes === 'closed'
      ? 'sleeping'
      : mv?.eyes === 'happy'
        ? 'excited'
        : mv?.eyes === 'half'
          ? 'dozing'
          : undefined;
  drawEyes(
    ctx,
    yawning
      ? { ...s, mood: 'sleeping' }
      : act?.type === 'stretch' || trick
        ? { ...s, mood: 'excited' }
        : moveEyes
          ? { ...s, mood: moveEyes }
          : s,
    look,
    g,
    mv?.eyes === 'wide',
  );
  if (kind === 'chick') drawBeak(ctx, s.mood, look, yawning || mv?.mouth === 'open' || mv?.mouth === 'o');
  else if (yawning) drawYawn(ctx, look);
  else if (mv?.mouth) drawMouth(ctx, mv.mouth === 'o' ? 'sleeping' : 'talking', look);
  else if (s.hungry && s.mood === 'idle') drawHungryMouth(ctx, look);
  else drawMouth(ctx, s.mood, look);
  ctx.restore();
  ctx.restore();
  ctx.restore();

  // 돋보기는 보는 쪽 눈 앞에 (눈 자리는 위 얼굴 그리기와 같은 계산)
  if (s.peer?.pose) {
    const side = lensSide(s.peer.dir);
    const gy = g ? g.y * 2.5 : 0;
    drawMagnifier(ctx, {
      pose: s.peer.pose,
      x: CX + (side * 20 + look + (g ? g.x * 3 : 0)) * sx,
      y: GROUND - lift + (-RY + gy - 6 + gy) * sy,
      paw: { body: BODY, line: LINE },
    });
  }
  drawExtras(ctx, s, GROUND - lift - RY * 2 * sy);
}

/** 입체 펫 눈 자리를 모를 때(눈 없는 설계도) 눈 높이 (머리 꼭대기 0, 바닥 1) */
const MODEL_EYE_AT = 0.5;
/** 사진 펫은 눈 자리를 몰라 얼굴이 흔히 있는 위쪽 1/3 남짓에 */
const PHOTO_EYE_AT = 0.38;

/** 사진과 입체 펫의 돋보기: 보는 쪽 눈 앞으로. 입체는 그린 눈 자리, 모르면 눈 높이(at) 어림 */
function drawPeer(
  ctx: CanvasRenderingContext2D,
  s: DrawState,
  top: number,
  bottom: number,
  at: number,
  model?: Model3D,
) {
  if (!s.peer?.pose) return;
  const side = lensSide(s.peer.dir);
  const eye = model?.eye?.(side) ?? { x: CX + side * 18, y: top + (bottom - top) * at };
  drawMagnifier(ctx, { pose: s.peer.pose, ...eye });
}

/**
 * 걷는 네 발 동물의 뒷발. 앞발(몸 아래 둘)보다 먼저, 가는 반대쪽으로 비켜 조금 위(뒤)에 작게 그린다.
 * 대각선 쌍으로 딛는다: 왼앞발과 오른뒷발이 같이 들린다 (step 은 앞발 그리기와 같은 값)
 */
function drawHindFeet(ctx: CanvasRenderingContext2D, dir: -1 | 1, step: number, lift: number) {
  ctx.save();
  ctx.fillStyle = BODY;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  for (const [side, up] of [
    [-1, Math.max(0, -step)],
    [1, Math.max(0, step)],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(CX - dir * 36 + side * 10, GROUND - 5 - lift - up, 8.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 손 흔들기: 몸 오른쪽 안쪽에서 시작한 짧은 팔이 몸 테두리 밖으로 나와 좌우로 흔든다 (몸 좌표, 가운데가 0).
 * 몸 안쪽 부분은 몸과 같은 색으로만 칠해 몸에서 자라난 듯 이어지고, 테두리 선은 밖으로 나온 부분에만 있다.
 * 얼굴(볼, 눈, 수염)보다 먼저 그려 얼굴을 가리지 않는다
 */
function drawWavingHand(ctx: CanvasRenderingContext2D, t: number) {
  const up = Math.min(1, t * 5, (1 - t) * 5);
  const swing = waveSwing(t);
  const len = 27 + up * 7;
  const arm = () => {
    ctx.beginPath();
    ctx.roundRect(-8, -len, 16, len + 8, 8);
  };
  const body = () => {
    ctx.beginPath();
    ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  };
  ctx.save();
  ctx.translate(RX - 12, 8);
  ctx.rotate(0.45 + (1 - up) * 0.8 + swing * 0.28);
  const local = ctx.getTransform();
  ctx.restore();
  // 몸 안: 몸 색으로만 (몸 테두리 안쪽 반을 덮어 이음매가 없다)
  ctx.save();
  body();
  ctx.clip();
  ctx.setTransform(local);
  arm();
  ctx.fillStyle = BODY;
  ctx.fill();
  ctx.restore();
  // 몸 밖: 테두리까지
  ctx.save();
  ctx.beginPath();
  ctx.rect(-CANVAS_SIZE, -CANVAS_SIZE, CANVAS_SIZE * 2, CANVAS_SIZE * 2);
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.clip('evenodd');
  ctx.setTransform(local);
  arm();
  ctx.fillStyle = BODY;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -len + 6, 3.2, 2.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 150, 170, 0.6)';
  ctx.fill();
  ctx.restore();
  if (up > 0.6) {
    ctx.save();
    ctx.setTransform(local);
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55;
    for (const r of [12, 16]) {
      ctx.beginPath();
      ctx.arc(0, -len + 4, r, -0.9, -0.35);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** 흔드는 표시: (x, y) 를 가운데로 한 짧은 곡선 두 줄 */
function drawWaveMarks(ctx: CanvasRenderingContext2D, x: number, y: number, swing: number) {
  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.6;
  for (const r of [6, 10]) {
    ctx.beginPath();
    ctx.arc(x, y, r, -0.9 + swing * 0.2, -0.2 + swing * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 머리 꽃 (친밀도 600): 분홍 꽃잎 다섯 장과 노란 가운데 */
function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.3);
  ctx.fillStyle = '#ff9fb8';
  ctx.strokeStyle = '#e0708f';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 4.6, Math.sin(a) * 4.6, 3.6, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd34d';
  ctx.fill();
  ctx.restore();
}

function drawCushion(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.fillStyle = '#9ec5e8';
  ctx.strokeStyle = '#5f8fb8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(CX, GROUND - 1, 66, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 멍멍이: 옆으로 처진 갈색 귀 (몸 위에 겹쳐 그린다) */
function drawDogEars(ctx: CanvasRenderingContext2D, flick: readonly [number, number] = [0, 0]) {
  for (const side of [-1, 1] as const) {
    // 처진 귀는 윗부분을 축으로 바깥쪽으로 펄럭
    const a = earAngle(flick, side) * -side;
    ctx.save();
    ctx.translate(side * 44, -RY + 14);
    ctx.rotate(a);
    ctx.translate(-side * 44, RY - 14);
    ctx.beginPath();
    ctx.ellipse(side * 50, -RY + 34, 13, 24, side * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#b9824c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LINE;
    ctx.stroke();
    ctx.restore();
  }
}

/** 귀 젖히는 각 (몸짓 ears, 바깥쪽이 +) */
function earAngle(flick: readonly [number, number], side: -1 | 1): number {
  return (side < 0 ? flick[0] : flick[1]) ?? 0;
}

/** 귀를 밑동(x, y) 둘레로 바깥쪽으로 돌린다 (왼쪽 귀는 반시계, 오른쪽 귀는 시계 방향) */
function earTurn(ctx: CanvasRenderingContext2D, x: number, y: number, side: -1 | 1, a: number) {
  ctx.translate(x, y);
  ctx.rotate(side * a);
  ctx.translate(-x, -y);
}

/**
 * 2D 꼬리 (냥이는 길고 가는 S 자, 멍멍이는 짧고 통통하게 말린 꼬리). 몸 오른쪽 아래 뒤에서 나와 흔든다.
 * out 이 0 이면 몸 뒤로 접혀 안 보이고, 1 이면 몸 옆으로 다 나온다. swing 은 흔드는 각 (라디안). 몸통보다 먼저 그린다
 */
function drawTail(ctx: CanvasRenderingContext2D, kind: 'cat' | 'dog', swing: number, out: number) {
  const cat = kind === 'cat';
  const base = { x: 34, y: 30 };
  ctx.save();
  ctx.translate(base.x, base.y);
  // 접힌 자리(몸 뒤 안쪽 아래)에서 위로 세운 자리까지. 바깥으로는 덜 흔들어 캔버스 밖으로 안 나가게
  ctx.rotate((1 - out) * -1.4 + (swing > 0 ? swing * 0.4 : swing));
  const tip = cat ? { x: 22, y: -56 } : { x: 22, y: -30 };
  const ctrl = cat ? { x: 38, y: -8 } : { x: 34, y: 2 };
  const width = cat ? 8 : 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, tip.x, tip.y);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = width + 4;
  ctx.stroke();
  ctx.strokeStyle = cat ? BODY : '#b9824c';
  ctx.lineWidth = width;
  ctx.stroke();
  if (cat) {
    // 꼬리 끝은 조금 진하게
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, width / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(141, 129, 120, 0.55)';
    ctx.fill();
  }
  ctx.restore();
}

/** 토순이: 위로 긴 귀, 안쪽 분홍 (몸 뒤에 그린다) */
function drawBunnyEars(ctx: CanvasRenderingContext2D, flick: readonly [number, number] = [0, 0]) {
  for (const side of [-1, 1] as const) {
    ctx.save();
    earTurn(ctx, side * 18, -RY + 12, side, earAngle(flick, side) * 0.8);
    ctx.beginPath();
    ctx.ellipse(side * 18, -RY - 14, 10, 30, side * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(side * 18, -RY - 12, 5, 21, side * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 150, 170, 0.55)';
    ctx.fill();
    ctx.restore();
  }
}

function drawCatEars(ctx: CanvasRenderingContext2D, flick: readonly [number, number] = [0, 0]) {
  for (const side of [-1, 1] as const) {
    ctx.save();
    earTurn(ctx, side * 36, -RY + 18, side, earAngle(flick, side));
    ctx.beginPath();
    ctx.moveTo(side * 22, -RY + 14);
    ctx.lineTo(side * 40, -RY - 14);
    ctx.lineTo(side * 48, -RY + 22);
    ctx.closePath();
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(side * 29, -RY + 14);
    ctx.lineTo(side * 39, -RY - 4);
    ctx.lineTo(side * 43, -RY + 17);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 150, 160, 0.55)';
    ctx.fill();
    ctx.restore();
  }
}

function drawWhiskers(ctx: CanvasRenderingContext2D, look: number) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (const dy of [-3, 3]) {
      ctx.beginPath();
      ctx.moveTo(side * 40 + look, 6 + dy);
      ctx.lineTo(side * 56 + look, 4 + dy * 2);
      ctx.stroke();
    }
  }
}

function drawTuft(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (const [x, bend] of [
    [-6, -8],
    [0, 0],
    [6, 8],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, -RY + 2);
    ctx.quadraticCurveTo(x + bend, -RY - 10, x + bend * 1.4, -RY - 14);
    ctx.stroke();
  }
}

/** 삐약이 부리: 말하거나 놀라면 벌린다 */
function drawBeak(ctx: CanvasRenderingContext2D, mood: PetMood, look: number, open: boolean) {
  const x = look;
  const gap = open || mood === 'talking' || mood === 'grabbed' ? 5 : 0;
  ctx.fillStyle = '#ff9f43';
  ctx.strokeStyle = '#d97a1e';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 8, 8);
  ctx.lineTo(x, 2);
  ctx.lineTo(x + 8, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 7, 9 + gap);
  ctx.lineTo(x, 15 + gap);
  ctx.lineTo(x + 7, 9 + gap);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawYawn(ctx: CanvasRenderingContext2D, x: number) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(x, 14, 7, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e66a7a';
  ctx.beginPath();
  ctx.ellipse(x, 19, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 사진 펫을 그리고 머리 꼭대기 y 를 돌려준다. 사진은 얼굴을 바꿀 수 없어 몸짓(튀기, 늘이기, 기울이기)으로 기분을 보인다. */
function drawPhoto(
  ctx: CanvasRenderingContext2D,
  s: DrawState,
  photo: CanvasImageSource & { width: number; height: number },
  lift: number,
  sx: number,
  sy: number,
  act: DrawState['activity'],
): number {
  // 캔버스 안 바닥에 서도록, 신남으로 튀어도 위가 안 잘리게 여유를 둔다.
  const maxW = 140;
  const maxH = 124;
  const k = Math.min(maxW / photo.width, maxH / photo.height);
  const w = photo.width * k;
  const h = photo.height * k;
  let tilt = 0;
  if (act?.type === 'walk') tilt = Math.sin(act.phase * Math.PI * 2) * 0.06;
  if (act?.type === 'look') tilt = act.dir * 0.08;
  const g = gazeOf(s, act);
  // 커서 쪽으로 살짝 기운다 (사진은 얼굴을 바꿀 수 없어서)
  if (g) tilt = g.x * 0.06;
  // 몸짓도 기울기로: 손 흔들기는 좌우로 까딱, 빙글 춤은 크게 흔들기
  const trick = trickOf(s);
  if (trick?.type === 'wave') tilt = waveSwing(trick.t) * 0.1;
  if (trick?.type === 'dance') tilt = danceTilt(trick.t);
  // 제자리 몸짓: 사진은 관절이 없어 몸 전체를 기울이고 옮긴다 (뒹굴기는 사진 펫이 고르지 않는다)
  const mv = movePoseOf(act, s.calm);
  let shift = 0;
  if (mv) {
    // 누운 사진은 깨진 그림처럼 보여서 몸 돌리기는 조금만 (뒹굴기는 사진 펫이 고르지 않지만 혹시 와도)
    const turn = Math.max(-0.3, Math.min(0.3, mv.turn));
    tilt = turn + mv.twist * 0.3 + mv.tilt * 0.5 + mv.look * 0.08 + mv.pitch * 0.25;
    shift = mv.dx + mv.look * 4;
  }
  if (s.mood === 'dozing') tilt = 0.1;
  ctx.save();
  ctx.translate(CX + shift, GROUND - lift);
  ctx.rotate(tilt);
  // 삐지면 등을 돌린 듯 좌우를 뒤집는다.
  ctx.scale(s.mood === 'sulky' ? -sx : sx, sy);
  if (s.mood === 'sleeping' || s.mood === 'dozing') ctx.globalAlpha = 0.85;
  ctx.drawImage(photo, -w / 2, -h, w, h);
  ctx.restore();
  const top = GROUND - lift - h * sy;
  // 사진은 손을 들 수 없어 기울기에 더해 흔드는 표시만 머리 옆에
  if (trick?.type === 'wave' && Math.min(1, trick.t * 5, (1 - trick.t) * 5) > 0.6)
    drawWaveMarks(ctx, CX + w / 2 - 6, top + 22, waveSwing(trick.t));
  return top;
}

function drawEyes(ctx: CanvasRenderingContext2D, s: DrawState, look: number, gaze?: Gaze, wide = false) {
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    // 커서를 보면 눈동자가 얼굴보다 조금 더 그쪽으로 (위아래도)
    // 얼굴(look)보다 눈이 조금 더 그쪽으로. 위아래는 눈만 (입과 볼은 그대로)
    const x = side * 20 + look + (gaze ? gaze.x * 3 : 0);
    const y = -6 + (gaze ? gaze.y * 2.5 : 0);
    ctx.beginPath();
    if (s.mood === 'sleeping') {
      ctx.arc(x, y - 2, 5, 0.15 * Math.PI, 0.85 * Math.PI); // 감은 눈
      ctx.stroke();
    } else if (s.mood === 'dozing') {
      ctx.moveTo(x - 5.5, y - 1); // 반쯤 감긴 눈꺼풀
      ctx.lineTo(x + 5.5, y - 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x, y + 0.5, 3.5, 2.2, 0, 0, Math.PI);
      ctx.fill();
    } else if (s.mood === 'grabbed') {
      ctx.moveTo(x - side * 5, y - 4); // > <
      ctx.lineTo(x + side * 2, y);
      ctx.lineTo(x - side * 5, y + 4);
      ctx.stroke();
    } else if (s.mood === 'excited') {
      ctx.arc(x, y + 2, 5, 1.15 * Math.PI, 1.85 * Math.PI); // 웃는 눈 ^ ^
      ctx.stroke();
    } else {
      // 깜빡일 때 위아래로 접힌다. 바쁠 때는 작게 뜬다.
      const open = s.blink >= 0 ? Math.abs(1 - 2 * s.blink) : 1;
      const r = s.mood === 'busy' ? 3.5 : wide ? 5.3 : 4.5;
      ctx.ellipse(x, y, r, Math.max(0.6, r * 1.15 * open), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 배고픈 입: 물결처럼 꼬불 */
function drawHungryMouth(ctx: CanvasRenderingContext2D, x: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 8, 13);
  ctx.quadraticCurveTo(x - 4, 9, x, 13);
  ctx.quadraticCurveTo(x + 4, 17, x + 8, 13);
  ctx.stroke();
}

function drawMouth(ctx: CanvasRenderingContext2D, mood: PetMood, look: number) {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const x = look;
  switch (mood) {
    case 'talking':
    case 'grabbed':
      ctx.ellipse(x, 12, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'sleeping':
    case 'dozing':
      ctx.ellipse(x, 13, 3, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'thinking':
    case 'busy':
      ctx.moveTo(x - 6, 12);
      ctx.lineTo(x + 6, 12);
      ctx.stroke();
      break;
    case 'sulky':
      ctx.arc(x, 18, 7, 1.2 * Math.PI, 1.8 * Math.PI);
      ctx.stroke();
      break;
    default:
      ctx.arc(x, 6, 8, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
  }
}

/** 몸 밖에 붙는 것들: 생각 중 점, 잠 Zz, 바쁨 땀과 이름표, 삐짐 막대, 하트. top 은 머리 꼭대기 y. */
function drawExtras(ctx: CanvasRenderingContext2D, s: DrawState, top: number) {
  // 머리 오른쪽 위에 꽂은 꽃. 사진은 머리가 가운데 쪽이라 조금 안으로
  if (s.flower) drawFlower(ctx, CX + (s.photo ? 14 : 24), top + 8);
  if ((s.sulk ?? 0) > 0 && s.mood === 'sulky') drawSulkGauge(ctx, s.sulk ?? 0, top);
  if ((s.hearts ?? -1) >= 0 && (s.hearts ?? 0) < HEARTS_MS) drawHearts(ctx, s.hearts ?? 0, top);
  drawMoveMark(ctx, s, top);
  ctx.fillStyle = INK;
  if (s.mood === 'thinking') {
    const step = Math.floor(s.elapsed / 400) % 4; // 점이 하나씩 늘어난다
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i < step ? 1 : 0.25;
      ctx.beginPath();
      ctx.arc(CX - 14 + i * 14, top - 10, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (s.mood === 'sleeping') {
    ctx.font = 'bold 14px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.fillText('z', CX + 40, top + 2);
    ctx.font = 'bold 18px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.fillText('Z', CX + 50, top - 12);
  } else if (s.mood === 'busy') {
    // 땀방울
    ctx.fillStyle = '#7cc4ff';
    ctx.beginPath();
    ctx.moveTo(CX + 44, top + 14);
    ctx.quadraticCurveTo(CX + 52, top + 26, CX + 44, top + 30);
    ctx.quadraticCurveTo(CX + 36, top + 26, CX + 44, top + 14);
    ctx.fill();
    if ((s.viewSize ?? CANVAS_SIZE) >= MIN_SIZE_FOR_TEXT) drawTag(ctx, t('pet.busyTag'), top - 22);
  }
}

/** 머리 위 7칸 막대: 찬 칸은 빨갛게 (기획서: 펫 머리 위 작은 칸 막대) */
function drawSulkGauge(ctx: CanvasRenderingContext2D, level: number, top: number) {
  const n = 7;
  const w = 8;
  const gap = 2;
  const x0 = CX - (n * w + (n - 1) * gap) / 2;
  const y = Math.max(2, top - 14);
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.roundRect(x0 + i * (w + gap), y, w, 6, 2);
    ctx.fillStyle = i < level ? SULK : 'rgba(255, 255, 255, 0.85)';
    ctx.fill();
    ctx.strokeStyle = i < level ? SULK : LINE;
    ctx.stroke();
  }
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.4, x, y - r * 0.5);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
  ctx.fill();
}

function drawHearts(ctx: CanvasRenderingContext2D, ms: number, top: number) {
  const t = ms / HEARTS_MS;
  ctx.fillStyle = HEART;
  // 머리 양옆에서 떠올라 사라진다 (가운데 위는 삐짐 막대 자리라 비운다).
  for (const [i, [dx, dy]] of (
    [
      [-52, 26],
      [50, 18],
      [-40, 0],
    ] as const
  ).entries()) {
    const k = Math.max(0, Math.min(1, t * 1.3 - i * 0.18));
    if (k <= 0) continue;
    ctx.globalAlpha = 1 - k * k;
    heart(ctx, CX + dx, Math.max(10, top + dy - k * 30), 8 + (i % 2) * 2);
  }
  ctx.globalAlpha = 1;
}

function drawTag(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.font = '12px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const width = ctx.measureText(text).width + 14;
  const x = CX - width / 2;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y - 10, width, 20, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 7, y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

/**
 * 몸짓 표시: 갸웃 물음표, 깰 때 느낌표, 꾸벅 작은 z, 킁킁 콧김, 몸 털기 물방울과 흔들림 선, 발 구르기와 착지 먼지,
 * 꼬리 흔들기 흔들림 선. top 은 머리 꼭대기 y
 */
function drawMoveMark(ctx: CanvasRenderingContext2D, s: DrawState, top: number) {
  const act = s.mood === 'idle' || s.mood === 'sulky' ? s.activity : undefined;
  const mv = movePoseOf(act, s.calm);
  if (!mv?.mark || mv.mark.k < 0.03) return;
  const { kind, k } = mv.mark;
  const side = act && 'dir' in act ? act.dir : 1;
  const font = (px: number) =>
    `bold ${px}px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k);
  ctx.fillStyle = INK;
  ctx.strokeStyle = LINE;
  ctx.lineCap = 'round';
  const y = Math.max(16, top + 14);
  if (kind === '?' || kind === '!') {
    // 머리 옆에서 톡 튀어나온다
    ctx.font = font(kind === '?' ? 20 : 22);
    ctx.textAlign = 'center';
    ctx.fillText(kind, CX + side * 50, y - (1 - k) * 6);
  } else if (kind === 'z') {
    ctx.font = font(13);
    ctx.fillText('z', CX + 42, y - k * 5);
  } else if (kind === 'sniff') {
    // 코끝 아래 바닥에서 킁킁 콧김이 짧게 퍼진다
    ctx.lineWidth = 1.5;
    const x = CX + mv.look * 10;
    const y = GROUND - 8;
    for (const a of [-2.3, -1.57, -0.84]) {
      const r0 = 3 + k * 2;
      const r1 = r0 + 3 + k * 3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 + 6);
      ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1 + 6);
      ctx.stroke();
    }
  } else if (kind === 'shake') {
    // 양옆 흔들림 선과 튀는 물방울
    ctx.lineWidth = 1.6;
    for (const sd of [-1, 1]) {
      for (const r of [9, 14]) {
        ctx.beginPath();
        ctx.arc(CX + sd * 58, GROUND - 52, r, sd > 0 ? -0.6 : Math.PI - 0.6, sd > 0 ? 0.6 : Math.PI + 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = '#7cc4ff';
      for (const [dx, dy] of [
        [62, -78],
        [58, -30],
      ] as const) {
        ctx.beginPath();
        ctx.arc(CX + sd * (dx + (1 - k) * 6), GROUND + dy - (1 - k) * 4, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'dust') {
    ctx.fillStyle = 'rgba(160, 150, 140, 0.55)';
    for (const sd of [-1, 1]) {
      for (const [dx, r] of [
        [36, 3.2],
        [44, 2.2],
      ] as const) {
        ctx.beginPath();
        ctx.arc(CX + sd * (dx + (1 - k) * 4), GROUND - 3 - (1 - k) * 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (kind === 'wag') {
    // 꼬리 쪽(오른쪽 아래) 흔들림 선
    ctx.globalAlpha = Math.min(1, k) * 0.6;
    ctx.lineWidth = 1.4;
    for (const r of [7, 12]) {
      ctx.beginPath();
      ctx.arc(CX + 60, GROUND - 46, r, -1.0, -0.2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
