import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// tray 영역 글
export const ko = {
  'tray.tooltip': (v: { name: string }) => `페어리 (${v.name})`,
  'tray.hiddenKeys': (v: { keys: string }) => `숨김: ${v.keys} 눌러 다시 부르기`,
  'tray.hiddenNoKey': '숨김: 앱을 다시 열면 돌아와',
  'tray.show': (v: { name: string }) => `${withParticle(v.name, '을')} 다시 보이기`,
  'tray.hide': (v: { name: string }) => `${withParticle(v.name, '을')} 잠깐 숨기기`,
  'tray.chat': (v: { name: string }) => `${withParticle(v.name, '과')} 대화`,
  'tray.look': (v: { name: string }) => `${withParticle(v.name, '이랑')} 같이 보기`,
  'tray.todos': '할 일 보기',
  'tray.addTodo': '할 일 추가',
  'tray.settings': '설정',
  'tray.feedback': '의견 보내기',
  'tray.reload': (v: { name: string }) => `${v.name} 새로고침`,
  'tray.quit': '끝내기',
  'tray.stats': '컴퓨터 상태',
  // 윈도우는 알림 영역 아이콘 옆에 글자를 못 써서 툴팁에 넣는다
  'tray.stats.show': (v: { mac: boolean }) => (v.mac ? '메뉴 막대에 CPU 보이기' : '알림 영역에 CPU 보이기'),
  'tray.stats.cpu': (v: { pct: number; bar: string }) => `CPU ${v.bar} ${v.pct}%`,
  'tray.stats.cpuWait': 'CPU 재는 중 (메뉴를 다시 열면 보여)',
  'tray.tooltipCpu': (v: { base: string; pct: number }) => `${v.base}\nCPU ${v.pct}%`,
  'tray.stats.cpuModel': (v: { model: string; cores: number }) => `${v.model} (${v.cores}코어)`,
  'tray.stats.memory': (v: { used: string; total: string; bar: string }) =>
    `메모리 ${v.bar} ${v.used} / ${v.total}`,
  'tray.stats.memoryTotal': (v: { total: string }) => `메모리 ${v.total}`,
  'tray.stats.disk': (v: { free: string; total: string; bar: string }) =>
    `디스크 ${v.bar} ${v.free} 남음 / ${v.total}`,
  'tray.stats.gpu': (v: { name: string }) => `그래픽 ${v.name}`,
  'tray.stats.uptime': (v: { d: number; h: number; m: number }) =>
    `켜진 지 ${v.d > 0 ? `${v.d}일 ` : ''}${v.h}시간 ${v.m}분`,
};

export const en: Translation<typeof ko> = {
  'tray.tooltip': (v: { name: string }) => `fairy (${v.name})`,
  'tray.hiddenKeys': (v: { keys: string }) => `Hidden: press ${v.keys} to bring back`,
  'tray.hiddenNoKey': 'Hidden: open the app to bring fairy back',
  'tray.show': (v: { name: string }) => `Show ${v.name} again`,
  'tray.hide': (v: { name: string }) => `Hide ${v.name} for a bit`,
  'tray.chat': (v: { name: string }) => `Chat with ${v.name}`,
  'tray.look': (v: { name: string }) => `Look together with ${v.name}`,
  'tray.todos': 'Show to-dos',
  'tray.addTodo': 'Add to-do',
  'tray.settings': 'Settings',
  'tray.feedback': 'Send feedback',
  'tray.reload': (v: { name: string }) => `Refresh ${v.name}`,
  'tray.quit': 'Quit',
  'tray.stats': 'Computer status',
  'tray.stats.show': (v: { mac: boolean }) =>
    v.mac ? 'Show CPU in the menu bar' : 'Show CPU in the notification area',
  'tray.stats.cpu': (v: { pct: number; bar: string }) => `CPU ${v.bar} ${v.pct}%`,
  'tray.stats.cpuWait': 'CPU: measuring (open the menu again)',
  'tray.tooltipCpu': (v: { base: string; pct: number }) => `${v.base}\nCPU ${v.pct}%`,
  'tray.stats.cpuModel': (v: { model: string; cores: number }) => `${v.model} (${v.cores} cores)`,
  'tray.stats.memory': (v: { used: string; total: string; bar: string }) =>
    `Memory ${v.bar} ${v.used} / ${v.total}`,
  'tray.stats.memoryTotal': (v: { total: string }) => `Memory ${v.total}`,
  'tray.stats.disk': (v: { free: string; total: string; bar: string }) =>
    `Disk ${v.bar} ${v.free} free / ${v.total}`,
  'tray.stats.gpu': (v: { name: string }) => `Graphics ${v.name}`,
  'tray.stats.uptime': (v: { d: number; h: number; m: number }) =>
    `Up ${v.d > 0 ? `${v.d}d ` : ''}${v.h}h ${v.m}m`,
};
