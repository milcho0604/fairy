// 자세 값을 한 틀에 바로 바꾸지 않고 짧게 따라가게 하는 도우미 (돌아서기, 삐친 고개, 커서 바라보기, 걷기 풀기).
// 그리기 없이 숫자만 다뤄 시험한다 (motion-ease.test.ts).

/** cur 를 target 쪽으로 dtMs 만큼 따라간다. tauMs 마다 남은 차이가 1/e 로 준다 (틀 간격이 들쭉날쭉해도 같은 빠르기) */
export function follow(cur: number, target: number, dtMs: number, tauMs: number): number {
  if (!(dtMs > 0) || !(tauMs > 0)) return dtMs > 0 ? target : cur;
  return target + (cur - target) * Math.exp(-dtMs / tauMs);
}

/** 이만큼 가까우면 다 따라간 것으로 본다 */
const EPS = 0.002;
/**
 * 한 틀에 따라가는 시간의 최대. 가만히 서 있으면 그리기가 멈추는데(그때 값은 이미 목표에 닿아 있다),
 * 오래 쉬었다 다시 그리는 첫 틀이 쉰 시간만큼 한 번에 건너뛰지 않게 한 틀 몫만 간다
 */
const MAX_DT = 50;

/**
 * 이름 붙은 값 여럿을 따라가게 둔다. 그리기 틀마다 frame(now) 를 먼저 부르고 to() 로 값을 얻는다.
 * now 가 없으면(얼굴 아이콘, 미리보기처럼 한 장만 그릴 때) 늘 목표값 그대로이고 기억도 건드리지 않는다
 */
export class Eased {
  private values = new Map<string, number>();
  private last: number | undefined;
  private dt = 0;
  private live = false;
  /** 이번 틀에 아직 목표에 닿지 않은 값이 있는지 (그리기를 몇 틀 더 이어 가야 하는지) */
  busy = false;

  frame(now: number | undefined): void {
    this.live = now !== undefined;
    this.busy = false;
    if (now === undefined) return;
    this.dt = this.last === undefined ? 0 : Math.min(MAX_DT, Math.max(0, now - this.last));
    this.last = now;
  }

  /** rate 가 있으면 1ms 에 그만큼까지만 바뀐다 (네 발로 선 몸이 발을 옮겨 디딜 틈을 두고 돈다) */
  to(key: string, target: number, tauMs: number, rate?: number): number {
    if (!this.live) return target;
    const cur = this.values.get(key);
    let next = cur === undefined ? target : follow(cur, target, this.dt, tauMs);
    if (cur !== undefined && rate !== undefined && rate > 0) {
      const max = rate * this.dt;
      next = cur + Math.max(-max, Math.min(max, next - cur));
    }
    if (Math.abs(next - target) <= EPS) next = target;
    else this.busy = true;
    this.values.set(key, next);
    return next;
  }

  /** 이번 틀이 지난 틀에서 흐른 시간 (ms, 한 장만 그리면 0) */
  get step(): number {
    return this.live ? this.dt : 0;
  }

  /** 기억한 값 (아직 없으면 undefined) */
  peek(key: string): number | undefined {
    return this.values.get(key);
  }
}
