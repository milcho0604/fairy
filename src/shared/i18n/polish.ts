import type { Translation } from './types.ts';

// 감사 2차 다듬기 (2026-10-11): 화면 읽기 이름, 플랫폼 글, 안내 글
export const ko = {
  // 할 일 줄 단추: 어느 할 일의 단추인지 이름에 넣는다 (화면 읽기가 "중요" 만 읽었다)
  'panel.todo.importantFor': (v: { title: string }) => `"${v.title}" 중요 표시`,
  'panel.todo.dueFor': (v: { title: string; when: string }) => `"${v.title}" 마감일: ${v.when}`,
  'remind.buttonFor': (v: { title: string; list: string }) => `"${v.title}" 알림: ${v.list}`,
  // 펫 만들기: 2.5D 나 입체를 골랐는데 아직 안 만들었을 때 저장 단추 위 안내
  'maker.relief.buildOnSave': '"이 페어리로 할게" 를 누르면 2.5D를 먼저 만들고 바로 저장할게.',
  'maker.3d.needFirst': '입체 피규어를 먼저 만들어 줘. 아니면 "사진 그대로" 를 골라.',
  // AI 관리: 쓸 수 있는 AI 가 없을 때 무료 AI 를 맨 위에
  'chat.recommended': '추천',
  'chat.local.downloadNow': '무료 AI 받기',
  // 내보낸 곳
  'settings.exportedTo': (v: { path: string }) => `여기에 저장했어: ${v.path}`,
  'settings.openFolder': '폴더 열기',
  // 빠른 입력: 지난 날
  'panel.quick.todoPast': (v: { due: string }) => `마감을 ${v.due}로 넣었어. 이미 지난 날이야.`,
  'panel.toast.toToday': '오늘로',
  // 설정 찾기: 어두운 모드
  'settings.themeNote':
    '밝은 화면, 어두운 화면(다크 모드)은 컴퓨터 설정을 따라가. 바꾸려면 운영체제 화면 설정에서 바꿔 줘.',
  'settings.themeKeywords':
    '테마 다크 다크모드 어두운 모드 밝은 모드 라이트 theme dark mode light appearance',
  // 받기가 통째로 막혔을 때 (프록시, 방화벽)
  'main.model.blocked':
    '연결이 막혀서 받지 못했어. 회사나 학교 네트워크라면 프록시나 방화벽이 막고 있을 수 있어. 다른 네트워크에서 해 보거나 관리자에게 물어봐 줘.',
};

export const en: Translation<typeof ko> = {
  'panel.todo.importantFor': (v: { title: string }) => `Mark "${v.title}" important`,
  'panel.todo.dueFor': (v: { title: string; when: string }) => `Due date for "${v.title}": ${v.when}`,
  'remind.buttonFor': (v: { title: string; list: string }) => `Reminders for "${v.title}": ${v.list}`,
  'maker.relief.buildOnSave': 'Press "Use this fairy" and I\'ll make the 2.5D version first, then save.',
  'maker.3d.needFirst': 'Make the 3D figure first, or pick "Photo as is".',
  'chat.recommended': 'Recommended',
  'chat.local.downloadNow': 'Download free AI',
  'settings.exportedTo': (v: { path: string }) => `Saved to ${v.path}`,
  'settings.openFolder': 'Open folder',
  'panel.quick.todoPast': (v: { due: string }) => `Due ${v.due}, which has already passed.`,
  'panel.toast.toToday': 'Make it today',
  'settings.themeNote':
    "Light and dark (dark mode) follow your computer's appearance. Change it in your system's display settings.",
  'settings.themeKeywords': 'theme dark mode light appearance 테마 다크 다크모드 어두운 밝은',
  'main.model.blocked':
    'The download was blocked. On a work or school network, a proxy or firewall may be blocking it. Try another network or ask your network admin.',
};
