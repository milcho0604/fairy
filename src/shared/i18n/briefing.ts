import type { Translation } from './types.ts';

// 브리핑과 하루 회고 글
export const ko = {
  'briefing.hi.morning': '좋은 아침!',
  'briefing.hi.day': '안녕!',
  'briefing.hi.evening': '왔구나!',
  'briefing.oneEvent': '오늘 일정은 {time} {title} 하나야.',
  'briefing.events': '오늘 일정 {n}개, 첫 일정은 {time} {title}.',
  'briefing.allDay': '오늘 종일: {list}.',
  'briefing.dueToday': '오늘 마감 {n}개',
  'briefing.overdue': '지난 마감 {n}개',
  'briefing.todos': '할 일은 {list} 있어.',
  'briefing.nothing': '오늘은 일정도 마감도 없어. 하고 싶은 걸 적어 봐.',
  'briefing.review.none': '오늘은 끝낸 할 일이 없네. 그래도 수고했어.',
  'briefing.review.one': '오늘 "{title}" 끝냈어. 수고했어!',
  'briefing.review.many': '오늘 할 일 {n}개 끝냈어. 수고했어!',
  'briefing.review.left': (v: { n: number }) => `오늘 마감 ${v.n}개가 남았는데 내일로 넘길까?`,
  'briefing.review.missed': (v: { done: number; left: number }) =>
    `하루 회고: 끝낸 할 일 ${v.done}개${v.left > 0 ? `, 남은 마감 ${v.left}개` : ''}`,
  'briefing.due.left': (v: { n: number; list: string }) => `오늘 마감인 할 일이 ${v.n}개 남았어. ${v.list}`,
  'briefing.due.more': (v: { n: number }) => ` 외 ${v.n}개`,
  'briefing.due.open': '볼게',
};

export const en: Translation<typeof ko> = {
  'briefing.hi.morning': 'Good morning!',
  'briefing.hi.day': 'Hi!',
  'briefing.hi.evening': "Oh, you're here!",
  'briefing.oneEvent': 'One event today: {title} at {time}.',
  'briefing.events': '{n} events today. First up: {title} at {time}.',
  'briefing.allDay': 'All day today: {list}.',
  'briefing.dueToday': '{n} due today',
  'briefing.overdue': '{n} overdue',
  'briefing.todos': 'To-dos: {list}.',
  'briefing.nothing': 'No events or deadlines today. Jot down something you want to do.',
  'briefing.review.none': 'No to-dos finished today. You still worked hard.',
  'briefing.review.one': 'You finished "{title}" today. Nice work!',
  'briefing.review.many': 'You finished {n} to-dos today. Nice work!',
  'briefing.review.left': (v: { n: number }) =>
    v.n === 1 ? "Push today's 1 open to-do to tomorrow?" : `Push today's ${v.n} open to-dos to tomorrow?`,
  'briefing.review.missed': (v: { done: number; left: number }) =>
    `Daily review: ${v.done} to-do${v.done === 1 ? '' : 's'} done${v.left > 0 ? `, ${v.left} still due` : ''}`,
  'briefing.due.left': (v: { n: number; list: string }) =>
    v.n === 1 ? `One to-do is due today: ${v.list}` : `${v.n} to-dos are due today: ${v.list}`,
  'briefing.due.more': (v: { n: number }) => ` and ${v.n} more`,
  'briefing.due.open': 'Show me',
};
