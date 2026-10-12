import { statfsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, freemem, homedir, totalmem, uptime } from 'node:os';
import {
  app,
  type MenuItemConstructorOptions,
  type NativeImage,
  nativeImage,
  nativeTheme,
  powerMonitor,
  type Tray,
} from 'electron';
import { t } from '../shared/i18n/index.ts';
import { RUNNER_COUNTS, RUNNER_MAC_PT, RUNNER_STATES, runnerAlpha } from '../shared/menu-runner.ts';
import type { PetKind } from '../shared/settings.ts';
import { sumCpuTimes } from '../shared/system-load.ts';
import {
  canReadMacMemory,
  cpuTitle,
  gb,
  gpuName,
  type MemoryUse,
  macMemoryUse,
  meter,
  uptimeParts,
  VM_INFO64_COUNT,
} from '../shared/system-stats.ts';
import { createMonitorCore, type PauseReason } from './monitor-core.ts';
import { setTrayTitlePart } from './tray-title.ts';

export interface SystemMonitor {
  /** 켜고 끈다 (설정 sysMonitor) */
  setEnabled(on: boolean): void;
  /** 꺼져 있을 때 쓸 아이콘 (윈도우는 펫 얼굴). 켜져 있으면 다음에 끌 때 쓴다 */
  setBaseIcon(icon: NativeImage): void;
  /** 메뉴 막대에서 달릴 펫 모습 (menu-runner.ts runnerKindOf). 바뀌면 그림을 새로 그려 지금 장을 바꿔 끼운다 */
  setKind(kind: PetKind): void;
  /** 발표, 전체 화면처럼 펫을 숨길 때는 메뉴 막대 펫도 세운다 */
  setPaused(reason: PauseReason, on: boolean): void;
  /** 메뉴의 "컴퓨터 상태" 칸 */
  menuItems(): MenuItemConstructorOptions[];
  dispose(): void;
}

/**
 * 메뉴 막대 컴퓨터 상태 (사용자 요청 2026-10-08: RunCat 처럼).
 * 켜져 있으면 2초마다 CPU 를 읽어(os.cpus() 한 번) 사용률을 쓰고(맥은 메뉴 막대 글자, 윈도우는 툴팁), 지금 펫 모습(menu-runner.ts)이 그만큼 바삐 움직인다(앉기, 걷기, 달리기, 질주).
 * 그림은 처음 한 번 도형으로 그려 두고 바꿔 끼우기만 한다. 같은 장, 같은 글자면 다시 쓰지 않는다.
 * 잠금, 잠자기, 자리 비움(화면 꺼짐)에는 읽기까지 멈추고, 배터리와 발표 중에는 펫만 세운다 (monitor-core.ts).
 * 꺼져 있으면 메뉴 막대에 아무것도 쓰지 않고, 메뉴를 열 때만 아이콘에 마우스가 올라온 때부터의 CPU 를 잰다.
 * 맥 메모리는 프로세스를 띄우지 않고 host_statistics64 로 읽는다 (system-watch.ts 와 같은 이유). 못 읽으면 메모리 칸은 전체 크기만.
 */
export function createSystemMonitor(
  tray: Tray,
  baseIcon: NativeImage,
  baseTooltip: () => string,
  log: (tag: string, ...rest: unknown[]) => void,
): SystemMonitor {
  const mac = process.platform === 'darwin';
  let base = baseIcon;
  let frames: NativeImage[] | undefined;
  let framesDark: boolean | undefined;
  let kind: PetKind = 'kong';
  let shownFrame: number | undefined;
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
    // 맥은 22x18 점(레티나 44x36px)으로 옆으로 조금 넓게, 윈도우 알림 영역은 16x16 칸이 정해져 있다
    const sizes = mac
      ? [{ w: RUNNER_MAC_PT.w * 2, h: RUNNER_MAC_PT.h * 2, scale: 2 }]
      : [
          { w: 16, h: 16, scale: 1 },
          { w: 32, h: 32, scale: 2 },
        ];
    // 모든 상태의 장을 한 줄로 (monitor-core 가 주는 번호 순서). 종류나 알림 영역 색이 바뀔 때만 다시 그린다
    const list = RUNNER_STATES.flatMap((state) =>
      Array.from({ length: RUNNER_COUNTS[state] }, (_, f) => ({ state, f })),
    );
    frames = list.map(({ state, f }) => {
      const img = nativeImage.createEmpty();
      for (const { w, h, scale } of sizes) {
        const a = runnerAlpha(kind, state, f, w, h);
        const bgra = Buffer.alloc(w * h * 4);
        for (let k = 0; k < a.length; k++) {
          const alpha = a[k] ?? 0;
          // 미리 곱한 색 (premultiplied)
          bgra[k * 4] = Math.round(((ink[2] ?? 0) * alpha) / 255);
          bgra[k * 4 + 1] = Math.round(((ink[1] ?? 0) * alpha) / 255);
          bgra[k * 4 + 2] = Math.round(((ink[0] ?? 0) * alpha) / 255);
          bgra[k * 4 + 3] = alpha;
        }
        img.addRepresentation({ scaleFactor: scale, width: w, height: h, buffer: bgra });
      }
      if (mac) img.setTemplateImage(true);
      return img;
    });
    framesDark = dark;
    return frames;
  };

  const alive = () => !tray.isDestroyed();
  const core = createMonitorCore({
    readCpu: () => sumCpuTimes(cpus()),
    idleSec: () => powerMonitor.getSystemIdleTime(),
    showCpu: (pct) => {
      if (!alive()) return;
      if (mac) setTrayTitlePart(tray, 'cpu', cpuTitle(pct));
      else tray.setToolTip(t('tray.tooltipCpu', { base: baseTooltip(), pct }));
    },
    clearCpu: () => {
      if (!alive()) return;
      if (mac) setTrayTitlePart(tray, 'cpu', '');
      else tray.setToolTip(baseTooltip());
    },
    showFrame: (i) => {
      shownFrame = i;
      const img = runnerFrames()[i];
      if (img && alive()) tray.setImage(img);
    },
    showBase: () => {
      shownFrame = undefined;
      if (alive()) tray.setImage(base);
    },
    now: () => Date.now(),
    later: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as NodeJS.Timeout),
  });

  // 잠금, 잠자기, 배터리는 운영체제가 알려 준다. 처음 상태는 지금 전원으로
  const power: [string, PauseReason, boolean][] = [
    ['lock-screen', 'locked', true],
    ['unlock-screen', 'locked', false],
    ['user-did-resign-active', 'locked', true],
    ['user-did-become-active', 'locked', false],
    ['suspend', 'asleep', true],
    ['resume', 'asleep', false],
    ['on-battery', 'battery', true],
    ['on-ac', 'battery', false],
  ];
  const powerHandlers = power.map(([event, reason, on]) => {
    const fn = () => core.setPaused(reason, on);
    powerMonitor.on(event as 'lock-screen', fn);
    return [event, fn] as const;
  });
  core.setPaused('battery', powerMonitor.isOnBatteryPower());

  // 꺼져 있을 때 메뉴용 CPU 구간을 연다 (os.cpus() 한 번). 메모리는 메뉴를 만들 때 바로 읽는다
  const onHover = () => core.hover();
  tray.on('mouse-enter', onHover);

  // 알림 영역 색이 바뀌면 그림을 다시 그리고 지금 장을 새 색으로 바꿔 끼운다
  const onTheme = () => {
    if (mac) return;
    frames = undefined;
    if (shownFrame !== undefined && alive()) {
      const img = runnerFrames()[shownFrame];
      if (img) tray.setImage(img);
    }
  };
  nativeTheme.on('updated', onTheme);

  // Rosetta 로 도는 인텔 앱은 읽지 않는다: 마하 트랩 호출이 앱을 죽인다 (canReadMacMemory)
  const translated = mac && app.runningUnderARM64Translation;
  if (translated) log('system', 'Rosetta 로 실행 중이라 메모리 칸은 전체 크기만');
  const readMacMemory = canReadMacMemory(process.platform, translated) ? macMemoryReader(log) : undefined;
  const memoryNow = (): MemoryUse => {
    const total = totalmem();
    // 윈도우, 리눅스는 사용 가능 메모리가 캐시를 포함해 그대로 쓴다. 맥은 못 읽었으면 빈 칸
    if (!mac) return { used: total - freemem(), total };
    return readMacMemory?.(total) ?? { used: Number.NaN, total };
  };

  const menuItems = (): MenuItemConstructorOptions[] => {
    // 꺼져 있으면 아이콘에 마우스가 올라온 때부터 지금까지만 잰다. 메뉴 막대 글자는 건드리지 않는다
    const cpu = core.menuCpu();
    const list = cpus();
    const model = (list[0]?.model ?? '').replace(/\s+/g, ' ').trim();
    const mem = memoryNow();
    const disk = diskUse();
    const up = uptimeParts(uptime());
    const line = (label: string): MenuItemConstructorOptions => ({ label, enabled: false });
    const items: MenuItemConstructorOptions[] = [
      line(
        cpu === undefined
          ? t('tray.stats.cpuWait')
          : t('tray.stats.cpu', { pct: Math.round(cpu), bar: meter(cpu / 100) }),
      ),
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
    setEnabled(want) {
      if (!alive() || want === core.enabled()) return;
      core.setEnabled(want);
      log('system', want ? '메뉴 막대 컴퓨터 상태 켬' : '메뉴 막대 컴퓨터 상태 끔');
    },
    setBaseIcon(icon) {
      base = icon;
      if (!core.enabled() && alive()) tray.setImage(icon);
    },
    setKind(next) {
      if (next === kind) return;
      kind = next;
      frames = undefined;
      // 지금 보이는 장을 새 모습으로 바로 바꿔 끼운다 (꺼져 있으면 다음에 켤 때 그린다)
      if (shownFrame !== undefined && alive()) {
        const img = runnerFrames()[shownFrame];
        if (img) tray.setImage(img);
      }
    },
    setPaused: (reason, on) => core.setPaused(reason, on),
    menuItems,
    dispose() {
      core.dispose();
      nativeTheme.off('updated', onTheme);
      tray.off('mouse-enter', onHover);
      for (const [event, fn] of powerHandlers) powerMonitor.off(event as 'lock-screen', fn);
    },
  };
}

/**
 * 맥 메모리 쪽 수를 프로세스 없이 libSystem host_statistics64(HOST_VM_INFO64) 로 읽는다 (2026-10-08 이 맥에서 한 번 약 0.6us,
 * vm_stat 출력과 같은 값). 쪽 크기는 sysctlbyname hw.pagesize. koffi 를 못 쓰면 undefined 를 돌려 메모리 칸을 비운다
 */
function macMemoryReader(
  log: (tag: string, ...rest: unknown[]) => void,
): ((total: number) => MemoryUse | undefined) | undefined {
  try {
    const require = createRequire(import.meta.url);
    const koffi = require('koffi');
    const libc = koffi.load('/usr/lib/libSystem.B.dylib');
    const machHostSelf = libc.func('uint32_t mach_host_self()');
    const hostStatistics64 = libc.func(
      'int host_statistics64(uint32_t host, int flavor, _Out_ void *info, _Inout_ uint32_t *count)',
    );
    const sysctlbyname = libc.func(
      'int sysctlbyname(const char *name, _Out_ void *oldp, _Inout_ size_t *oldlenp, void *newp, size_t newlen)',
    );
    const HOST_VM_INFO64 = 4;
    // 포트는 한 번만 받는다 (부를 때마다 받으면 포트 권한이 쌓인다)
    const host = machHostSelf();
    const ps = Buffer.alloc(8);
    const psLen = [8];
    if (sysctlbyname('hw.pagesize', ps, psLen, null, 0) !== 0) throw new Error('hw.pagesize');
    const pageSize = psLen[0] === 4 ? ps.readUInt32LE(0) : Number(ps.readBigUInt64LE(0));
    const info = Buffer.alloc(VM_INFO64_COUNT * 4);
    return (total) => {
      const count = [VM_INFO64_COUNT];
      if (hostStatistics64(host, HOST_VM_INFO64, info, count) !== 0) return undefined;
      const words = new Uint32Array(info.buffer, info.byteOffset, VM_INFO64_COUNT);
      return macMemoryUse(words, pageSize, total);
    };
  } catch (err) {
    log(
      'system',
      '맥 메모리를 함수로 못 읽음, 메모리 칸은 전체 크기만',
      err instanceof Error ? err.message : String(err),
    );
    return undefined;
  }
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
