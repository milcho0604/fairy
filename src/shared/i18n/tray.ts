import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// tray 영역 글
export const ko = {
  'tray.tooltip': (v: { name: string }) => `짝꿍 (${v.name})`,
  'tray.show': (v: { name: string }) => `${withParticle(v.name, '을')} 다시 보이기`,
  'tray.hide': (v: { name: string }) => `${withParticle(v.name, '을')} 잠깐 숨기기`,
  'tray.chat': (v: { name: string }) => `${withParticle(v.name, '과')} 대화`,
  'tray.todos': '할 일 보기',
  'tray.addTodo': '할 일 추가',
  'tray.settings': '설정',
  'tray.feedback': '의견 보내기',
  'tray.reload': (v: { name: string }) => `${v.name} 새로고침`,
  'tray.quit': '끝내기',
};

export const en: Translation<typeof ko> = {
  'tray.tooltip': (v: { name: string }) => `Jjakkung (${v.name})`,
  'tray.show': (v: { name: string }) => `Show ${v.name} again`,
  'tray.hide': (v: { name: string }) => `Hide ${v.name} for a bit`,
  'tray.chat': (v: { name: string }) => `Chat with ${v.name}`,
  'tray.todos': 'Show to-dos',
  'tray.addTodo': 'Add to-do',
  'tray.settings': 'Settings',
  'tray.feedback': 'Send feedback',
  'tray.reload': (v: { name: string }) => `Refresh ${v.name}`,
  'tray.quit': 'Quit',
};
