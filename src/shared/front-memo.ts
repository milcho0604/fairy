/**
 * 펫을 누르는 순간 맥은 앱을 깨우며 뒤에 있던 창에 포커스를 준다. 클릭이 메인에 닿을 때는 이미 isFocused() 가 참이라
 * "맨 앞이었다" 와 구별이 안 된다. 그래서 창이 뒤로 갔다가 포커스를 되찾은 지 얼마 안 되면 맨 앞이 아니었던 것으로 본다.
 * 한 번도 뒤로 가지 않은 창(방금 열림)은 해당하지 않는다.
 */
export const FRESH_FOCUS_MS = 1000;

export class FrontMemo {
  #gainedAt: number | undefined;
  #lostAt: number | undefined;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  gained(): void {
    this.#gainedAt = this.#now();
  }

  lost(): void {
    this.#lostAt = this.#now();
  }

  /** 뒤로 갔다가 포커스를 되찾은 지 얼마 안 됨 (펫 누르기가 앱을 깨운 것일 수 있음) */
  fresh(): boolean {
    if (this.#gainedAt === undefined || this.#lostAt === undefined) return false;
    return this.#lostAt <= this.#gainedAt && this.#now() - this.#gainedAt < FRESH_FOCUS_MS;
  }
}
