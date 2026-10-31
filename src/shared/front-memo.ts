/**
 * 펫을 누르는 순간 맥은 앱을 깨우며 뒤에 있던 창에 포커스를 준다. 클릭이 메인에 닿을 때는(단일 클릭은 더블클릭을 기다려
 * 500ms 뒤) 이미 isFocused() 가 참이라 "맨 앞이었다" 와 구별이 안 된다.
 * 그래서 창이 뒤로 갔다가 포커스를 되찾은 때가 펫을 누른 때(pointerdown)와 같은 순간이면 펫 누르기가 깨운 것으로 본다.
 * 누른 때와 클릭이 닿은 때 사이의 시간은 보지 않는다. 누른 적이 없으면(단축키, 트레이) 판정에 끼지 않는다.
 */
export const PRESS_SYNC_MS = 400;

export class FrontMemo {
  #gainedAt: number | undefined;
  #lostAt: number | undefined;
  readonly #pressAt: () => number | undefined;
  readonly #now: () => number;

  constructor(pressAt: () => number | undefined, now: () => number = Date.now) {
    this.#pressAt = pressAt;
    this.#now = now;
  }

  gained(): void {
    this.#gainedAt = this.#now();
  }

  lost(): void {
    this.#lostAt = this.#now();
  }

  /** 우리가 창을 띄우거나 숨겼다: 그때까지의 포커스 기록은 버린다 (그 뒤의 포커스 변화는 우리가 한 것이다) */
  reset(): void {
    this.#gainedAt = undefined;
    this.#lostAt = undefined;
  }

  /** 뒤로 갔다가 되찾은 포커스가 마지막으로 펫을 누른 순간에 일어났다 (펫 누르기가 앱을 깨운 것) */
  wokenByPet(): boolean {
    const gained = this.#gainedAt;
    const press = this.#pressAt();
    if (gained === undefined || press === undefined) return false;
    if (this.#lostAt === undefined || this.#lostAt > gained) return false;
    return Math.abs(gained - press) <= PRESS_SYNC_MS;
  }
}
