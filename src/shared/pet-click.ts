/** 펫을 한 번 또는 두 번 눌렀을 때 실행할 동작. */
export const PET_CLICK_ACTIONS = ['panel', 'chat', 'hide', 'none'] as const;
export type PetClickAction = (typeof PET_CLICK_ACTIONS)[number];

/** 더블클릭으로 묶을 수 있도록 첫 클릭을 기다리는 시간. 일반적인 데스크톱 더블클릭 간격을 허용한다. */
export const PET_DOUBLE_CLICK_DELAY_MS = 500;

export interface PetClickScheduler {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

type PendingPetClick = { cancel: () => void; deadline: number; secondPress: boolean };

const defaultScheduler: PetClickScheduler = {
  now: () => Date.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

/** 단일 클릭을 잠시 보류하고, 간격 안에 다음 클릭이 오면 단일 동작 없이 더블클릭으로 보낸다. */
export class PetClickSequence {
  private pending?: PendingPetClick;
  private readonly onSingle: () => void;
  private readonly onDouble: () => void;
  private readonly schedule: PetClickScheduler;
  private readonly delayMs: number;

  constructor(
    onSingle: () => void,
    onDouble: () => void,
    schedule: PetClickScheduler = defaultScheduler,
    delayMs = PET_DOUBLE_CLICK_DELAY_MS,
  ) {
    this.onSingle = onSingle;
    this.onDouble = onDouble;
    this.schedule = schedule;
    this.delayMs = delayMs;
  }

  click() {
    const pending = this.pending;
    if (pending) {
      if (pending.secondPress || this.schedule.now() <= pending.deadline) {
        pending.cancel();
        this.pending = undefined;
        this.onDouble();
        return;
      }
      this.flushSingle(pending);
    }

    const next = { cancel: () => {}, deadline: this.schedule.now() + this.delayMs, secondPress: false };
    this.pending = next;
    next.cancel = this.schedule.schedule(() => this.flushSingle(next), this.delayMs);
  }

  /** 두 번째 누름이 기한 안에 시작됐는지 기록한다. 오래 누르거나 끌면 double로 확정하지 않는다. */
  press() {
    const pending = this.pending;
    if (!pending || pending.secondPress) return;
    if (this.schedule.now() > pending.deadline) {
      this.flushSingle(pending);
      return;
    }
    pending.cancel();
    pending.secondPress = true;
  }

  /** 두 번째 누름이 클릭으로 끝나지 않았을 때 첫 클릭의 남은 대기 시간을 이어 간다. */
  cancelPress() {
    const pending = this.pending;
    if (!pending?.secondPress) return;
    pending.secondPress = false;
    const remaining = pending.deadline - this.schedule.now();
    if (remaining <= 0) {
      this.flushSingle(pending);
      return;
    }
    pending.cancel = this.schedule.schedule(() => this.flushSingle(pending), remaining);
  }

  cancel() {
    this.pending?.cancel();
    this.pending = undefined;
  }

  private flushSingle(pending: PendingPetClick) {
    if (this.pending !== pending) return;
    pending.cancel();
    this.pending = undefined;
    this.onSingle();
  }
}

export function isPetClickAction(value: unknown): value is PetClickAction {
  return typeof value === 'string' && (PET_CLICK_ACTIONS as readonly string[]).includes(value);
}
