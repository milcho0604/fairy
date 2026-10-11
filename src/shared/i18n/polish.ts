import type { Translation } from './types.ts';

// 감사 2차 다듬기 (2026-10-11): 화면 읽기 이름, 플랫폼 글, 안내 글
export const ko = {
  // 할 일 줄 단추: 어느 할 일의 단추인지 이름에 넣는다 (화면 읽기가 "중요" 만 읽었다)
  'panel.todo.importantFor': (v: { title: string }) => `"${v.title}" 중요 표시`,
  'panel.todo.dueFor': (v: { title: string; when: string }) => `"${v.title}" 마감일: ${v.when}`,
  'remind.buttonFor': (v: { title: string; list: string }) => `"${v.title}" 알림: ${v.list}`,
  // 펫 만들기: 2.5D 나 입체를 골랐는데 아직 안 만들었을 때 저장 단추 위 안내
  'maker.relief.buildOnSave': '"이 펫으로 할게" 를 누르면 2.5D를 먼저 만들고 바로 저장할게.',
  'maker.3d.needFirst': '입체 피규어를 먼저 만들어 줘. 아니면 "사진 그대로" 를 골라.',
};

export const en: Translation<typeof ko> = {
  'panel.todo.importantFor': (v: { title: string }) => `Mark "${v.title}" important`,
  'panel.todo.dueFor': (v: { title: string; when: string }) => `Due date for "${v.title}": ${v.when}`,
  'remind.buttonFor': (v: { title: string; list: string }) => `Reminders for "${v.title}": ${v.list}`,
  'maker.relief.buildOnSave': 'Press "Use this pet" and I\'ll make the 2.5D version first, then save.',
  'maker.3d.needFirst': 'Make the 3D figure first, or pick "Photo as is".',
};
