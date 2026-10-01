import { execFile } from 'node:child_process';
import { cpus, freemem, totalmem } from 'node:os';
import { powerMonitor } from 'electron';
import type { PetEnv } from '../shared/ipc.ts';
import { SLEEP_AFTER_MS } from '../shared/pet-mood.ts';
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
 * 한 번 읽는 비용: os.cpus() 와 sysctl 한 번(약 2ms).
 */
export function watchSystem(
  onChange: (env: PetEnv) => void,
  log: (tag: string, ...rest: unknown[]) => void,
): () => void {
  const tracker = new BusyTracker();
  let prev: CpuTimes = sumCpuTimes(cpus());
  let last: PetEnv = { systemBusy: false, userIdleMs: 0 };

  const tick = async () => {
    const next = sumCpuTimes(cpus());
    const cpu = cpuPercent(prev, next);
    prev = next;
    const memory = await readMemoryPressure();
    const systemBusy = tracker.feed({ cpu, memory });

    const userIdleMs = powerMonitor.getSystemIdleTime() * 1000;
    const asleep = userIdleMs >= SLEEP_AFTER_MS;
    const wasAsleep = last.userIdleMs >= SLEEP_AFTER_MS;

    if (systemBusy !== last.systemBusy || asleep !== wasAsleep) {
      last = { systemBusy, userIdleMs };
      log('system', JSON.stringify({ cpu: Math.round(cpu), memory, systemBusy, asleep }));
      onChange(last);
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
