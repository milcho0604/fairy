import { execFile } from 'node:child_process';
import { cpus, freemem, totalmem } from 'node:os';
import { powerMonitor } from 'electron';
import type { PetEnv } from '../shared/ipc.ts';
import { DOZE_AFTER_MS, SLEEP_AFTER_MS } from '../shared/pet-mood.ts';
import {
  BusyTracker,
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
 * 한 번 읽는 비용: os.cpus() 와 sysctl 한 번(약 1ms). 펫 창(기본 펫, 친구)이 여럿이어도 읽기는 한 번만 하고
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

/** 졸기(5분), 잠(10분) 단계 */
const stage = (ms: number) => (ms >= SLEEP_AFTER_MS ? 2 : ms >= DOZE_AFTER_MS ? 1 : 0);

function startSampler(): () => void {
  const tracker = new BusyTracker();
  let prev: CpuTimes = sumCpuTimes(cpus());

  const tick = async () => {
    const next = sumCpuTimes(cpus());
    const cpu = cpuPercent(prev, next);
    prev = next;
    const memory = await readMemoryPressure();
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

function readMemoryPressure(): Promise<MemoryPressure> {
  if (process.platform !== 'darwin') return Promise.resolve(ratioPressure(freemem(), totalmem()));
  return new Promise((resolve) => {
    execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], (err, out) => {
      resolve(err ? 'normal' : macPressure(Number(out.trim())));
    });
  });
}
