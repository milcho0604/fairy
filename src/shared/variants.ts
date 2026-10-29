// 같은 상황의 여러 말 (변형). 사전에 `pet.rest.1`, `pet.rest.2`, ... 또는 `pet.fed`, `pet.fed.2`, `pet.fed.3`, ... 로 둔다.
// 기본 열쇠(번호 없이 쓰던 열쇠)는 첫째 변형이고, 새 변형은 .2 부터 이어 붙인다. 사전에 번호만 더하면 코드를 고치지 않아도
// 고르는 곳(variantsOf, VariantPicker)이 센다. 사용자가 고친 대사(#125)는 열쇠마다라 변형마다 따로 고칠 수 있다.
import { dicts, isMutedLine } from './i18n/index.ts';

let exact: Set<string> | undefined;
let numbered: Map<string, string[]> | undefined;

function index(): { exact: Set<string>; numbered: Map<string, string[]> } {
  if (!exact || !numbered) {
    exact = new Set(Object.keys(dicts.ko));
    numbered = new Map();
    for (const key of exact) {
      const dot = key.lastIndexOf('.');
      if (dot < 0 || !/^\d+$/.test(key.slice(dot + 1))) continue;
      const base = key.slice(0, dot);
      const list = numbered.get(base);
      if (list) list.push(key);
      else numbered.set(base, [key]);
    }
    for (const list of numbered.values())
      list.sort((a, b) => Number(a.slice(a.lastIndexOf('.') + 1)) - Number(b.slice(b.lastIndexOf('.') + 1)));
  }
  return { exact, numbered };
}

/**
 * base 의 변형 열쇠들. base 자체가 사전에 있으면 첫째, 이어서 base.N (번호 순).
 * variantsOf('idle.morning') -> idle.morning.1, idle.morning.2, ...
 * variantsOf('pet.fed') -> pet.fed, pet.fed.2, pet.fed.3, ...
 * 둘 다 없으면 빈 목록
 */
export function variantsOf(base: string): string[] {
  const { exact: all, numbered: nums } = index();
  const list = nums.get(base) ?? [];
  // base 와 base.1 이 둘 다 있으면 같은 말이 아니니 둘 다 센다
  return all.has(base) ? [base, ...list] : [...list];
}

/**
 * 변형 하나를 고르되 바로 앞에 한 말은 피한다 (변형이 둘 이상일 때). 기본 열쇠 하나만 있으면 그것.
 * 앱을 켜는 동안만 기억한다. 다른 곳(혼잣말)은 더 긴 기억을 따로 쓴다
 */
export class VariantPicker {
  #last = new Map<string, string>();
  #rand: () => number = Math.random;
  #fixed = false;

  /** 시험용: 고르는 난수를 정해진 값으로. 정하면 바로 앞 말 피하기는 끈다 (늘 같은 순서로 나오게) */
  setRandom(rand: () => number): void {
    this.#rand = rand;
    this.#fixed = true;
  }

  /** 시험용: 바로 앞에 한 말 기억을 지운다 */
  reset(): void {
    this.#last.clear();
  }

  /** 변형 하나. 안 쓰기로 한 변형은 빼고, 모두 안 쓰기로 했으면 null (부르는 쪽이 말하지 않는다) */
  pick(base: string, rand: () => number = this.#rand): string | null {
    const all = variantsOf(base);
    const list = all.filter((k) => !isMutedLine(k));
    if (all.length === 0) return base;
    if (list.length === 0) return null;
    if (list.length === 1) return list[0] as string;
    const last = this.#last.get(base);
    const choices = this.#fixed ? list : list.filter((k) => k !== last);
    const key = choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))] as string;
    this.#last.set(base, key);
    return key;
  }
}

/** 앱 전체가 같이 쓰는 고르기 (휴식, 인사, 축하, 먹이기) */
export const variants = new VariantPicker();
