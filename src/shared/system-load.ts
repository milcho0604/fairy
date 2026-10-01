// 컴퓨터가 바쁜지 판단한다. 사용자 요청(2026-10-02): CPU 나 메모리가 차면 펫이 멈추고 바쁘다고 알린다.
// 잠깐 튀는 값에 펫이 들락날락하지 않도록 들어갈 때와 나올 때 기준을 다르게 둔다.

export type MemoryPressure = 'normal' | 'warn' | 'critical';

export interface LoadSample {
  /** 모든 코어 평균 사용률 0~100. */
  cpu: number;
  memory: MemoryPressure;
}

export interface CpuTimes {
  idle: number;
  total: number;
}

/** 표본 간격. 이 간격으로 os.cpus() 를 읽는다. */
export const SAMPLE_INTERVAL_MS = 5000;

export const BUSY_CPU = 85;
/** 이만큼 연달아 BUSY_CPU 이상이면 바쁨 (5초 x 2 = 10초). */
export const BUSY_SAMPLES = 2;
export const CALM_CPU = 70;
/** 이만큼 연달아 CALM_CPU 미만이고 메모리가 정상이면 바쁨을 푼다 (15초). */
export const CALM_SAMPLES = 3;

/** 코어별 누적 시간 두 번을 받아 그 사이 평균 사용률(0~100)을 낸다. */
export function cpuPercent(prev: CpuTimes, next: CpuTimes): number {
  const total = next.total - prev.total;
  if (total <= 0) return 0;
  const busy = total - (next.idle - prev.idle);
  return Math.min(100, Math.max(0, (busy / total) * 100));
}

/** os.cpus() 결과를 합친다. */
export function sumCpuTimes(cpus: readonly { times: Record<string, number> }[]): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const { times } of cpus) {
    idle += times.idle ?? 0;
    for (const v of Object.values(times)) total += v;
  }
  return { idle, total };
}

/** 맥 `sysctl kern.memorystatus_vm_pressure_level` 값: 1 정상, 2 경고, 4 위험. */
export function macPressure(level: number): MemoryPressure {
  if (level >= 4) return 'critical';
  if (level >= 2) return 'warn';
  return 'normal';
}

/** 윈도우는 사용 가능 메모리 비율로 본다. 맥의 freemem 은 캐시를 빼서 늘 0 에 가까워 쓰지 않는다. */
export function ratioPressure(free: number, total: number): MemoryPressure {
  if (total <= 0) return 'normal';
  const used = 1 - free / total;
  if (used >= 0.95) return 'critical';
  if (used >= 0.9) return 'warn';
  return 'normal';
}

export class BusyTracker {
  #busy = false;
  #hot = 0;
  #calm = 0;

  /** 표본 하나를 넣고 지금 바쁜지 돌려준다. */
  feed(sample: LoadSample): boolean {
    const memoryTight = sample.memory !== 'normal';
    this.#hot = sample.cpu >= BUSY_CPU ? this.#hot + 1 : 0;
    this.#calm = sample.cpu < CALM_CPU && !memoryTight ? this.#calm + 1 : 0;

    if (!this.#busy && (memoryTight || this.#hot >= BUSY_SAMPLES)) this.#busy = true;
    else if (this.#busy && this.#calm >= CALM_SAMPLES) this.#busy = false;
    return this.#busy;
  }

  get busy(): boolean {
    return this.#busy;
  }
}
