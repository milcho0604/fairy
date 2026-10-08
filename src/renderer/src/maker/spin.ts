// 펫 만들기 미리보기에서 입체 펫을 돌려 보는 손: 끌기, 놓으면 조금 더 도는 관성, 천천히 자동 회전,
// 화살표 한 칸, 정면으로 되돌리기. 그리기(Pet3D)와 따로 둬서 숫자로 시험한다 (spin.test.ts).
// yaw 는 Pet3D.spin 에, pitch 는 Pet3D.tilt 에 그대로 넣는다.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export interface SpinLimits {
  /** 좌우로 돌 수 있는 끝(spin 값). 없으면 한 바퀴 다 돈다 */
  yaw?: number;
  /** 위아래 기울기 범위(라디안). 양수가 위에서 내려다보기 */
  pitch: readonly [number, number];
  /** 화면에 알리는 각도 = yaw × shown. 2.5D 는 Pet3D 가 spin 을 0.4 배로 써서 */
  shown: number;
  /** 화살표 한 번에 도는 만큼(spin 값) */
  step: number;
}

/** AI 설계도 피규어: 한 바퀴 다 돈다. 아래에서 올려보기는 조금만(발바닥과 바닥 그림자가 어색하다) */
export const FIGURE_LIMITS: SpinLimits = { pitch: [-10 * DEG, 25 * DEG], shown: 1, step: 30 * DEG };
/** 2.5D 입체 판: 앞모습뿐이라 좌우 25도(spin 1.1 × 0.4)까지, 기울기도 조금만 */
export const RELIEF_LIMITS: SpinLimits = { yaw: 1.1, pitch: [-8 * DEG, 10 * DEG], shown: 0.4, step: 0.275 };

/** 끌기 1px 에 도는 각. 미리보기(220px)를 한 번 가로질러 끌면 반 바퀴 남짓 */
export const RAD_PER_PX = 0.0145;
/** 위아래는 더 둔하게 (살짝 비뚤게 끌어도 기울지 않게) */
const PITCH_PER_PX = 0.006;
/** 놓았을 때 이어 도는 빠르기 상한(라디안/ms, 초당 1/4 바퀴쯤) */
export const MAX_VEL = 0.0045;
/**
 * 관성이 줄어드는 시간 상수(ms). 놓은 뒤 더 도는 각은 빠르기 × 이 값쯤이라
 * 세게 던져도 60도 남짓, 보통 끌기는 10~30도 (관성은 조금만)
 */
const FRICTION_MS = 220;
/** 이보다 느리면 멈춘 것으로 */
const MIN_VEL = 0.00012;
/** 놓기 직전 이만큼 멈춰 있었으면 관성 없이 그 자리에 */
const HOLD_MS = 90;
/** 자동 회전: 한 바퀴 14초 */
export const AUTO_VEL = TAU / 14_000;
/** 2.5D 자동: 좌우로 천천히 (옛 미리보기와 같은 빠르기) */
const SWAY_MS = 2600;
/** 화살표, 정면 되돌리기가 목표로 미끄러지는 시간 상수(ms) */
const EASE_MS = 110;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 각을 (-π, π] 로 */
export function wrap(a: number): number {
  const r = (((a + Math.PI) % TAU) + TAU) % TAU;
  return r === 0 ? Math.PI : r - Math.PI;
}

export class Spinner {
  yaw = 0;
  pitch = 0;
  /** 관성 빠르기(라디안/ms) */
  vel = 0;
  auto: boolean;
  private target: { yaw: number; pitch: number } | undefined;
  private drag: { x: number; y: number; t: number } | undefined;
  /** 2.5D 자동 흔들기 자리 */
  private phase = 0;

  readonly limits: SpinLimits;

  constructor(limits: SpinLimits, auto: boolean) {
    this.limits = limits;
    this.auto = auto;
  }

  get dragging(): boolean {
    return !!this.drag;
  }

  /** 끌기를 시작한다. 자동 회전과 관성, 미끄러짐은 멈춘다 */
  grab(x: number, y: number, t: number): void {
    this.drag = { x, y, t };
    this.vel = 0;
    this.target = undefined;
    this.auto = false;
  }

  move(x: number, y: number, t: number): void {
    const d = this.drag;
    if (!d) return;
    const before = this.yaw;
    this.yaw = this.clampYaw(this.yaw + (x - d.x) * RAD_PER_PX);
    this.pitch = clamp(this.pitch + (y - d.y) * PITCH_PER_PX, ...this.limits.pitch);
    const dt = t - d.t;
    if (dt > 0) {
      // 빠르기는 앞 값과 반씩 섞는다 (손 떨림 한 번에 휙 돌지 않게)
      const now = (this.yaw - before) / dt;
      this.vel = this.vel * 0.5 + now * 0.5;
    }
    this.drag = { x, y, t };
  }

  release(t: number): void {
    const d = this.drag;
    if (!d) return;
    this.drag = undefined;
    this.vel = t - d.t > HOLD_MS ? 0 : clamp(this.vel, -MAX_VEL, MAX_VEL);
  }

  /** 화살표 한 칸. dir 은 -1(왼쪽, 아래) 또는 1. 한 바퀴 다 도는 펫은 계속 눌러 끝없이 돈다 */
  nudge(axis: 'yaw' | 'pitch', dir: -1 | 1): void {
    this.auto = false;
    this.vel = 0;
    const base = this.target ?? { yaw: this.yaw, pitch: this.pitch };
    this.target =
      axis === 'yaw'
        ? { yaw: this.clampYaw(base.yaw + dir * this.limits.step), pitch: base.pitch }
        : { yaw: base.yaw, pitch: clamp(base.pitch + dir * 8 * DEG, ...this.limits.pitch) };
  }

  /** 정면으로 되돌린다. 가까운 쪽으로 돌아 온다 */
  front(): void {
    this.auto = false;
    this.vel = 0;
    this.drag = undefined;
    if (this.limits.yaw === undefined) this.yaw = wrap(this.yaw);
    this.target = { yaw: 0, pitch: 0 };
  }

  setAuto(on: boolean): void {
    this.auto = on;
    if (!on) return;
    this.vel = 0;
    this.target = undefined;
    const max = this.limits.yaw;
    // 2.5D 는 지금 자리에서 이어 흔들게
    if (max !== undefined) this.phase = Math.asin(clamp(this.yaw / max, -1, 1)) * SWAY_MS;
  }

  /**
   * dt(ms) 만큼 움직인다. 아직 움직이는 중이면 true (끌기, 관성, 미끄러짐, 자동).
   * 멈춰 있으면 false 라서 그리는 쪽이 천천히 그려도 된다
   */
  step(dt: number): boolean {
    // 창이 잠깐 멈췄다 돌아오면 dt 가 커서 휙 돈다
    const ms = clamp(dt, 0, 100);
    if (this.drag) return true;
    const max = this.limits.yaw;
    if (this.target) {
      const k = 1 - Math.exp(-ms / EASE_MS);
      this.yaw += (this.target.yaw - this.yaw) * k;
      this.pitch += (this.target.pitch - this.pitch) * k;
      if (Math.abs(this.target.yaw - this.yaw) < 0.002 && Math.abs(this.target.pitch - this.pitch) < 0.002) {
        this.yaw = this.target.yaw;
        this.pitch = this.target.pitch;
        this.target = undefined;
        this.settle();
      }
      return true;
    }
    if (this.vel !== 0) {
      const next = this.yaw + this.vel * ms;
      this.yaw = this.clampYaw(next);
      // 끝에 닿으면 멈춘다 (2.5D)
      this.vel = this.yaw !== next ? 0 : this.vel * Math.exp(-ms / FRICTION_MS);
      if (Math.abs(this.vel) < MIN_VEL) {
        this.vel = 0;
        this.settle();
      }
      return true;
    }
    if (this.auto) {
      if (max === undefined) this.yaw = wrap(this.yaw + AUTO_VEL * ms);
      else {
        this.phase += ms;
        this.yaw = Math.sin(this.phase / SWAY_MS) * max;
      }
      return true;
    }
    return false;
  }

  /** 화면에 알릴 각도(도). 한 바퀴 도는 펫은 0~359, 2.5D 는 -25~25 */
  degrees(): number {
    const a = this.yaw * this.limits.shown;
    if (this.limits.yaw !== undefined) return Math.round(a / DEG);
    return ((Math.round(wrap(a) / DEG) % 360) + 360) % 360;
  }

  /** 지금 보이는 쪽 */
  side(): 'front' | 'side' | 'back' {
    const d = this.degrees();
    const off = Math.abs(d > 180 ? d - 360 : d);
    return off <= 30 ? 'front' : off >= 150 ? 'back' : 'side';
  }

  private clampYaw(y: number): number {
    const max = this.limits.yaw;
    return max === undefined ? y : clamp(y, -max, max);
  }

  /** 멈췄을 때 큰 각을 (-π, π] 로 접어 둔다 (보이는 모습은 같다) */
  private settle() {
    if (this.limits.yaw === undefined) this.yaw = wrap(this.yaw);
  }
}
