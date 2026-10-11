import type { Translation } from './types.ts';

// 감사 2차 다듬기 (2026-10-11): 화면 읽기 이름, 플랫폼 글, 안내 글
export const ko = {
  // 할 일 줄 단추: 어느 할 일의 단추인지 이름에 넣는다 (화면 읽기가 "중요" 만 읽었다)
  'panel.todo.importantFor': (v: { title: string }) => `"${v.title}" 중요 표시`,
  'panel.todo.dueFor': (v: { title: string; when: string }) => `"${v.title}" 마감일: ${v.when}`,
  'remind.buttonFor': (v: { title: string; list: string }) => `"${v.title}" 알림: ${v.list}`,
};

export const en: Translation<typeof ko> = {
  'panel.todo.importantFor': (v: { title: string }) => `Mark "${v.title}" important`,
  'panel.todo.dueFor': (v: { title: string; when: string }) => `Due date for "${v.title}": ${v.when}`,
  'remind.buttonFor': (v: { title: string; list: string }) => `Reminders for "${v.title}": ${v.list}`,
};
