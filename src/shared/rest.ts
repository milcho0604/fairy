// 휴식 권유 (v1). 오래 쉬지 않고 일하면 물 마시기, 스트레칭, 산책을 권한다. 기획서 "수다 빈도": 보통 2시간, 수다쟁이 1시간, 조용히 끔.
// 권유를 받아들이고 실제로 3분 넘게 자리를 비웠다 오면 코인 3개 (게임 규칙 "산책, 휴식 권유 따르기").
import type { ChatterLevel } from './chatter.ts';

export const REST = {
  /** 이만큼 입력이 없으면 쉰 것으로 본다 (연속 작업 시간을 0 으로) */
  idleResetSec: 5 * 60,
  /** 권유를 받아들인 뒤 이만큼 자리를 비우면 쉰 것 */
  breakSec: 3 * 60,
  /** 권유를 받아들인 뒤 이 안에 쉬어야 보상 */
  acceptWindowMs: 30 * 60_000,
  coins: 3,
} as const;

export const REST_EVERY_MIN: Record<ChatterLevel, number | undefined> = {
  quiet: undefined,
  normal: 120,
  chatty: 60,
};

export const REST_LINES = [
  '오래 앉아 있었어. 물 한 잔 마시고 올까?',
  '어깨 한 번 쭉 펴자. 스트레칭 어때?',
  '잠깐 창밖 보고 오자. 눈도 쉬어야 해.',
];

export type RestEvent = 'suggest' | 'rested';

/**
 * 1분쯤마다 tick 을 부른다. 연속으로 일한 분을 세다가 권유할 때가 되면 'suggest'.
 * accept() 뒤 실제로 자리를 비웠다 돌아오면 'rested' (코인은 부르는 쪽이 준다).
 */
export class RestCoach {
  #workedMs = 0;
  #last: number | undefined;
  #accepted: number | undefined;
  #away = false;

  tick(now: number, idleSec: number, level: ChatterLevel): RestEvent | undefined {
    const dt = this.#last === undefined ? 0 : Math.min(5 * 60_000, now - this.#last);
    this.#last = now;
    if (this.#accepted !== undefined) {
      if (now - this.#accepted > REST.acceptWindowMs) this.#accepted = undefined;
      else if (idleSec >= REST.breakSec) this.#away = true;
      else if (this.#away && idleSec < 30) {
        this.#accepted = undefined;
        this.#away = false;
        this.#workedMs = 0;
        return 'rested';
      }
    }
    if (idleSec >= REST.idleResetSec) {
      this.#workedMs = 0;
      return undefined;
    }
    this.#workedMs += dt;
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
}
