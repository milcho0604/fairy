// 자세가 한 틀에 통째로 바뀌지 않게 짧게 겹쳐 바꾸는 도우미 (pet.ts).
// 같이 타자 치다 컴퓨터가 바빠지면 키보드 자세가 한 틀에 "바빠서 쉬는 중" 자세로 바뀌었다 (2026-10-11 점검).
// 상태(기분, 키보드, 든 쪽지, 연필, 몸짓)가 바뀐 틀에 지난 그림을 떠 두고, 새 그림 위에 BLEND_MS 동안 옅어지며 겹친다.
// 자세 하나하나에 따라가기를 넣지 않아도 2D, 사진, 입체 모두 같이 부드러워진다. 그리기 없는 부분은 시험한다 (pose-blend.test.ts)
import type { PetMood } from '../../shared/pet-mood.ts';

/** 겹쳐 바꾸는 시간 */
export const BLEND_MS = 220;

/** 한 틀의 자세를 가르는 것들. 이 중 하나가 바뀌면 겹쳐 바꾼다 */
export interface PoseKey {
  mood: PetMood;
  /** 같이 타자 치는 키보드를 그리는지 */
  tap: boolean;
  /** 든 쪽지를 그리는지 */
  note: boolean;
  /** 같이 일하는 연필을 그리는지 */
  work: boolean;
  /** 몸짓 (손 흔들기, 춤). 없으면 '' */
  trick: string;
  /** 등 돌리고 앉았는지 (매운맛 토라짐 3단계) */
  back: boolean;
}

const same = (a: PoseKey, b: PoseKey) =>
  a.mood === b.mood &&
  a.tap === b.tap &&
  a.note === b.note &&
  a.work === b.work &&
  a.trick === b.trick &&
  a.back === b.back;

/**
 * 겹쳐 바꿀지. 움직임 줄이기와 배터리 절약이면 바로 바꾼다 (그리기를 더 하지 않는다).
 * 잡을 때는 바로 들린 모습이어야 손에 붙는 느낌이라 겹치지 않는다 (놓을 때는 겹친다). 숨김은 겹칠 그림이 없다.
 * 가만히 있는 자세끼리(키보드 → 바쁨, 졸기 → 잠, 연필 들기, 내려앉기) 바뀔 때 쓴다
 */
export function shouldBlend(
  prev: PoseKey | undefined,
  next: PoseKey,
  o: { calm: boolean; saver: boolean },
): boolean {
  if (!prev || same(prev, next) || o.calm || o.saver) return false;
  if (prev.mood === 'hidden' || next.mood === 'hidden') return false;
  if (next.mood === 'grabbed' && prev.mood !== 'grabbed') return false;
  // 통통 튀기, 춤, 손 흔들기가 시작되거나 튀는 동안은 바로 바꾼다: 움직이는 몸끼리 겹치면 테두리가 두 겹으로 보인다
  // (움직임이 시작되는 틀의 바뀜은 움직임에 묻힌다). 움직임이 끝나 가만히 서는 쪽은 겹친다
  if (next.mood === 'excited' || (next.trick !== '' && next.trick !== prev.trick)) return false;
  return true;
}

/** 지난 그림이 남은 정도: 1 에서 0 으로, 처음과 끝이 완만하게 (t 는 0~1 진행) */
export function ghostAlpha(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const k = 1 - t;
  return k * k * (3 - 2 * k);
}

/** 캔버스 하나의 겹쳐 바꾸기. 바뀐 틀에 snap(), 새 그림을 그린 뒤 매 틀 over() */
export class PoseBlend {
  private ghost: HTMLCanvasElement | undefined;
  private owner: CanvasRenderingContext2D | undefined;
  private start = -1;

  /** 겹치는 중인지 (그리기를 이어 가야 하는지) */
  get active(): boolean {
    return this.start >= 0;
  }

  /** 지금 캔버스 그림(새 자세를 그리기 전)을 떠 둔다 */
  snap(ctx: CanvasRenderingContext2D, now: number): void {
    const src = ctx.canvas;
    if (!src.width || !src.height) return;
    this.ghost ??= document.createElement('canvas');
    const g = this.ghost;
    if (g.width !== src.width || g.height !== src.height) {
      g.width = src.width;
      g.height = src.height;
    }
    const gctx = g.getContext('2d');
    if (!gctx) return;
    gctx.clearRect(0, 0, g.width, g.height);
    gctx.drawImage(src as CanvasImageSource, 0, 0);
    this.owner = ctx;
    this.start = now;
  }

  /** 새 그림 위에 지난 그림을 겹친다: 새 그림 × (1-a) + 지난 그림 × a (투명한 곳도 같이 섞인다) */
  over(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.start < 0) return;
    const g = this.ghost;
    const a = ghostAlpha((now - this.start) / BLEND_MS);
    // 다른 캔버스로 옮겼거나(2D ↔ 입체) 크기가 바뀌었으면 그만
    if (
      !g ||
      a <= 0 ||
      ctx !== this.owner ||
      g.width !== ctx.canvas.width ||
      g.height !== ctx.canvas.height
    ) {
      this.start = -1;
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = 1 - a;
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(g, 0, 0);
    ctx.restore();
  }

  stop(): void {
    this.start = -1;
  }
}
