// 펫 화면(렌더러)이 죽었을 때 다시 불러올지 정한다. 화면이 죽는 원인이 그대로면 다시 불러도 또 죽어서
// 끝없이 되풀이한다(CPU 를 먹고 기록만 쌓인다). 짧은 시간에 너무 자주 죽으면 멈추고, 사용자가 메뉴의 새로고침으로 다시 부른다.

/** 이 시간 안에 */
export const CRASH_WINDOW_MS = 60_000;
/** 이만큼까지는 다시 불러온다. 넘으면(4번째부터) 멈춘다 */
export const CRASH_MAX_RELOADS = 3;

export class CrashGuard {
  #at: number[] = [];
  #stopped = false;

  readonly windowMs: number;
  readonly maxReloads: number;

  constructor(windowMs = CRASH_WINDOW_MS, maxReloads = CRASH_MAX_RELOADS) {
    this.windowMs = windowMs;
    this.maxReloads = maxReloads;
  }

  /** 화면이 죽었다. 다시 불러와도 되면 'reload', 짧은 시간에 너무 자주면 'stop' (한 번 멈추면 reset 전까지 계속 'stop') */
  crashed(now: number): 'reload' | 'stop' {
    if (this.#stopped) return 'stop';
    this.#at = this.#at.filter((t) => now - t < this.windowMs);
    this.#at.push(now);
    if (this.#at.length > this.maxReloads) {
      this.#stopped = true;
      return 'stop';
    }
    return 'reload';
  }

  /** 사용자가 직접 새로고침했다: 세던 것을 지우고 다시 자동으로 살린다 */
  reset(): void {
    this.#at = [];
    this.#stopped = false;
  }

  get stopped(): boolean {
    return this.#stopped;
  }
}
