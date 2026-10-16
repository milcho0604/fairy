import type { Translation } from './types.ts';

// 펫 질문 칩, 진행 중 말풍선, 꾹 누르면 커지기 (이슈 #124, 2026-10-16)
// 줄표와 가운뎃점은 사전 글에 쓰지 않는다 (i18n.test.ts)
export const ko = {
  'chips.menu': '물어보기',
  'chips.ask': '뭐가 궁금해?',
  'chips.more': '다른 것도',
  'chips.enough': '됐어',
  'chips.todoDone': '오늘 얼마나 했어?',
  'chips.todoLeft': '남은 할 일은?',
  'chips.nextEvent': '다음 일정은?',
  'chips.focusToday': '오늘 집중 몇 분?',
  'chips.coins': '코인 얼마야?',
  'chips.a.doneNone': '오늘은 아직 끝낸 할 일이 없어. 하나만 해 볼까?',
  'chips.a.done': (v: { n: number; open: number }) => `오늘 할 일 ${v.n}개 끝냈어! 남은 건 ${v.open}개야.`,
  'chips.a.doneAll': (v: { n: number }) => `오늘 할 일 ${v.n}개 끝냈어! 남은 건 없어.`,
  'chips.a.leftNone': '남은 할 일이 없어. 푹 쉬어도 돼!',
  'chips.a.left': (v: { n: number; title: string }) => `남은 할 일이 ${v.n}개야. 먼저 "${v.title}" 어때?`,
  'chips.a.eventNone': '앞으로 2주 안에 일정이 없어.',
  'chips.a.event': (v: { when: string; title: string }) =>
    `다음 일정은 ${v.when}에 있는 "${v.title}" 일정이야.`,
  'chips.a.eventNow': (v: { title: string }) => `지금 "${v.title}" 일정이 진행 중이야.`,
  'chips.when.today': '오늘',
  'chips.when.tomorrow': '내일',
  'chips.when.date': (v: { month: number; day: number }) => `${v.month}월 ${v.day}일`,
  'chips.when.clock': (v: { hour12: number; min: string; pm: boolean }) =>
    `${v.pm ? '오후' : '오전'} ${v.hour12}:${v.min}`,
  'chips.when.allDay': '종일',
  'chips.a.focusNone': '오늘은 아직 집중한 시간이 없어.',
  'chips.a.focus': (v: { time: string }) => `오늘 ${v.time} 집중했어.`,
  'chips.a.focusRunning': (v: { time: string }) => `오늘 ${v.time} 집중했어. 지금도 집중 중이야!`,
  'chips.time.min': (v: { n: number }) => `${v.n}분`,
  'chips.time.hour': (v: { h: number }) => `${v.h}시간`,
  'chips.time.hourMin': (v: { h: number; m: number }) => `${v.h}시간 ${v.m}분`,
  'chips.a.coins': (v: { n: number }) => `코인 ${v.n}개 가지고 있어.`,
  // 진행 중 말풍선과 집중 말풍선
  'chips.doing': (v: { title: string }) => `▶ 진행 중: ${v.title}`,
  'chips.doingMore': (v: { title: string; n: number }) => `▶ 진행 중: ${v.title} 외 ${v.n}개`,
  'chips.focusing': (v: { min: number }) => `집중 중, ${v.min}분 남았어`,
  'chips.focusingLast': '집중 중, 1분 안에 끝나',
  'chips.doingStart': '진행 중으로 표시',
  'chips.doingStop': '진행 중 풀기',
  'chips.doingStartFor': (v: { title: string }) => `"${v.title}" 진행 중으로 표시`,
  'chips.doingStopFor': (v: { title: string }) => `"${v.title}" 진행 중 풀기`,
  'chips.doingMark': '진행 중',
  // 설정 (펫 탭)
  'settings.petChips': '질문 칩',
  'settings.petChipsHint':
    '펫을 우클릭해 "물어보기"를 누르면 오늘 한 일, 다음 일정, 집중 시간, 코인을 칩으로 바로 알려 줘. AI는 쓰지 않아.',
  'settings.doingBubble': '진행 중 말풍선',
  'settings.doingBubbleHint':
    '할 일에 ▶를 누르면 펫 머리 위에 "진행 중"이 계속 떠 있어. 집중 중에는 남은 시간이 대신 떠.',
  'settings.clickGrow': '꾹 누르면 커지기',
  'settings.clickGrowHint':
    '펫을 가만히 누르고 있으면 잠깐 크게 보여 줘. 놓으면 돌아와. 누른 채 움직이면 그냥 끌려가. 움직임 줄이기를 켜 두면 부드럽게 커지지 않고 바로 바뀌어.',
};

export const en: Translation<typeof ko> = {
  'chips.menu': 'Quick questions',
  'chips.ask': 'What do you want to know?',
  'chips.more': 'Ask more',
  'chips.enough': 'Done',
  'chips.todoDone': 'How much did I do today?',
  'chips.todoLeft': 'What is left to do?',
  'chips.nextEvent': 'What is my next event?',
  'chips.focusToday': 'Focus time today?',
  'chips.coins': 'How many coins?',
  'chips.a.doneNone': 'No to-dos finished today yet. How about one?',
  'chips.a.done': (v: { n: number; open: number }) =>
    `You finished ${v.n} to-do${v.n === 1 ? '' : 's'} today! ${v.open} left.`,
  'chips.a.doneAll': (v: { n: number }) =>
    `You finished ${v.n} to-do${v.n === 1 ? '' : 's'} today! Nothing left.`,
  'chips.a.leftNone': 'Nothing left to do. Go rest!',
  'chips.a.left': (v: { n: number; title: string }) =>
    `${v.n} to-do${v.n === 1 ? '' : 's'} left. How about "${v.title}" first?`,
  'chips.a.eventNone': 'No events in the next two weeks.',
  'chips.a.event': (v: { when: string; title: string }) => `Your next event is "${v.title}", ${v.when}.`,
  'chips.a.eventNow': (v: { title: string }) => `"${v.title}" is on right now.`,
  'chips.when.today': 'today',
  'chips.when.tomorrow': 'tomorrow',
  'chips.when.date': (v: { month: number; day: number }) =>
    `on ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][v.month - 1]} ${v.day}`,
  'chips.when.clock': (v: { hour12: number; min: string; pm: boolean }) =>
    `at ${v.hour12}:${v.min} ${v.pm ? 'PM' : 'AM'}`,
  'chips.when.allDay': 'all day',
  'chips.a.focusNone': 'No focus time yet today.',
  'chips.a.focus': (v: { time: string }) => `You focused for ${v.time} today.`,
  'chips.a.focusRunning': (v: { time: string }) => `You focused for ${v.time} today. Still going!`,
  'chips.time.min': (v: { n: number }) => `${v.n} min`,
  'chips.time.hour': (v: { h: number }) => `${v.h} hr`,
  'chips.time.hourMin': (v: { h: number; m: number }) => `${v.h} hr ${v.m} min`,
  'chips.a.coins': (v: { n: number }) => `You have ${v.n} coin${v.n === 1 ? '' : 's'}.`,
  'chips.doing': (v: { title: string }) => `▶ Working on: ${v.title}`,
  'chips.doingMore': (v: { title: string; n: number }) => `▶ Working on: ${v.title} and ${v.n} more`,
  'chips.focusing': (v: { min: number }) => `Focusing, ${v.min} min left`,
  'chips.focusingLast': 'Focusing, done within a minute',
  'chips.doingStart': 'Mark as in progress',
  'chips.doingStop': 'Clear in progress',
  'chips.doingStartFor': (v: { title: string }) => `Mark "${v.title}" as in progress`,
  'chips.doingStopFor': (v: { title: string }) => `Clear in progress for "${v.title}"`,
  'chips.doingMark': 'In progress',
  'settings.petChips': 'Quick questions',
  'settings.petChipsHint':
    'Right-click your fairy and pick "Quick questions" to get today\'s progress, your next event, focus time and coins as chips. No AI involved.',
  'settings.doingBubble': 'In-progress bubble',
  'settings.doingBubbleHint':
    'Press ▶ on a to-do and "in progress" stays above your fairy. While focusing, the time left shows instead.',
  'settings.clickGrow': 'Grow when held',
  'settings.clickGrowHint':
    'Press and hold your fairy to see it bigger for a moment. Let go and it returns. Move while pressing and it is just dragged. With reduce motion on, it switches size at once instead of easing.',
};
