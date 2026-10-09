// 메뉴 막대 컴퓨터 상태 (사용자 요청 2026-10-08: RunCat 처럼). CPU 가 바쁠수록 메뉴 막대의 작은 펫이 빨리 달리고
// (그림과 상태는 menu-runner.ts), 메뉴를 열면 CPU, 메모리, 디스크, 그래픽, 켜진 시간을 본다.
// 여기는 화면 없는 계산만 둔다 (main/system-monitor.ts 가 쓴다).

/** CPU 를 읽는 간격. os.cpus() 한 번이라 가볍다 */
export const MONITOR_SAMPLE_MS = 2000;
/** 입력 없이 이만큼(초) 지나면 화면이 꺼졌거나 자리를 비운 것으로 보고 펫과 글자를 세운다 */
export const MONITOR_AWAY_SEC = 180;
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
 * 맥 host_statistics64(HOST_VM_INFO64) 가 채우는 vm_statistics64 를 32비트 칸 번호로 본 자리.
 * 칸 수 HOST_VM_INFO64_COUNT 는 38 (152바이트). vm_stat 명령도 같은 값을 찍는다
 */
export const VM_INFO64_COUNT = 38;
const VM_ACTIVE = 1;
const VM_WIRED = 3;
const VM_PURGEABLE = 22;
const VM_COMPRESSOR = 32;

/**
 * 맥 쪽 수(vm_statistics64 의 32비트 칸들)로 쓰는 메모리를 낸다. 활성 상황(Activity Monitor)의 "사용된 메모리"에 가깝게
 * 앱(active) + 고정(wired) + 압축(compressor) 쪽만 센다. 캐시(inactive, speculative, purgeable)는 빼서
 * os.freemem() 처럼 늘 꽉 찬 것으로 보이지 않는다. 칸이 모자라거나 쪽 크기를 모르면 undefined
 */
export function macMemoryUse(
  words: ArrayLike<number>,
  pageSize: number,
  total: number,
): MemoryUse | undefined {
  if (words.length < VM_INFO64_COUNT || !(pageSize > 0)) return undefined;
  const at = (i: number) => words[i] ?? 0;
  const used = (Math.max(0, at(VM_ACTIVE) - at(VM_PURGEABLE)) + at(VM_WIRED) + at(VM_COMPRESSOR)) * pageSize;
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
