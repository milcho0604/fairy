import type { Translation } from './types.ts';

// 오늘 뭐부터 (AI 없이 답하기), 매달 반복 할 일 (2026-10-11)
export const ko = {
  // ---- 오늘 뭐부터 ----
  'first.head': '오늘은 이 순서로 해 보자!',
  'first.none': '지금 급한 할 일은 없어! 하고 싶은 것부터 천천히 해도 돼.',
  'first.more': (v: { n: number }) => `(그 밖에 ${v.n}개는 그다음에)`,
  'first.block': (v: { from: string; to: string; title: string; min: number }) =>
    `${v.from}~${v.to}에 시간이 비어. 거기서 "${v.title}" ${v.min}분 집중 어때?`,
  'first.noGap': '오늘 남은 시간엔 일정 사이 빈틈이 별로 없네. 짧게라도 하나씩 해 보자.',
  'first.bubble': (v: { title: string; why: string; rest: string }) =>
    v.rest ? `"${v.title}"부터 하자! (${v.why}) 그다음은 ${v.rest}.` : `"${v.title}"부터 하자! (${v.why})`,
  'first.why.overdue': '마감 지남',
  'first.why.dueAt': (v: { time: string }) => `${v.time} 마감`,
  'first.why.today': '오늘 마감',
  'first.why.important': '중요',
  'first.why.tomorrow': '내일 마감',
  'first.why.soon': (v: { m: number; d: number }) => `${v.m}월 ${v.d}일 마감`,
  'first.why.habit': '오늘 습관',
  'first.why.oldest': '제일 먼저 넣은 것',
  'first.ctx.head': '[페어리가 마감과 중요 표시로 세운 오늘 순서. 참고해서 답해 줘]',
  'first.ctx.free': (v: { from: string; to: string }) => `다음 빈 시간: ${v.from}~${v.to}`,
  // 채팅 답 위 꼬리표와 답 아래 단추
  'first.tag': 'AI 없이',
  'first.tagTitle': 'AI 없이 마감, 중요 표시, 일정으로 골랐어',
  'first.focus': '집중 시작',
  'first.panel': '패널 열기',
  // 펫 우클릭 메뉴
  'first.menu': '오늘 뭐부터?',
  // ---- 매달 반복 ----
  'panel.repeat.monthly': '매달',
  'repeat.monthly.added': (v: { d: number; due: string }) =>
    `매달 ${v.d}일 반복으로 넣었어. 첫 마감은 ${v.due}.`,
  'habit.streakMonthly': (v: { n: number }) => `${v.n}달째`,
};

export const en: Translation<typeof ko> = {
  'first.head': "Here's the order I'd go with today:",
  'first.none': 'Nothing urgent right now! Start with whatever you feel like.',
  'first.more': (v: { n: number }) => `(${v.n} more after that)`,
  'first.block': (v: { from: string; to: string; title: string; min: number }) =>
    `You're free ${v.from}–${v.to}. How about ${v.min} minutes of focus on "${v.title}" then?`,
  'first.noGap': "There isn't much free time between events today. Let's chip away one at a time.",
  'first.bubble': (v: { title: string; why: string; rest: string }) =>
    v.rest ? `Start with "${v.title}" (${v.why}). Then ${v.rest}.` : `Start with "${v.title}" (${v.why}).`,
  'first.why.overdue': 'overdue',
  'first.why.dueAt': (v: { time: string }) => `due ${v.time}`,
  'first.why.today': 'due today',
  'first.why.important': 'important',
  'first.why.tomorrow': 'due tomorrow',
  'first.why.soon': (v: { m: number; d: number }) => `due ${v.m}/${v.d}`,
  'first.why.habit': "today's habit",
  'first.why.oldest': 'added first',
  'first.ctx.head': "[The user's order for today, ranked by due dates and stars. Use it in your answer]",
  'first.ctx.free': (v: { from: string; to: string }) => `Next free time: ${v.from}-${v.to}`,
  'first.tag': 'No AI',
  'first.tagTitle': 'Picked without AI, from due dates, stars, and events',
  'first.focus': 'Start focus',
  'first.panel': 'Open panel',
  'first.menu': 'What first today?',
  'panel.repeat.monthly': 'Monthly',
  'repeat.monthly.added': (v: { d: number; due: string }) =>
    `Added as a monthly repeat on day ${v.d}. First due ${v.due}.`,
  'habit.streakMonthly': (v: { n: number }) => `${v.n} month${v.n === 1 ? '' : 's'} in a row`,
};
