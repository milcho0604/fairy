// 코드로 그린 기본 펫 (v1, D6 그림 대신). 사진 펫(P1-08)이면 몸통 대신 사진.
// 콩이와 삐약이가 귀여운 까닭을 모든 기본 펫에 지킨다 (2026-10-12 사용자 요청 "콩이, 삐약이처럼 귀엽게"):
// 동그란 몸 하나가 곧 얼굴이고 캔버스를 채운다, 눈은 작고 멀찍이 떨어져 얼굴 가운데보다 아래, 얼굴 위 선은 적게
// (특징은 하나만: 콩이 새싹, 삐약이 깃털과 부리), 맑고 따뜻한 파스텔 한 색. 몸 테두리 밖으로 크게 삐져나온 것은 귀뿐

import type { EnergyLook } from '../../shared/energy.ts';
import { heldAt } from '../../shared/fetch.ts';
import type { Gaze } from '../../shared/gaze.ts';
import type { Point } from '../../shared/geometry.ts';
import { t } from '../../shared/i18n/index.ts';
import { lensSide, type MagnifierPose } from '../../shared/look-motion.ts';
import type { MoveType } from '../../shared/moves.ts';
import type { PetMood } from '../../shared/pet-mood.ts';
import type { Gait } from '../../shared/pet3d/blueprint.ts';
import type { PetKind } from '../../shared/settings.ts';
import type { PhotoEyes } from '../../shared/starter-pets.ts';
import type { NoteLook } from '../../shared/together.ts';
import type { Outfit } from '../../shared/wear.ts';
import { drawMagnifier } from './magnifier.ts';
import { Eased } from './motion-ease.ts';
import {
  HELD_LIFT,
  HELD_SQUEEZE,
  hopScale,
  LAND_MS,
  landPose,
  type MovePose,
  movePeak,
  movePose,
} from './move-pose.ts';
import { quadKind, walkEnvelopeOf } from './pet3d-gait.ts';
import { eyedPhoto, photoEyeOpen } from './photo-eyes.ts';
import { impactSquash, photoStep, TurnWatch, turnSquash } from './photo-motion.ts';
import {
  drawBrow,
  drawHeldNote,
  drawKeyboard,
  drawPencil,
  drawTapPaws,
  drawWorkSparkle,
  tapPaws,
} from './together-draw.ts';
import { footSlide } from './walk-pace.ts';
import { drawWear2D } from './wear-draw.ts';

export const CANVAS_SIZE = 160;

const INK = '#1f2328';
const BLUSH = 'rgba(255, 140, 140, 0.45)';
const SULK = '#e07a5f';
const HEART = '#ff6b8a';

/** 기본 펫 색 */
const COLORS: Record<PetKind, { body: string; line: string }> = {
  kong: { body: '#ffd8a8', line: '#c4854a' },
  // 냥이: 옅은 하늘빛 회색 (예전 잿빛 베이지는 탁해 보였다)
  cat: { body: '#e3e8f3', line: '#8a91aa' },
  chick: { body: '#ffe27a', line: '#d29d00' },
  // 멍멍이: 크림빛 흰 강아지에 캐러멜 귀와 한쪽 눈 얼룩 (예전 갈색 몸은 콩이와 비슷하고 귀가 헤드폰처럼 보였다)
  dog: { body: '#fff3e2', line: '#b48b62' },
  bunny: { body: '#f6f0f2', line: '#a3949a' },
  // 햄찌: 위는 노릇한 황금색, 볼과 배는 흰색
  hamster: { body: '#f6c88e', line: '#c48a4d' },
  // 뒤뚱이: 남색 몸에 흰 얼굴과 배
  penguin: { body: '#56668a', line: '#3a4562' },
  // 곰돌이: 밀크초코 몸에 크림 주둥이
  bear: { body: '#cf9f72', line: '#8e6140' },
};
/** 멍멍이 귀, 눈 얼룩, 꼬리 색 */
const DOG_SPOT = '#e3a66a';
/** 몸 아래쪽을 덮는 흰 털 (햄찌 볼과 배, 뒤뚱이 얼굴과 배) */
const WHITE_FUR = '#fffaf3';
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
  /** 사진 크기 배율 (AI 일러스트 아기, 청소년은 작게). 없으면 1. 발은 바닥에 그대로 */
  photoScale?: number;
  /** 사진 속 눈 자리 (밀크, 초코). 있으면 잠, 졸음, 깜빡임에 사진 눈을 감긴다 (photo-eyes.ts). 2.5D 판도 쓴다 */
  photoEyes?: PhotoEyes;
  /**
   * 기본 상태에서 하는 행동 (P1-06). phase 는 걷기 걸음 진행 0~1.
   * 걷기의 since 는 걷기를 시작하고 지난 시간, left 는 지금 토막이 끝날 때까지 남은 시간, segMs 는 지금 토막 길이
   * (ms. 네 발 펫의 출발과 멈춤, pet3d-gait.ts walkEnvelope).
   * t 라고 쓰지 않는다: 제자리 몸짓은 't' in act 로 가린다 (movePoseOf)
   */
  activity?:
    | {
        type: 'walk';
        dir: -1 | 1;
        phase: number;
        since?: number;
        left?: number;
        segMs?: number;
        stride?: number;
        /** 걷기를 시작하고 걸은 걸음 수 (소수, phase 를 감지 않은 값). 네 발로 선 입체 몸이 간 거리를 잰다 */
        steps?: number;
        /** 집 문으로 들어가며(away) 등을 보이고, 나오며(toward) 얼굴을 보인다. 없으면 옆으로 */
        facing?: 'away' | 'toward';
      }
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
  /** 매운맛 토라짐 단계 0~3 (shared/pout.ts). 삐진 모습(sulky)의 세기를 정한다 (sulkStage) */
  pout?: number;
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
  /** 철마다 옷 (기본 펫, shared/wear.ts). 2D 는 wear-draw.ts 가 그린다. 꽃 옷이면 친밀도 꽃은 뺀다 */
  wear?: Outfit;
  /** 성장 배율 (2D 기본 펫, 발 가운데를 축으로). 없으면 1 */
  grow?: number;
  /** 2.5D 그림 펫이 숨을 쉬며 흔들리는지 (계속 그릴 때만 true. 아니면 숨과 흔들림 없이 가만히) */
  breathe?: boolean;
  /** 움직임 줄이기 (운영체제 설정 prefers-reduced-motion). 신나서 크게 튀지 않고 살짝만 들썩인다 */
  calm?: boolean;
  /** 이름 옆 얼굴 그림용 (pet-face.ts). 발은 그리지 않는다: 얼굴 아이콘은 얼굴만 */
  face?: boolean;
  /** 바닥 그림자를 그리지 않는다 (얼굴 아이콘, 집 안 그림. pet-face.ts) */
  noShadow?: boolean;
  /** 같이 보기 (shared/look-motion.ts): 그쪽을 보고, pose 가 있으면 돋보기를 든다 */
  peer?: { dir: Gaze; pose?: MagnifierPose };
  /** 사용자가 고른 걸음새 (설정). 없으면 자동: 2D 는 토순이만 네 발 (냥이, 멍멍이는 팔이 있어 두 발) */
  gait?: Gait;
  /** 입에 문 공 (네 발 펫 공놀이, shared/fetch.ts) */
  carry?: CarryDraw;
  /** 기운 (하루 리듬과 연속 작업 피로, shared/energy.ts). 기본과 말하기 상태의 뜬 눈에만 보인다 (energyFace) */
  energy?: EnergyLook;
  /** 개운함 반짝임 진행 0~1 (쉬고 와서 기지개). 없으면 -1 */
  fresh?: number;
  /** 큰 축하 색종이가 터진 뒤 흐른 시간(ms). 없으면 -1 */
  confetti?: number;
  /** 들렸다가 놓인 뒤 흐른 시간(ms). 내려앉으며 살짝 찌그러진다. 없으면 -1 */
  land?: number;
  /** 던져서 날아가다 바닥이나 벽에 부딪힌 뒤 지난 시간과 방향, 세기 (photo-motion.ts impactSquash). 없으면 undefined */
  impact?: { ms: number; axis: 'x' | 'y'; k: number };
  /**
   * 그리는 시각 (performance.now). 펫 화면이 이어서 그릴 때만 준다: 있으면 돌아서기, 고개 돌리기, 삐친 고개, 커서 보기가
   * 한 틀에 바뀌지 않고 짧게 따라간다 (motion-ease.ts). 얼굴 아이콘, 미리보기처럼 한 장만 그릴 때는 없다
   */
  now?: number;
  /** drawPet 이 부드럽게 따라간 커서 방향 (gazeOf 가 이것을 돌려준다). null 이면 안 본다. 밖에서 넣지 않는다 */
  easedGaze?: Gaze | null;
  /**
   * 같이 타자 치기 (shared/together.ts): k 는 키보드가 나온 정도 0~1 (나오고 들어가며 바뀐다), ms 는 두드린 시간.
   * 앞발로 작은 키보드를 번갈아 두드린다 (together-draw.ts tapPaws). 한가한 모습일 때만 (tapOf)
   */
  tap?: { k: number; ms: number };
  /** 같이 일하는 표정이 시작된 뒤 흐른 시간(ms): 집중한 눈썹, 연필, 반짝이. 없으면 -1 */
  work?: number;
  /** 든 쪽지 (매일 쪽지, 특별한 편지) */
  note?: NoteLook;
}

/** 같이 타자 치기를 보일 때: 한가하거나 말하는 중, 걷거나 몸짓을 하지 않을 때 (앉기는 된다). 얼굴 아이콘은 빼고 */
export function tapOf(s: DrawState, act: DrawState['activity']): { k: number; ms: number } | undefined {
  if (!s.tap || s.tap.k <= 0 || s.face) return undefined;
  if (s.mood !== 'idle' && s.mood !== 'talking') return undefined;
  if ((act && act.type !== 'sit') || s.peer?.pose || s.carry || trickOf(s)) return undefined;
  return s.tap;
}

/** 같이 일하는 표정을 보일 때: 깨어 있고 들리지 않았을 때 */
export function workOf(s: DrawState): number | undefined {
  if (s.work === undefined || s.work < 0 || s.face) return undefined;
  if (['sleeping', 'dozing', 'grabbed', 'hidden', 'busy'].includes(s.mood)) return undefined;
  return s.work;
}

/** 든 쪽지를 보일 때: 같이 타자 치는 중이 아니고, 걷거나 몸짓 중이 아니고, 깨어 있을 때 */
export function noteOf(s: DrawState, act: DrawState['activity']): NoteLook | undefined {
  if (!s.note || s.face || (s.tap?.k ?? 0) > 0.5) return undefined;
  if (['sleeping', 'dozing', 'grabbed', 'hidden', 'busy', 'thinking'].includes(s.mood)) return undefined;
  if ((act && act.type !== 'sit') || s.peer?.pose || s.carry || trickOf(s)) return undefined;
  return s.note;
}

/**
 * 지금 얼굴에 보일 기운. 기본과 말하기 상태에서만: 잠, 졸기, 신남, 잡힘, 생각 중, 바쁨은 그 상태 표정이 먼저다.
 * 같이 보기(돋보기) 중에는 눈을 뜨고 집중한다
 */
export function energyFace(s: Pick<DrawState, 'mood' | 'energy' | 'peer'>): EnergyLook | undefined {
  if (!s.energy || s.peer || (s.mood !== 'idle' && s.mood !== 'talking')) return undefined;
  return s.energy;
}

/** 눈꺼풀이 덮는 몫 (위에서부터). 녹초면 조금 더 */
export function lidOf(e: EnergyLook | undefined): number {
  if (!e) return 0;
  const base = e.stage === 'sleepy' ? 0.48 : e.stage === 'tired' ? 0.3 : 0;
  return base + (e.worn && base > 0 ? 0.06 : 0);
}

/** 축 처진 몸 (지침, 졸림): 살짝 낮고 넓게. 쉬는 모습, 앉기, 두리번일 때만 (걷기와 몸짓은 그대로) */
function droop(s: DrawState, act: DrawState['activity']): { sx: number; sy: number } {
  const e = s.mood === 'idle' ? s.energy : undefined;
  if (!e || (act && act.type !== 'sit' && act.type !== 'look')) return { sx: 1, sy: 1 };
  if (e.stage === 'sleepy') return { sx: 1.02, sy: 0.97 };
  if (e.stage === 'tired' || e.worn) return { sx: 1.01, sy: 0.985 };
  return { sx: 1, sy: 1 };
}

/** 입에 문 공. r 은 반지름(160 기준), from 은 물기 전 바닥 공 가운데 */
export interface CarryDraw {
  image: CanvasImageSource;
  r: number;
  from: Point;
  /** 고개 숙인 정도 0~1 (물 때) */
  dip: number;
  /** from 에서 입으로 옮겨 간 정도 0~1 */
  grab: number;
}

export interface Trick {
  type: 'wave' | 'dance';
  t: number;
}

/**
 * 삐진 모습의 세기 0~3. 삐지지 않았으면 0, 날 단위 삐짐만이면 1 (고개 돌리기).
 * 매운맛 토라짐이면 그 단계: 2 흥(볼 빵빵, 흘겨보기, 콧김), 3 등 돌리고 앉기(얼굴 안 보임, 화난 표시).
 * 같이 보기(peer) 중에는 그쪽을 봐야 해서 1 까지만. 기운(피곤) 표정은 sulky 에 안 붙어 겹치지 않는다 (energyFace)
 */
export function sulkStage(s: Pick<DrawState, 'mood' | 'pout' | 'peer'>): number {
  if (s.mood !== 'sulky') return 0;
  if (s.peer) return 1;
  return Math.max(1, Math.min(3, Math.round(s.pout ?? 0)));
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
  // 찌그러짐은 바닥에 닿는 순간(phase 0, 1)에 가장 크고 뜨면서 풀린다 (켜고 끄면 틀마다 툭툭 바뀌었다)
  const near = Math.min(phase, 1 - phase) / 0.12;
  return {
    lift: Math.sin(phase * Math.PI) * (calm ? 3 : 18),
    squash: calm || near >= 1 ? 0 : 0.08 * (1 - near * near),
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
  if (s.easedGaze !== undefined) return s.easedGaze ?? undefined;
  if (s.peer) return s.peer.dir;
  // 같이 타자 치거나 같이 일하는 동안은 손 쪽(아래)을 본다
  if (tapOf(s, act) || (workOf(s) !== undefined && s.mood === 'idle' && !act)) return { x: 0, y: 0.7 };
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
  /** 방금 그린 그림에서 입 가운데 (문 공 자리). 입이 없으면 undefined */
  mouth?(): { x: number; y: number } | undefined;
  /** 방금 그린 자세가 아직 목표로 따라가는 중인지 (돌아서기, 걷기 풀기). 그렇다면 몇 틀 더 그린다 */
  settling?(): boolean;
  /** 관절 없는 한 장 그림(2.5D 판)인지. 걸음 몸짓을 사진처럼 몸 전체로 한다 (photo-motion.ts) */
  readonly flat?: boolean;
  /** 같이 타자 치기 키보드와 앞발을 입체로 직접 그린다 (아니면 2D 키보드와 앞발을 위에 얹는다) */
  ownsTap?(): boolean;
  /** 방금 그린 그림에서 side 쪽 앞발 끝 (연필과 쪽지를 손에 맞춘다). 모르면 undefined */
  hand?(side: -1 | 1): { x: number; y: number } | undefined;
}

/** 하트가 떠올라 사라지는 시간 */
export const HEARTS_MS = 1500;
/** 축하 색종이가 터져 흩날리다 사라지는 시간 */
export const CONFETTI_MS = 1800;
const CONFETTI_COLORS = ['#ff6b8a', '#ffc94d', '#6fcf97', '#7cc4ff', '#b69cff'] as const;
const CONFETTI_N = 14;

/**
 * 색종이 조각들의 자리 (펫 그림 좌표, 160 기준). 머리 위(top)에서 위로 터졌다가 양옆으로 흩어지며 떨어지고 끝에 흐려진다.
 * 조각마다 정해진 값(난수 없음)이라 틀마다 같은 조각이 이어진다
 */
export function confettiAt(
  ms: number,
  top: number,
): { x: number; y: number; angle: number; color: string; alpha: number; w: number; h: number }[] {
  const t = Math.max(0, Math.min(1, ms / CONFETTI_MS));
  return Array.from({ length: CONFETTI_N }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = 18 + ((i * 37) % 50);
    const rise = 26 + ((i * 23) % 22);
    const x = CX + side * spread * Math.sqrt(t) + side * (i % 3) * 3;
    // 위로 솟았다가(처음 30%) 천천히 내려온다
    const y =
      top + 6 - rise * Math.sin(Math.min(1, t / 0.6) * Math.PI * 0.5) + 70 * Math.max(0, t - 0.3) ** 2;
    return {
      x: Math.max(4, Math.min(156, x)),
      y: Math.max(4, y),
      angle: (i * 0.9 + t * (4 + (i % 4))) * side,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] ?? '#ffc94d',
      alpha: t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3),
      w: 5 + (i % 2) * 2,
      h: 9 - (i % 2) * 3,
    };
  });
}

function drawConfetti(ctx: CanvasRenderingContext2D, ms: number, top: number) {
  for (const p of confettiAt(ms, top)) {
    if (p.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

/** 이보다 작게 그려지면 글씨표(바쁨)를 그리지 않는다. 12px 글씨가 9px 아래로 줄어드는 크기 */
const MIN_SIZE_FOR_TEXT = 120;

const CX = 80;
/** 몸 꼭대기 위로 귀나 깃털이 나온 높이 (2D) */
const EAR_TOP: Record<PetKind, number> = {
  kong: 0,
  cat: 12,
  chick: 14,
  dog: 0,
  bunny: 44,
  hamster: 6,
  penguin: 0,
  bear: 10,
};
const GROUND = 154;
const RX = 58;
const RY = 50;

/** 2D 와 사진 펫이 짧게 따라가는 값 (얼굴 방향, 삐친 사진 뒤집기, 커서 방향) */
const ease2d = new Eased();
/**
 * 한 장만 그릴 때(얼굴 아이콘, 몸 그림, 미리보기) 쓰는 따로 된 것. 늘 목표값 그대로라
 * 살아 있는 펫이 따라가던 값을 건드리지 않는다
 */
const easeStill = new Eased();
easeStill.frame(undefined);
/** 이번 drawPet 이 쓰는 것 (살아 있는 틀이면 ease2d) */
let ease = ease2d;
/** 마지막으로 이어 그린 입체 펫 (따라가는 중인지 물어본다) */
let liveModel: Model3D | undefined;
/** 고개 돌리기, 커서 보기가 따라가는 빠르기 (ms, 1/e 시간) */
const LOOK_TAU = 70;
const GAZE_TAU = 90;
/** 사진이 상태 따라 기우는 것(두리번, 졸기)이 따라가는 빠르기 (ms). 한 틀에 기울면 그림이 툭 꺾여 보였다 */
const PHOTO_TILT_TAU = 110;
/** 사진 펫이 걷다 돌아서는 때 (사진은 어느 쪽을 보는지 몰라 뒤집지 않고 잠깐 좁아진다) */
const photoTurn = new TurnWatch();
/** 이번 틀에 사진이 돌아서는 중인지 (끝날 때까지 촘촘히 그린다) */
let photoTurning = false;

/** 방금 이어 그린 자세가 아직 따라가는 중인지 (펫 화면이 그리기를 몇 틀 더 이어 간다) */
export function motionSettling(): boolean {
  return ease2d.busy || photoTurning || !!liveModel?.settling?.();
}

/** 펫을 그린다. 공을 물고 있으면 그 공 가운데를 돌려준다 (메인이 내려놓을 자리를 물을 때) */
export function drawPet(ctx: CanvasRenderingContext2D, s: DrawState): Point | undefined {
  const k = s.grow ?? 1;
  if (k === 1 || s.photo || s.model3d) return drawPetBody(ctx, s);
  // 성장 (아기, 어린이): 2D 기본 펫을 발 가운데를 축으로 조금 작게. 지우기는 줄이기 전에 캔버스 전체를
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.save();
  ctx.translate(CX, GROUND);
  ctx.scale(k, k);
  ctx.translate(-CX, -GROUND);
  try {
    const p = drawPetBody(ctx, s);
    return p && { x: CX + (p.x - CX) * k, y: GROUND + (p.y - GROUND) * k };
  } finally {
    ctx.restore();
  }
}

function drawPetBody(ctx: CanvasRenderingContext2D, s: DrawState): Point | undefined {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (s.now !== undefined) {
    ease = ease2d;
    ease2d.frame(s.now);
    liveModel = s.model3d;
  } else ease = easeStill;
  if (s.mood === 'hidden') return undefined;
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
    lift = HELD_LIFT;
    sx = 1 - HELD_SQUEEZE.x;
    sy = 1 + HELD_SQUEEZE.y;
    // 던져서 날아가다 부딪히면 그쪽으로 잠깐 눌렸다 돌아온다
    if (s.impact) {
      const hit = impactSquash(s.impact.ms, s.impact.axis, s.impact.k, s.calm);
      sx *= hit.sx;
      sy *= hit.sy;
    }
  } else if ((s.land ?? -1) >= 0 && (s.land ?? 0) < LAND_MS) {
    // 놓이면 툭 내려앉으며 살짝 납작해졌다 돌아온다
    const l = landPose(s.land ?? 0, s.calm);
    lift = l.lift;
    sx = l.sx;
    sy = l.sy;
  }
  const act = s.mood === 'idle' || s.mood === 'sulky' ? s.activity : undefined;
  // 한 장 그림(사진, 2.5D 판)은 다리가 없어 걸음마다 몸 전체가 눌렸다 늘어난다 (photo-motion.ts). 2D 와 입체는 들썩이기만
  if (act?.type === 'walk') {
    if (s.photo || s.model3d?.flat) {
      const st = photoStep(act, s.calm);
      lift = st.lift;
      sx *= st.sx;
      sy *= st.sy;
    } else lift = Math.abs(Math.sin(act.phase * Math.PI * 2)) * 3;
  }
  // 커서 방향은 한 틀에 홱 돌지 않고 따라간다 (걷기를 시작하거나 멈출 때도 고개가 툭 돌아가지 않게)
  if (s.now !== undefined) {
    const raw = gazeOf(s, act);
    const gx = ease.to('gx', raw?.x ?? 0, GAZE_TAU);
    const gy = ease.to('gy', raw?.y ?? 0, GAZE_TAU);
    s = { ...s, easedGaze: raw || Math.abs(gx) + Math.abs(gy) > 0.004 ? { x: gx, y: gy } : null };
  }
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
  // 지치거나 졸리면 몸이 살짝 처진다 (2D, 사진, 입체 모두)
  const tiredBody = droop(s, act);
  sx *= tiredBody.sx;
  sy *= tiredBody.sy;
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
    const ball = drawCarry(ctx, s.carry, guessMouth(top, GROUND - lift));
    drawPeer(ctx, s, top, GROUND - lift, PHOTO_EYE_AT);
    drawTogetherOver(ctx, s, act, top, GROUND - lift);
    drawExtras(ctx, s, top, lift);
    return ball;
  }
  if (s.model3d) {
    const top = s.model3d.draw(ctx, s, lift, sx, sy, act);
    if (top !== undefined) {
      const ball = s.carry
        ? drawCarry(ctx, s.carry, s.model3d.mouth?.() ?? guessMouth(top, GROUND - lift))
        : undefined;
      drawPeer(ctx, s, top, GROUND - lift, MODEL_EYE_AT, s.model3d);
      drawTogetherOver(ctx, s, act, top, GROUND - lift, s.model3d);
      drawExtras(ctx, s, top, lift);
      return ball;
    }
  }
  // 공을 물 때 고개를 숙인다: 2D 는 몸이 곧 머리라 몸을 조금 눌러 얼굴을 내린다
  const dip = s.carry?.dip ?? 0;
  sy *= 1 - 0.06 * dip;

  // 발: 몸통보다 먼저 그려서 몸 아래로 조금 나오게. 걸을 때는 번갈아 든다. 매달리면 늘어진다.
  // 얼굴 그림에서는 빼고 둥근 몸만 (몸통이 닫힌 타원이라 발 자리에 틈이 생기지 않는다)
  // 폴짝 뛰어도 귀 끝이 캔버스 위로 잘리지 않게 (토순이 귀는 몸 위로 44 나온다)
  // 꼭대기를 잘라 판판하게 떠 있지 않게, 뛰는 곡선 전체를 같은 배율로 낮춘다. 토순이는 뛰는 동안 귀를 뒤로 젖혀
  // (hopEars) 그만큼 더 높이 뛴다
  if (mv && act && 't' in act) {
    const peak = movePeak(act.type, s.calm);
    const room = GROUND - (RY * 2 + EAR_TOP[kind] - earDrop(kind, hopEars(act.type, 1))) * peak.sy - 4;
    lift = mv.lift * hopScale(peak.lift, room) + (lift - mv.lift);
    lift = Math.min(
      lift,
      GROUND - (RY * 2 + EAR_TOP[kind] - earDrop(kind, hopEars(act.type, mv.legs[0] / 0.6))) * sy - 4,
    );
  }
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
    // 걷기 세기: 출발과 멈출 때 0 에서 오르고 0 으로 내린다 (멈추는 틀에 발이 툭 제자리로 가지 않게)
    const walkK = act?.type === 'walk' ? walkEnvelopeOf(act).stride : 0;
    const step = act?.type === 'walk' ? Math.sin(act.phase * Math.PI * 2) * 4 * walkK : 0;
    // 디딘 발은 몸이 간 만큼 뒤로 밀린다 (walk-pace.ts footSlide). 보폭은 펫 그림 160 기준
    const slide = (swingAt: number) =>
      act?.type === 'walk' ? act.dir * footSlide(act.phase, swingAt) * (act.stride ?? 0) * walkK : 0;
    const dangle = s.mood === 'grabbed' ? 6 : 0;
    // 네 발 동물(토순이, 또는 네 발을 고른 펫)은 걸을 때 뒷발 둘이 가는 반대쪽 뒤에 보인다 (pet3d-gait.ts)
    // 걸을 때 몸은 걸음마다 들썩여도(lift) 디딘 발은 바닥에 그대로 있고 든 발만 올라간다 (예전엔 두 발이 같이 떴다)
    const footLift = act?.type === 'walk' ? 0 : lift;
    if (act?.type === 'walk' && quadKind(kind, s.gait))
      drawHindFeet(ctx, act.dir, step, footLift, [slide(0.5), slide(0)]);
    ctx.fillStyle = FEET[kind] ?? BODY;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    for (const [side, up, dx] of [
      [-1, Math.max(0, step) + (mv ? mv.legs[0] * 10 : 0), slide(0)],
      [1, Math.max(0, -step) + (mv ? mv.legs[1] * 10 : 0), slide(0.5)],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(CX + side * spread + dx, GROUND - 2 - footLift - up + dangle, 10, 5, 0, 0, Math.PI * 2);
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
  if (kind === 'hamster' || kind === 'bear') drawRoundEars(ctx, kind, mv?.ears);
  if (kind === 'bunny') {
    // 폴짝 뛰는 동안은 귀를 양옆으로 젖힌다 (hopEars)
    const a = mv && act && 't' in act ? hopEars(act.type, mv.legs[0] / 0.6) : 0;
    drawBunnyEars(ctx, a > 0 ? [a, a] : mv?.ears);
  }

  // 몸통
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.fillStyle = BODY;
  ctx.fill();
  // 몸 무늬 (햄찌 흰 배, 뒤뚱이 흰 얼굴, 냥이 이마 줄무늬): 테두리 전에 몸 안에만 칠한다. 등을 돌리면 안 보인다
  if (sulkStage(s) < 3 && drawCoat(ctx, kind)) {
    // 무늬가 길을 새로 그렸으니 테두리 길을 다시 잡는다
    ctx.beginPath();
    ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE;
  ctx.stroke();
  // 손 (모든 펫은 손이 있어야 한다, 2026-10-11 사용자 규칙). 얼굴 다음에 그린다 (든 손이 수염 앞에).
  // 얼굴 아이콘은 머리만
  const hand = s.face ? undefined : HAND[kind];
  if (kind === 'dog') drawDogEars(ctx, mv?.ears);
  // 손 흔들기 팔은 몸과 귀 다음, 얼굴 전에 (얼굴을 가리지 않게). 팔 끝은 다른 손과 같은 손.
  // 멍멍이는 팔의 몸 안쪽 부분을 칠하지 않는다 (늘어진 귀를 몸 색으로 덮어 귀가 패여 보였다).
  // 삐약이는 팔 대신 날개를 들어 파닥인다 (drawHands)
  if (trick?.type === 'wave' && !hand?.wing) drawWavingHand(ctx, trick.t, hand?.color, kind !== 'dog');
  // 매운맛 토라짐 3단계: 등을 돌려 얼굴 대신 뒷모습 (꼬리)
  const stage = sulkStage(s);
  if (stage >= 3) {
    drawBack(ctx, kind);
    if (s.wear && !s.face) drawWear2D(ctx, s.wear, true);
    ctx.restore();
    ctx.restore();
    drawExtras(ctx, s, GROUND - lift - RY * 2 * sy, lift);
    return undefined;
  }

  // 볼
  // 얼굴을 옆으로: 삐지면 고개를 돌리고, 걷거나 두리번거리면 그쪽을 본다.
  const g = gazeOf(s, act);
  const lookTo =
    s.mood === 'sulky' && !s.peer
      ? stage >= 2
        ? 16
        : 12
      : act?.type === 'walk'
        ? act.dir * 6
        : act?.type === 'look'
          ? act.dir * 8
          : mv
            ? mv.look * 8
            : g
              ? g.x * 8
              : 0;
  // 삐쳐 고개를 돌리거나 걷기 시작할 때 얼굴이 한 틀에 옆으로 건너뛰지 않고 짧게 돌아간다
  const look = ease.to('look', lookTo, LOOK_TAU);
  // 위아래를 보면 얼굴 전체(볼, 눈, 입)가 그쪽으로 조금. 고개를 숙이면(킁킁, 꾸벅) 더 아래로
  const faceDy = (g ? g.y * 2.5 : 0) + (mv ? mv.pitch * 22 : 0) + dip * 14;
  ctx.save();
  ctx.translate(0, faceDy);
  ctx.fillStyle = BLUSH;
  for (const x of [-32, 32]) {
    ctx.beginPath();
    // 삐지면 한쪽 볼이 부풀고, 흥(2단계)이면 두 볼 다 빵빵
    const puffed = s.mood === 'sulky' && (x > 0 || stage >= 2);
    const rx = puffed ? (stage >= 2 ? 12 : 11) : 8;
    ctx.ellipse(x + look, 10, rx, puffed && stage >= 2 ? 6.5 : 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (kind === 'chick') drawTuft(ctx);
  if (kind === 'cat') drawWhiskers(ctx, look);
  if (kind === 'dog') drawEyeSpot(ctx, look, g);
  if (kind === 'bear') drawMuzzle(ctx, look);

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
  // 같이 일하는 표정: 눈 위 집중한 눈썹 (눈 자리는 drawEyes 와 같은 계산)
  if (workOf(s) !== undefined && !yawning && !mv?.eyes && s.mood !== 'excited')
    for (const side of [-1, 1] as const)
      drawBrow(ctx, side * 20 + look + (g ? g.x * 3 : 0), -6 + (g ? g.y * 2.5 : 0), side);
  if (kind === 'chick' || kind === 'penguin')
    drawBeak(
      ctx,
      s.mood,
      look,
      yawning || mv?.mouth === 'open' || mv?.mouth === 'o',
      kind === 'penguin' ? 0.8 : 1,
    );
  else {
    // 코 (냥이 분홍 세모, 멍멍이와 곰돌이 까만 코, 햄찌 분홍 점): 입 위
    drawNose(ctx, kind, look);
    if (yawning) drawYawn(ctx, look);
    else if (mv?.mouth) drawMouth(ctx, mv.mouth === 'o' ? 'sleeping' : 'talking', look);
    else if (s.hungry && s.mood === 'idle') drawHungryMouth(ctx, look);
    else if ((kind === 'cat' || kind === 'hamster') && (s.mood === 'idle' || s.mood === 'excited')) {
      // 냥이와 햄찌는 웃을 때 ω 입. 햄찌는 그 아래 앞니 둘
      drawCatMouth(ctx, look);
      if (kind === 'hamster') drawTeeth(ctx, look);
    } else drawMouth(ctx, s.mood, look);
  }
  ctx.restore();
  // 철마다 옷: 얼굴 다음, 손 전에 (든 손과 쉬는 손이 늘 옷 위에 보이게)
  if (s.wear && !s.face) drawWear2D(ctx, s.wear);
  // 같이 타자 치기의 키보드, 든 쪽지: 몸 앞, 손 밑에 (몸 좌표. 키보드는 몸 아래쪽을 가로지른다)
  const tapping = tapOf(s, act);
  const press = tapping ? tapPaws(tapping.ms, s.calm) : undefined;
  if (tapping) drawKeyboard(ctx, 0, RY - 12, 66, tapping.k, press);
  const held = noteOf(s, act);
  if (held) drawHeldNote(ctx, 0, 26, held, 1.05);
  // 손: 늘어진 귀와 수염 앞에. 손 흔들기 동안 오른손은 흔드는 팔이 대신한다
  if (hand) {
    const walking = act?.type === 'walk' ? act : undefined;
    const step = walking ? Math.sin(walking.phase * Math.PI * 2) : 0;
    // 네 발로 걸으면 손이 앞발이 된다 (출발하며 숙이는 만큼 내려가고 멈추며 다시 올라온다)
    const quad = walking && quadKind(kind, s.gait) ? walkEnvelopeOf(walking).lean : 0;
    // 디딘 앞발 가운데 (발 그리기와 같은 자리: 바닥에서 2 위, 걸을 때 발은 들썩이지 않는다)를 몸 좌표로
    const footY = RY + (lift - 2) / sy;
    drawHands(ctx, kind, {
      raise: pawRaise(s, act, mv?.arms ?? 0, trick),
      step: quad > 0 ? step * (1 - quad) : step,
      wave: trick?.type === 'wave' ? trick.t : undefined,
      quad,
      footY,
      lifts: [Math.max(0, step * 4) / sy, Math.max(0, -step * 4) / sy],
      holding: s.peer?.pose && s.peer.pose.alpha > 0 ? lensSide(s.peer.dir) : undefined,
      ...(tapping && press ? { tap: { k: tapping.k, press } } : {}),
      ...(held ? { hold: true } : {}),
      ...(workOf(s) !== undefined && !tapping && !held && !walking ? { pencil: true } : {}),
    });
  }
  ctx.restore();
  ctx.restore();
  // 문 공은 얼굴 앞에. 입 자리는 위 입 그리기와 같은 계산 (입은 얼굴 가운데에서 look 만큼 옆, 12 아래)
  const ball = drawCarry(ctx, s.carry, {
    x: CX + (mv?.dx ?? 0) + look * sx,
    y: GROUND - lift + (-RY + faceDy + MOUTH_Y) * sy,
  });

  // 돋보기는 보는 쪽 눈 앞에 (눈 자리는 위 얼굴 그리기와 같은 계산)
  if (s.peer?.pose) {
    const side = lensSide(s.peer.dir);
    const gy = g ? g.y * 2.5 : 0;
    drawMagnifier(ctx, {
      pose: s.peer.pose,
      x: CX + (side * 20 + look + (g ? g.x * 3 : 0)) * sx,
      y: GROUND - lift + (-RY + gy - 6 + gy) * sy,
      paw: { body: HAND[kind].color, line: LINE },
    });
  }
  drawExtras(ctx, s, GROUND - lift - RY * 2 * sy, lift);
  return ball;
}

/** 2D 입 높이 (얼굴 가운데 기준, drawMouth 의 웃는 입과 벌린 입 사이) */
const MOUTH_Y = 12;

/** 입 자리를 모를 때(사진, 입 없는 설계도) 입 어림: 머리 꼭대기에서 바닥까지의 60% 쯤 가운데 */
function guessMouth(top: number, bottom: number): Point {
  return { x: CX, y: top + (bottom - top) * 0.6 };
}

/**
 * 입에 문 공 (shared/fetch.ts). 물 때는 바닥 자리(from)에서 입으로 옮겨 가고, 그 뒤로는 입 바로 아래에 붙는다.
 * 몸 다음에 그려 늘 얼굴 앞에 보인다. 그린 공 가운데를 돌려준다
 */
function drawCarry(ctx: CanvasRenderingContext2D, c: CarryDraw | undefined, mouth: Point): Point | undefined {
  if (!c) return undefined;
  const held = heldAt(mouth, c.r);
  const k = Math.min(1, Math.max(0, c.grab));
  const at = { x: c.from.x + (held.x - c.from.x) * k, y: c.from.y + (held.y - c.from.y) * k };
  ctx.drawImage(c.image, at.x - c.r, at.y - c.r, c.r * 2, c.r * 2);
  return at;
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
 * 사진과 입체 펫 위에 얹는 같이 지내는 모습 (together-draw.ts): 바닥 앞 작은 키보드(사진은 두드리는 앞발도, 입체는 팔이
 * 두드린다), 몸 앞에 든 쪽지, 같이 일할 때 연필과 눈썹. top 머리 꼭대기, bottom 발 높이 (2D 캔버스)
 */
function drawTogetherOver(
  ctx: CanvasRenderingContext2D,
  s: DrawState,
  act: DrawState['activity'],
  top: number,
  bottom: number,
  model?: Model3D,
) {
  const tapping = tapOf(s, act);
  if (tapping && !model?.ownsTap?.()) {
    const press = tapPaws(tapping.ms, s.calm);
    const keyY = bottom - 15;
    drawKeyboard(ctx, CX, keyY, 70, tapping.k, press);
    drawTapPaws(ctx, CX, keyY, 70, tapping.k, press);
  }
  const held = noteOf(s, act);
  if (held) {
    // 입체는 두 앞발 사이 조금 위, 모르면(사진) 배 앞
    const l = model?.hand?.(-1);
    const r = model?.hand?.(1);
    if (l && r) drawHeldNote(ctx, (l.x + r.x) / 2, (l.y + r.y) / 2 - 5, held, 1.05);
    else drawHeldNote(ctx, CX, top + (bottom - top) * 0.72, held, 1.05);
  }
  const work = workOf(s);
  if (work === undefined) return;
  // 연필은 오른 앞발에 (모르면 오른쪽 아래 어림). 두드리거나 쪽지를 든 동안은 손이 바빠 안 든다
  if (!tapping && !held && !(act && act.type !== 'sit')) {
    const hand = model?.hand?.(1);
    if (hand) drawPencil(ctx, hand.x + 1, hand.y - 3, 0.38);
    else drawPencil(ctx, CX + 34, top + (bottom - top) * 0.66, 0.38);
  }
  // 눈썹: 입체는 그린 눈 위에, 사진은 눈 자리를 몰라 그리지 않는다
  if (model?.eye && s.mood !== 'excited')
    for (const side of [-1, 1] as const) {
      const eye = model.eye(side);
      if (eye) drawBrow(ctx, eye.x, eye.y, side, 3.6);
    }
}

/**
 * 걷는 네 발 동물의 뒷발. 앞발(몸 아래 둘)보다 먼저, 가는 반대쪽으로 비켜 조금 위(뒤)에 작게 그린다.
 * 대각선 쌍으로 딛는다: 왼앞발과 오른뒷발이 같이 들린다 (step 은 앞발 그리기와 같은 값)
 */
function drawHindFeet(
  ctx: CanvasRenderingContext2D,
  dir: -1 | 1,
  step: number,
  lift: number,
  slide: readonly [number, number],
) {
  ctx.save();
  ctx.fillStyle = BODY;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  for (const [side, up, dx] of [
    [-1, Math.max(0, -step), slide[0]],
    [1, Math.max(0, step), slide[1]],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(CX - dir * 36 + side * 10 + dx, GROUND - 5 - lift - up, 8.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 기본 펫의 손 (모든 펫은 손이 있어야 한다, 2026-10-11 사용자 규칙). 냥이, 멍멍이, 토순이, 콩이는 동그란 손(발),
 * 삐약이는 작은 날개 손. 색은 입체 설계도와 같다 (냥이 하얀 발, 멍멍이 크림색 발, 토순이 하얀 배, 콩이 몸 색,
 * 삐약이 날개 색, shared/pet3d/defaults.ts). pad 면 든 손에 분홍 발바닥
 */
const HAND: Record<PetKind, { color: string; pad: boolean; wing?: boolean }> = {
  kong: { color: COLORS.kong.body, pad: true },
  cat: { color: '#fbfcff', pad: true },
  dog: { color: '#fffaf2', pad: true },
  bunny: { color: '#fffafa', pad: true },
  chick: { color: '#ffd24d', pad: false, wing: true },
  hamster: { color: '#ffe3dc', pad: true },
  // 뒤뚱이는 날개(지느러미) 손
  penguin: { color: '#475674', pad: false, wing: true },
  bear: { color: COLORS.bear.body, pad: true },
};

/** 발 색. 없으면 몸 색 (뒤뚱이는 주황 발, 햄찌는 분홍 발) */
const FEET: Partial<Record<PetKind, string>> = { penguin: '#ffad4d', hamster: '#ffd9d0' };

/**
 * 손을 드는 정도 0~1 (양손 [왼, 오른], 화면 기준). 신나면(밥 먹기, 큰 축하도) 통통 흔들며 들고, 빙글 춤과 기지개는 활짝,
 * 들려 있으면 버둥, 폴짝, 뒹굴기 같은 몸짓은 그 팔 값(move-pose.ts arms)대로. 하품은 조금
 */
function pawRaise(
  s: DrawState,
  act: DrawState['activity'],
  arms: number,
  trick: ReturnType<typeof trickOf>,
): [number, number] {
  let k = arms * 1.6;
  if (s.mood === 'excited') {
    const w = Math.sin(s.elapsed / 90);
    return [0.85 + w * 0.15, 0.85 - w * 0.15];
  }
  if (s.mood === 'grabbed') k = Math.max(k, 0.6);
  if (trick?.type === 'dance') k = Math.max(k, 0.8);
  if (act?.type === 'stretch') k = Math.max(k, Math.sin(Math.min(1, act.t) * Math.PI));
  if (act?.type === 'yawn') k = Math.max(k, 0.4 * Math.sin(Math.min(1, act.t) * Math.PI));
  if (s.mood === 'thinking') return [0, 0.45];
  const v = Math.min(1, k);
  return [v, v];
}

/** 손 그리기에 넘기는 자세 (몸 좌표, 가운데가 0) */
interface HandPose {
  /** 드는 정도 [왼, 오른] 0~1 (pawRaise) */
  raise: readonly [number, number];
  /** 걸을 때 흔들기 -1~1 (발과 반대로) */
  step: number;
  /** 손 흔들기 진행 0~1. 손 펫은 흔드는 팔이 오른손을 대신하고, 삐약이는 오른 날개를 들어 파닥인다 */
  wave?: number;
  /**
   * 네 발 걷기 정도 0~1 (출발하며 들어가고 멈추며 풀린다). 손이 몸 테두리를 따라 내려가 앞발이 되어 딛는다.
   * footY 는 디딘 앞발 가운데 높이(몸 좌표), lifts 는 앞발 [왼, 오른]을 든 높이 (발 그리기와 같은 값)
   */
  quad: number;
  footY: number;
  lifts: readonly [number, number];
  /** 돋보기를 쥔 쪽 (그쪽 손은 손잡이를 쥐러 갔다) */
  holding?: -1 | 1;
  /** 같이 타자 치기: 손이 몸 앞 키보드 위로 와서 press [왼, 오른] 만큼 누른다. k 는 나온 정도 */
  tap?: { k: number; press: readonly [number, number] };
  /** 쪽지를 두 손으로 몸 앞에 들었다 */
  hold?: boolean;
  /** 같이 일하는 중: 오른손에 연필 */
  pencil?: boolean;
}

/** 몸 테두리의 가로 자리 (몸 좌표 y 에서) */
function bodyEdge(y: number): number {
  return RX * Math.sqrt(Math.max(0, 1 - (y / RY) ** 2));
}

/**
 * 기본 펫의 손: 몸 아래쪽 양옆에 반쯤 나온 동그란 발 (몸 좌표, 가운데가 0). 쉴 때는 배 옆에 붙어 있고,
 * 들면 몸 테두리를 따라 위로 올라간다. 들어 손바닥이 보이면 분홍 발바닥.
 * 걸을 때는 발과 반대로 앞뒤(위아래)로 흔든다. 네 발로 걸으면 테두리를 따라 내려가 앞발 자리에서 딛는다.
 * 삐약이는 날개 손 (drawWing)
 */
function drawHands(ctx: CanvasRenderingContext2D, kind: PetKind, p: HandPose) {
  const hand = HAND[kind];
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE;
  for (const side of [-1, 1] as const) {
    if (side === p.holding) continue;
    const i = side === -1 ? 0 : 1;
    if (hand.wing && !p.tap && !p.hold) {
      const waving = side === 1 && p.wave !== undefined;
      const wt = p.wave ?? 0;
      const up = waving ? Math.max(p.raise[i] ?? 0, Math.min(1, wt * 5, (1 - wt) * 5)) : (p.raise[i] ?? 0);
      drawWing(ctx, side, up, waving ? waveSwing(wt) * 0.35 : p.step * side * 0.12, hand.color);
      // 같이 일하는 중: 오른 날개 끝에 연필
      if (p.pencil && side === 1 && !waving) drawPencil(ctx, bodyEdge(4) + 1, 19, 0.38);
      continue;
    }
    if (side === 1 && p.wave !== undefined) continue;
    const up = p.raise[i] ?? 0;
    if (p.tap || p.hold) {
      // 같이 타자 치기: 몸 앞 키보드 위로 손을 모아 번갈아 누른다. 쪽지: 두 손으로 몸 앞 쪽지 양끝을 쥔다
      const k = p.tap ? p.tap.k : 1;
      const press = p.tap?.press[i] ?? 0;
      const tx = side * (p.tap ? 17 : 15);
      const ty = p.tap ? RY - 21 + press * 7 : 30;
      const rx0 = side * (bodyEdge(24) + 1);
      const x = rx0 + (tx - rx0) * k;
      const y = 24 + (ty - 24) * k;
      ctx.beginPath();
      // 삐약이는 날개 끝을 모아 쥔다 (조금 길쭉한 날개깃 모양에 깃 홈 하나)
      if (hand.wing) ctx.ellipse(x, y, 7.5, 9, side * 0.5, 0, Math.PI * 2);
      else ctx.ellipse(x, y, 9, 7.5, side * 0.3 * (1 - k), 0, Math.PI * 2);
      ctx.fillStyle = hand.color;
      ctx.fill();
      ctx.stroke();
      if (hand.wing) {
        ctx.save();
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(x + side * 1.5, y + 2);
        ctx.lineTo(x + side * 3, y + 7);
        ctx.stroke();
        ctx.restore();
      }
      continue;
    }
    if (p.pencil && side === 1) {
      // 같이 일하는 중: 오른손을 조금 들어 연필을 쥔다 (연필 먼저, 손이 그 위를 감싼다)
      const py = 24 - 0.3 * 40;
      const px = bodyEdge(py) + 2.5;
      drawPencil(ctx, px + 1, py - 1, 0.38);
      ctx.beginPath();
      ctx.ellipse(px, py, 9, 8, 0.45, 0, Math.PI * 2);
      ctx.fillStyle = hand.color;
      ctx.fill();
      ctx.stroke();
      continue;
    }
    // 손은 늘 몸 테두리에 반쯤 걸쳐 있다 (떨어져 떠 보이지 않게): 쉴 때 배 옆 아래, 들면 테두리를 따라 어깨 위로
    // 올라가며 조금 더 밖으로 나온다. 걸을 때는 위아래로 조금
    let y = 24 - up * 40 - side * p.step * 3;
    let x = side * (bodyEdge(y) + 1 + up * 5);
    let rx = 9;
    let ry = 8;
    if (p.quad > 0) {
      // 네 발 걷기: 테두리를 따라 내려가 앞발 자리(가운데에서 24)에서 디딘다. 앞발 그림을 덮게 조금 납작하고 넓게
      y += (p.footY - (p.lifts[i] ?? 0) - y) * p.quad;
      x = side * Math.max(bodyEdge(y) + 1, 24 + (Math.abs(x) - 24) * (1 - p.quad));
      rx += 2 * p.quad;
      ry -= 1.5 * p.quad;
    }
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, side * (0.3 + up * 0.5) * (1 - p.quad), 0, Math.PI * 2);
    ctx.fillStyle = hand.color;
    ctx.fill();
    ctx.stroke();
    if (hand.pad && up > 0.5) {
      ctx.beginPath();
      ctx.ellipse(x + side * 0.5, y + 1, 3.6, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 150, 170, ${Math.min(0.6, (up - 0.5) * 1.6)})`;
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * 삐약이 날개 손: 어깨(몸 테두리 조금 안)에서 아래로 늘어진 작은 날개. 들면 바깥 위로 펼치고, flap 만큼 더 파닥인다.
 * 끝에 깃 두 가닥 홈을 그어 날개로 읽힌다
 */
function drawWing(ctx: CanvasRenderingContext2D, side: -1 | 1, up: number, flap: number, color: string) {
  const y0 = 4 - up * 12;
  ctx.save();
  // 들수록 어깨 안쪽에서 더 위로 세운다 (옆으로 눕히면 날개 끝이 캔버스 밖으로 잘린다)
  ctx.translate(side * (bodyEdge(y0) - 5 - up * 3), y0);
  ctx.rotate(-side * (0.4 + up * 2.3 + flap));
  ctx.beginPath();
  ctx.ellipse(0, 10, 7, 12.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  // 깃 홈: 날개 끝 쪽 짧은 선 둘
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.6;
  for (const dx of [-2.6, 2.6]) {
    ctx.beginPath();
    ctx.moveTo(dx * 0.6, 13);
    ctx.lineTo(dx, 19.5);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 손 흔들기: 몸 오른쪽 안쪽에서 시작한 짧은 팔이 몸 테두리 밖으로 나와 좌우로 흔든다 (몸 좌표, 가운데가 0).
 * 몸 안쪽 부분은 몸과 같은 색으로만 칠해 몸에서 자라난 듯 이어지고, 테두리 선은 밖으로 나온 부분에만 있다.
 * 얼굴(볼, 눈, 수염)보다 먼저 그려 얼굴을 가리지 않는다. paw 를 주면 팔 끝에 그 색 손 (HAND).
 * inside 가 false 면 몸 안쪽 부분을 칠하지 않는다 (몸 위에 그린 귀를 덮지 않게)
 */
function drawWavingHand(ctx: CanvasRenderingContext2D, t: number, paw?: string, inside = true) {
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
  // 몸 안: 몸 색으로만 (몸 테두리 안쪽 반을 덮어 이음매가 없다). inside 가 false 면 몸 테두리에서 바로 나온다
  if (inside) {
    ctx.save();
    body();
    ctx.clip();
    ctx.setTransform(local);
    arm();
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.restore();
  }
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
  // 팔 끝은 다른 손과 같은 색 동그란 손 (drawHands)
  if (paw) {
    ctx.beginPath();
    ctx.ellipse(0, -len + 5, 9, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = paw;
    ctx.fill();
    ctx.stroke();
  }
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

/**
 * 멍멍이: 머리 위 양옆에서 늘어진 캐러멜 귀 (몸 위에 겹쳐 그린다). 밑동은 몸 테두리 안 머리 위에 붙고 끝은 몸 옆으로
 * 살짝만 나온다 (예전에는 몸 양옆에 큰 타원이 붙어 헤드폰처럼 보이고 동그란 몸 윤곽이 깨졌다)
 */
function drawDogEars(ctx: CanvasRenderingContext2D, flick: readonly [number, number] = [0, 0]) {
  for (const side of [-1, 1] as const) {
    // 처진 귀는 밑동을 축으로 바깥쪽으로 펄럭
    ctx.save();
    earTurn(ctx, side * 30, -RY + 6, side, -earAngle(flick, side));
    ctx.beginPath();
    // 물방울 모양: 밑동은 좁고 끝은 둥글다
    ctx.moveTo(side * 20, -RY + 6);
    ctx.bezierCurveTo(side * 40, -RY - 6, side * 64, -RY + 10, side * 60, -RY + 36);
    ctx.bezierCurveTo(side * 57, -RY + 50, side * 42, -RY + 48, side * 40, -RY + 34);
    ctx.bezierCurveTo(side * 38, -RY + 22, side * 30, -RY + 14, side * 20, -RY + 6);
    ctx.closePath();
    ctx.fillStyle = DOG_SPOT;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LINE;
    ctx.stroke();
    ctx.restore();
  }
}

/** 멍멍이 한쪽(보는 사람 왼쪽) 눈의 캐러멜 얼룩 (눈 밑에 깐다. 눈 자리는 drawEyes 와 같은 계산) */
function drawEyeSpot(ctx: CanvasRenderingContext2D, look: number, g?: Gaze) {
  ctx.save();
  ctx.fillStyle = DOG_SPOT;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.ellipse(-21 + look + (g ? g.x * 1.5 : 0), -7, 13, 11, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 곰돌이 크림 주둥이 (코와 입이 여기 얹힌다) */
function drawMuzzle(ctx: CanvasRenderingContext2D, look: number) {
  ctx.save();
  ctx.fillStyle = '#f6e3c9';
  ctx.beginPath();
  ctx.ellipse(look, 9, 17, 12.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 코: 냥이 분홍 세모, 멍멍이와 곰돌이 까만 타원, 햄찌 분홍 점. 콩이와 토순이는 없다 */
function drawNose(ctx: CanvasRenderingContext2D, kind: PetKind, x: number) {
  ctx.save();
  ctx.beginPath();
  if (kind === 'cat') {
    ctx.moveTo(x - 3.2, 3.6);
    ctx.lineTo(x + 3.2, 3.6);
    ctx.lineTo(x, 6.6);
    ctx.closePath();
    ctx.fillStyle = '#f39aac';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f39aac';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  } else if (kind === 'dog' || kind === 'bear') {
    ctx.ellipse(x, 4.5, kind === 'bear' ? 5.5 : 5, 3.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3a2c28';
  } else if (kind === 'hamster') {
    ctx.ellipse(x, 5, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#f08aa0';
  } else {
    ctx.restore();
    return;
  }
  ctx.fill();
  ctx.restore();
}

/** ω 입 (냥이, 햄찌가 웃을 때): 코 밑에서 두 작은 호 */
function drawCatMouth(ctx: CanvasRenderingContext2D, x: number) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const dx of [-3.6, 3.6]) {
    ctx.beginPath();
    ctx.arc(x + dx, 8, 3.6, 0.05 * Math.PI, 0.95 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** 햄찌 앞니 둘 (ω 입 가운데 밑) */
function drawTeeth(ctx: CanvasRenderingContext2D, x: number) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  for (const dx of [-2.4, 2.4]) {
    ctx.beginPath();
    ctx.roundRect(x + dx - 2.2, 11.6, 4.4, 4.6, [0, 0, 1.4, 1.4]);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 몸 무늬 (몸 안에만, 테두리 전에): 햄찌는 볼과 배가 흰 털, 뒤뚱이는 하트 모양 흰 얼굴과 배,
 * 냥이는 이마에 짧은 줄무늬 셋 (삐약이 깃털처럼 한 가지 특징)
 */
function drawCoat(ctx: CanvasRenderingContext2D, kind: PetKind): boolean {
  if (kind !== 'hamster' && kind !== 'penguin' && kind !== 'cat') return false;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
  ctx.clip();
  if (kind === 'cat') {
    ctx.strokeStyle = 'rgba(138, 145, 170, 0.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [x, len] of [
      [-9, 9],
      [0, 12],
      [9, 9],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x, -RY + 1);
      ctx.lineTo(x * 0.85, -RY + 1 + len);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = WHITE_FUR;
    ctx.beginPath();
    if (kind === 'hamster') {
      // 볼에서 배까지 흰 털: 아래쪽 넓은 둥근 판에 볼 두 개가 위로 솟는다
      ctx.ellipse(0, 30, 56, 34, 0, 0, Math.PI * 2);
      ctx.moveTo(0, 8);
      ctx.ellipse(-22, 8, 22, 15, 0, 0, Math.PI * 2);
      ctx.moveTo(44, 8);
      ctx.ellipse(22, 8, 22, 15, 0, 0, Math.PI * 2);
    } else {
      // 뒤뚱이: 눈 둘을 감싼 하트 모양 얼굴이 배까지 이어진다
      ctx.ellipse(-19, -2, 25, 24, 0, 0, Math.PI * 2);
      ctx.moveTo(19 + 25, -2);
      ctx.ellipse(19, -2, 25, 24, 0, 0, Math.PI * 2);
      ctx.moveTo(44, 26);
      ctx.ellipse(0, 26, 44, 34, 0, 0, Math.PI * 2);
    }
    ctx.fill('nonzero');
  }
  ctx.restore();
  return true;
}

/** 햄찌와 곰돌이: 머리 위 동그란 귀 (몸 뒤에 그린다). 햄찌는 작고 안쪽 분홍, 곰돌이는 크고 안쪽 크림 */
function drawRoundEars(
  ctx: CanvasRenderingContext2D,
  kind: 'hamster' | 'bear',
  flick: readonly [number, number] = [0, 0],
) {
  const bear = kind === 'bear';
  const r = bear ? 15 : 11.5;
  for (const side of [-1, 1] as const) {
    const x = side * (bear ? 36 : 33);
    const y = -RY + (bear ? 7 : 9);
    ctx.save();
    earTurn(ctx, x, y + r, side, earAngle(flick, side) * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + 1, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = bear ? '#f3dcc0' : 'rgba(255, 150, 165, 0.6)';
    ctx.fill();
    ctx.restore();
  }
}

/** 토순이 2D 가 폴짝 뛰는 동안 귀를 젖히는 각 (air 는 뜬 정도 0~1). 다른 몸짓은 0 */
function hopEars(type: string, air: number): number {
  return type === 'hop' ? 1.2 * Math.max(0, Math.min(1, air)) : 0;
}

/** 귀를 a 만큼 젖혔을 때 귀 끝이 내려온 높이. 토순이만 (밑동에서 귀 끝까지 56, drawBunnyEars 는 0.8 배로 돌린다) */
function earDrop(kind: PetKind, a: number): number {
  return kind === 'bunny' ? 56 * (1 - Math.cos(a * 0.8)) : 0;
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
  ctx.strokeStyle = cat ? BODY : DOG_SPOT;
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

/** 냥이: 끝이 둥근 세모 귀, 안쪽 분홍 (몸 뒤에 그린다). 예전 뾰족 귀보다 낮고 둥글게 (아기 고양이 비율) */
function drawCatEars(ctx: CanvasRenderingContext2D, flick: readonly [number, number] = [0, 0]) {
  for (const side of [-1, 1] as const) {
    ctx.save();
    earTurn(ctx, side * 36, -RY + 18, side, earAngle(flick, side));
    ctx.beginPath();
    ctx.moveTo(side * 18, -RY + 12);
    ctx.lineTo(side * 34, -RY - 8);
    ctx.quadraticCurveTo(side * 40, -RY - 14, side * 43, -RY - 6);
    ctx.lineTo(side * 50, -RY + 22);
    ctx.closePath();
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = LINE;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(side * 27, -RY + 12);
    ctx.quadraticCurveTo(side * 39, -RY - 6, side * 44, -RY + 16);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 150, 170, 0.6)';
    ctx.fill();
    ctx.restore();
  }
}

/** 냥이 수염: 볼 바깥에 짧고 옅게 두 가닥씩 (예전에는 몸 끝까지 길게 뻗어 얼굴이 어수선했다) */
function drawWhiskers(ctx: CanvasRenderingContext2D, look: number) {
  ctx.save();
  ctx.strokeStyle = LINE;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (const dy of [-2.5, 2.5]) {
      ctx.beginPath();
      ctx.moveTo(side * 44 + look, 7 + dy);
      ctx.lineTo(side * 53 + look, 6 + dy * 1.8);
      ctx.stroke();
    }
  }
  ctx.restore();
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
function drawBeak(ctx: CanvasRenderingContext2D, mood: PetMood, look: number, open: boolean, k = 1) {
  const x = look;
  const gap = open || mood === 'talking' || mood === 'grabbed' ? 5 : 0;
  // 뒤뚱이는 조금 작은 부리 (가운데 높이 8 을 축으로 줄인다)
  ctx.save();
  ctx.translate(x, 8);
  ctx.scale(k, k);
  ctx.translate(-x, -8);
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
  ctx.restore();
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
  const k = Math.min(maxW / photo.width, maxH / photo.height) * (s.photoScale ?? 1);
  const w = photo.width * k;
  const h = photo.height * k;
  // 기울기는 셋으로 나눠 다룬다: 상태 따라 기울기(두리번, 졸기, 커서)는 짧게 따라가고, 걸음 까딱과 몸짓은 제 곡선 그대로,
  // 가는 쪽으로 숙이기는 걷기 세기를 따른다 (예전엔 모두 한 틀에 바뀌어 걷다 멈추거나 두리번거릴 때 그림이 툭 꺾였다)
  let tilt = 0;
  let rock = 0;
  let lean = 0;
  const walking = act?.type === 'walk' ? act : undefined;
  if (walking) {
    const st = photoStep(walking, s.calm);
    rock = st.rock;
    lean = st.lean;
  }
  if (act?.type === 'look') tilt = act.dir * 0.08;
  const g = gazeOf(s, act);
  // 커서 쪽으로 살짝 기운다 (사진은 얼굴을 바꿀 수 없어서)
  if (g) tilt = g.x * 0.06;
  if (s.mood === 'dozing') tilt = 0.1;
  tilt = ease.to('ptilt', tilt, PHOTO_TILT_TAU);
  // 걷다 거꾸로 돌아서면 잠깐 좁아졌다 돌아온다 (사진을 한 틀에 뒤집지 않는다)
  const turnT = photoTurn.update(s.now, walking?.dir);
  photoTurning = turnT >= 0;
  const turn = turnSquash(turnT, s.calm);
  // 가만히 숨쉬기 (부스트 모드에서 계속 그릴 때만, 2.5D 판과 같은 박자). 발은 바닥에 그대로
  const breath = s.breathe && !s.calm ? Math.sin((s.elapsed / 1000) * 2.2) : 0;
  // 몸짓도 기울기로: 손 흔들기는 좌우로 까딱, 빙글 춤은 크게 흔들기
  const trick = trickOf(s);
  if (trick?.type === 'wave') tilt = waveSwing(trick.t) * 0.1;
  if (trick?.type === 'dance') tilt = danceTilt(trick.t);
  tilt += rock + lean;
  // 제자리 몸짓: 사진은 관절이 없어 몸 전체를 기울이고 옮긴다 (뒹굴기는 사진 펫이 고르지 않는다)
  const mv = movePoseOf(act, s.calm);
  let shift = 0;
  if (mv) {
    // 누운 사진은 깨진 그림처럼 보여서 몸 돌리기는 조금만 (뒹굴기는 사진 펫이 고르지 않지만 혹시 와도)
    const turn = Math.max(-0.3, Math.min(0.3, mv.turn));
    tilt = turn + mv.twist * 0.3 + mv.tilt * 0.5 + mv.look * 0.08 + mv.pitch * 0.25;
    shift = mv.dx + mv.look * 4;
  }
  lift += turn.lift;
  // 바닥 그림자: 떠오를수록 옅고 작게 (입체와 같은 모양). 얼굴 아이콘, 집 안 그림에는 그리지 않는다
  if (!s.noShadow) {
    const away = Math.min(1, lift / 30);
    ctx.save();
    ctx.globalAlpha = 0.13 * (1 - 0.6 * away);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(CX + shift, GROUND - 1, w * 0.36 * sx * turn.sx * (1 - 0.3 * away), 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(CX + shift, GROUND - lift);
  ctx.rotate(tilt);
  // 삐지면 등을 돌린 듯 좌우를 뒤집는다. 한 틀에 뒤집지 않고 돌아서듯 좁아졌다 뒤집혀 넓어진다.
  // 걸을 때는 뒤집지 않는다: 사진이 어느 쪽을 보는지 모른다
  const flip = ease.to('flip', s.mood === 'sulky' ? -1 : 1, LOOK_TAU);
  ctx.scale(
    (flip < 0 ? -1 : 1) * Math.max(0.12, Math.abs(flip)) * sx * turn.sx * (1 - 0.006 * breath),
    sy * turn.sy * (1 + 0.012 * breath),
  );
  if (s.mood === 'sleeping' || s.mood === 'dozing') ctx.globalAlpha = 0.85;
  // 눈 자리를 아는 사진은 잠, 졸음, 깜빡임에 눈을 감는다 (2026-10-12: 초코가 자도 눈을 뜨고 있었다)
  const open = s.photoEyes
    ? photoEyeOpen({ ...s, activity: act, moveEyes: mv?.eyes, sulk: sulkStage(s) })
    : 1;
  ctx.drawImage(eyedPhoto(photo, s.photoEyes, open), -w / 2, -h, w, h);
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
  // 기운 (shared/energy.ts): 활발하면 반짝, 지치면 눈꺼풀이 내려오고, 졸리거나 녹초면 눈썹이 처지고, 녹초면 눈 밑 그늘.
  // 동그랗게 놀란 눈(몸짓 wide)에는 붙이지 않는다
  const energy = wide ? undefined : energyFace(s);
  const lid = lidOf(energy);
  for (const side of [-1, 1] as const) {
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
    } else if (sulkStage(s) >= 2) {
      drawSideEye(ctx, x, y, side, s.blink >= 0 ? Math.abs(1 - 2 * s.blink) : 1);
    } else {
      // 깜빡일 때 위아래로 접힌다. 바쁠 때는 작게 뜬다.
      const open = s.blink >= 0 ? Math.abs(1 - 2 * s.blink) : 1;
      const r = s.mood === 'busy' ? 3.5 : wide ? 5.3 : energy?.stage === 'lively' ? 4.8 : 4.5;
      const ry = Math.max(0.6, r * 1.15 * open);
      if (energy) drawEnergyEye(ctx, x, y, r, ry, side, lid, energy);
      else {
        ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/**
 * 기운이 보이는 뜬 눈 하나 (drawEyes). 눈꺼풀은 위를 덮고 바깥쪽이 살짝 처진 선, 눈썹은 안쪽이 올라간 짧은 선,
 * 눈 밑 그늘은 옅은 보라 호. 활발하면 눈이 조금 크고 흰 반짝이가 하나
 */
function drawEnergyEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  ry: number,
  side: -1 | 1,
  lid: number,
  e: EnergyLook,
) {
  // 다 감기 직전(깜빡임 가운데)은 눈꺼풀 없이 얇은 선 하나로.
  // 눈꺼풀 끝선은 가운데가 둥글게 솟은 선(∩)이고 바깥 끝은 눈보다 조금 길게 아래로 처진다 (졸려서 무거운 눈).
  // 가운데가 처진 선(∪)이나 곧은 선은 끝이 치켜 올라가 시큰둥하게 째려보는 눈으로 읽혔다 (사용자 지적 2026-10-08)
  if (lid > 0 && ry > 1.5) {
    const ly = y - ry + 2 * ry * lid;
    const arch = 1.5;
    const inner = { x: x - side * (r + 0.2), y: ly + 0.4 };
    const outer = { x: x + side * (r + 1.4), y: ly + 2.2 };
    const mid = { x: x - side * 0.4, y: ly - 2 * arch };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.quadraticCurveTo(mid.x, mid.y, outer.x, outer.y);
    ctx.lineTo(outer.x, y + ry + 2);
    ctx.lineTo(inner.x, y + ry + 2);
    ctx.closePath();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.quadraticCurveTo(mid.x, mid.y, outer.x, outer.y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (e.stage === 'lively' && ry > 2.5) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + 1.6, y - ry * 0.42, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
  }
  if (e.stage === 'sleepy' || e.worn) {
    // 팔자 눈썹: 안쪽(얼굴 가운데 쪽)이 올라가고 바깥으로 둥글게 내려간다 (찡그린 눈썹으로 보이지 않게 옅고 가늘게)
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - side * 4.5, y - 13);
    ctx.quadraticCurveTo(x + side * 0.5, y - 13, x + side * 4, y - 10.4);
    ctx.stroke();
    ctx.restore();
  }
  if (e.worn) {
    // 눈 밑 그늘
    ctx.save();
    ctx.strokeStyle = 'rgba(122, 98, 168, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 1.5, r + 1.6, 0.22 * Math.PI, 0.78 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth = 2.5;
}

/**
 * 흘겨보는 눈 (매운맛 토라짐 2단계): 위가 평평하게 잘린 눈에 눈동자는 바깥(고개 돌린 쪽)으로 몰리고,
 * 눈썹은 안쪽이 내려간 짧은 선 (뾰로통)
 */
function drawSideEye(ctx: CanvasRenderingContext2D, x: number, y: number, side: -1 | 1, open: number) {
  ctx.save();
  // 깜빡일 때는 아래 반달이 납작해진다
  ctx.beginPath();
  ctx.ellipse(x + 1.5, y + 1, 4.6, Math.max(0.6, 3.6 * open), 0, 0, Math.PI);
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x - 5.5, y + 0.6);
  ctx.lineTo(x + 6, y + 0.6);
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x - side * 1.5, y - 7);
  ctx.lineTo(x + side * 6.5, y - 9.5);
  ctx.stroke();
  ctx.restore();
}

/**
 * 뒷모습 (매운맛 토라짐 3단계). 몸 가운데 기준 좌표. 얼굴은 안 그리고 등에 꼬리만:
 * 냥이, 멍멍이는 위로 말린 꼬리, 토순이와 콩이는 동그란 솜꼬리, 삐약이는 꽁지깃 셋
 */
function drawBack(ctx: CanvasRenderingContext2D, kind: PetKind) {
  ctx.save();
  // 등 그늘: 아래쪽이 살짝 짙다 (앉은 엉덩이)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.beginPath();
  ctx.ellipse(0, RY * 0.45, RX * 0.8, RY * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BODY;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  if (kind === 'cat' || kind === 'dog') {
    ctx.lineWidth = kind === 'cat' ? 7 : 9;
    ctx.strokeStyle = LINE;
    ctx.beginPath();
    ctx.moveTo(4, RY * 0.7);
    ctx.quadraticCurveTo(26, RY * 0.55, 20, RY * 0.1);
    ctx.stroke();
    ctx.lineWidth = kind === 'cat' ? 4 : 6;
    ctx.strokeStyle = BODY;
    ctx.stroke();
  } else if (kind === 'penguin') {
    // 뒤뚱이: 짧은 세모 꽁지
    ctx.beginPath();
    ctx.moveTo(-8, RY * 0.66);
    ctx.lineTo(0, RY * 0.9);
    ctx.lineTo(8, RY * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'chick') {
    for (const a of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.ellipse(Math.sin(a) * 9, RY * 0.72 - Math.cos(a) * 4, 4, 9, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(0, RY * 0.68, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4, RY * 0.66);
    ctx.lineTo(-1, RY * 0.62);
    ctx.moveTo(2, RY * 0.72);
    ctx.lineTo(5, RY * 0.68);
    ctx.stroke();
  }
  ctx.restore();
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

/**
 * 몸 밖에 붙는 것들: 생각 중 점, 잠 Zz, 바쁨 땀과 이름표, 삐짐 막대, 하트. top 은 머리 꼭대기 y.
 * lift 는 몸이 뛰어오른 높이: 색종이는 바닥 기준(top + lift)에서 터져 펫이 통통 튀어도 따라 튀지 않는다
 */
function drawExtras(ctx: CanvasRenderingContext2D, s: DrawState, top: number, lift = 0) {
  // 머리 오른쪽 위에 꽂은 꽃. 사진은 머리가 가운데 쪽이라 조금 안으로
  if (s.flower && s.wear !== 'flower') drawFlower(ctx, CX + (s.photo ? 14 : 24), top + 8);
  if ((s.sulk ?? 0) > 0 && s.mood === 'sulky') drawSulkGauge(ctx, s.sulk ?? 0, top);
  const pouting = sulkStage(s);
  if (pouting >= 2) drawHuff(ctx, top, pouting >= 3);
  if (pouting >= 3) drawCross(ctx, CX - 40, Math.max(12, top + 10));
  if ((s.hearts ?? -1) >= 0 && (s.hearts ?? 0) < HEARTS_MS) drawHearts(ctx, s.hearts ?? 0, top);
  if ((s.confetti ?? -1) >= 0 && (s.confetti ?? 0) < CONFETTI_MS)
    drawConfetti(ctx, s.confetti ?? 0, top + lift);
  drawMoveMark(ctx, s, top);
  if ((s.fresh ?? -1) >= 0 && s.mood !== 'sleeping' && s.mood !== 'dozing') drawFresh(ctx, s.fresh ?? 0, top);
  // 같이 일하는 중: 머리 오른쪽 위 반짝이
  const work = workOf(s);
  // 사진 펫은 오른쪽 위에 기운 반짝이가 있어 왼쪽 위에
  if (work !== undefined && s.mood !== 'thinking')
    drawWorkSparkle(ctx, CX + (s.photo ? -46 : 42), Math.max(10, top + 4), work, s.calm);
  if (s.photo) drawPhotoEnergy(ctx, s, top);
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
  } else if (s.mood === 'sleeping' && !s.face) {
    // 얼굴 그림(집 안 침대의 자는 얼굴)에는 Zz 를 넣지 않는다: 집 그림이 따로 올린다
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

/** 네 갈래 반짝이 하나 (개운함, 활발한 사진 펫) */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.18, y - r * 0.18, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.18, y + r * 0.18, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.18, y + r * 0.18, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.18, y - r * 0.18, x, y - r);
  ctx.fill();
}

/** 개운함: 머리 둘레에서 반짝이 넷이 차례로 반짝였다 사라진다. t 는 진행 0~1 */
function drawFresh(ctx: CanvasRenderingContext2D, t: number, top: number) {
  ctx.save();
  ctx.fillStyle = '#ffc94d';
  for (const [i, [dx, dy, r]] of (
    [
      [-46, 18, 7],
      [44, 6, 8],
      [-30, -4, 5],
      [58, 30, 5],
    ] as const
  ).entries()) {
    const k = Math.max(0, Math.min(1, t * 1.6 - i * 0.15));
    if (k <= 0 || k >= 1) continue;
    const pulse = Math.sin(k * Math.PI);
    ctx.globalAlpha = pulse;
    sparkle(ctx, CX + dx, Math.max(8, top + dy - k * 6), r * (0.6 + 0.4 * pulse));
  }
  ctx.restore();
}

/**
 * 사진 펫은 얼굴을 바꿀 수 없어 기운을 머리 옆 작은 표시로 (멈춘 그림, 다시 그리지 않는다):
 * 활발하면 반짝이 둘, 졸리면 작은 z, 녹초면 작은 땀방울
 */
function drawPhotoEnergy(ctx: CanvasRenderingContext2D, s: DrawState, top: number) {
  const e = energyFace(s);
  if (!e || s.activity) return;
  ctx.save();
  if (e.stage === 'lively') {
    ctx.fillStyle = '#ffc94d';
    ctx.globalAlpha = 0.9;
    sparkle(ctx, CX + 46, Math.max(10, top + 10), 6);
    sparkle(ctx, CX + 58, Math.max(18, top + 24), 4);
  }
  if (e.stage === 'sleepy') {
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.7;
    ctx.font = 'bold 13px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    ctx.fillText('z', CX + 44, Math.max(14, top + 8));
  }
  if (e.worn) {
    ctx.fillStyle = '#7cc4ff';
    ctx.globalAlpha = 0.85;
    const x = CX - 46;
    const y = Math.max(10, top + 14);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 5, y + 8, x, y + 11);
    ctx.quadraticCurveTo(x - 5, y + 8, x, y);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 흥! 콧김 (매운맛 토라짐 2단계부터): 고개 돌린 쪽 얼굴 옆으로 작은 김 두 덩이.
 * 등 돌린 3단계는 머리 위로 피어오른다. 멈춘 그림 (다시 그리지 않는다)
 */
function drawHuff(ctx: CanvasRenderingContext2D, top: number, back: boolean) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = 'rgba(31, 35, 40, 0.55)';
  ctx.lineWidth = 1.4;
  const puffs: [number, number, number][] = back
    ? [
        [CX + 34, top + 4, 7],
        [CX + 46, top - 4, 5],
      ]
    : [
        [CX + 60, top + 44, 6.5],
        [CX + 70, top + 34, 4.5],
      ];
  for (const [x, y, r] of puffs) {
    const cy = Math.max(r + 2, y);
    ctx.beginPath();
    ctx.arc(x - r * 0.55, cy, r * 0.7, 0, Math.PI * 2);
    ctx.arc(x + r * 0.5, cy - r * 0.15, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x, cy - r * 0.55, r * 0.65, 0, Math.PI * 2);
    // 밝은 바탕에서도 보이게 겉선을 먼저 굵게 그리고 흰 속을 채운다
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.fill();
    ctx.lineWidth = 1.4;
  }
  // 김 줄기 (얼굴 쪽에서 나온다)
  ctx.beginPath();
  if (back) {
    ctx.moveTo(CX + 24, Math.max(10, top + 16));
    ctx.lineTo(CX + 30, Math.max(8, top + 10));
  } else {
    ctx.moveTo(CX + 50, top + 52);
    ctx.lineTo(CX + 55, top + 48);
  }
  ctx.stroke();
  ctx.restore();
}

/** 화난 표시 (네 갈래 꺾인 핏줄 모양). 매운맛 토라짐 3단계, 머리 왼쪽 위 (오른쪽은 꽃 자리) */
function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = SULK;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x + dx * 2, y + dy * 7);
    ctx.quadraticCurveTo(x + dx * 2.5, y + dy * 2.5, x + dx * 7, y + dy * 2);
    ctx.stroke();
  }
  ctx.restore();
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
