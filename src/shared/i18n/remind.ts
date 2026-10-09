import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

type N = { n: number };
type Title = { title: string };
type At = { title: string; time: string };

// 미리 알림 (8판): 고르기 칸 이름, 패널 고르기 화면, 펫이 하는 말
export const ko = {
  // 고르기 칸
  'remind.at': '정각',
  'remind.min': (v: N) => `${v.n}분 전`,
  'remind.hour': (v: N) => `${v.n}시간 전`,
  'remind.hourMin': (v: { h: number; m: number }) => `${v.h}시간 ${v.m}분 전`,
  'remind.day': (v: N) => `${v.n}일 전`,
  'remind.week': (v: N) => `${v.n}주 전`,
  'remind.sameDay': (v: { at: string }) => `당일 ${v.at}`,
  'remind.prevDay': (v: { at: string }) => `전날 ${v.at}`,
  'remind.daysAt': (v: { n: number; at: string }) => `${v.n}일 전 ${v.at}`,
  'remind.weekAt': (v: { n: number; at: string }) => `${v.n}주 전 ${v.at}`,
  'remind.morning': '아침 9시',
  'remind.evening': '저녁 8시',
  // 패널 고르기 화면
  'remind.title': '미리 알림',
  'remind.button': (v: { list: string }) => `알림: ${v.list}`,
  'remind.none': '알림 없음',
  'remind.noneAllDay': '알림 없음 (아침 브리핑에 나와)',
  'remind.custom': '직접',
  'remind.amount': '얼마나 전',
  'remind.unit': '단위',
  'remind.unit.min': '분',
  'remind.unit.hour': '시간',
  'remind.unit.day': '일',
  'remind.dayHint': '일 전 아침 9시',
  'remind.add': '더하기',
  'remind.close': '닫기',
  'remind.max': (v: N) => `알림은 ${v.n}개까지야.`,
  'remind.bad': '1분부터 30일 전까지 넣을 수 있어.',
  'remind.dueTime': '마감 시각',
  'remind.clearTime': '시각 빼기',
  'remind.needDue': '마감일을 정하면 알려 줄게.',
  'remind.allDayHint': '종일 일정은 아침 브리핑에도 나와.',
  'remind.dateHint': '마감 시각이 없으면 아침 9시나 저녁 8시에 알려 줄게.',
  // 펫이 하는 말. 늦게 꺼내도 맞게 지금 시각으로 다시 만든다
  'remind.say.eventNow': (v: At) => `지금 ${v.title} 시작이야! (${v.time})`,
  'remind.say.eventSoon': (v: At & N) => `${v.n}분 뒤 ${v.title}! 준비됐어? (${v.time})`,
  'remind.say.eventLater': (v: At & { dur: string }) =>
    `${v.dur} 뒤에 ${withParticle(v.title, '이')} 있어 (${v.time})`,
  'remind.say.eventTomorrow': (v: At) => `내일 ${v.time}에 ${withParticle(v.title, '이')} 있어! 준비됐어?`,
  'remind.say.eventDays': (v: At & N & { date: string }) =>
    `${v.title}까지 ${v.n === 7 ? '딱 일주일' : `${v.n}일`} 남았어 (${v.date} ${v.time})`,
  'remind.say.allDayToday': (v: Title & { range: string }) => `오늘은 종일 ${v.title}! 잊지 마${v.range}`,
  'remind.say.allDayTomorrow': (v: Title & { range: string }) =>
    `내일은 종일 ${v.title}! 준비됐어?${v.range}`,
  'remind.say.allDayDays': (v: Title & N & { date: string }) =>
    `${v.title}까지 ${v.n === 7 ? '딱 일주일' : `${v.n}일`} 남았어 (${v.date})`,
  'remind.say.todoNow': (v: At) => `지금 "${v.title}" 마감이야! (${v.time})`,
  'remind.say.todoSoon': (v: At & N) => `"${v.title}" 마감까지 ${v.n}분! 거의 다 왔어 (${v.time})`,
  'remind.say.todoLater': (v: At & { dur: string }) => `"${v.title}" 마감까지 ${v.dur} 남았어 (${v.time})`,
  'remind.say.todoToday': (v: Title) => `오늘 마감: "${v.title}"! 할 수 있어`,
  'remind.say.todoTomorrow': (v: Title) => `내일 마감: "${v.title}". 미리 해 둘까?`,
  'remind.say.todoTomorrowAt': (v: At) => `내일 ${v.time}까지 "${v.title}"! 미리 해 둘까?`,
  'remind.say.todoDays': (v: Title & N & { date: string }) =>
    `"${v.title}" 마감까지 ${v.n === 7 ? '딱 일주일' : `${v.n}일`} 남았어 (${v.date})`,
  'remind.dur.h': (v: { h: number }) => `${v.h}시간`,
  'remind.dur.hm': (v: { h: number; m: number }) => `${v.h}시간 ${v.m}분`,
  'remind.snoozeHour': '1시간 뒤에 다시',
  'remind.show': '볼게',
};

export const en: Translation<typeof ko> = {
  'remind.at': 'At start',
  'remind.min': (v: N) => `${v.n} min before`,
  'remind.hour': (v: N) => `${v.n} hr before`,
  'remind.hourMin': (v: { h: number; m: number }) => `${v.h} hr ${v.m} min before`,
  'remind.day': (v: N) => (v.n === 1 ? '1 day before' : `${v.n} days before`),
  'remind.week': (v: N) => (v.n === 1 ? '1 week before' : `${v.n} weeks before`),
  'remind.sameDay': (v: { at: string }) => `Same day, ${v.at}`,
  'remind.prevDay': (v: { at: string }) => `Day before, ${v.at}`,
  'remind.daysAt': (v: { n: number; at: string }) => `${v.n} days before, ${v.at}`,
  'remind.weekAt': (v: { n: number; at: string }) =>
    `${v.n === 1 ? '1 week' : `${v.n} weeks`} before, ${v.at}`,
  'remind.morning': '9 AM',
  'remind.evening': '8 PM',
  'remind.title': 'Reminders',
  'remind.button': (v: { list: string }) => `Reminders: ${v.list}`,
  'remind.none': 'No reminders',
  'remind.noneAllDay': 'None (shows in the morning briefing)',
  'remind.custom': 'Custom',
  'remind.amount': 'How long before',
  'remind.unit': 'Unit',
  'remind.unit.min': 'min',
  'remind.unit.hour': 'hr',
  'remind.unit.day': 'days',
  'remind.dayHint': 'days before, 9 AM',
  'remind.add': 'Add',
  'remind.close': 'Done',
  'remind.max': (v: N) => `Up to ${v.n} reminders.`,
  'remind.bad': 'Pick something between 1 minute and 30 days.',
  'remind.dueTime': 'Due time',
  'remind.clearTime': 'Remove time',
  'remind.needDue': "Set a due date and I'll remind you.",
  'remind.allDayHint': 'All-day events also show up in the morning briefing.',
  'remind.dateHint': "Without a due time, I'll remind you at 9 AM or 8 PM.",
  'remind.say.eventNow': (v: At) => `${v.title} is starting now! (${v.time})`,
  'remind.say.eventSoon': (v: At & N) => `${v.title} in ${v.n} min! Ready? (${v.time})`,
  'remind.say.eventLater': (v: At & { dur: string }) => `${v.title} in ${v.dur} (${v.time})`,
  'remind.say.eventTomorrow': (v: At) => `${v.title} tomorrow at ${v.time}! Ready?`,
  'remind.say.eventDays': (v: At & N & { date: string }) =>
    `${v.n === 7 ? 'One week' : `${v.n} days`} until ${v.title} (${v.date}, ${v.time})`,
  'remind.say.allDayToday': (v: Title & { range: string }) =>
    `All day today: ${v.title}! Don't forget${v.range}`,
  'remind.say.allDayTomorrow': (v: Title & { range: string }) =>
    `All day tomorrow: ${v.title}! Ready?${v.range}`,
  'remind.say.allDayDays': (v: Title & N & { date: string }) =>
    `${v.n === 7 ? 'One week' : `${v.n} days`} until ${v.title} (${v.date})`,
  'remind.say.todoNow': (v: At) => `"${v.title}" is due now! (${v.time})`,
  'remind.say.todoSoon': (v: At & N) => `"${v.title}" is due in ${v.n} min! Almost there (${v.time})`,
  'remind.say.todoLater': (v: At & { dur: string }) => `"${v.title}" is due in ${v.dur} (${v.time})`,
  'remind.say.todoToday': (v: Title) => `"${v.title}" is due today! You've got this`,
  'remind.say.todoTomorrow': (v: Title) => `"${v.title}" is due tomorrow. Get a head start?`,
  'remind.say.todoTomorrowAt': (v: At) => `"${v.title}" is due tomorrow at ${v.time}. Get a head start?`,
  'remind.say.todoDays': (v: Title & N & { date: string }) =>
    `${v.n === 7 ? 'One week' : `${v.n} days`} left for "${v.title}" (${v.date})`,
  'remind.dur.h': (v: { h: number }) => `${v.h} hr`,
  'remind.dur.hm': (v: { h: number; m: number }) => `${v.h} hr ${v.m} min`,
  'remind.snoozeHour': 'Again in 1 hour',
  'remind.show': 'Show me',
};
