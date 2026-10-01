// 펫 위 마우스 입력을 클릭, 드래그로 나눈다.
// 왼쪽 버튼만 클릭과 드래그로 본다. 우클릭은 contextmenu 로 따로 받는다 (L3).

export type GestureEvent =
  | { type: 'click' }
  | { type: 'drag-start'; offset: { x: number; y: number } }
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
