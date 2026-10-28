// 휴식 권유 (v1). 오래 쉬지 않고 일하면 물 마시기, 스트레칭, 산책을 권한다. 기획서 "수다 빈도": 보통 2시간, 수다쟁이 1시간, 조용히 끔.
// 권유를 받아들이고 실제로 3분 넘게 자리를 비웠다 오면 코인 3개 (게임 규칙 "산책, 휴식 권유 따르기").
import type { ChatterLevel } from './chatter.ts';
import { REST_COINS } from './coin-rules.ts';
import type { I18nKey } from './i18n/index.ts';
import { voiced } from './persona-voice.ts';
import { variants, variantsOf } from './variants.ts';

export const REST = {
  /** 이만큼 입력이 없으면 쉰 것으로 본다 (연속 작업 시간을 0 으로) */
  idleResetSec: 5 * 60,
  /** 권유를 받아들인 뒤 이만큼 자리를 비우면 쉰 것 */
  breakSec: 3 * 60,
  /** 권유를 받아들인 뒤 이 안에 쉬어야 보상 */
  acceptWindowMs: 30 * 60_000,
  coins: REST_COINS,
} as const;

export const REST_EVERY_MIN: Record<ChatterLevel, number | undefined> = {
  quiet: undefined,
  normal: 120,
  sometimes: 120,
  chatty: 60,
};

/** 휴식 권유 대사 (지금 말로) */
export const restLines = (): string[] => variantsOf('pet.rest').map((k) => voiced(k as I18nKey));

/** 휴식 권유 대사 하나 (바로 앞에 한 말은 피한다) */
export const restLine = (rand?: () => number): string => voiced(variants.pick('pet.rest', rand) as I18nKey);

export type RestEvent = 'suggest' | 'rested';

/**
 * 1분쯤마다 tick 을 부른다. 연속으로 일한 분을 세다가 권유할 때가 되면 'suggest'.
 * accept() 뒤 실제로 자리를 비웠다 돌아오면 'rested' (코인은 부르는 쪽이 준다).
 */
export class RestCoach {
  #workedMs = 0;
  /** 쉬지 않고 일한 시간. 권유를 띄워도 0 으로 돌리지 않는다 (기운의 피로, shared/energy.ts). 실제로 쉬어야 0 */
  #streakMs = 0;
  #last: number | undefined;
  #accepted: number | undefined;
  #away = false;

  tick(now: number, idleSec: number, level: ChatterLevel): RestEvent | undefined {
    // 시계를 뒤로 돌리면 음수가 된다 (일한 시간이 줄지 않게)
    const prev = this.#last;
    const gap = prev === undefined ? 0 : now - prev;
    const dt = Math.max(0, Math.min(5 * 60_000, gap));
    this.#last = now;
    // 덮개를 닫아 잠든 동안은 표본이 멈춘다. 깨고 나면 입력 없던 시간이 짧아도 그 틈은 쉰 것이다
    // (안 그러면 밤새 잔 뒤 아침부터 지친 눈이었다)
    if (gap >= REST.idleResetSec * 1000) {
      this.#workedMs = 0;
      this.#streakMs = 0;
      // 권유를 받아들이고 덮개를 닫았으면 자리를 비운 것이다. 돌아와 입력하면 보상 (기한 안에 떠났을 때만)
      if (this.#accepted !== undefined && prev !== undefined) {
        if (prev - this.#accepted <= REST.acceptWindowMs) this.#away = true;
        else if (!this.#away) this.#accepted = undefined;
      }
      return undefined;
    }
    if (this.#accepted !== undefined) {
      // 기한은 떠나기까지만 잰다. 기한 안에 떠났으면 40분 쉬다 와도 보상 (오래 쉬었다고 놓치면 안 된다)
      if (!this.#away && now - this.#accepted > REST.acceptWindowMs) this.#accepted = undefined;
      else if (idleSec >= REST.breakSec) this.#away = true;
      else if (this.#away && idleSec < 30) {
        this.#accepted = undefined;
        this.#away = false;
        this.#workedMs = 0;
        this.#streakMs = 0;
        return 'rested';
      }
    }
    if (idleSec >= REST.idleResetSec) {
      this.#workedMs = 0;
      this.#streakMs = 0;
      return undefined;
    }
    this.#workedMs += dt;
    this.#streakMs += dt;
    const every = REST_EVERY_MIN[level];
    if (every === undefined || this.#accepted !== undefined) return undefined;
    if (this.#workedMs >= every * 60_000) {
      this.#workedMs = 0;
      return 'suggest';
    }
    return undefined;
  }

  /** 권유를 받아들였다 ("다녀올게") */
  accept(now: number): void {
    this.#accepted = now;
    this.#away = false;
  }

  get workedMin(): number {
    return Math.floor(this.#workedMs / 60_000);
  }

  /** 쉬지 않고 일한 분 (권유와 상관없이, 5분 넘게 자리를 비우거나 권유대로 쉬어야 0) */
  get streakMin(): number {
    return Math.floor(this.#streakMs / 60_000);
  }
}
