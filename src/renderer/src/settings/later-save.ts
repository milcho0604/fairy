// 잠깐 멈추면 저장 (글 칸). 기다리는 사이 창을 닫거나 칸이 사라지면 버리지 않고 바로 저장한다 (flush).
// 내 말투 만들기의 말끝, 부르는 말 칸이 0.5초 안에 창을 닫으면 쓴 글을 잃었다.

export interface LaterSave<T> {
  /** ms 뒤에 저장 (그사이 또 오면 마지막 것만) */
  later(value: T): void;
  /** 바로 저장 (기다리던 것은 버린다: 이것이 더 새 값) */
  now(value: T): void;
  /** 기다리던 것이 있으면 바로 저장 (창 닫기, 칸이 사라질 때) */
  flush(): void;
  /** 기다리는 중인지 */
  readonly pending: boolean;
}

export function laterSave<T>(
  save: (value: T) => void,
  ms: number,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  } = {
    set: (fn, wait) => setTimeout(fn, wait),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): LaterSave<T> {
  let timer: unknown;
  let waiting: { value: T } | undefined;
  const stop = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  return {
    later(value) {
      stop();
      waiting = { value };
      timer = timers.set(() => {
        timer = undefined;
        const w = waiting;
        waiting = undefined;
        if (w) save(w.value);
      }, ms);
    },
    now(value) {
      stop();
      waiting = undefined;
      save(value);
    },
    flush() {
      stop();
      const w = waiting;
      waiting = undefined;
      if (w) save(w.value);
    },
    get pending() {
      return waiting !== undefined;
    },
  };
}
