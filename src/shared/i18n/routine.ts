import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 만나는 시간 (맞이, 헤어짐, 쉬는 날, 설정과 첫 실행 안내). 여러 말 중 하나는 날짜로 고른 i 로 (같은 날은 같은 말)
const one = (list: readonly string[], i: number) => list[Number(i) % list.length] ?? list[0] ?? '';

export const ko = {
  'routine.hi.first': '만나는 첫날이야! 앞으로 이 시간마다 기다릴게.',
  'routine.hi.early': (v: { i: number }) =>
    one(['일찍 왔네! 오늘도 반가워.', '벌써 왔어? 부지런하다!', '와, 일찍 왔다! 같이 시작하자.'], v.i),
  'routine.hi.onTime': (v: { i: number }) =>
    one(['딱 맞춰 왔네! 오늘도 반가워.', '시간 딱 맞췄다! 반가워.', '딱 이 시간이야! 왔구나.'], v.i),
  'routine.hi.late': (v: { i: number }) =>
    one(['기다렸어! 오늘도 만나서 반가워.', '왔다! 계속 기다리고 있었어.', '드디어 왔네! 기다렸어.'], v.i),
  'routine.streak': (v: { n: number }) => `${v.n}일째 만나는 중!`,
  'routine.coins': (v: { n: number }) => `만난 기념 코인 ${v.n}개!`,
  'routine.coinsBonus': (v: { days: number; n: number }) => `${v.days}일 연속 만난 기념으로 코인 ${v.n}개!`,
  'routine.cue': '시작할 시간이야! 오늘도 같이 힘내자.',
  'routine.bye.head': (v: { i: number }) =>
    one(['오늘 수고했어!', '오늘도 고생 많았어!', '오늘 하루 끝!'], v.i),
  'routine.bye.doneOne': '"{title}" 끝낸 거 멋졌어.',
  'routine.bye.doneMany': (v: { n: number }) => `할 일 ${v.n}개나 끝냈어.`,
  'routine.bye.tomorrowFirst': '내일은 {time} {title}부터야.',
  'routine.bye.tomorrowAllDay': '내일은 종일 {list}.',
  'routine.bye.tomorrowMeet': '내일 {time}에 또 만나!',
  'routine.bye.nextMeet': '다음에 만나는 날은 {weekday}이야. 푹 쉬어!',
  'routine.bye.rest': '푹 쉬어!',
  'routine.rest': (v: { i: number }) =>
    one(
      [
        '오늘은 쉬는 날이네! 푹 쉬어.',
        '쉬는 날인데 왔네? 오늘은 느긋하게 하자.',
        '오늘은 쉬는 날! 무리하지 마.',
        '쉬는 날이다! 오늘은 천천히 놀자.',
      ],
      v.i,
    ),
  // 설정
  'routine.set.title': '만나는 시간',
  'routine.set.on': (v: { name: string }) => `${withParticle(v.name, '과')} 만나는 시간 정하기`,
  'routine.set.onHint':
    '일을 시작하는 시간에 반갑게 맞이하고 오늘 브리핑을 보여 줘. 헤어지는 시간엔 수고했다고 인사해. 끄면 컴퓨터를 켤 때 인사해.',
  'routine.set.days': '만나는 요일',
  'routine.set.daysAria': '만나는 요일',
  'routine.set.start': '만나는 시간',
  'routine.set.end': '헤어지는 시간',
  'routine.set.overnight': '다음 날 헤어져',
  'routine.set.same': '같은 시간',
  'routine.set.each': '요일마다',
  'routine.set.timesAria': '시간 정하는 방법',
  'routine.set.noDays': '요일을 하나도 안 고르면 매일 쉬는 날이야.',
  'routine.set.restNote': '다른 요일은 쉬는 날이라 조용히 한마디만 해.',
  'routine.set.reviewNote': '만난 날은 하루 회고를 헤어질 때 같이 해.',
  'routine.set.sameTime': '만나는 시간과 헤어지는 시간이 같으면 정할 수 없어.',
  // 첫 실행 안내
  'routine.onb.title': (v: { name: string }) => `${withParticle(v.name, '과')} 만나는 시간`,
  'routine.onb.lead':
    '일을 시작하는 시간을 알려 주면 그때 반갑게 맞이하고 오늘 할 일을 알려 줄게. 끝날 땐 수고했다고 인사할게.',
  'routine.onb.set': '시간 정하기',
  'routine.onb.setHint': '요일과 시간을 정해',
  'routine.onb.free': '켤 때마다 인사',
  'routine.onb.freeHint': '정한 시간 없이',
  'routine.onb.later': '설정에서 언제든 바꿀 수 있어.',
};

export const en: Translation<typeof ko> = {
  'routine.hi.first': "Our first meeting day! I'll be waiting at this time from now on.",
  'routine.hi.early': (v: { i: number }) =>
    one(
      ["You're early! Good to see you.", 'Already here? Look at you go!', "Ooh, early! Let's get started."],
      v.i,
    ),
  'routine.hi.onTime': (v: { i: number }) =>
    one(['Right on time! Good to see you.', 'Perfect timing! Hi!', "It's time, and here you are!"], v.i),
  'routine.hi.late': (v: { i: number }) =>
    one(
      [
        'I was waiting for you! Good to see you.',
        "You're here! I've been waiting.",
        'Finally! I missed you.',
      ],
      v.i,
    ),
  'routine.streak': (v: { n: number }) => `Day ${v.n} in a row!`,
  'routine.coins': (v: { n: number }) => `+${v.n} coins for showing up!`,
  'routine.coinsBonus': (v: { days: number; n: number }) => `${v.days} days in a row, so +${v.n} coins!`,
  'routine.cue': "It's time to start! Let's do our best today.",
  'routine.bye.head': (v: { i: number }) =>
    one(['Great work today!', 'You did a lot today!', "That's a wrap!"], v.i),
  'routine.bye.doneOne': 'Finishing "{title}" was awesome.',
  'routine.bye.doneMany': (v: { n: number }) => `You finished ${v.n} to-dos!`,
  'routine.bye.tomorrowFirst': 'Tomorrow starts with {title} at {time}.',
  'routine.bye.tomorrowAllDay': 'All day tomorrow: {list}.',
  'routine.bye.tomorrowMeet': 'See you tomorrow at {time}!',
  'routine.bye.nextMeet': 'See you on {weekday}. Rest well!',
  'routine.bye.rest': 'Rest well!',
  'routine.rest': (v: { i: number }) =>
    one(
      [
        "It's your day off! Take it easy.",
        "Day off and you're here? Let's keep it slow today.",
        "Day off! Don't push yourself.",
        "It's a day off! Let's take it slow.",
      ],
      v.i,
    ),
  'routine.set.title': 'Meeting time',
  'routine.set.on': (v: { name: string }) => `Set a meeting time with ${v.name}`,
  'routine.set.onHint':
    "I'll greet you when you start work and show today's briefing. When you're done, I'll say goodbye. Off: I greet you when the computer starts.",
  'routine.set.days': 'Meeting days',
  'routine.set.daysAria': 'Meeting days',
  'routine.set.start': 'Meet at',
  'routine.set.end': 'Part at',
  'routine.set.overnight': 'Ends the next day',
  'routine.set.same': 'Same time',
  'routine.set.each': 'Per day',
  'routine.set.timesAria': 'How to set times',
  'routine.set.noDays': 'With no days picked, every day is a day off.',
  'routine.set.restNote': "Other days are days off. I'll just say a quiet hello.",
  'routine.set.reviewNote': 'On days we meet, the daily review comes with the goodbye.',
  'routine.set.sameTime': "Meet and part times can't be the same.",
  'routine.onb.title': (v: { name: string }) => `When to meet ${v.name}`,
  'routine.onb.lead':
    "Tell me when you start work and I'll greet you then with today's to-dos. When you're done, I'll say goodbye.",
  'routine.onb.set': 'Pick a time',
  'routine.onb.setHint': 'Choose days and hours',
  'routine.onb.free': 'Greet on start',
  'routine.onb.freeHint': 'No set time',
  'routine.onb.later': 'You can change this in Settings anytime.',
};
