// 펫 위 마우스 입력을 클릭, 드래그로 나눈다.
// 왼쪽 버튼만 클릭과 드래그로 본다. 우클릭은 contextmenu 로 따로 받는다 (L3).

export type GestureEvent =
  | { type: 'click' }
  | { type: 'drag-start'; offset: { x: number; y: number }; petRelative?: boolean }
  | { type: 'drag-end' };

/** 이만큼(px) 움직이면 클릭이 아니라 드래그로 본다. */
export const DRAG_THRESHOLD = 4;

const LEFT_BUTTON = 0;

export class GestureTracker {
  #down: { x: number; y: number } | undefined;
  #dragging = false;

  /** 버튼을 눌렀다. x, y 는 창 안 좌표. */
  down(button: number, x: number, y: number): void {
    if (button !== LEFT_BUTTON) return;
    this.#down = { x, y };
    this.#dragging = false;
  }

  move(x: number, y: number): GestureEvent | undefined {
    const start = this.#down;
    if (!start || this.#dragging) return undefined;
    if (Math.hypot(x - start.x, y - start.y) < DRAG_THRESHOLD) return undefined;
    this.#dragging = true;
    // 창 왼쪽 위에서 커서까지 거리. 메인이 커서 위치에서 이만큼 빼서 창을 옮긴다.
    return { type: 'drag-start', offset: start };
  }

  up(button: number): GestureEvent | undefined {
    if (button !== LEFT_BUTTON || !this.#down) return undefined;
    const wasDragging = this.#dragging;
    this.cancel();
    return wasDragging ? { type: 'drag-end' } : { type: 'click' };
  }

  /** 포인터를 놓쳤을 때(창이 가려짐 등). 드래그 중이었으면 끝낸다. */
  cancel(): GestureEvent | undefined {
    const wasDragging = this.#dragging;
    this.#down = undefined;
    this.#dragging = false;
    return wasDragging ? { type: 'drag-end' } : undefined;
  }

  get dragging(): boolean {
    return this.#dragging;
  }
}

/**
 * 쓰다듬기 (v1): 버튼을 누르지 않고 펫 위에서 마우스를 좌우로 문지른다.
 * 1.2초 안에 방향을 4번 바꾸면(한 번에 6px 이상 움직여야 센다) 쓰다듬은 것. 한 번 알리면 2초 쉰다.
 */
export class RubTracker {
  #lastX: number | undefined;
  #dir = 0;
  #travel = 0;
  #flips: number[] = [];
  #quietUntil = 0;

  static readonly WINDOW_MS = 1200;
  static readonly FLIPS = 4;
  static readonly MIN_MOVE = 6;
  static readonly COOLDOWN_MS = 2000;

  /** 펫 위에서 마우스가 움직였다. 쓰다듬었으면 true */
  move(x: number, t: number): boolean {
    const last = this.#lastX;
    this.#lastX = x;
    if (last === undefined) return false;
    const dx = x - last;
    if (dx === 0) return false;
    const dir = Math.sign(dx);
    if (dir === this.#dir || this.#dir === 0) {
      this.#dir = dir;
      this.#travel += Math.abs(dx);
      return false;
    }
    // 방향이 바뀌었다. 앞 방향으로 충분히 움직였을 때만 센다.
    if (this.#travel >= RubTracker.MIN_MOVE) this.#flips.push(t);
    this.#dir = dir;
    this.#travel = Math.abs(dx);
    this.#flips = this.#flips.filter((f) => t - f <= RubTracker.WINDOW_MS);
    if (t < this.#quietUntil || this.#flips.length < RubTracker.FLIPS) return false;
    this.#flips = [];
    this.#quietUntil = t + RubTracker.COOLDOWN_MS;
    return true;
  }

  /** 펫 밖으로 나갔다 */
  reset(): void {
    this.#lastX = undefined;
    this.#dir = 0;
    this.#travel = 0;
    this.#flips = [];
  }
}
