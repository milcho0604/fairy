import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 짝꿍과 더 가까워지는 것들 (2026-10-11): 짝꿍이 아는 것, 첫 7일 여정, 성장과 철마다 옷, 주간 회고 카드.
// 값: name 펫 이름, value 알려 준 것, m 월, d 일, n 수, coins 코인, day 여정 몇째 날

type Name = { name: string };
type NV = { name: string; value: string };
type MD = { m: number; d: number };
type N = { n: number };
type Count = { n: number; max: number };
type Grow = { days: number; affection: number };

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const ko = {
  'bond.loading': '불러오는 중...',
  'bond.menu.knows': (v: Name) => `${withParticle(v.name, '이')} 아는 것`,

  // ---- 짝꿍이 아는 것 창 ----
  'bond.knows.title': (v: Name) => `${withParticle(v.name, '이')} 아는 것`,
  'bond.knows.intro': (v: Name) =>
    `${withParticle(v.name, '이')} 너에 대해 아는 걸 다 모아 뒀어. 이 컴퓨터에만 있고, 고치거나 잊게 할 수 있어.`,
  'bond.knows.facts': '내가 알려 준 것',
  'bond.knows.factsHint': (v: Name) =>
    `AI가 없어도 ${withParticle(v.name, '이')} 써. 생일엔 축하하고, 가끔 좋아하는 걸 말해 줘.`,
  'bond.knows.birthday': '생일',
  'bond.knows.birthdayForget': '생일 잊기',
  'bond.knows.month': '월',
  'bond.knows.day': '일',
  'bond.knows.monthN': (v: N) => `${v.n}월`,
  'bond.knows.dayN': (v: N) => `${v.n}일`,
  'bond.knows.date': (v: MD) => `${v.m}월 ${v.d}일`,
  'bond.knows.food': '좋아하는 간식',
  'bond.knows.foodPlaceholder': '예) 붕어빵',
  'bond.knows.likes': '좋아하는 것',
  'bond.knows.likePlaceholder': '예) 비 오는 날 산책',
  'bond.knows.likesFull': '좋아하는 것은 {max}개까지야. 하나 잊고 다시 해 줘',
  'bond.knows.tell': '알려 주기',
  'bond.knows.factSaved': '알려 줘서 고마워!',
  'bond.knows.factBad': '날짜를 다시 골라 줘',
  'bond.knows.memory': '기억하는 것',
  'bond.knows.count': (v: Count) => `${v.n}/${v.max}`,
  'bond.knows.memoryHint': 'AI에 질문할 때 같이 보내. 어디서 왔는지와 기억한 날이 붙어 있어.',
  'bond.knows.memoryEmpty': '아직 기억하는 게 없어. 아래에 적어 줘.',
  'bond.knows.rulesHint': '대화할 때 늘 지켜 줄 것. 한 줄이 하나야.',
  'bond.knows.rulesEmpty': '아직 규칙이 없어.',
  'bond.knows.rulePlaceholder': '예) 답은 세 줄 안으로',
  'bond.knows.ruleAdd': '더하기',
  'bond.knows.ruleDeleted': '규칙을 지웠어',
  'bond.knows.edit': '고치기',
  'bond.knows.editAria': (v: { text: string }) => `"${v.text}" 고치기`,
  'bond.knows.edited': '고쳤어',
  'bond.knows.save': '저장',
  'bond.knows.failed': '저장하지 못했어. 다시 해 줘',
  'bond.knows.forgetAll': '모두 잊기',
  'bond.knows.localOnly': '모두 이 컴퓨터에만 저장돼.',
  'bond.knows.forgetTitle': (v: Name) => `${withParticle(v.name, '이')} 다 잊을까?`,
  'bond.knows.forgetBody': '알려 준 것, 기억하는 것, 기억해도 될지 묻던 것을 모두 지워. 되돌릴 수 없어.',
  'bond.knows.forgetRules': '규칙도 지우기',
  'bond.knows.forgetYes': '모두 잊기',
  'bond.knows.forgotAll': '모두 잊었어',
  'bond.knows.fromSettings': '출처와 날짜, 생일과 좋아하는 것까지 한눈에 보고 고칠 수 있어.',
  'bond.knows.open': '모두 보기',
  'bond.src.chat': '대화',
  'bond.src.user': '직접',
  'bond.src.mcp': 'MCP',

  // ---- 알려 준 것으로 하는 말 (AI 없이) ----
  'bond.fact.birthday': (v: Name) =>
    `생일 축하해! 오늘은 ${withParticle(v.name, '이')} 하루 종일 옆에서 응원할게.`,
  'bond.fact.food.1': (v: NV) => `오늘 간식은 ${withParticle(v.value, '으로')} 어때? 좋아한다고 했잖아!`,
  'bond.fact.food.2': (v: NV) => `${v.value} 생각나지 않아? ${withParticle(v.name, '은')} 한 입만...!`,
  'bond.fact.like.1': (v: NV) => `${v.value} 좋아한다고 했지? ${withParticle(v.name, '이')} 기억하고 있어.`,
  'bond.fact.like.2': (v: NV) => `오늘은 ${v.value} 생각하면서 힘내 보자!`,
  // AI 에 같이 보내는 줄
  'bond.fact.ai.birthday': (v: MD) => `내 생일은 ${v.m}월 ${v.d}일이야`,
  'bond.fact.ai.food': (v: { value: string }) => `좋아하는 간식: ${v.value}`,
  'bond.fact.ai.like': (v: { value: string }) => `좋아하는 것: ${v.value}`,

  // ---- 첫 7일 여정 ----
  'bond.journey.title': (v: { day: number }) => `첫 7일 여정, ${v.day}일째`,
  'bond.journey.skip': '그만 보기',
  'bond.journey.skipSure': '정말 그만 볼까?',
  'bond.journey.progress': (v: N) => `7개 중 ${v.n}개 해 봄`,
  'bond.journey.try': '해 보기',
  'bond.journey.go': '해 볼래',
  'bond.journey.later': '나중에',
  'bond.journey.restToday': (v: Name) =>
    `오늘 몫은 다 했어! 내일 ${withParticle(v.name, '이')} 하나 더 알려 줄게.`,
  'bond.journey.allDone': (v: { name: string; coins: number }) =>
    `일곱 가지 다 해 봤어! 코인 ${v.coins}개 모았어. ${withParticle(v.name, '이')} 자랑스러워.`,
  'bond.journey.reward': (v: { what: string; coins: number }) =>
    `${withParticle(v.what, '을')} 해 봤네! 코인 ${v.coins}개 줄게.`,
  'bond.journey.finished': (v: { name: string; coins: number }) =>
    `첫 7일 여정 끝! 코인 ${v.coins}개 더. ${withParticle(v.name, '은')} 이제 네 단짝이야.`,
  'bond.journey.step.quick': '빠른 입력',
  'bond.journey.step.focus': '집중 25분',
  'bond.journey.step.note': '메모',
  'bond.journey.step.event': '일정',
  'bond.journey.step.maker': '펫 만들기',
  'bond.journey.step.look': '같이 보기',
  'bond.journey.step.week': '주간 돌아보기',
  'bond.journey.hint.quick': () => '단축키 하나로 어디서든 할 일을 넣어.',
  'bond.journey.hint.focus': (v: Name) => `25분 동안 ${withParticle(v.name, '은')} 옆에서 조용히 잘게.`,
  'bond.journey.hint.note': () => '떠오른 걸 메모 탭에 적어 둬.',
  'bond.journey.hint.event': () => '"내일 3시 치과"처럼 적으면 일정이 돼.',
  'bond.journey.hint.maker': () => '사진 한 장으로 새 펫을 만들 수 있어.',
  'bond.journey.hint.look': () => '화면 한 곳을 같이 보고 물어봐.',
  'bond.journey.hint.week': () => '이번 주를 카드 한 장으로 돌아봐.',
  'bond.journey.nudge.quick': (v: Name) =>
    `오늘은 빠른 입력 해 볼래? 어디서든 단축키로 할 일을 ${withParticle(v.name, '이')}한테 넘길 수 있어.`,
  'bond.journey.nudge.focus': (v: Name) =>
    `오늘은 25분만 같이 집중해 볼까? ${withParticle(v.name, '은')} 옆에서 조용히 있을게.`,
  'bond.journey.nudge.note': () => '생각난 거 있으면 메모로 남겨 볼래? 나중에 같이 찾아 줄게.',
  'bond.journey.nudge.event': () => '일정 하나 넣어 볼래? 시간 되기 전에 살짝 알려 줄게.',
  'bond.journey.nudge.maker': () => '좋아하는 사진으로 펫을 만들어 볼래? 나도 궁금해!',
  'bond.journey.nudge.look': () => '화면에서 모르는 거 있으면 같이 보자. 내가 돋보기 들고 갈게.',
  'bond.journey.nudge.week': () => '이번 주 어땠는지 같이 돌아볼래? 카드로 예쁘게 만들어 줄게.',
  'bond.journey.state.done': '해 봄',
  'bond.journey.state.now': '오늘',
  'bond.journey.state.open': '열림',
  'bond.journey.state.later': '아직',

  // ---- 성장과 철마다 옷 ----
  'bond.grow.section': '자라는 모습과 옷',
  'bond.grow.stage.baby': '아기',
  'bond.grow.stage.kid': '어린이',
  'bond.grow.stage.adult': '어른',
  'bond.grow.now': (v: { stage: string; days: number }) => `지금은 ${v.stage}야. 함께한 지 ${v.days}일째`,
  'bond.grow.nextKid': (v: Grow) =>
    v.days > 0 && v.affection > 0
      ? `어린이까지 ${v.days}일, 또는 친밀도 ${v.affection} 더`
      : '곧 어린이가 될 거야',
  'bond.grow.nextAdult': (v: Grow) =>
    v.days > 0 && v.affection > 0
      ? `어른까지 ${v.days}일과 친밀도 ${v.affection} 더`
      : v.days > 0
        ? `어른까지 ${v.days}일 더`
        : v.affection > 0
          ? `어른까지 친밀도 ${v.affection} 더`
          : '곧 어른이 될 거야',
  'bond.grow.grown': '다 자랐어. 한 번 자라면 다시 작아지지 않아.',
  'bond.grow.photo': '사진 펫은 그대로야. 기본 펫일 때 자라는 모습과 옷이 보여.',
  'bond.grow.kid': (v: Name) => `${withParticle(v.name, '이')} 조금 자랐어! 이제 어린이야.`,
  'bond.grow.adult': (v: Name) => `${withParticle(v.name, '이')} 다 컸어! 같이 지내 줘서 고마워.`,
  'bond.wear.toggle': '철마다 옷 입기',
  'bond.wear.hint': (v: { today: string }) =>
    `봄엔 꽃, 여름엔 밀짚모자, 가을엔 목도리, 겨울엔 털모자. 설날, 추석, 크리스마스엔 특별한 옷. 오늘은 ${v.today}.`,
  'bond.wear.outfit.flower': '봄 꽃',
  'bond.wear.outfit.straw': '밀짚모자',
  'bond.wear.outfit.scarf': '가을 목도리',
  'bond.wear.outfit.beanie': '털모자',
  'bond.wear.outfit.ribbon': '명절 댕기 리본',
  'bond.wear.outfit.santa': '산타 모자',

  // ---- 주간 회고 카드 ----
  'bond.week.make': '카드로 만들기',
  'bond.week.title': '이번 주 카드',
  'bond.week.cardTitle': (v: Name) => `${v.name}의 이번 주`,
  'bond.week.range': (v: { from: string; to: string }) => `${v.from} ~ ${v.to}`,
  'bond.week.done': '끝낸 일',
  'bond.week.focus': '집중 시간',
  'bond.week.streak': '연속 기록',
  'bond.week.hm': (v: { h: number; m: number }) => (v.m ? `${v.h}시간 ${v.m}분` : `${v.h}시간`),
  'bond.week.m': (v: { m: number }) => `${v.m}분`,
  'bond.week.days': (v: N) => `${v.n}일`,
  'bond.week.diary': (v: Name) => `${v.name}의 한 줄 일기`,
  'bond.week.noDiary': (v: Name) => `이번 주도 ${withParticle(v.name, '이')} 옆에 있었어.`,
  'bond.week.titles': '이번 주 끝낸 일',
  'bond.week.footer': '짝꿍과 함께한 한 주',
  'bond.week.withTitles': '할 일 제목 넣기',
  'bond.week.titlesOff': '할 일 제목은 넣지 않았어. 숫자와 펫만 들어가.',
  'bond.week.titlesOn': '이번 주 끝낸 일 제목이 들어가. 올리기 전에 한 번 봐 줘.',
  'bond.week.save': 'PNG로 저장',
  'bond.week.close': '닫기',
  'bond.week.saved': '카드를 저장했어!',
  'bond.week.saveFailed': '저장하지 못했어. 다시 해 줘',
  'bond.week.saveTitle': '이번 주 카드 저장',
  'bond.week.filePrefix': '짝꿍-이번주',
  'bond.week.alt': (v: { name: string; done: number }) => `${v.name}의 이번 주 카드. 끝낸 일 ${v.done}개`,
};

export const en: Translation<typeof ko> = {
  'bond.loading': 'Loading...',
  'bond.menu.knows': (v: Name) => `What ${v.name} knows`,

  'bond.knows.title': (v: Name) => `What ${v.name} knows`,
  'bond.knows.intro': (v: Name) =>
    `Everything ${v.name} knows about you, in one place. It stays on this computer, and you can edit or forget any of it.`,
  'bond.knows.facts': 'Things you told me',
  'bond.knows.factsHint': (v: Name) =>
    `${v.name} uses these even without AI: a birthday cheer, and a word about your favorites now and then.`,
  'bond.knows.birthday': 'Birthday',
  'bond.knows.birthdayForget': 'Forget birthday',
  'bond.knows.month': 'Month',
  'bond.knows.day': 'Day',
  'bond.knows.monthN': (v: N) => new Date(2024, v.n - 1, 1).toLocaleDateString('en-US', { month: 'long' }),
  'bond.knows.dayN': (v: N) => String(v.n),
  'bond.knows.date': (v: MD) =>
    new Date(2024, v.m - 1, v.d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
  'bond.knows.food': 'Favorite snack',
  'bond.knows.foodPlaceholder': 'e.g. Fish-shaped bread',
  'bond.knows.likes': 'Things you like',
  'bond.knows.likePlaceholder': 'e.g. Walks in the rain',
  'bond.knows.likesFull': 'Up to {max} things. Forget one and try again',
  'bond.knows.tell': 'Tell',
  'bond.knows.factSaved': 'Thanks for telling me!',
  'bond.knows.factBad': 'Please pick the date again',
  'bond.knows.memory': 'Things I remember',
  'bond.knows.count': (v: Count) => `${v.n}/${v.max}`,
  'bond.knows.memoryHint': 'Sent along with your AI questions. Each shows where it came from and when.',
  'bond.knows.memoryEmpty': 'Nothing yet. Write one below.',
  'bond.knows.rulesHint': 'What to always follow in chats. One per line.',
  'bond.knows.rulesEmpty': 'No rules yet.',
  'bond.knows.rulePlaceholder': 'e.g. Keep answers under three lines',
  'bond.knows.ruleAdd': 'Add',
  'bond.knows.ruleDeleted': 'Rule removed',
  'bond.knows.edit': 'Edit',
  'bond.knows.editAria': (v: { text: string }) => `Edit "${v.text}"`,
  'bond.knows.edited': 'Updated',
  'bond.knows.save': 'Save',
  'bond.knows.failed': "Couldn't save. Please try again",
  'bond.knows.forgetAll': 'Forget everything',
  'bond.knows.localOnly': 'All of this is saved only on this computer.',
  'bond.knows.forgetTitle': (v: Name) => `Should ${v.name} forget everything?`,
  'bond.knows.forgetBody':
    'This clears what you told me, what I remember, and what I asked to remember. It cannot be undone.',
  'bond.knows.forgetRules': 'Clear rules too',
  'bond.knows.forgetYes': 'Forget everything',
  'bond.knows.forgotAll': 'Forgot everything',
  'bond.knows.fromSettings':
    'See where each memory came from, plus your birthday and favorites, all in one place.',
  'bond.knows.open': 'See all',
  'bond.src.chat': 'Chat',
  'bond.src.user': 'You',
  'bond.src.mcp': 'MCP',

  'bond.fact.birthday': (v: Name) => `Happy birthday! ${v.name} is cheering for you all day today.`,
  'bond.fact.food.1': (v: NV) => `How about ${v.value} for a snack today? You said it's your favorite!`,
  'bond.fact.food.2': (v: NV) => `Thinking about ${v.value}? ${v.name} wants just one bite...!`,
  'bond.fact.like.1': (v: NV) => `You love ${v.value}, right? ${v.name} remembers.`,
  'bond.fact.like.2': (v: NV) => `Let's think of ${v.value} and keep going today!`,
  'bond.fact.ai.birthday': (v: MD) =>
    `My birthday is ${new Date(2024, v.m - 1, v.d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`,
  'bond.fact.ai.food': (v: { value: string }) => `Favorite snack: ${v.value}`,
  'bond.fact.ai.like': (v: { value: string }) => `Likes: ${v.value}`,

  'bond.journey.title': (v: { day: number }) => `First 7 days, day ${v.day}`,
  'bond.journey.skip': 'Hide',
  'bond.journey.skipSure': 'Really hide?',
  'bond.journey.progress': (v: N) => `${v.n} of 7 tried`,
  'bond.journey.try': 'Try it',
  'bond.journey.go': "Let's try",
  'bond.journey.later': 'Later',
  'bond.journey.restToday': (v: Name) => `All done for today! ${v.name} will show you one more tomorrow.`,
  'bond.journey.allDone': (v: { name: string; coins: number }) =>
    `You tried all seven and earned ${v.coins} coins! ${v.name} is so proud.`,
  'bond.journey.reward': (v: { what: string; coins: number }) =>
    `You tried ${v.what}! Here ${s(v.coins, 'is', 'are')} ${v.coins} ${s(v.coins, 'coin', 'coins')}.`,
  'bond.journey.finished': (v: { name: string; coins: number }) =>
    `First 7 days complete! ${v.coins} more ${s(v.coins, 'coin', 'coins')}. ${v.name} is your buddy now.`,
  'bond.journey.step.quick': 'Quick add',
  'bond.journey.step.focus': '25-min focus',
  'bond.journey.step.note': 'Notes',
  'bond.journey.step.event': 'Events',
  'bond.journey.step.maker': 'Make a pet',
  'bond.journey.step.look': 'Look together',
  'bond.journey.step.week': 'Week review',
  'bond.journey.hint.quick': () => 'Add a to-do from anywhere with one shortcut.',
  'bond.journey.hint.focus': (v: Name) => `${v.name} naps quietly next to you for 25 minutes.`,
  'bond.journey.hint.note': () => 'Jot down whatever pops into your head in Notes.',
  'bond.journey.hint.event': () => 'Write "dentist tomorrow 3pm" and it becomes an event.',
  'bond.journey.hint.maker': () => 'Turn one photo into a brand new pet.',
  'bond.journey.hint.look': () => 'Pick a spot on screen and ask about it together.',
  'bond.journey.hint.week': () => 'Look back on your week as one cute card.',
  'bond.journey.nudge.quick': (v: Name) =>
    `Want to try quick add today? Hand ${v.name} a to-do from anywhere with a shortcut.`,
  'bond.journey.nudge.focus': (v: Name) =>
    `Focus together for just 25 minutes today? ${v.name} will stay quiet.`,
  'bond.journey.nudge.note': () => "Got a thought? Save it as a note and I'll help you find it later.",
  'bond.journey.nudge.event': () => "Add one event? I'll give you a little heads-up before it starts.",
  'bond.journey.nudge.maker': () => "Make a pet from a favorite photo? I'm curious too!",
  'bond.journey.nudge.look': () =>
    "Stuck on something on screen? Let's look together. I'll bring my magnifier.",
  'bond.journey.nudge.week': () => "Look back on your week together? I'll make it into a pretty card.",
  'bond.journey.state.done': 'tried',
  'bond.journey.state.now': 'today',
  'bond.journey.state.open': 'open',
  'bond.journey.state.later': 'not yet',

  'bond.grow.section': 'Growing up and outfits',
  'bond.grow.stage.baby': 'a baby',
  'bond.grow.stage.kid': 'a kid',
  'bond.grow.stage.adult': 'all grown up',
  'bond.grow.now': (v: { stage: string; days: number }) => `Right now: ${v.stage}. Day ${v.days} together`,
  'bond.grow.nextKid': (v: Grow) =>
    v.days > 0 && v.affection > 0
      ? `${v.days} more ${s(v.days, 'day', 'days')} or ${v.affection} more affection to become a kid`
      : 'Almost a kid',
  'bond.grow.nextAdult': (v: Grow) =>
    v.days > 0 && v.affection > 0
      ? `${v.days} more ${s(v.days, 'day', 'days')} and ${v.affection} more affection to grow up`
      : v.days > 0
        ? `${v.days} more ${s(v.days, 'day', 'days')} to grow up`
        : v.affection > 0
          ? `${v.affection} more affection to grow up`
          : 'Almost grown up',
  'bond.grow.grown': "All grown up. Once they grow, they don't shrink back.",
  'bond.grow.photo': 'Photo pets stay as they are. Growing up and outfits show on the built-in pets.',
  'bond.grow.kid': (v: Name) => `${v.name} grew a little! Now a kid.`,
  'bond.grow.adult': (v: Name) => `${v.name} is all grown up! Thanks for being together.`,
  'bond.wear.toggle': 'Seasonal outfits',
  'bond.wear.hint': (v: { today: string }) =>
    `Flowers in spring, a straw hat in summer, a scarf in autumn, a knit hat in winter, and something special for Seollal, Chuseok and Christmas. Today: ${v.today}.`,
  'bond.wear.outfit.flower': 'a spring flower',
  'bond.wear.outfit.straw': 'a straw hat',
  'bond.wear.outfit.scarf': 'an autumn scarf',
  'bond.wear.outfit.beanie': 'a knit hat',
  'bond.wear.outfit.ribbon': 'a holiday ribbon',
  'bond.wear.outfit.santa': 'a Santa hat',

  'bond.week.make': 'Make a card',
  'bond.week.title': 'Your week card',
  'bond.week.cardTitle': (v: Name) => `${v.name}'s week`,
  'bond.week.range': (v: { from: string; to: string }) => `${v.from} to ${v.to}`,
  'bond.week.done': 'Done',
  'bond.week.focus': 'Focus',
  'bond.week.streak': 'Streak',
  'bond.week.hm': (v: { h: number; m: number }) => (v.m ? `${v.h}h ${v.m}m` : `${v.h}h`),
  'bond.week.m': (v: { m: number }) => `${v.m}m`,
  'bond.week.days': (v: N) => `${v.n} ${s(v.n, 'day', 'days')}`,
  'bond.week.diary': (v: Name) => `${v.name}'s one-line diary`,
  'bond.week.noDiary': (v: Name) => `${v.name} was right here with you all week.`,
  'bond.week.titles': 'Done this week',
  'bond.week.footer': 'A week with Jjakkung',
  'bond.week.withTitles': 'Include to-do titles',
  'bond.week.titlesOff': 'To-do titles are left out. Only numbers and your pet.',
  'bond.week.titlesOn': "This week's finished to-do titles are included. Check before sharing.",
  'bond.week.save': 'Save as PNG',
  'bond.week.close': 'Close',
  'bond.week.saved': 'Card saved!',
  'bond.week.saveFailed': "Couldn't save. Please try again",
  'bond.week.saveTitle': 'Save your week card',
  'bond.week.filePrefix': 'jjakkung-week',
  'bond.week.alt': (v: { name: string; done: number }) => `${v.name}'s week card. ${v.done} done`,
};
