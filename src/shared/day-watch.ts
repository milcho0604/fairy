// 날이 바뀌었는지 본다 (버그잡이 b, 2026-10-13). 패널은 그릴 거리를 메인이 보낼 때만 다시 그려,
// 자정을 넘겨 열어 둔 패널이 어제 것(오늘 끝낸 일 수, "오늘" 마감, 내일 마감이 안 보임)을 그대로 보였다.
// 메인이 잠깐마다 check 를 불러 날이 바뀌었으면 onTurn 으로 다시 보낸다. 잠자기에서 깨어나도 다음 check 에 잡힌다.

export interface DayWatch {
  /** 지금 날이 마지막으로 본 날과 다르면 onTurn 을 부르고 true */
  check(): boolean;
  /** 이 날로 그렸다 (다시 보낼 때마다 알려 같은 날 두 번 부르지 않게) */
  seen(day: string): void;
}

export function dayWatch(o: {
  now: () => number;
  day: (ms: number) => string;
  onTurn: () => void;
}): DayWatch {
  let last = o.day(o.now());
  return {
    check() {
      const d = o.day(o.now());
      if (d === last) return false;
      last = d;
      o.onTurn();
      return true;
    },
    seen(day) {
      last = day;
    },
  };
}
