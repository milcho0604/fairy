// 플래너가 다음에 깰 때 (main/planner.ts). 예전에는 15초마다 깨어 모든 것을 물었다.
// 하루 일(브리핑, 회고, 마감 알림, 만나는 시간)은 날짜와 "지금 분이 어느 문턱 뒤인지"만 보고, 미리 알림은 울릴 때가 정해져 있다.
// 그래서 다음 문턱이나 다음 알림까지 잔다. 막혀서 기다리는 것(자리 비움, 숨음, 말풍선이 떠 있음)이 있거나
// 집중 중이거나 수다쟁이(혼잣말이 입력과 커서를 15초마다 본다)면 예전처럼 15초마다 본다.
import { localDay } from './todo-store.ts';

/** 예전 틱. 기다리는 것이 있을 때는 이만큼마다 본다 */
export const PLAN_TICK_MS = 15_000;
/** 가장 오래 자는 시간. 깰 때마다 시계를 보고 다시 잡아서, 시계나 시간대를 바꿔도 이 안에 알아챈다 */
export const PLAN_MAX_SLEEP_MS = 60_000;
/** 깨자마자 다시 깨지 않게 (때가 지금이거나 지났을 때) */
export const PLAN_MIN_SLEEP_MS = 1000;

const MIN = 60_000;
const minuteOf = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * now 뒤로 처음 현지 날짜가 바뀌거나 지금 분이 문턱(분) 하나를 넘는 때 (분 단위로 맞춘 ms).
 * 분을 하나씩 걸어서 서머타임(없는 시각, 되풀이되는 시각)도 실제 시계가 넘는 때를 찾는다. 길어야 하루(1440번)
 */
export function nextMinuteTurn(now: number, thresholds: readonly number[]): number {
  const day = localDay(now);
  const m0 = minuteOf(now);
  const side = thresholds.map((m) => m0 >= m);
  // 서머타임 날도 하루는 25시간을 넘지 않는다
  for (let t = Math.floor(now / MIN) * MIN + MIN; t <= now + 26 * 60 * MIN; t += MIN) {
    if (localDay(t) !== day) return t;
    const m = minuteOf(t);
    if (thresholds.some((th, i) => m >= th !== side[i])) return t;
  }
  return now + 26 * 60 * MIN;
}

/**
 * at 을 예전 틱 자리(origin 에서 15초씩)로 올린다. 예전에는 때가 된 뒤 첫 틱에 했으니 같은 자리에 깨면 하는 일과 때가 같다
 * (15초 안에 몰린 알림을 말풍선 하나로 묶는 것도 같다)
 */
export function onTick(at: number, origin: number): number {
  return at <= origin ? origin : origin + Math.ceil((at - origin) / PLAN_TICK_MS) * PLAN_TICK_MS;
}

/**
 * 다음에 깰 때까지 기다릴 시간 (ms). poll 이면 예전 틱. 아니면 다음 때(at)까지, 길어도 PLAN_MAX_SLEEP_MS.
 * 때가 이미 지났으면 PLAN_MIN_SLEEP_MS 뒤
 */
export function wakeDelay(now: number, poll: boolean, at: number | undefined): number {
  if (poll) return PLAN_TICK_MS;
  if (at === undefined) return PLAN_MAX_SLEEP_MS;
  return Math.min(PLAN_MAX_SLEEP_MS, Math.max(PLAN_MIN_SLEEP_MS, at - now));
}

/**
 * 깼을 때 바로 틱을 할지: 때가 됐거나(조금 이르게 깨도), 잠자기나 시계 바꾸기로 벽시계가 단조 시계보다 2초 넘게 튀었거나,
 * 시간대가 바뀌었으면. 아니면 같은 때를 향해 다시 잔다
 */
export function wakeNow(o: {
  now: number;
  mono: number;
  zone: string;
  dueAt: number;
  armed: { wall: number; mono: number; zone: string };
}): boolean {
  const jumped = Math.abs(o.now - o.armed.wall - (o.mono - o.armed.mono)) > 2000;
  return o.now >= o.dueAt - 100 || jumped || o.zone !== o.armed.zone;
}

/** 시간대 열쇠 (바뀌었으면 하루 일의 문턱을 다시 잡는다) */
export function zoneKey(now: number): string {
  return `${Intl.DateTimeFormat().resolvedOptions().timeZone}|${new Date(now).getTimezoneOffset()}`;
}
