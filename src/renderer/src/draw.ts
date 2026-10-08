// 코드로 그린 기본 펫. 콩, 냥이, 삐약이 세 가지 (v1, D6 그림 대신). 사진 펫(P1-08)이면 몸통 대신 사진.

import type { Gaze } from '../../shared/gaze.ts';
import { t } from '../../shared/i18n/index.ts';
import type { PetMood } from '../../shared/pet-mood.ts';
import type { PetKind } from '../../shared/settings.ts';

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
  /** 기본 상태에서 하는 행동 (P1-06). phase 는 걷기 걸음 진행 0~1 */
  activity?:
    | { type: 'walk'; dir: -1 | 1; phase: number }
    | { type: 'sit' }
    | { type: 'look'; dir: -1 | 1 }
    | { type: 'yawn'; t: number }
    | { type: 'stretch'; t: number };
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

/** 지금 커서를 볼지: 기본 상태에서 아무것도 안 하거나 앉아 있을 때만 */
export function gazeOf(s: DrawState, act: DrawState['activity']): Gaze | undefined {
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
}

/** 하트가 떠올라 사라지는 시간 */
export const HEARTS_MS = 1500;

/** 이보다 작게 그려지면 글씨표(바쁨)를 그리지 않는다. 12px 글씨가 9px 아래로 줄어드는 크기 */
const MIN_SIZE_FOR_TEXT = 120;

const CX = 80;
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
  if (act?.type === 'sit') {
    sx = 1.06;
    sy = 0.9;
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

  if (s.cushion && (act?.type === 'sit' || s.mood === 'sleeping' || s.mood === 'dozing')) drawCushion(ctx);

  if (s.photo) {
    const top = drawPhoto(ctx, s, s.photo, lift, sx, sy, act);
    drawExtras(ctx, s, top);
    return;
  }
  if (s.model3d) {
    const top = s.model3d.draw(ctx, s, lift, sx, sy, act);
    if (top !== undefined) {
      drawExtras(ctx, s, top);
      return;
    }
  }

  // 발: 몸통보다 먼저 그려서 몸 아래로 조금 나오게. 걸을 때는 번갈아 든다. 매달리면 늘어진다.
  // 얼굴 그림에서는 빼고 둥근 몸만 (몸통이 닫힌 타원이라 발 자리에 틈이 생기지 않는다)
  if (!s.face) {
    const spread = act?.type === 'sit' ? 32 : 24;
    const step = act?.type === 'walk' ? Math.sin(act.phase * Math.PI * 2) * 4 : 0;
    const dangle = s.mood === 'grabbed' ? 6 : 0;
    ctx.fillStyle = BODY;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    for (const [side, up] of [
      [-1, Math.max(0, step)],
      [1, Math.max(0, -step)],
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
  ctx.scale(sx, sy);
  ctx.translate(0, -RY);

  if (kind === 'cat') drawCatEars(ctx);
  if (kind === 'bunny') drawBunnyEars(ctx);

  // 몸통
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = BODY;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE;
  ctx.stroke();
  if (kind === 'dog') drawDogEars(ctx);
  // 손 흔들기 팔은 몸과 귀 다음, 얼굴 전에 (얼굴을 가리지 않게)
  if (trick?.type === 'wave') drawWavingHand(ctx, trick.t);

  // 볼
  // 얼굴을 옆으로: 삐지면 고개를 돌리고, 걷거나 두리번거리면 그쪽을 본다.
  const g = gazeOf(s, act);
  const look =
    s.mood === 'sulky'
      ? 12
      : act?.type === 'walk'
        ? act.dir * 6
        : act?.type === 'look'
          ? act.dir * 8
          : g
            ? g.x * 8
            : 0;
  // 위아래를 보면 얼굴 전체(볼, 눈, 입)가 그쪽으로 조금
  ctx.save();
  ctx.translate(0, g ? g.y * 2.5 : 0);
  ctx.fillStyle = BLUSH;
  for (const x of [-32, 32]) {
    ctx.beginPath();
    ctx.ellipse(x + look, 10, s.mood === 'sulky' && x > 0 ? 11 : 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (kind === 'chick') drawTuft(ctx);
  if (kind === 'cat') drawWhiskers(ctx, look);

  const yawning = act?.type === 'yawn' && act.t > 0.15 && act.t < 0.85;
  drawEyes(
    ctx,
    yawning ? { ...s, mood: 'sleeping' } : act?.type === 'stretch' || trick ? { ...s, mood: 'excited' } : s,
    look,
    g,
  );
  if (kind === 'chick') drawBeak(ctx, s.mood, look, yawning);
  else if (yawning) drawYawn(ctx, look);
  else if (s.hungry && s.mood === 'idle') drawHungryMouth(ctx, look);
  else drawMouth(ctx, s.mood, look);
  ctx.restore();
  ctx.restore();

  drawExtras(ctx, s, GROUND - lift - RY * 2 * sy);
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
function drawDogEars(ctx: CanvasRenderingContext2D) {
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 50, -RY + 34, 13, 24, side * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#b9824c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LINE;
    ctx.stroke();
  }
}

/** 토순이: 위로 긴 귀, 안쪽 분홍 (몸 뒤에 그린다) */
function drawBunnyEars(ctx: CanvasRenderingContext2D) {
  for (const side of [-1, 1]) {
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
  }
}

function drawCatEars(ctx: CanvasRenderingContext2D) {
  for (const side of [-1, 1]) {
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
  if (s.mood === 'dozing') tilt = 0.1;
  ctx.save();
  ctx.translate(CX, GROUND - lift);
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

function drawEyes(ctx: CanvasRenderingContext2D, s: DrawState, look: number, gaze?: Gaze) {
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
      const r = s.mood === 'busy' ? 3.5 : 4.5;
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
