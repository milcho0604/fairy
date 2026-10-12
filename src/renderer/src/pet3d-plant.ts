// 네 발로 선 입체 몸의 발 딛기 (pet3d.ts poseStance). 디딘 발은 바닥(세상)의 한 점에 붙어 있고, 몸이 가거나 돌면
// 그 점에서 떨어진 만큼 발을 들어 새 자리로 옮겨 딛는다. 걷는 동안은 걸음 박자(pet3d-stance.ts footPhase)대로 딛고,
// 돌아서기(출발, 방향 바꾸기, 집 문), 멈추기, 자세 바꾸기에서는 많이 벗어난 발부터 한두 발씩 옮긴다.
// 그래서 출발할 때 몸이 돌아도 발이 같이 돌지 않고, 멈출 때 발이 미끄러져 모이지 않고 한 발씩 모은다.
// three 없이 숫자만 다뤄 시험한다 (pet3d-plant.test.ts).
//
// 좌표: 무대(stage)는 몸 관절의 부모 공간 (x 화면 오른쪽, z 카메라 쪽). 몸(root) 은 무대 가운데에 서 있고 y 축으로
// heading 만큼 돈다. 걸으면 창이 움직이니 몸 대신 바닥이 거꾸로 밀린다: 세상 x = 무대 x + 몸이 간 거리(bodyX)

import type { LegId } from './pet3d-gait.ts';
import { footPhase, type GaitKind } from './pet3d-stance.ts';

export interface Spot {
  x: number;
  z: number;
}

/** 이번 틀의 몸 */
export interface PlantFrame {
  /** 시각 (ms) */
  now: number;
  /** 몸이 향한 각 (root rotation.y) */
  heading: number;
  /** 몸이 돌아가려는 각 (돌아서는 중이면 다 돈 뒤의 각). 옮겨 딛는 발은 그 방향의 자리에 내린다. 없으면 heading */
  aim?: number;
  /** 이번 틀에 몸이 무대 x 로 간 거리 (몸 단위, 부호 있음) */
  move: number;
  /** 걸음 박자대로 딛는다 (걷는 중이고 돌아서기가 거의 끝났을 때). duty 는 디딘 몫, cycle 은 한 걸음 거리, lift 발 높이 */
  gait?: { kind: GaitKind; duty: number; cycle: number; lift: number };
  /** 다리마다 지금 자세의 바랄 발 자리 (root 기준 x, z. 걸음은 넣지 않은 값) */
  rest: Record<LegId, Spot>;
  /** 발을 바닥에 붙여 두는 정도 0~1 (선 자세 1, 앉거나 엎드리거나 들리면 0: 자세 그대로 바랄 자리에 둔다) */
  hold: number;
  /** 다리 길이 (걸음 크기의 기준) */
  L: number;
}

/** 발 하나의 답 (root 기준) */
export interface FootOut {
  x: number;
  z: number;
  /** 든 높이 */
  lift: number;
  /** 바닥을 딛고 있는지 */
  planted: boolean;
  /** 들어 옮기는 진행 0~1 (발목 굽히기). 디딘 발은 -1 */
  swing: number;
}

interface Swing {
  fx: number;
  fz: number;
  t0: number;
  /** 걸음 박자로 든 발이면 들기 시작한 박자 진행, 아니면 undefined (시간으로만 간다) */
  p0?: number;
  dur: number;
  height: number;
  /** 마지막으로 정한 내릴 자리 (세상) */
  tx: number;
  tz: number;
}

interface Foot {
  /** 디딘 자리 (세상) */
  ax: number;
  az: number;
  swing?: Swing;
  /** 박자보다 일찍 내린 발 (박자가 디딤으로 돌아올 때까지 다시 들지 않는다) */
  early: boolean;
}

const LEGS: readonly LegId[] = ['fl', 'fr', 'hl', 'hr'];
/** 걷다 멈추면 많이 벗어난 발 둘(대각선)까지 같이 옮긴다. 그보다 가까우면 한 발씩 */
const PAIR_ERR = 0.28;
/** 디딘 발이 쉬는 자리에서 이만큼(다리 길이 배) 넘게 벗어나면 다리가 닿지 않는다: 바로 옮긴다 */
const REACH = 0.52;
/** 이만큼 벗어난 발은 같은 쪽 다리가 들려 있어도 옮긴다 */
const URGENT = 0.5;
/** 옮겨 딛는 발이 앞질러 내다보는 몸 돌기 (라디안) */
const AIM_AHEAD = 0.55;
/** 걷는 중 디딘 발이 박자 자리에서 이만큼(다리 길이 배) 벗어나면 바로 옮긴다 */
const MISS = 0.22;
/** 한 번 들어 옮기는 데 걸리는 시간 상한 (ms). 걸음 박자가 느려져도(멈추는 중) 이 안에 내린다 */
const SWING_MAX_MS = 300;
/** 이 틀 사이가 길면(그리지 않던 동안) 발을 바랄 자리에 다시 둔다 */
const GAP_MS = 400;

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** 붙여 두는 정도(hold)를 섞는 무게로 */
const w0 = (hold: number) => smooth(0.5, 0.9, hold);

/** root 기준 → 무대 (y 축으로 h 만큼 돈 자리) */
export function toStage(p: Spot, h: number): Spot {
  const c = Math.cos(h);
  const s = Math.sin(h);
  return { x: p.x * c + p.z * s, z: -p.x * s + p.z * c };
}

/** 무대 → root 기준 */
export function toLocal(p: Spot, h: number): Spot {
  const c = Math.cos(h);
  const s = Math.sin(h);
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c };
}

/** 같은 쪽(왼, 오른) 다리: 한쪽 다리 둘을 같이 들지 않는다 (넘어진다) */
function neighbors(a: LegId, b: LegId): boolean {
  return a !== b && a[1] === b[1];
}

export class FootPlanter {
  private feet = new Map<LegId, Foot>();
  /** 몸이 간 거리 (세상 x) */
  private bodyX = 0;
  /** 걸음 진행 (간 거리 / 한 걸음 거리를 이어 쌓는다. 빠르기가 바뀌어도 건너뛰지 않는다) */
  phase = 0;
  private dir: -1 | 1 = 1;
  private last: number | undefined;
  /** 아직 옮길 발이 있는지 (든 발이 있거나 바랄 자리에서 벗어난 디딘 발). 펫 화면이 몇 틀 더 그린다 */
  busy = false;

  /** 다음 틀에 처음부터 (펫을 바꿨다) */
  reset(): void {
    this.feet.clear();
    this.last = undefined;
    this.bodyX = 0;
    this.phase = 0;
  }

  /** 디딘 발 자리 (세상). 시험용 */
  anchors(): Record<LegId, { x: number; z: number; planted: boolean }> {
    const out = {} as Record<LegId, { x: number; z: number; planted: boolean }>;
    for (const id of LEGS) {
      const f = this.feet.get(id);
      out[id] = { x: f?.ax ?? 0, z: f?.az ?? 0, planted: !f?.swing };
    }
    return out;
  }

  /** 지금 몸이 간 거리 (세상 x). 시험용 */
  get travelled(): number {
    return this.bodyX;
  }

  update(f: PlantFrame): Record<LegId, FootOut> {
    const dt = this.last === undefined ? Number.POSITIVE_INFINITY : f.now - this.last;
    this.last = f.now;
    this.bodyX += f.move;
    if (Math.abs(f.move) > 1e-7) this.dir = f.move > 0 ? 1 : -1;
    const gait = f.gait;
    const du = gait && gait.cycle > 0 ? Math.abs(f.move) / gait.cycle : 0;
    this.phase = (this.phase + du) % 1;
    const toWorld = (p: Spot) => {
      const s = toStage(p, f.heading);
      return { x: s.x + this.bodyX, z: s.z };
    };
    const nominal = {} as Record<LegId, Spot>;
    for (const id of LEGS) nominal[id] = toWorld(f.rest[id]);
    /** 다 돈 뒤의 바랄 자리 (옮겨 딛는 발이 내릴 곳) */
    // 크게 돌 때(거꾸로 돌아서기, 집 문)는 한 번에 다 돈 자리가 아니라 조금 앞(AIM_AHEAD)까지만: 디딘 발이 다리 길이 안에 있다
    const aimH = f.heading + Math.max(-AIM_AHEAD, Math.min(AIM_AHEAD, (f.aim ?? f.heading) - f.heading));
    const goal = {} as Record<LegId, Spot>;
    for (const id of LEGS) {
      const s = toStage(f.rest[id], aimH);
      goal[id] = { x: s.x + this.bodyX, z: s.z };
    }
    // 오래 안 그렸거나 처음이거나 발을 붙여 두지 않는 자세: 발을 바랄 자리에 둔다
    // 걷는 중에 한 틀이 늦었으면(컴퓨터가 잠깐 바빴다) 디딘 자리를 그대로 두고 멀어진 발만 옮긴다
    const gap = gait || Math.abs(f.move) > 1e-7 ? GAP_MS * 5 : GAP_MS;
    if (!(dt >= 0 && dt < gap) || f.hold < 0.5) {
      for (const id of LEGS) {
        const n = nominal[id];
        this.feet.set(id, { ax: n.x, az: n.z, early: false });
      }
    }
    const L = f.L;
    const moving = Math.abs(f.move) > 1e-7;
    const swinging = () => LEGS.filter((id) => this.feet.get(id)?.swing);
    /** 이웃(같은 쪽)이 든 동안은 들지 않는다. 너무 멀어진 발(urgent)은 그래도 든다 (다리가 닿지 않으면 미끄러진다) */
    const canLift = (id: LegId, max: number, urgent = false) => {
      const up = swinging();
      return up.length < max && (urgent || !up.some((o) => neighbors(o, id)));
    };
    const start = (foot: Foot, p0: number | undefined, tx: number, tz: number) => {
      const dist = Math.hypot(tx - foot.ax, tz - foot.az);
      foot.swing = {
        fx: foot.ax,
        fz: foot.az,
        t0: f.now,
        ...(p0 !== undefined ? { p0 } : {}),
        dur: Math.min(210, Math.max(140, 130 + (120 * dist) / Math.max(1e-6, L))),
        height: gait && p0 !== undefined ? gait.lift : Math.min(0.16 * L, 0.05 * L + 0.5 * dist),
        tx,
        tz,
      };
      foot.early = false;
    };

    if (gait) {
      const { kind, duty, cycle } = gait;
      for (const id of LEGS) {
        const foot = this.feet.get(id);
        if (!foot) continue;
        const u = footPhase(id, this.phase, kind);
        const n = nominal[id];
        if (!foot.swing) {
          // 반 틀 앞을 내다보고 든다 (드물게 그리면 한 틀 늦게 들어 디딘 발이 다리 끝까지 끌려갔다)
          const lead = du * 0.5;
          if (u < duty - lead) foot.early = false;
          // 걸음 박자의 들기는 막지 않는다 (앞 쌍이 이번 틀에 내리는 중이라 셋까지 세일 수 있다)
          else if (!foot.early && canLift(id, kind === 'trot' ? 4 : 2, true))
            start(foot, Math.max(0, (u - duty) / (1 - duty)), n.x, n.z);
        }
        // 박자와 크게 어긋난 디딘 발 (돌아서기에서 막 넘어왔거나 걸음새가 바뀌었다): 이웃이 안 들었으면 바로 옮긴다
        if (!foot.swing && u < duty) {
          const ex = n.x + this.dir * cycle * (duty / 2 - u);
          if (
            Math.hypot(foot.ax - ex, foot.az - n.z) > MISS * L &&
            canLift(id, 2, Math.hypot(foot.ax - ex, foot.az - n.z) > URGENT * L)
          )
            start(foot, undefined, ex, n.z);
        }
        const sw = foot.swing;
        if (!sw) continue;
        // 내릴 자리: 박자대로 들었으면 내릴 때 몸이 간 곳에서 반 걸음 앞. 디딜 때 옮긴 발은 지금 박자의 디딘 자리
        sw.tx =
          u >= duty
            ? n.x + this.dir * ((1 - u) * cycle + (duty * cycle) / 2)
            : n.x + this.dir * cycle * (duty / 2 - u);
        // 지금 몸에서 다리가 닿는 곳보다 멀리 내리지 않는다 (걸음새가 바뀌어 박자가 건너뛰었을 때)
        sw.tx = n.x + Math.max(-REACH * 0.9 * L, Math.min(REACH * 0.9 * L, sw.tx - n.x));
        sw.tz = n.z;
      }
    } else {
      // 박자 없이: 바랄 자리(가면 조금 앞)에서 많이 벗어난 발부터 옮긴다
      const lead = moving ? this.dir * 0.12 * L : 0;
      const thr = (moving ? 0.2 : 0.07) * L;
      const errs = LEGS.map((id) => {
        const foot = this.feet.get(id);
        const n = nominal[id];
        const g = goal[id];
        // 지금 자리에서도, 다 돈 자리에서도 벗어났으면 옮긴다
        const e = foot
          ? Math.min(
              Math.hypot(foot.ax - n.x - lead, foot.az - n.z),
              Math.hypot(foot.ax - g.x - lead, foot.az - g.z),
            )
          : 0;
        return { id, foot, e };
      })
        .filter((v) => v.foot && !v.foot.swing && v.e > thr)
        .sort((a, b) => b.e - a.e);
      for (const v of errs) {
        if (!v.foot) continue;
        const g = goal[v.id];
        if (canLift(v.id, v.e > PAIR_ERR * L ? 2 : 1, v.e > URGENT * L))
          start(v.foot, undefined, g.x + lead, g.z);
      }
      for (const id of LEGS) {
        const sw = this.feet.get(id)?.swing;
        if (!sw) continue;
        const g = goal[id];
        sw.tx = g.x + lead;
        sw.tz = g.z;
      }
    }

    // 다리가 닿지 않을 만큼 멀어진 디딘 발은 무엇보다 먼저 옮긴다 (빠르게 달리거나 그리기가 드문드문할 때)
    if (w0(f.hold) > 0)
      for (const id of LEGS) {
        const foot = this.feet.get(id);
        if (!foot || foot.swing) continue;
        const local = toLocal({ x: foot.ax - this.bodyX, z: foot.az }, f.heading);
        const r = f.rest[id];
        if (Math.hypot(local.x - r.x, local.z - r.z) <= REACH * L || !canLift(id, 3, true)) continue;
        const g = goal[id];
        const ahead = gait ? this.dir * gait.cycle * gait.duty * 0.35 : 0;
        start(foot, undefined, g.x + ahead, g.z);
      }
    let pending = false;
    if (!gait && w0(f.hold) > 0)
      for (const id of LEGS) {
        const foot = this.feet.get(id);
        const g = goal[id];
        if (foot && !foot.swing && Math.hypot(foot.ax - g.x, foot.az - g.z) > 0.07 * L) pending = true;
      }
    const out = {} as Record<LegId, FootOut>;
    const w = w0(f.hold);
    for (const id of LEGS) {
      const foot = this.feet.get(id);
      const n = nominal[id];
      let px = n.x;
      let pz = n.z;
      let lift = 0;
      let swing = -1;
      if (foot) {
        px = foot.ax;
        pz = foot.az;
        const sw = foot.swing;
        if (sw) {
          let k = (f.now - sw.t0) / (sw.p0 !== undefined ? SWING_MAX_MS : sw.dur);
          if (sw.p0 !== undefined && gait) {
            const u = footPhase(id, this.phase, gait.kind);
            // 디딤 끝 조금 앞에서 미리 든 발은 아직 0 (박자가 한 바퀴 돌아 디딤에 들어왔으면 1)
            const p = u >= gait.duty ? (u - gait.duty) / (1 - gait.duty) : u > gait.duty - 0.2 ? 0 : 1;
            k = Math.max(k, (p - sw.p0) / Math.max(1e-6, 1 - sw.p0));
          }
          k = Math.min(1, Math.max(0, k));
          if (k >= 1) {
            foot.ax = sw.tx;
            foot.az = sw.tz;
            foot.swing = undefined;
            // 박자가 아직 드는 때면 다시 들지 않게
            foot.early = !!gait && footPhase(id, this.phase, gait.kind) >= gait.duty;
            px = foot.ax;
            pz = foot.az;
          } else {
            const e = (1 - Math.cos(Math.PI * k)) / 2;
            px = sw.fx + (sw.tx - sw.fx) * e;
            pz = sw.fz + (sw.tz - sw.fz) * e;
            lift = sw.height * Math.sin(Math.PI * k ** 0.8);
            swing = k;
          }
        }
      }
      // 무대로, 다시 root 기준으로. 붙여 두는 정도만큼 바랄 자리와 섞는다
      const local = toLocal({ x: px - this.bodyX, z: pz }, f.heading);
      const r = f.rest[id];
      out[id] = {
        x: r.x + (local.x - r.x) * w,
        z: r.z + (local.z - r.z) * w,
        lift: lift * w,
        // 바랄 자리와 섞는 동안(자세를 바꾸는 중)은 디딘 발로 치지 않는다
        planted: swing < 0 && w >= 0.999,
        swing: w > 0 ? swing : -1,
      };
    }
    this.busy = pending || LEGS.some((id) => !!this.feet.get(id)?.swing) || !!gait;
    return out;
  }
}
