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

export interface HintStore {
  /** 마지막으로 띄운 때(밀리초). 없으면 0 */
  get(): number;
  set(at: number): void;
}

function memoryStore(): HintStore {
  let at = 0;
  return { get: () => at, set: (t) => (at = t) };
}

/**
 * 칩 권유기. 같은 끌기에서는 한 번만, 끌기가 달라도 EXPAND_HINT_GAP_MS 안에는 다시 띄우지 않는다.
 * 끌기를 시작할 때 start(), 움직일 때마다 drag() 를 부르고 true 가 오면 칩을 띄운다
 */
export function createExpandHint(
  maxWidth: number,
  now: () => number = Date.now,
  /** 마지막으로 띄운 때를 어디에 두나. 기본은 이 함수 안(창이 새로 뜨면 사라진다). 메인에 두면 패널을 닫았다 열어도 이어진다 */
  store: HintStore = memoryStore(),
) {
  let offered = false;
  return {
    start() {
      offered = false;
    },
    drag(d: HintDrag): boolean {
      if (offered || !pushesPastMax(d, maxWidth)) return false;
      offered = true;
      const t = now();
      const last = store.get();
      if (last > 0 && t - last < EXPAND_HINT_GAP_MS) return false;
      store.set(t);
      return true;
    },
  };
}
