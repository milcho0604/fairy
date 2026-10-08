// 모니터 바뀜 알림 걸러내기.
// 맥은 아무것도 안 바뀌어도 display-metrics-changed 를 약 90ms 간격으로 16번, 22번씩 몰아서 보낸다
// (2026-10-08 실측: changedMetrics 가 빈 배열이고 bounds, workArea, scaleFactor 가 그대로). 펫과 무관한 다른 앱도
// 같은 순간에 받는다. 그래서 몰아 온 알림은 잦아든 뒤 한 번만 보고, 화면 값이 그 전과 같으면 아무것도 안 한다.

import type { Rect } from './geometry.ts';

export interface DisplayLike {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  rotation: number;
}

const rect = (r: Rect) => `${r.x},${r.y},${r.width},${r.height}`;

/** 화면 배치를 한 줄로. 순서와 무관하게 같은 배치면 같은 글자다 */
export function displaySignature(displays: readonly DisplayLike[]): string {
  return [...displays]
    .sort((a, b) => a.id - b.id)
    .map((d) => `${d.id}:${rect(d.bounds)}/${rect(d.workArea)}@${d.scaleFactor}r${d.rotation}`)
    .join(' ');
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * 알림이 ms 동안 안 오면 그때 한 번 read() 로 화면을 읽어, 지난번과 다를 때만 onChange 를 부른다.
 * 처음 값은 만들 때 읽어 둔다. stop() 뒤에는 아무것도 부르지 않는다.
 */
export function settleDisplayChanges<T>(opts: {
  read: () => T;
  key: (value: T) => string;
  onChange: (value: T) => void;
  ms: number;
  timers?: Timers;
}): { notify: () => void; stop: () => void } {
  const timers = opts.timers ?? realTimers;
  let last = opts.key(opts.read());
  let pending: unknown;
  let stopped = false;
  const fire = () => {
    pending = undefined;
    const value = opts.read();
    const next = opts.key(value);
    if (next === last) return;
    last = next;
    opts.onChange(value);
  };
  return {
    notify: () => {
      if (stopped) return;
      if (pending !== undefined) timers.clear(pending);
      pending = timers.set(fire, opts.ms);
    },
    stop: () => {
      stopped = true;
      if (pending !== undefined) timers.clear(pending);
      pending = undefined;
    },
  };
}
