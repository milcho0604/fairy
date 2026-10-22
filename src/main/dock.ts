import { app } from 'electron';
import {
  DOCK_VERIFY_MS,
  type DockEffect,
  type DockEnv,
  type DockEvent,
  type DockState,
  dockStep,
  initialDock,
} from '../shared/dock-policy.ts';

// 맥 Dock 아이콘을 큰 창이 열린 동안만 보인다. 정함은 shared/dock-policy.ts (순수 함수), 여기는 Electron 에 잇는 얇은 껍데기.
//
// 순서 (앱 종류가 바뀌는 때를 한 곳에 모은다):
//  열기: open → dock.show() (앱이 Dock 있는 보통 앱이 됨) → 끝나면 reassert → 그제야 큰 창을 띄운다 (ready())
//  닫기: close → 마지막 dock 호출로부터 1.1초가 지난 뒤 dock.hide() → 바로 reassert, 1.5초 뒤 아이콘이 정말 사라졌는지
//        보고(isVisible) 남았으면 다시 hide → 또 reassert
// reassert: 펫 창들의 "모든 데스크톱, 항상 위" 설정을 다시 건다 (pet-window.ts reassertSpaces). 앱 종류 전환이 창 설정을
// 흔들었어도 펫이 제자리에 남게. 앱 종류를 바꾸는 다른 호출(setVisibleOnAllWorkspaces)은 모두 KEEP_APP_TYPE 을 같이 넘긴다
// (active-space.ts). 안 그러면 큰 창이 열린 동안 그 호출이 앱 종류를 UIElement 로 되돌려 Dock 아이콘이 사라진다.

export interface DockOptions {
  /** 시험 실행(JJ_NO_FOCUS): show 를 절대 부르지 않고 부르려 했다는 기록만 남긴다 */
  test: boolean;
  /** 앱 종류가 바뀐 뒤 펫 창(과 패널) 설정을 다시 건다 */
  reassert: () => void;
  log: (tag: string, ...rest: unknown[]) => void;
  platform?: NodeJS.Platform;
  now?: () => number;
}

export interface Dock {
  /** 큰 창이 열린다 */
  open(): void;
  /** 큰 창이 닫혔거나 숨었다 */
  close(): void;
  /** 앱이 끝나는 중 */
  quit(): void;
  /** 가장 나중 show 가 끝나면 풀린다 (이미 보이거나 시험 실행이면 바로) */
  ready(): Promise<void>;
  /** 시험 손잡이 (__jj.home.dock) */
  stats(): {
    want: boolean;
    shown: boolean;
    pendingHide: boolean;
    /** 시험 실행에서 show 를 부르려 한 횟수 (부르지는 않았다) */
    triedShow: number;
    /** 진짜로 app.dock.show / hide 를 부른 횟수 */
    shows: number;
    hides: number;
    /** 맥이면 app.dock.isVisible() */
    visible: boolean | undefined;
    events: string[];
  };
}

export function createDock(o: DockOptions): Dock {
  const platform = o.platform ?? process.platform;
  const now = o.now ?? Date.now;
  const env: DockEnv = { platform, test: o.test };
  let state: DockState = initialDock();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let verifyTimer: ReturnType<typeof setTimeout> | undefined;
  let readyP: Promise<void> = Promise.resolve();
  let shows = 0;
  let hides = 0;
  const events: string[] = [];
  const note = (s: string) => {
    events.push(`${Math.round(now() % 1e7)} ${s}`);
    if (events.length > 200) events.shift();
  };

  const reassert = () => {
    try {
      o.reassert();
    } catch (err) {
      o.log('dock', 'reassert 실패', err instanceof Error ? err.message : String(err));
    }
  };

  function run(effect: DockEffect) {
    if (effect.do === 'wait') {
      clearTimeout(timer);
      timer = setTimeout(() => feed('tick'), effect.ms);
      return;
    }
    if (!app.dock) return;
    if (effect.do === 'show') {
      shows++;
      note('dock.show');
      readyP = app.dock
        .show()
        .catch((err: unknown) => o.log('dock', 'show 실패', err instanceof Error ? err.message : String(err)))
        .then(() => {
          note('dock.show 끝');
          reassert();
        });
      return;
    }
    hides++;
    note('dock.hide');
    app.dock.hide();
    reassert();
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      // 열려 있어야 하는 때(다시 열었다)는 정상이다. 숨겼는데 남아 있으면 다시 숨긴다
      if (!state.want && app.dock?.isVisible()) feed('seen-visible');
      else reassert();
    }, DOCK_VERIFY_MS);
  }

  function feed(ev: DockEvent) {
    const r = dockStep(state, ev, now(), env);
    state = r.state;
    note(`${ev} -> ${r.effects.map((e) => e.do).join(',') || '-'}`);
    for (const e of r.effects) run(e);
  }

  return {
    open: () => feed('open'),
    close: () => feed('close'),
    quit: () => {
      clearTimeout(timer);
      clearTimeout(verifyTimer);
      feed('quit');
    },
    ready: () => readyP,
    stats: () => ({
      want: state.want,
      shown: state.shown,
      pendingHide: state.pendingHide,
      triedShow: state.triedShow,
      shows,
      hides,
      visible: platform === 'darwin' ? app.dock?.isVisible() : undefined,
      events: [...events],
    }),
  };
}
