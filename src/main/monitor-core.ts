// 메뉴 막대 컴퓨터 상태(system-monitor.ts)의 켜고 끄기, 쉬기, 타이머 규칙. Electron 없이 시험하려고 화면 쪽은 host 로 받는다.

import {
  RUNNER_COUNTS,
  type RunnerState,
  runnerFrameMs,
  runnerIndex,
  runnerState,
} from '../shared/menu-runner.ts';
import { type CpuTimes, cpuPercent } from '../shared/system-load.ts';
import { MONITOR_AWAY_SEC, MONITOR_SAMPLE_MS } from '../shared/system-stats.ts';

export interface MonitorHost {
  readCpu(): CpuTimes;
  /** 사용자 입력이 없던 시간(초) */
  idleSec(): number;
  /** CPU 글자를 쓴다 (맥 메뉴 막대 글자, 윈도우 툴팁). 같은 값이면 부르지 않는다 */
  showCpu(pct: number): void;
  /** CPU 글자를 걷는다 (맥 글자 비우기, 윈도우 툴팁 원래대로) */
  clearCpu(): void;
  /** 달리기 그림 i 번째로 (모든 상태의 장을 한 줄로 놓은 번호, menu-runner.ts runnerIndex). 같은 장이면 부르지 않는다 */
  showFrame(i: number): void;
  /** 꺼진 아이콘으로 */
  showBase(): void;
  now(): number;
  later(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/**
 * 쉬는 이유. locked(잠금, 사용자 전환), asleep(잠자기), away(자리 비움: 입력 없이 MONITOR_AWAY_SEC, 화면이 꺼졌을 때쯤)는
 * 읽기까지 멈춘다(away 는 돌아왔는지만 본다). battery(배터리), presentation(윈도우 전체 화면, 발표)은 펫만 세우고 글자는 계속 고친다
 */
export type PauseReason = 'locked' | 'asleep' | 'battery' | 'presentation';

/** 메뉴를 열 때 CPU 를 잴 구간: 아이콘에 마우스가 올라온 때부터. 이보다 짧거나 길면 믿지 않는다 */
export const MENU_WINDOW_MIN_MS = 50;
export const MENU_WINDOW_MAX_MS = 10_000;

export interface MonitorCore {
  setEnabled(on: boolean): void;
  enabled(): boolean;
  setPaused(reason: PauseReason, on: boolean): void;
  /** 아이콘에 마우스가 올라왔다. 꺼져 있으면 메뉴용 CPU 구간을 여기서 시작한다 */
  hover(): void;
  /** 메뉴에 쓸 CPU. 켜져 돌고 있으면 마지막 표본, 아니면 hover 부터 지금까지. 잴 수 없으면 undefined */
  menuCpu(): number | undefined;
  /** 지금 걸린 타이머 수 (시험용) */
  timers(): number;
  dispose(): void;
}

export function createMonitorCore(host: MonitorHost): MonitorCore {
  let on = false;
  const paused = new Set<PauseReason>();
  let away = false;
  let cpu = 0;
  let prev: CpuTimes | undefined;
  let sampledAt = Number.NEGATIVE_INFINITY;
  let shownPct: number | undefined;
  let frame = 0;
  /** 앉기, 걷기, 달리기, 질주. 켜자마자는 아직 CPU 를 모르니 앉아 있다 */
  let state: RunnerState = 'rest';
  let shownFrame: number | undefined;
  let sampler: unknown;
  let runner: unknown;
  let hoverMark: { at: number; times: CpuTimes } | undefined;

  const halted = () => paused.has('locked') || paused.has('asleep');
  const running = () => on && !halted() && !away && !paused.has('battery') && !paused.has('presentation');

  const stopRunner = () => {
    if (runner !== undefined) host.cancel(runner);
    runner = undefined;
  };
  const stopSampler = () => {
    if (sampler !== undefined) host.cancel(sampler);
    sampler = undefined;
  };

  const setFrame = (i: number) => {
    if (i === shownFrame) return;
    shownFrame = i;
    host.showFrame(i);
  };

  const step = () => {
    runner = undefined;
    if (!running()) return;
    frame = (frame + 1) % RUNNER_COUNTS[state];
    setFrame(runnerIndex(state, frame));
    runner = host.later(step, runnerFrameMs(cpu, state));
  };

  const syncRunner = () => {
    if (running()) {
      if (runner === undefined) runner = host.later(step, runnerFrameMs(cpu, state));
    } else stopRunner();
  };

  const tick = () => {
    sampler = undefined;
    if (!on || halted()) return;
    away = host.idleSec() >= MONITOR_AWAY_SEC;
    if (away) {
      // 돌아왔을 때 자리 비운 동안의 평균을 쓰지 않게 기준을 버린다
      prev = undefined;
    } else {
      const next = host.readCpu();
      if (prev) {
        cpu = cpuPercent(prev, next);
        sampledAt = host.now();
        // 상태가 바뀌면 새 상태의 첫 장부터. 걸린 타이머는 새 빠르기로 다시 건다
        // (쉬기 1.5초를 다 기다리지 않게. 다시 걸어도 지난 장에서 새 한 장 시간 이상 지나 초당 5장을 넘지 않는다)
        const want = runnerState(cpu, state);
        if (want !== state) {
          state = want;
          frame = -1;
          stopRunner();
        }
        const pct = Math.round(cpu);
        if (pct !== shownPct) {
          shownPct = pct;
          host.showCpu(pct);
        }
      }
      prev = next;
    }
    syncRunner();
    sampler = host.later(tick, MONITOR_SAMPLE_MS);
  };

  /** 켜졌거나 쉬기가 풀렸을 때 다시 돌린다. 기준은 지금부터 (쉰 동안의 평균을 쓰지 않는다) */
  const restart = () => {
    stopSampler();
    stopRunner();
    if (!on || halted()) return;
    prev = undefined;
    away = false;
    tick();
  };

  return {
    setEnabled(want) {
      if (want === on) return;
      on = want;
      if (on) {
        shownFrame = undefined;
        setFrame(runnerIndex(state, frame));
        restart();
        return;
      }
      stopSampler();
      stopRunner();
      prev = undefined;
      shownPct = undefined;
      shownFrame = undefined;
      sampledAt = Number.NEGATIVE_INFINITY;
      host.clearCpu();
      host.showBase();
    },
    enabled: () => on,
    setPaused(reason, want) {
      if (want === paused.has(reason)) return;
      const wasHalted = halted();
      if (want) paused.add(reason);
      else paused.delete(reason);
      if (halted()) {
        stopSampler();
        stopRunner();
        prev = undefined;
      } else if (wasHalted) restart();
      else syncRunner();
    },
    hover() {
      if (on && host.now() - sampledAt <= MONITOR_SAMPLE_MS * 1.5) return;
      hoverMark = { at: host.now(), times: host.readCpu() };
    },
    menuCpu() {
      if (on && host.now() - sampledAt <= MONITOR_SAMPLE_MS * 1.5) return cpu;
      const mark = hoverMark;
      const age = mark ? host.now() - mark.at : Number.POSITIVE_INFINITY;
      if (mark && age >= MENU_WINDOW_MIN_MS && age <= MENU_WINDOW_MAX_MS)
        return cpuPercent(mark.times, host.readCpu());
      // 키보드로 열었거나 너무 오래됐다: 지금부터 재서 다음에 열 때 보인다
      hoverMark = { at: host.now(), times: host.readCpu() };
      return undefined;
    },
    timers: () => (sampler === undefined ? 0 : 1) + (runner === undefined ? 0 : 1),
    dispose() {
      stopSampler();
      stopRunner();
      on = false;
    },
  };
}
