// "크게 볼까요?" 칩을 띄울 때의 정함 (이슈 #164). 순수 함수라 단위 시험이 된다.
// 패널을 가장 넓게(PANEL_MAX_WIDTH) 만든 채 더 넓히려고 끌면 한 줄로 권한다. 창은 저절로 바뀌지 않는다.

/** 칩이 떠 있는 시간 */
export const EXPAND_HINT_MS = 4000;
/** 칩이 한 번 뜬 뒤 다시 뜰 수 있기까지 */
export const EXPAND_HINT_GAP_MS = 60_000;

export interface HintDrag {
  /** 지금 창 너비(운영체제 기준 DIP) */
  outerWidth: number;
  /** 지금 화면 너비(CSS px) */
  innerWidth: number;
  /** 손잡이가 바라는 너비(CSS px). 너비를 안 바꾸는 끌기(아래 가장자리)는 없다 */
  wantWidth: number | undefined;
}

/** 가장 넓은 너비에 닿은 채 더 넓히려는가 (1px 안쪽 오차는 닿은 것으로 본다) */
export function pushesPastMax(d: HintDrag, maxWidth: number): boolean {
  if (d.wantWidth === undefined) return false;
  return d.outerWidth >= maxWidth - 1 && d.wantWidth > d.innerWidth + 2;
}

/**
 * 칩 권유기. 같은 끌기에서는 한 번만, 끌기가 달라도 EXPAND_HINT_GAP_MS 안에는 다시 띄우지 않는다.
 * 끌기를 시작할 때 start(), 움직일 때마다 drag() 를 부르고 true 가 오면 칩을 띄운다
 */
export function createExpandHint(maxWidth: number, now: () => number = Date.now) {
  let shownAt = Number.NEGATIVE_INFINITY;
  let offered = false;
  return {
    start() {
      offered = false;
    },
    drag(d: HintDrag): boolean {
      if (offered || !pushesPastMax(d, maxWidth)) return false;
      offered = true;
      const t = now();
      if (t - shownAt < EXPAND_HINT_GAP_MS) return false;
      shownAt = t;
      return true;
    },
  };
}
