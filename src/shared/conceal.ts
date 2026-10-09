// 펫 창을 잠깐 안 보이게 하는 까닭들 (불투명도 0). 두더지 잡기 구멍 속(mole)과 같이 보기 찍는 순간(veil).
// 까닭마다 따로 "원래 불투명도"를 기억하면 상대가 만든 0 을 원래 값으로 잡아 펫이 투명한 채 남는다.
// 그래서 까닭을 한곳에 모으고, 원래 불투명도는 처음 가릴 때 한 번만 기억한다.
// (사용자 숨기기, 발표, 집 안은 창을 숨기는 다른 축이라 presence.ts HideReasons 가 맡는다)

export type ConcealReason = 'mole' | 'veil';

/** 지금 할 일. hide: 불투명도 0 으로. show: to 로 되돌린다 (다 되돌리면 settled 를 부른다) */
export type ConcealStep = { kind: 'hide' } | { kind: 'show'; to: number };

export class Conceal {
  #reasons = new Set<ConcealReason>();
  /** 가리기 전 불투명도. 다 나타나기 전(되돌리는 중)에 다시 가려도 처음 값을 그대로 둔다 */
  #base: number | undefined;

  /**
   * 까닭을 켜거나 끈다. 창에 할 일이 없으면 undefined.
   * read 는 지금 불투명도 (처음 가릴 때만 읽는다)
   */
  set(reason: ConcealReason, on: boolean, read: () => number): ConcealStep | undefined {
    if (on) {
      if (this.#reasons.has(reason)) return undefined;
      const first = this.#reasons.size === 0;
      this.#reasons.add(reason);
      this.#base ??= read();
      return first ? { kind: 'hide' } : undefined;
    }
    if (!this.#reasons.delete(reason)) return undefined;
    if (this.#reasons.size > 0) return undefined;
    return { kind: 'show', to: this.#base ?? 1 };
  }

  /** 다 되돌렸다. 가린 까닭이 없을 때만 기억한 값을 잊는다 */
  settled(): void {
    if (this.#reasons.size === 0) this.#base = undefined;
  }

  has(reason: ConcealReason): boolean {
    return this.#reasons.has(reason);
  }

  get active(): boolean {
    return this.#reasons.size > 0;
  }
}
