// 코드로 그린 기본 펫. 사진 펫(P1-08)과 기본 펫 그림(D6)이 나오면 몸통 그리기만 바꾼다.
import type { PetMood } from '../../shared/pet-mood.ts';

export const CANVAS_SIZE = 160;

const BODY = '#ffd8a8';
const LINE = '#c4854a';
const INK = '#1f2328';
const BLUSH = 'rgba(255, 140, 140, 0.45)';

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
  /** 기본 상태에서 하는 행동 (P1-06). phase 는 걷기 걸음 진행 0~1 */
  activity?: { type: 'walk'; dir: -1 | 1; phase: number } | { type: 'sit' } | { type: 'look'; dir: -1 | 1 };
}

/** 이보다 작게 그려지면 글씨표(바쁨)를 그리지 않는다. 12px 글씨가 9px 아래로 줄어드는 크기 */
const MIN_SIZE_FOR_TEXT = 120;

const CX = 80;
const GROUND = 154;
const RX = 58;
const RY = 50;

export function drawPet(ctx: CanvasRenderingContext2D, s: DrawState): void {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (s.mood === 'hidden') return;

  // 몸 모양: 신남은 통통 튀고 착지할 때 찌그러진다. 잡힘은 늘어난다.
  let lift = 0;
  let sx = 1;
  let sy = 1;
  if (s.mood === 'excited') {
    const phase = (s.elapsed % 600) / 600;
    lift = Math.sin(phase * Math.PI) * 18;
    const squash = phase < 0.12 || phase > 0.88 ? 0.08 : 0;
    sx = 1 + squash;
    sy = 1 - squash;
  } else if (s.mood === 'grabbed') {
    // 들려 있으니 몸을 조금 올려 늘어진 발이 캔버스 아래로 잘리지 않게 한다.
    lift = 6;
    sx = 0.94;
    sy = 1.08;
  }
  const act = s.mood === 'idle' ? s.activity : undefined;
  if (act?.type === 'walk') lift = Math.abs(Math.sin(act.phase * Math.PI * 2)) * 3;
  if (act?.type === 'sit') {
    sx = 1.06;
    sy = 0.9;
  }

  // 발: 몸통보다 먼저 그려서 몸 아래로 조금 나오게. 걸을 때는 번갈아 든다. 매달리면 늘어진다.
  {
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

  ctx.save();
  ctx.translate(CX, GROUND - lift);
  ctx.scale(sx, sy);
  ctx.translate(0, -RY);

  // 몸통
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = BODY;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE;
  ctx.stroke();

  // 볼
  // 얼굴을 옆으로: 삐지면 고개를 돌리고, 걷거나 두리번거리면 그쪽을 본다.
  const look =
    s.mood === 'sulky' ? 12 : act?.type === 'walk' ? act.dir * 6 : act?.type === 'look' ? act.dir * 8 : 0;
  ctx.fillStyle = BLUSH;
  for (const x of [-32, 32]) {
    ctx.beginPath();
    ctx.ellipse(x + look, 10, s.mood === 'sulky' && x > 0 ? 11 : 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEyes(ctx, s, look);
  if (s.hungry && s.mood === 'idle') drawHungryMouth(ctx, look);
  else drawMouth(ctx, s.mood, look);
  ctx.restore();

  drawExtras(ctx, s, GROUND - lift - RY * 2 * sy);
}

function drawEyes(ctx: CanvasRenderingContext2D, s: DrawState, look: number) {
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const x = side * 20 + look;
    const y = -6;
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

/** 몸 밖에 붙는 것들: 생각 중 점, 잠 Zz, 바쁨 땀과 이름표. top 은 머리 꼭대기 y. */
function drawExtras(ctx: CanvasRenderingContext2D, s: DrawState, top: number) {
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
    if ((s.viewSize ?? CANVAS_SIZE) >= MIN_SIZE_FOR_TEXT) drawTag(ctx, '바빠서 쉬는 중', top - 22);
  }
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
