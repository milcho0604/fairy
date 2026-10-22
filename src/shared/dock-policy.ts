// 맥 Dock 아이콘 정함 (큰 창 설계 #159, #161). 큰 창이 열려 있는 동안만 Dock 과 Cmd+Tab 에 보이고, 닫거나 숨기면 다시 숨긴다.
//
// 왜 정해 두나: app.dock.show() 는 앱 종류를 Dock 없는 앱(UIElement)에서 Dock 있는 보통 앱(Foreground)으로 바꾼다.
// 보통 앱은 앞으로 올 때 맥이 그 앱 창이 있는 데스크톱(Space)으로 화면을 넘기므로(active-space.ts) 큰 창이 떠 있는 동안
// 펫을 눌러 다른 데스크톱으로 끌려갈 수 있다. 그래서 앱 종류를 바꾸는 일은 이 한 곳에서만 하고, 부르는 때와 순서를 정한다.
//
// Electron 문서(app.dock.hide): 1초 안에 앞 호출이 있으면 hide() 가 아무 일도 안 한다. 그래서
//  - hide 는 마지막 dock 호출(show 든 hide 든)로부터 DOCK_GAP_MS 가 지난 뒤에만 부른다. 모자라면 남은 만큼 기다린다.
//  - hide 를 불렀는데도 아이콘이 남아 있으면(isVisible) 다시 부른다 (DOCK_RETRY_MAX 번까지).
//  - 열고 닫기를 빠르게 되풀이하면 show 는 이미 보이는 동안 다시 부르지 않고, 기다리던 hide 는 취소한다.
// 시험 실행(JJ_NO_FOCUS)은 show 를 절대 부르지 않고 "부르려 했다"만 센다 (Dock 아이콘은 창이 아니라 숨기기가 안 걸리고
// 사용자의 Dock 에 그대로 뜬다). 맥이 아니면 아무것도 하지 않는다 (윈도우, 리눅스는 창을 skipTaskbar:false 로 만든다).

/** 앞 dock 호출과 hide 사이에 두는 간격. Electron 이 1초 안의 hide 를 무시하므로 조금 더 */
export const DOCK_GAP_MS = 1100;
/** hide 를 부른 뒤 아이콘이 정말 사라졌는지 보는 때 */
export const DOCK_VERIFY_MS = 1500;
/** 사라지지 않았을 때 다시 부르는 상한 */
export const DOCK_RETRY_MAX = 3;

export interface DockEnv {
  platform: NodeJS.Platform;
  /** 시험 실행(JJ_NO_FOCUS): show 를 부르지 않는다 */
  test: boolean;
}

export interface DockState {
  /** 큰 창이 열려 있어 Dock 에 보여야 한다 */
  want: boolean;
  /** 우리가 show 를 불러 보이는 중이라고 믿는다 */
  shown: boolean;
  /** 마지막 dock 호출(show, hide) 시각. 없으면 -Infinity */
  lastCallAt: number;
  /** 숨기려고 간격을 기다리는 중 */
  pendingHide: boolean;
  /** 아이콘이 안 사라져 다시 부른 횟수 */
  retries: number;
  /** 앱이 끝나는 중이라 더는 건드리지 않는다 */
  quitting: boolean;
  /** 시험 실행에서 show 를 부르려 한 횟수 (부르지는 않았다) */
  triedShow: number;
}

export type DockEvent = 'open' | 'close' | 'tick' | 'seen-visible' | 'quit';

export type DockEffect =
  | { do: 'show' }
  | { do: 'hide' }
  /** ms 뒤에 'tick' 을 넣어 달라 */
  | { do: 'wait'; ms: number };

export interface DockResult {
  state: DockState;
  effects: DockEffect[];
}

export function initialDock(): DockState {
  return {
    want: false,
    shown: false,
    lastCallAt: Number.NEGATIVE_INFINITY,
    pendingHide: false,
    retries: 0,
    quitting: false,
    triedShow: 0,
  };
}

/** 숨길 때가 됐으면 숨기고, 아니면 기다릴 만큼을 알린다 */
function hideOrWait(s: DockState, now: number): DockResult {
  const since = now - s.lastCallAt;
  if (since >= DOCK_GAP_MS)
    return { state: { ...s, shown: false, pendingHide: false, lastCallAt: now }, effects: [{ do: 'hide' }] };
  return {
    state: { ...s, pendingHide: true },
    effects: [{ do: 'wait', ms: DOCK_GAP_MS - since + 50 }],
  };
}

/** 사건 하나를 받아 다음 상태와 할 일을 돌려준다. 상태를 바꾸지 않는다 */
export function dockStep(s: DockState, ev: DockEvent, now: number, env: DockEnv): DockResult {
  if (ev === 'quit') return { state: { ...s, quitting: true, want: false, pendingHide: false }, effects: [] };
  if (s.quitting) return { state: s, effects: [] };
  const mac = env.platform === 'darwin';

  if (ev === 'open') {
    const next = { ...s, want: true, pendingHide: false, retries: 0 };
    if (!mac) return { state: next, effects: [] };
    // 시험 실행: 부르려 했다는 기록만
    if (env.test) return { state: { ...next, triedShow: s.triedShow + 1 }, effects: [] };
    // 이미 보이는 동안은 다시 부르지 않는다 (기다리던 hide 는 위에서 취소됐다)
    if (s.shown) return { state: next, effects: [] };
    return { state: { ...next, shown: true, lastCallAt: now }, effects: [{ do: 'show' }] };
  }

  if (ev === 'close') {
    const next = { ...s, want: false };
    if (!mac || env.test || !s.shown) return { state: { ...next, pendingHide: false }, effects: [] };
    return hideOrWait(next, now);
  }

  if (ev === 'tick') {
    // 다시 열렸거나 기다리던 hide 가 없으면 할 일 없음
    if (!mac || env.test || s.want || !s.pendingHide || !s.shown) return { state: s, effects: [] };
    return hideOrWait(s, now);
  }

  // seen-visible: 숨겼는데 아이콘이 남아 있다. 지금 열려 있어야 하는 때는 정상이다
  if (!mac || env.test || s.want || s.retries >= DOCK_RETRY_MAX) return { state: s, effects: [] };
  return hideOrWait({ ...s, shown: true, retries: s.retries + 1 }, now);
}
