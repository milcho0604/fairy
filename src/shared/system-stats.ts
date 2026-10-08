// 메뉴 막대 컴퓨터 상태 (사용자 요청 2026-10-08: RunCat 처럼). CPU 가 바쁠수록 메뉴 막대의 작은 콩이가 빨리 달리고,
// 메뉴를 열면 CPU, 메모리, 디스크, 그래픽, 켜진 시간을 본다. 여기는 화면 없는 계산만 둔다 (main/system-monitor.ts 가 쓴다).

/** CPU 를 읽는 간격. os.cpus() 한 번이라 가볍다 */
export const MONITOR_SAMPLE_MS = 2000;
/** 달리기 그림 수 (한 바퀴) */
export const RUNNER_FRAMES = 6;
/** 한가할 때(0%)와 꽉 찼을 때(100%) 그림 한 장 시간 */
export const RUNNER_SLOW_MS = 400;
export const RUNNER_FAST_MS = 60;

/** CPU 사용률(0~100)에 맞는 그림 한 장 시간. 바쁠수록 짧다 (RunCat 처럼 반비례에 가깝게) */
export function runnerFrameMs(cpu: number): number {
  const c = Math.min(100, Math.max(0, Number.isFinite(cpu) ? cpu : 0)) / 100;
  const k = RUNNER_SLOW_MS / RUNNER_FAST_MS - 1;
  return Math.round(RUNNER_SLOW_MS / (1 + c * k));
}

/** 메뉴 막대 글자. 자리 수가 바뀌어도 아이콘이 덜 흔들리게 늘 두 자리 이상 */
export function cpuTitle(cpu: number): string {
  const n = Math.min(100, Math.max(0, Math.round(Number.isFinite(cpu) ? cpu : 0)));
  return `${String(n).padStart(2, ' ')}%`;
}

/** 바이트를 GB 로 (소수 한 자리) */
export const gb = (n: number): string => `${(Math.max(0, n) / 1024 ** 3).toFixed(1)}GB`;

export interface MemoryUse {
  used: number;
  total: number;
}

/**
 * 맥 `vm_stat` 출력으로 쓰는 메모리를 낸다. 활성 상황(Activity Monitor)의 "사용된 메모리"에 가깝게
 * 앱(active) + 고정(wired) + 압축(compressor) 쪽만 센다. 캐시(inactive, speculative, purgeable)는 빼서
 * os.freemem() 처럼 늘 꽉 찬 것으로 보이지 않는다. 못 읽으면 undefined
 */
export function parseVmStat(text: string, total: number): MemoryUse | undefined {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!pageSize) return undefined;
  const pages = (label: string) => {
    const m = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text);
    return m ? Number(m[1]) : undefined;
  };
  const active = pages('Pages active');
  const wired = pages('Pages wired down');
  if (active === undefined || wired === undefined) return undefined;
  const compressed = pages('Pages occupied by compressor') ?? 0;
  const purgeable = pages('Pages purgeable') ?? 0;
  const used = (Math.max(0, active - purgeable) + wired + compressed) * pageSize;
  return { used: Math.min(total, used), total };
}

/**
 * 그래픽 이름. Electron getGPUInfo('basic') 의 auxAttributes.glRenderer 는
 * "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" 나
 * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" 같은 꼴이라 이름만 뽑는다
 */
export function gpuName(renderer: string | undefined): string | undefined {
  if (!renderer) return undefined;
  const r = renderer.trim();
  const metal = /Renderer:\s*([^,)]+)/.exec(r);
  if (metal?.[1]) return metal[1].trim();
  const angle = /^ANGLE \(([^,]+),\s*([^,]+?)(?:\s+(?:Direct3D|OpenGL|Vulkan)\S*.*)?(?:,|\))/.exec(r);
  if (angle?.[2]) return angle[2].trim();
  return r.slice(0, 60) || undefined;
}

/** 켜진 시간(초)을 일, 시간, 분으로 */
export function uptimeParts(sec: number): { d: number; h: number; m: number } {
  const s = Math.max(0, Math.floor(sec));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60) };
}

/** 사용률 막대 (메뉴 글자). 10칸 */
export function meter(ratio: number): string {
  const n = Math.round(Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0)) * 10);
  return '▮'.repeat(n) + '▯'.repeat(10 - n);
}

/**
 * 메뉴 막대에서 달리는 작은 콩이 그림 한 장 (불투명도만, 0~255). 그림 파일 없이 도형으로 그린다:
 * 옆에서 본 동그란 콩 몸, 눈 구멍, 머리 새싹, 번갈아 차는 두 다리와 팔. 4x4 로 나눠 재서 가장자리를 부드럽게.
 * 맥은 이 불투명도로 흑백 템플릿을 만들어 메뉴 막대 색(밝음, 어두움)을 따르게 한다
 */
export function runnerAlpha(frame: number, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const p = ((((frame % RUNNER_FRAMES) + RUNNER_FRAMES) % RUNNER_FRAMES) / RUNNER_FRAMES) * Math.PI * 2;
  // 발이 땅을 차는 순간 몸이 살짝 뜬다
  const bob = -0.035 * Math.abs(Math.cos(p));
  // 옆에서 본 달리기: 한 엉덩이에서 두 다리가 앞뒤로 엇갈리고, 뒤로 간 다리는 무릎을 굽혀 발을 찬다
  const hip = { x: 0.5, y: 0.64 + bob };
  const legs: Seg[] = [];
  for (const phase of [p, p + Math.PI]) {
    const a = 0.7 * Math.sin(phase);
    const knee = { x: hip.x + Math.sin(a) * 0.14, y: hip.y + Math.cos(a) * 0.14 };
    const shin = a - (a < 0 ? 1.2 : 0.25) * Math.abs(a);
    legs.push(seg(hip.x, hip.y, knee.x, knee.y, 0.05));
    legs.push(seg(knee.x, knee.y, knee.x + Math.sin(shin) * 0.13, knee.y + Math.cos(shin) * 0.13, 0.045));
  }
  // 팔은 몸 앞(오른쪽)으로 나와 다리와 반대로 흔든다
  const armA = 1.6 + 0.6 * Math.sin(p + Math.PI);
  const shoulder = { x: 0.7, y: 0.5 + bob };
  const arm = seg(
    shoulder.x,
    shoulder.y,
    shoulder.x + Math.sin(armA) * 0.12,
    shoulder.y + Math.cos(armA) * 0.12,
    0.04,
  );
  const sprout = seg(0.5, 0.22 + bob, 0.53, 0.11 + bob, 0.025);
  const N = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = (px + (sx + 0.5) / N) / size;
          const y = (py + (sy + 0.5) / N) / size;
          const bx = (x - 0.5) / 0.3;
          const by = (y - (0.45 + bob)) / 0.26;
          const body = bx * bx + by * by <= 1;
          const ex = x - 0.62;
          const ey = y - (0.4 + bob);
          const eye = ex * ex + ey * ey <= 0.052 * 0.052;
          const lx = x - 0.575;
          const ly = y - (0.1 + bob);
          const leaf = (lx / 0.075) ** 2 + (ly / 0.04) ** 2 <= 1;
          const inside =
            (body && !eye) ||
            leaf ||
            inSeg(sprout, x, y) ||
            inSeg(arm, x, y) ||
            legs.some((l) => inSeg(l, x, y));
          if (inside) hit++;
        }
      }
      out[py * size + px] = Math.round((hit / (N * N)) * 255);
    }
  }
  return out;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

const seg = (ax: number, ay: number, bx: number, by: number, r: number): Seg => ({ ax, ay, bx, by, r });

/** 둥근 끝 막대(캡슐) 안인지 */
function inSeg(s: Seg, x: number, y: number): boolean {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((x - s.ax) * dx + (y - s.ay) * dy) / len));
  const cx = s.ax + dx * t - x;
  const cy = s.ay + dy * t - y;
  return cx * cx + cy * cy <= s.r * s.r;
}
