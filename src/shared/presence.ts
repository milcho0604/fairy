// 방해 금지(P1-10): 펫을 숨길 까닭들. 까닭이 하나라도 있으면 숨는다.

/** user 숨기기, presentation 발표나 전체 화면, house 집 안에서 쉬는 중 (집은 보인다) */
export type HideReason = 'user' | 'presentation' | 'house';

/**
 * 윈도우 SHQueryUserNotificationState 결과 중 숨길 상태.
 * 2 QUNS_BUSY(전체 화면 앱), 3 QUNS_RUNNING_D3D_FULL_SCREEN(전체 화면 게임, 영상), 4 QUNS_PRESENTATION_MODE(발표 모드).
 * 1 은 잠금 화면이라 어차피 안 보이고, 5~7 은 평소 상태다.
 */
export function windowsStateMeansHide(state: number): boolean {
  return state === 2 || state === 3 || state === 4;
}

export class HideReasons {
  #reasons = new Set<HideReason>();

  /** 까닭을 켜거나 끈다. 숨김 여부가 바뀌면 true. */
  set(reason: HideReason, on: boolean): boolean {
    const before = this.hidden;
    if (on) this.#reasons.add(reason);
    else this.#reasons.delete(reason);
    return before !== this.hidden;
  }

  has(reason: HideReason): boolean {
    return this.#reasons.has(reason);
  }

  /** 지금 켜진 까닭들. 숨은 동안 새로 온 창(친구 펫)에 같은 까닭을 걸어 같이 숨긴다 */
  list(): HideReason[] {
    return [...this.#reasons];
  }

  get hidden(): boolean {
    return this.#reasons.size > 0;
  }
}
