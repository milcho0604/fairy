import type { Translation } from './types.ts';

// 고정(핀): 메모, 할 일, 일정을 목록 맨 위에 (2026-10-12)
export const ko = {
  'pin.pin': '맨 위에 고정',
  'pin.unpin': '고정 풀기',
  'pin.pinFor': (v: { title: string }) => `"${v.title}" 맨 위에 고정`,
  'pin.unpinFor': (v: { title: string }) => `"${v.title}" 고정 풀기`,
  'pin.pinned': '고정됨',
  'pin.section': '고정',
  'pin.menu': (v: { title: string }) => `"${v.title}" 메뉴`,
};

export const en: Translation<typeof ko> = {
  'pin.pin': 'Pin to top',
  'pin.unpin': 'Unpin',
  'pin.pinFor': (v: { title: string }) => `Pin "${v.title}" to top`,
  'pin.unpinFor': (v: { title: string }) => `Unpin "${v.title}"`,
  'pin.pinned': 'Pinned',
  'pin.section': 'Pinned',
  'pin.menu': (v: { title: string }) => `Menu for "${v.title}"`,
};
