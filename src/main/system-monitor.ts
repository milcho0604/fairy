import { execFile } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { arch, cpus, freemem, homedir, totalmem, uptime } from 'node:os';
import {
  app,
  type MenuItemConstructorOptions,
  type NativeImage,
  nativeImage,
  nativeTheme,
  type Tray,
} from 'electron';
import { t } from '../shared/i18n/index.ts';
import { type CpuTimes, cpuPercent, sumCpuTimes } from '../shared/system-load.ts';
import {
  cpuTitle,
  gb,
  gpuName,
  type MemoryUse,
  MONITOR_SAMPLE_MS,
  meter,
  parseVmStat,
  RUNNER_FRAMES,
  runnerAlpha,
  runnerFrameMs,
  uptimeParts,
} from '../shared/system-stats.ts';

export interface SystemMonitor {
  /** 켜고 끈다 (설정 sysMonitor) */
  setEnabled(on: boolean): void;
  /** 꺼져 있을 때 쓸 아이콘 (윈도우는 펫 얼굴). 켜져 있으면 다음에 끌 때 쓴다 */
  setBaseIcon(icon: NativeImage): void;
  /** 메뉴의 "컴퓨터 상태" 칸 */
  menuItems(): MenuItemConstructorOptions[];
  dispose(): void;
}

/**
 * 메뉴 막대 컴퓨터 상태 (사용자 요청 2026-10-08: RunCat 처럼).
 * 켜져 있으면 2초마다 CPU 를 읽어(os.cpus() 한 번) 메뉴 막대에 사용률을 쓰고, 작은 콩이가 그만큼 빨리 달린다.
 * 그림은 처음 한 번 도형으로 그려 두고 바꿔 끼우기만 한다. 맥 메모리는 vm_stat 을 메뉴 위에 마우스가 올 때만 읽는다
 * (계속 띄우지 않는다, system-watch.ts 와 같은 이유).
 */
export function createSystemMonitor(
  tray: Tray,
  baseIcon: NativeImage,
  log: (tag: string, ...rest: unknown[]) => void,
): SystemMonitor {
  const mac = process.platform === 'darwin';
  let base = baseIcon;
  let on = false;
  let cpu = 0;
  let prev: CpuTimes = sumCpuTimes(cpus());
  let sampler: NodeJS.Timeout | undefined;
  let runner: NodeJS.Timeout | undefined;
  let frame = 0;
  let frames: NativeImage[] | undefined;
  let framesDark: boolean | undefined;
  let memory: MemoryUse | undefined;
  let memoryAt = 0;
  let gpu: string | undefined;

  // 그래픽 이름은 바뀌지 않으니 한 번만
  app
    .getGPUInfo('basic')
    .then((info) => {
      const aux = (info as { auxAttributes?: { glRenderer?: string } }).auxAttributes;
      gpu = gpuName(aux?.glRenderer);
    })
    .catch(() => {});

  const runnerFrames = (): NativeImage[] => {
    // 윈도우는 알림 영역 색(밝음, 어두움)에 맞춰 칠한다. 맥은 흑백 템플릿이라 운영체제가 칠한다
    const dark = !mac && nativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
    if (frames && framesDark === dark) return frames;
    const ink = mac ? [0, 0, 0] : dark ? [245, 245, 245] : [40, 40, 40];
    const sizes = mac
      ? [{ px: 36, scale: 2 }]
      : [
          { px: 16, scale: 1 },
          { px: 32, scale: 2 },
        ];
    frames = Array.from({ length: RUNNER_FRAMES }, (_, i) => {
      const img = nativeImage.createEmpty();
      for (const { px, scale } of sizes) {
        const a = runnerAlpha(i, px);
        const bgra = Buffer.alloc(px * px * 4);
        for (let k = 0; k < a.length; k++) {
          const alpha = a[k] ?? 0;
          // 미리 곱한 색 (premultiplied)
          bgra[k * 4] = Math.round(((ink[2] ?? 0) * alpha) / 255);
          bgra[k * 4 + 1] = Math.round(((ink[1] ?? 0) * alpha) / 255);
          bgra[k * 4 + 2] = Math.round(((ink[0] ?? 0) * alpha) / 255);
          bgra[k * 4 + 3] = alpha;
        }
        img.addRepresentation({ scaleFactor: scale, width: px, height: px, buffer: bgra });
      }
      if (mac) img.setTemplateImage(true);
      return img;
    });
    framesDark = dark;
    return frames;
  };

  const sample = () => {
    const next = sumCpuTimes(cpus());
    cpu = cpuPercent(prev, next);
    prev = next;
    if (mac) tray.setTitle(cpuTitle(cpu), { fontType: 'monospacedDigit' });
  };

  const step = () => {
    if (!on || tray.isDestroyed()) return;
    const list = runnerFrames();
    frame = (frame + 1) % list.length;
    const img = list[frame];
    if (img) tray.setImage(img);
    runner = setTimeout(step, runnerFrameMs(cpu));
  };

  const refreshMemory = () => {
    if (!mac) return;
    if (Date.now() - memoryAt < 5000) return;
    memoryAt = Date.now();
    execFile('/usr/bin/vm_stat', (err, out) => {
      if (err) return;
      memory = parseVmStat(out, totalmem()) ?? memory;
    });
  };
  tray.on('mouse-enter', refreshMemory);

  const stop = () => {
    clearInterval(sampler);
    clearTimeout(runner);
    sampler = undefined;
    runner = undefined;
  };

  const setEnabled = (want: boolean) => {
    if (want === on || tray.isDestroyed()) return;
    on = want;
    stop();
    if (on) {
      prev = sumCpuTimes(cpus());
      sampler = setInterval(sample, MONITOR_SAMPLE_MS);
      sample();
      step();
      refreshMemory();
      log('system', '메뉴 막대 컴퓨터 상태 켬');
    } else {
      if (mac) tray.setTitle('');
      tray.setImage(base);
      log('system', '메뉴 막대 컴퓨터 상태 끔');
    }
  };

  // 알림 영역 색이 바뀌면 다음 그림부터 새 색으로 (runnerFrames 가 다시 그린다)
  const onTheme = () => {
    if (!mac) frames = undefined;
  };
  nativeTheme.on('updated', onTheme);

  const memoryNow = (): MemoryUse => {
    const total = totalmem();
    // 윈도우, 리눅스는 사용 가능 메모리가 캐시를 포함해 그대로 쓴다. 맥은 vm_stat 을 못 읽었으면 빈 칸
    if (!mac) return { used: total - freemem(), total };
    return memory ?? { used: Number.NaN, total };
  };

  const menuItems = (): MenuItemConstructorOptions[] => {
    // 꺼져 있어도 메뉴를 열 때는 지금 값을 한 번 읽는다
    if (!on) sample();
    refreshMemory();
    const list = cpus();
    const model = (list[0]?.model ?? '').replace(/\s+/g, ' ').trim();
    const mem = memoryNow();
    const disk = diskUse();
    const up = uptimeParts(uptime());
    const line = (label: string): MenuItemConstructorOptions => ({ label, enabled: false });
    const items: MenuItemConstructorOptions[] = [
      line(t('tray.stats.cpu', { pct: Math.round(cpu), bar: meter(cpu / 100) })),
      line(t('tray.stats.cpuModel', { model: model || arch(), cores: list.length })),
      line(
        Number.isFinite(mem.used)
          ? t('tray.stats.memory', {
              used: gb(mem.used),
              total: gb(mem.total),
              bar: meter(mem.used / mem.total),
            })
          : t('tray.stats.memoryTotal', { total: gb(mem.total) }),
      ),
    ];
    if (disk)
      items.push(
        line(
          t('tray.stats.disk', {
            free: gb(disk.free),
            total: gb(disk.total),
            bar: meter(1 - disk.free / disk.total),
          }),
        ),
      );
    if (gpu) items.push(line(t('tray.stats.gpu', { name: gpu })));
    items.push(line(osName()));
    items.push(line(t('tray.stats.uptime', up)));
    return items;
  };

  return {
    setEnabled,
    setBaseIcon(icon) {
      base = icon;
      if (!on && !tray.isDestroyed()) tray.setImage(icon);
    },
    menuItems,
    dispose() {
      stop();
      on = false;
      nativeTheme.off('updated', onTheme);
    },
  };
}

/** 시스템 디스크 (맥 /, 윈도우는 홈이 있는 드라이브) */
function diskUse(): { free: number; total: number } | undefined {
  try {
    const root = process.platform === 'win32' ? `${homedir().slice(0, 2)}\\` : '/';
    const s = statfsSync(root);
    const total = s.blocks * s.bsize;
    if (!total) return undefined;
    return { free: s.bavail * s.bsize, total };
  } catch {
    return undefined;
  }
}

function osName(): string {
  const v = process.getSystemVersion();
  if (process.platform === 'darwin') return `macOS ${v}`;
  if (process.platform === 'win32') return `Windows ${v}`;
  return `${process.platform} ${v}`;
}
