import type { Translation } from './types.ts';

// 비서 기능 (2026-10-10): 할 일 단계, 찾기와 태그, 지금 하기 좋은 일, 지난 마감 옮기기, 이번 주, 일정 겹침

/** 집중 분을 "1시간 20분", "45분" 으로 */
const koMin = (n: number) =>
  n >= 60 ? `${Math.floor(n / 60)}시간${n % 60 ? ` ${n % 60}분` : ''}` : `${n}분`;
const enMin = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}` : `${n}m`);

export const ko = {
  'assist.step.open': (v: { title: string }) => `"${v.title}" 단계 보기`,
  'assist.step.button': '단계',
  'assist.step.add': '단계 더하기',
  'assist.step.placeholder': '작은 단계를 적고 Enter',
  'assist.step.check': (v: { title: string }) => `단계 끝내기: ${v.title}`,
  'assist.step.uncheck': (v: { title: string }) => `단계 되돌리기: ${v.title}`,
  'assist.step.remove': (v: { title: string }) => `단계 지우기: ${v.title}`,
  'assist.step.full': (v: { n: number }) => `단계는 ${v.n}개까지야`,
  'assist.step.allDone': '단계를 다 했어! 할 일도 끝낼까?',
  'assist.step.finish': '끝내기',
  'assist.step.hint': '쪼개면 시작이 쉬워. 한 단계씩 지워 봐',
  'assist.find.open': '할 일 찾기',
  'assist.find.placeholder': '찾을 말',
  'assist.find.clear': '찾기 지우기',
  'assist.find.none': '맞는 할 일이 없어',
  'assist.tag.nav': '태그로 좁히기',
  'assist.tag.all': '모두',
  'assist.next.step': (v: { title: string }) => `다음 단계: ${v.title}`,
  'assist.overdue.move': (v: { n: number }) => `지난 ${v.n}개 오늘로`,
  'assist.overdue.moved': (v: { n: number }) => `지난 마감 ${v.n}개를 오늘로 옮겼어`,
  'assist.overdue.brief': '지난 것 오늘로',
  'assist.defer.move': (v: { n: number }) => `못 한 ${v.n}개 내일로`,
  'assist.defer.moved': (v: { n: number }) => `못 한 ${v.n}개를 내일로 옮겼어`,
  'assist.week.title': '이번 주',
  'assist.week.summary': (v: { done: number; focus: number }) =>
    `끝낸 일 ${v.done}개${v.focus > 0 ? `, 집중 ${koMin(v.focus)}` : ''}`,
  'assist.week.vsLast': (v: { diff: number }) =>
    v.diff > 0
      ? `지난주 이맘때보다 ${v.diff}개 더 했어`
      : v.diff < 0
        ? `지난주 이맘때보다 ${-v.diff}개 적어. 괜찮아, 천천히 가자`
        : '지난주 이맘때와 같아',
  'assist.week.dueSoon': (v: { n: number }) => `다음 7일 안에 마감 ${v.n}개`,
  'assist.week.days': '월,화,수,목,금,토,일',
  'assist.week.dayTitle': (v: { label: string; done: number; focus: number }) =>
    `${v.label}: 끝낸 일 ${v.done}개, 집중 ${koMin(v.focus)}`,
  'assist.week.friday': (v: { n: number }) => `이번 주엔 할 일 ${v.n}개 끝냈어. 주말 푹 쉬어!`,
  'assist.clash': (v: { time: string; title: string }) => `${v.time} "${v.title}" 일정과 시간이 겹쳐`,
  'assist.clash.badge': '겹침',
  'assist.clash.title': '다른 일정과 시간이 겹쳐',
};

export const en: Translation<typeof ko> = {
  'assist.step.open': (v: { title: string }) => `Steps for "${v.title}"`,
  'assist.step.button': 'Steps',
  'assist.step.add': 'Add a step',
  'assist.step.placeholder': 'Type a small step, press Enter',
  'assist.step.check': (v: { title: string }) => `Finish step: ${v.title}`,
  'assist.step.uncheck': (v: { title: string }) => `Undo step: ${v.title}`,
  'assist.step.remove': (v: { title: string }) => `Delete step: ${v.title}`,
  'assist.step.full': (v: { n: number }) => `Up to ${v.n} steps`,
  'assist.step.allDone': 'All steps done! Finish the to-do too?',
  'assist.step.finish': 'Finish',
  'assist.step.hint': 'Small steps make starting easy. Tick them off one by one',
  'assist.find.open': 'Find to-dos',
  'assist.find.placeholder': 'Search',
  'assist.find.clear': 'Clear search',
  'assist.find.none': 'No matching to-dos',
  'assist.tag.nav': 'Filter by tag',
  'assist.tag.all': 'All',
  'assist.next.step': (v: { title: string }) => `Next step: ${v.title}`,
  'assist.overdue.move': (v: { n: number }) => `Move ${v.n} overdue to today`,
  'assist.overdue.moved': (v: { n: number }) =>
    v.n === 1 ? 'Moved 1 overdue to-do to today' : `Moved ${v.n} overdue to-dos to today`,
  'assist.overdue.brief': 'Move overdue to today',
  'assist.defer.move': (v: { n: number }) => `Push ${v.n} undone to tomorrow`,
  'assist.defer.moved': (v: { n: number }) =>
    v.n === 1 ? 'Pushed 1 to-do to tomorrow' : `Pushed ${v.n} to-dos to tomorrow`,
  'assist.week.title': 'This week',
  'assist.week.summary': (v: { done: number; focus: number }) =>
    `${v.done} done${v.focus > 0 ? `, ${enMin(v.focus)} focused` : ''}`,
  'assist.week.vsLast': (v: { diff: number }) =>
    v.diff > 0
      ? `${v.diff} more than this time last week`
      : v.diff < 0
        ? `${-v.diff} fewer than this time last week. No rush`
        : 'Same as this time last week',
  'assist.week.dueSoon': (v: { n: number }) => `${v.n} due in the next 7 days`,
  'assist.week.days': 'M,T,W,T,F,S,S',
  'assist.week.dayTitle': (v: { label: string; done: number; focus: number }) =>
    `${v.label}: ${v.done} done, ${enMin(v.focus)} focused`,
  'assist.week.friday': (v: { n: number }) =>
    `You finished ${v.n} to-do${v.n === 1 ? '' : 's'} this week. Have a restful weekend!`,
  'assist.clash': (v: { time: string; title: string }) => `Overlaps with "${v.title}" at ${v.time}`,
  'assist.clash.badge': 'Overlap',
  'assist.clash.title': 'Overlaps with another event',
};
