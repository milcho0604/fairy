import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpus, freemem, totalmem } from 'node:os';
import { powerMonitor } from 'electron';
import type { PetEnv } from '../shared/ipc.ts';
import { DOZE_AFTER_MS, SLEEP_AFTER_MS } from '../shared/pet-mood.ts';
import {
  BusyTracker,
  CALM_CPU,
  type CpuTimes,
  cpuPercent,
  type MemoryPressure,
  macPressure,
  ratioPressure,
  SAMPLE_INTERVAL_MS,
  sumCpuTimes,
} from '../shared/system-load.ts';

/**
 * 5초마다 CPU, 메모리, 사용자 입력 없는 시간을 읽고, 펫 상태에 영향이 있을 때만 알린다.
 * 한 번 읽는 비용: os.cpus() 와 맥 메모리 압박 단계 읽기 한 번. 펫 창(기본 펫, 친구)이 여럿이어도 읽기는 한 번만 하고
 * 듣는 쪽마다 바뀐 것만 알린다 (예전에는 창마다 따로 읽어 친구 셋이면 sysctl 을 5초에 네 번 띄웠다).
 */
export function watchSystem(
  onChange: (env: PetEnv) => void,
  log: (tag: string, ...rest: unknown[]) => void,
): () => void {
  const watcher: Watcher = { onChange, log, last: { systemBusy: false, userIdleMs: 0 } };
  watchers.add(watcher);
  if (!shared) shared = startSampler();
  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0 && shared) {
      shared();
      shared = undefined;
    }
  };
}

interface Watcher {
  onChange: (env: PetEnv) => void;
  log: (tag: string, ...rest: unknown[]) => void;
  last: PetEnv;
}

const watchers = new Set<Watcher>();
let shared: (() => void) | undefined;

/** 듣는 쪽 아무나의 기록 함수 (모두 같은 log 를 넘긴다) */
const firstLog = () => watchers.values().next().value?.log ?? (() => {});

/** 졸기(5분), 잠(10분) 단계 */
const stage = (ms: number) => (ms >= SLEEP_AFTER_MS ? 2 : ms >= DOZE_AFTER_MS ? 1 : 0);

function startSampler(): () => void {
  const tracker = new BusyTracker();
  let prev: CpuTimes = sumCpuTimes(cpus());

  const tick = async () => {
    const next = sumCpuTimes(cpus());
    const cpu = cpuPercent(prev, next);
    prev = next;
    const memory = await readMemoryPressure(cpu, firstLog());
    const systemBusy = tracker.feed({ cpu, memory });
    const userIdleMs = powerMonitor.getSystemIdleTime() * 1000;

    let logged = false;
    for (const w of watchers) {
      // 졸기, 잠 경계를 넘거나 바쁨이 바뀔 때만 알린다.
      if (systemBusy === w.last.systemBusy && stage(userIdleMs) === stage(w.last.userIdleMs)) continue;
      w.last = { systemBusy, userIdleMs };
      if (!logged) {
        w.log(
          'system',
          JSON.stringify({ cpu: Math.round(cpu), memory, systemBusy, asleep: stage(userIdleMs) === 2 }),
        );
        logged = true;
      }
      w.onChange(w.last);
    }
  };

  const timer = setInterval(() => void tick(), SAMPLE_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * 맥 메모리 압박 단계(kern.memorystatus_vm_pressure_level)를 프로세스 없이 libc sysctlbyname 으로 읽는다.
 * 예전에는 5초마다 /usr/sbin/sysctl 프로세스를 띄웠다(한 번 약 1.2ms, 하루 1만 7천 번). 같은 값을 함수로 읽으면 약 1.4us.
 *
 * 프로세스 없이 읽는 다른 길은 판단이 달라 쓰지 않는다 (2026-10-07 이 맥에서 잼):
 * - os.freemem() 과 Electron process.getSystemMemoryInfo().free 는 맥에서 정말 빈 쪽만 센다(캐시, 압축 제외).
 *   같은 순간 커널 단계는 2(경고)인데 빈 비율은 1.1% 라, 비율로 보면 '위험'으로 잘못 읽는다. 단계가 평소(1)일 때도 0 에 가깝다.
 * - 압박 단계는 커널이 압축, 스왑, 빈 쪽을 함께 보고 정한 값이라 다른 숫자로 다시 만들 수 없다.
 * 그래서 같은 값을 읽는 sysctlbyname 으로 바꿨다. 판단 기준(1 정상, 2 경고, 4 위험)은 그대로다.
 * koffi 를 못 쓰면(불러오기 실패) 예전처럼 sysctl 을 띄우되, CPU 가 높을 때만 부른다(메모리만 빠듯한 경우는 놓친다).
 */
type PressureReader = () => number | undefined;
let pressureReader: PressureReader | null | undefined;

function macPressureReader(log: (tag: string, ...rest: unknown[]) => void): PressureReader | undefined {
  if (pressureReader !== undefined) return pressureReader ?? undefined;
  try {
    const require = createRequire(import.meta.url);
    const koffi = require('koffi');
    const libc = koffi.load('/usr/lib/libSystem.B.dylib');
    const sysctlbyname = libc.func(
      'int sysctlbyname(const char *name, _Out_ int *oldp, _Inout_ size_t *oldlenp, void *newp, size_t newlen)',
    );
    pressureReader = () => {
      const out = [0];
      const len = [4];
      return sysctlbyname('kern.memorystatus_vm_pressure_level', out, len, null, 0) === 0
        ? out[0]
        : undefined;
    };
  } catch (err) {
    log(
      'system',
      '메모리 압박을 함수로 못 읽음, sysctl 로',
      err instanceof Error ? err.message : String(err),
    );
    pressureReader = null;
  }
  return pressureReader ?? undefined;
}

function readMemoryPressure(
  cpu: number,
  log: (tag: string, ...rest: unknown[]) => void,
): Promise<MemoryPressure> {
  if (process.platform !== 'darwin') return Promise.resolve(ratioPressure(freemem(), totalmem()));
  const read = macPressureReader(log);
  if (read) {
    const level = read();
    return Promise.resolve(level === undefined ? 'normal' : macPressure(level));
  }
  // 함수로 못 읽을 때만: 프로세스는 CPU 가 바쁨 기준 근처일 때만 띄운다
  if (cpu < CALM_CPU) return Promise.resolve('normal');
  return new Promise((resolve) => {
    execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], (err, out) => {
      resolve(err ? 'normal' : macPressure(Number(out.trim())));
    });
  });
}
