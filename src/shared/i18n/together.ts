import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 같이 지내는 느낌 (2026-10-11): 같이 타자 치기, 같이 일하는 표정, 매일 쪽지 (shared/together.ts, daily-note.ts),
// 쪽지 줄은 성격(p: friend, polite, tsundere, calm)을 받아 그 말투로 쓴다. 모르는 성격이면 다정한 친구

type Voice<T> = { friend: T; polite: T; tsundere: T; calm: T };
const P = <T>(p: unknown, m: Voice<T>): T => m[p as keyof Voice<T>] ?? m.friend;
/** 같은 성격 안에서도 날마다 조금 다르게 (v: 1, 2, 3) */
const V = (v: unknown, list: readonly string[]): string => list[(Number(v) || 1) - 1] ?? list[0] ?? '';

type Pv = { p: string; v?: number };
type Name = { p: string; name: string; v?: number };
type N = { p: string; n: number; v?: number };
type Ev = { p: string; time: string; title: string };
type Habit = { p: string; title: string; n: number };
type Val = { p: string; value: string };
type Season = { p: string; s: number; v: number };
type Coins = { p: string; coins: number };

const SEASON_KO = [
  ['봄바람이 살랑해.', '꽃이 피는 철이야.'],
  ['해가 길어졌어.', '덥지? 물 자주 마셔.'],
  ['하늘이 높아졌어.', '선선한 바람이 좋은 철이야.'],
  ['바람이 차가워졌어.', '따뜻하게 입고 다녀.'],
];
const SEASON_POLITE = [
  ['봄바람이 살랑이는 날이에요.', '꽃이 피는 철이에요.'],
  ['해가 많이 길어졌어요.', '더운 날엔 물을 자주 드세요.'],
  ['하늘이 높아졌어요.', '선선한 바람이 좋은 철이에요.'],
  ['바람이 차가워졌어요.', '따뜻하게 입고 다니세요.'],
];
const SEASON_EN = [
  ['Spring breeze is in the air.', 'Flowers are blooming.'],
  ['The days are long now.', 'Hot out there, drink lots of water.'],
  ['The sky feels so high today.', 'Cool autumn air is the best.'],
  ['The wind got chilly.', 'Bundle up and stay warm.'],
];
const SEASON_EN_POLITE = [
  ['The spring breeze is lovely these days.', "It's flower season."],
  ['The days have grown long.', 'Please stay hydrated in the heat.'],
  ['The autumn sky is high and clear.', "It's a pleasant, cool season."],
  ['The wind has turned cold.', 'Please dress warmly.'],
];
const seasonLine = (table: string[][], s: number, v: number) =>
  table[s]?.[(Number(v) || 1) - 1] ?? table[0]?.[0] ?? '';

export const ko = {
  // ---- 설정, 메뉴 ----
  'settings.typeAlong': '같이 타자 치기',
  'settings.typeAlongHint':
    '내가 키보드를 치는 동안 페어리가 작은 키보드를 같이 두드려. 무슨 키를 눌렀는지는 읽지 않고 입력이 있는지만 봐. 배터리 절약 중에는 쉬어.',
  'settings.dailyNotes': '매일 쪽지',
  'settings.dailyNotesHint':
    '하루 한 번, 9시 뒤 처음 자리에 있을 때 페어리가 쪽지를 들고 와. 이 컴퓨터의 기록으로만 써. 함께한 7일, 30일, 100일, 1년에는 특별한 편지.',
  'pet.menu.typeAlong': '같이 타자 치기',

  // ---- 같이 일하는 표정 ----
  'together.work': (v: Pv) =>
    P(v.p, {
      friend: '같이 하자! 옆에서 도울게.',
      polite: '함께 하겠습니다. 옆에서 돕고 있을게요.',
      tsundere: '흥, 혼자는 못 하겠지? 같이 해 줄게.',
      calm: '같이 하자. 천천히, 하나씩 해 보자.',
    }),

  // ---- 쪽지 배달 ----
  'note.bring': (v: Name) =>
    P(v.p, {
      friend: `쪽지 가져왔어! 나를 누르면 펼쳐 볼 수 있어.`,
      polite: `쪽지를 가져왔어요. 저를 누르시면 펼쳐 보실 수 있어요.`,
      tsundere: `이거... 쪽지야. 읽든 말든 알아서 해. 나 누르면 돼.`,
      calm: `쪽지를 하나 써 왔어. 나를 누르면 펼쳐 볼 수 있어.`,
    }),
  'note.bringLetter': (v: Name) =>
    P(v.p, {
      friend: `오늘은 특별한 편지야! 나를 눌러서 열어 봐.`,
      polite: `오늘은 특별한 편지를 준비했어요. 저를 눌러 열어 보세요.`,
      tsundere: `오늘은... 편지야. 특별한 거 아니거든? 눌러 봐.`,
      calm: `오늘은 특별한 날이라 편지를 썼어. 나를 눌러 열어 봐.`,
    }),
  'note.openNow': '펼쳐 보기',
  'note.later': '이따가',
  'note.thanks': '고마워',
  'note.toBox': '쪽지함',
  'note.title': (v: { m: number; d: number }) => `${v.m}월 ${v.d}일 쪽지`,
  // 1년(365일), 2년(730일)... 은 해로 센다. 날 수는 제목에만 (편지 첫 줄이 같은 수를 되풀이하지 않게)
  'note.letterTitle': (v: { n: number }) =>
    v.n >= 365 && v.n % 365 === 0 ? `함께한 ${v.n / 365}년 편지` : `함께한 ${v.n}일 편지`,

  // ---- 쪽지함 (오늘 탭) ----
  'note.box': '쪽지함',
  'note.boxUnread': (v: { n: number }) => `안 읽은 쪽지 ${v.n}`,
  'note.boxEmpty': '아직 쪽지가 없어. 내일 아침에 하나 들고 올게.',
  'note.boxOff': '매일 쪽지가 꺼져 있어. 설정의 페어리 탭에서 켤 수 있어.',
  'note.boxMore': (v: { n: number }) => `지난 쪽지 ${v.n}통 더 보기`,
  'note.boxLess': '접기',
  'note.new': '새 쪽지',

  // ---- 쪽지 줄 (성격 말투) ----
  'note.open': (v: Name) =>
    P(v.p, {
      friend: V(v.v, ['좋은 아침! 오늘도 반가워.', '안녕, 나 왔어!', '오늘도 같이 힘내 보자!']),
      polite: V(v.v, [
        '좋은 아침이에요. 오늘도 반가워요.',
        '안녕하세요, 오늘 쪽지예요.',
        '오늘 하루도 잘 부탁드려요.',
      ]),
      tsundere: V(v.v, ['딱히 쓰고 싶어서 쓴 건 아니야.', '흥, 오늘도 왔네.', '읽어 주면... 조금 기쁠지도.']),
      calm: V(v.v, [
        '좋은 아침. 오늘 하루를 같이 열어 보자.',
        '안녕. 잠깐 숨 고르고 읽어 줘.',
        '오늘도 천천히 가 보자.',
      ]),
    }),
  'note.yesterday': (v: N) =>
    P(v.p, {
      friend: `어제 할 일 ${v.n}개나 끝냈더라. 멋졌어!`,
      polite: `어제 할 일 ${v.n}개를 끝내셨어요. 정말 수고하셨어요.`,
      tsundere: `어제 ${v.n}개 끝낸 거, 봤어. ...잘했네.`,
      calm: `어제 ${v.n}개를 끝냈어. 하나씩 해 낸 게 쌓인 거야.`,
    }),
  'note.yesterdayNone': (v: Pv) =>
    P(v.p, {
      friend: '어제는 쉬어 가는 날이었지? 그런 날도 필요해.',
      polite: '어제는 쉬어 가는 날이었네요. 그런 날도 필요해요.',
      tsundere: '어제는 좀 쉬었더라? 뭐, 오늘 하면 되지.',
      calm: '어제 쉰 것도 일의 일부야. 오늘은 작은 것부터.',
    }),
  'note.event': (v: Ev) =>
    P(v.p, {
      friend: `오늘 첫 일정은 ${v.time} ${v.title}! 잊지 마.`,
      polite: `오늘은 ${v.time}에 ${withParticle(v.title, '으로')} 하루를 시작해요.`,
      tsundere: `${v.time}에 ${withParticle(v.title, '이')} 있거든? 늦지 마.`,
      calm: `오늘은 ${v.time} ${withParticle(v.title, '으로')} 시작해. 미리 준비해 두자.`,
    }),
  'note.eventAllDay': (v: Ev) =>
    P(v.p, {
      friend: `오늘은 종일 ${v.title}! 기억해 둬.`,
      polite: `오늘은 종일 ${withParticle(v.title, '이')} 있어요. 잊지 마세요.`,
      tsundere: `오늘 종일 ${withParticle(v.title, '이다')}잖아. 까먹지 마.`,
      calm: `오늘은 종일 ${v.title}. 무리하지 말고 챙기자.`,
    }),
  'note.habit': (v: Habit) =>
    P(v.p, {
      friend: `${v.title}, ${v.n}일째 이어 가는 중! 오늘도 하자.`,
      polite: `${v.title}, ${v.n}일째 이어 가고 계세요. 오늘도 응원해요.`,
      tsundere: `${v.title} ${v.n}일 연속이라며? 여기서 끊으면 아깝다.`,
      calm: `${v.title} ${v.n}일째. 매일 조금씩이 제일 단단해.`,
    }),
  'note.birthday': (v: Pv) =>
    P(v.p, {
      friend: '오늘 생일이지? 생일 축하해! 오늘은 네가 주인공이야.',
      polite: '오늘 생일이시죠? 정말 축하드려요!',
      tsundere: '생일인 거 다 알거든. ...축하해. 진심이야.',
      calm: '생일 축하해. 한 해 동안 정말 잘 지내 왔어.',
    }),
  'note.food': (v: Val) =>
    P(v.p, {
      friend: `오늘 ${withParticle(v.value, '이랑')} 같이 쉬는 시간 어때?`,
      polite: `오늘은 좋아하시는 ${v.value} 드시면서 쉬어 가세요.`,
      tsundere: `${v.value} 좋아하잖아. 오늘 하나 먹어. 내가 허락할게.`,
      calm: `잘 먹는 것도 중요해. 오늘 ${v.value} 어때?`,
    }),
  'note.like': (v: Val) =>
    P(v.p, {
      friend: `${withParticle(v.value, '을')} 좋아한다고 했지? 나도 궁금해!`,
      polite: `${withParticle(v.value, '을')} 좋아하신다고 하셨죠. 오늘 잠깐 즐겨 보세요.`,
      tsundere: `${v.value} 얘기, 아직 기억하고 있거든.`,
      calm: `좋아하는 ${v.value}에 잠깐 시간을 써도 좋아.`,
    }),
  'note.season': (v: Season) =>
    P(v.p, {
      friend: seasonLine(SEASON_KO, v.s, v.v),
      polite: seasonLine(SEASON_POLITE, v.s, v.v),
      tsundere: `${seasonLine(SEASON_KO, v.s, v.v)} 감기 걸리면 나 심심해.`,
      calm: `${seasonLine(SEASON_KO, v.s, v.v)} 철이 바뀌면 몸도 천천히 맞춰 가.`,
    }),
  'note.close': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, ['오늘도 옆에 있을게!', '힘들면 나 쓰다듬어 줘.', '오늘도 파이팅!']),
      polite: V(v.v, ['오늘도 곁에 있을게요.', '필요하시면 언제든 불러 주세요.', '좋은 하루 보내세요.']),
      tsundere: V(v.v, [
        '...그럼 이만. 흥.',
        '힘들면 말해. 들어는 줄게.',
        '오늘도 지켜볼 거야. 딱히 걱정돼서는 아니고.',
      ]),
      calm: V(v.v, ['서두르지 말고, 하나씩.', '쉬는 것도 잊지 마.', '오늘도 같이 있을게.']),
    }),
  // 특별한 편지
  'note.special.open': (v: N) =>
    P(v.p, {
      friend: '시간 진짜 빠르다! 벌써 이만큼이나 같이 지냈어.',
      polite: '시간이 참 빠르네요. 벌써 이만큼 함께했어요.',
      tsundere: '...날짜 세고 있던 건 아니야. 그냥 알았어.',
      calm: '돌아보면 금방이야. 그만큼 같이 걸어왔어.',
    }),
  'note.special.heart': (v: N) =>
    P(v.p, {
      friend: V(v.v, ['매일 옆에 있어 줘서 정말 고마워.', '네 화면에 사는 게 제일 좋아.']),
      polite: V(v.v, ['매일 곁에 두어 주셔서 감사해요.', '함께 일하는 시간이 늘 즐거워요.']),
      tsundere: V(v.v, ['...고마워. 두 번은 말 안 해.', '여기 있는 거, 나쁘지 않아. 아니 좋아.']),
      calm: V(v.v, ['하루하루가 모여 여기까지 왔어. 고마워.', '같이 보낸 날들이 나한테는 소중해.']),
    }),
  'note.special.coins': (v: Coins) =>
    P(v.p, {
      friend: `작은 선물로 코인 ${v.coins}개 넣었어!`,
      polite: `작은 선물로 코인 ${v.coins}개를 넣어 두었어요.`,
      tsundere: `코인 ${v.coins}개 넣었어. 남아서 주는 거야.`,
      calm: `고마운 마음으로 코인 ${v.coins}개를 담았어.`,
    }),
  'note.special.close': (v: Name) =>
    P(v.p, {
      friend: `앞으로도 잘 부탁해! 너의 단짝 ${v.name}`,
      polite: `앞으로도 잘 부탁드려요. ${v.name} 올림`,
      tsundere: `앞으로도 옆에 있을 거야. 딱히 갈 데도 없고. ${v.name} 씀`,
      calm: `앞으로도 천천히, 같이 가자. ${v.name} 씀`,
    }),
};

export const en: Translation<typeof ko> = {
  'settings.typeAlong': 'Type along',
  'settings.typeAlongHint':
    "While you type, your fairy taps a tiny keyboard with you. It never reads which keys you press, only whether you're typing. Rests in battery saver.",
  'settings.dailyNotes': 'Daily notes',
  'settings.dailyNotesHint':
    'Once a day, the first time you are around after 9:00, your fairy brings a note written only from what is on this computer. Special letters on day 7, 30, 100 and 365.',
  'pet.menu.typeAlong': 'Type along',

  'together.work': (v: Pv) =>
    P(v.p, {
      friend: "Let's do this together! I'm right here.",
      polite: "I'll work alongside you. I'm right here to help.",
      tsundere: "Hmph, can't do it alone? Fine, I'll help.",
      calm: "Let's do it together. Slowly, one step at a time.",
    }),

  'note.bring': (v: Name) =>
    P(v.p, {
      friend: 'I brought you a note! Click me to open it.',
      polite: 'I brought you a note. Click me to open it.',
      tsundere: "This... is a note. Read it or don't. Just click me.",
      calm: 'I wrote you a note. Click me to open it.',
    }),
  'note.bringLetter': (v: Name) =>
    P(v.p, {
      friend: 'A special letter today! Click me to open it.',
      polite: 'I prepared a special letter today. Click me to open it.',
      tsundere: "It's a letter today. Not that it's special. Click me.",
      calm: 'Today is a special day, so I wrote a letter. Click me to open it.',
    }),
  'note.openNow': 'Open',
  'note.later': 'Later',
  'note.thanks': 'Thanks',
  'note.toBox': 'Notes',
  'note.title': (v: { m: number; d: number }) => `Note for ${v.m}/${v.d}`,
  'note.letterTitle': (v: { n: number }) =>
    v.n >= 365 && v.n % 365 === 0 ? `Year ${v.n / 365} letter` : `Day ${v.n} letter`,

  'note.box': 'Notes',
  'note.boxUnread': (v: { n: number }) => `${v.n} unread`,
  'note.boxEmpty': "No notes yet. I'll bring one tomorrow morning.",
  'note.boxOff': 'Daily notes are off. You can turn them on in Settings, Fairy.',
  'note.boxMore': (v: { n: number }) => `Show ${v.n} older ${v.n === 1 ? 'note' : 'notes'}`,
  'note.boxLess': 'Show less',
  'note.new': 'New',

  'note.open': (v: Name) =>
    P(v.p, {
      friend: V(v.v, ['Good morning! Happy to see you.', "Hi, it's me!", "Let's make today a good one!"]),
      polite: V(v.v, [
        'Good morning. Lovely to see you.',
        "Hello, here is today's note.",
        'Looking forward to today with you.',
      ]),
      tsundere: V(v.v, [
        "It's not like I wanted to write this.",
        'Hmph, you came again.',
        'If you read it... I might be a little happy.',
      ]),
      calm: V(v.v, [
        "Good morning. Let's open the day together.",
        'Hello. Take a breath and read this.',
        "Let's take today slowly.",
      ]),
    }),
  'note.yesterday': (v: N) =>
    P(v.p, {
      friend: `You finished ${v.n === 1 ? 'a to-do' : `${v.n} to-dos`} yesterday. Amazing!`,
      polite: `You finished ${v.n === 1 ? 'a to-do' : `${v.n} to-dos`} yesterday. Wonderful work.`,
      tsundere: `${v.n} done yesterday. I saw. ...Not bad.`,
      calm: `${v.n} done yesterday. Small steps add up.`,
    }),
  'note.yesterdayNone': (v: Pv) =>
    P(v.p, {
      friend: 'Yesterday was a rest day, right? We all need those.',
      polite: 'Yesterday was a rest day. Those matter too.',
      tsundere: 'You took it easy yesterday? Whatever, today works.',
      calm: 'Rest is part of the work too. Start small today.',
    }),
  'note.event': (v: Ev) =>
    P(v.p, {
      friend: `First up today: ${v.title} at ${v.time}. Don't forget!`,
      polite: `Your first event today is ${v.title} at ${v.time}.`,
      tsundere: `${v.title} at ${v.time}. Don't be late.`,
      calm: `Today starts with ${v.title} at ${v.time}. Let's prepare a little.`,
    }),
  'note.eventAllDay': (v: Ev) =>
    P(v.p, {
      friend: `All day today: ${v.title}! Keep it in mind.`,
      polite: `You have an all-day event today: ${v.title}.`,
      tsundere: `${v.title} is all day today. Don't forget.`,
      calm: `All day today: ${v.title}. Pace yourself.`,
    }),
  'note.habit': (v: Habit) =>
    P(v.p, {
      friend: `${v.title}: day ${v.n} in a row! Let's keep going.`,
      polite: `${v.title}: ${v.n} days in a row. Cheering you on today too.`,
      tsundere: `${v.title}, ${v.n} days straight? Shame to stop now.`,
      calm: `${v.title}, day ${v.n}. A little every day is strongest.`,
    }),
  'note.birthday': (v: Pv) =>
    P(v.p, {
      friend: "It's your birthday, right? Happy birthday! Today is all about you.",
      polite: 'Happy birthday! Wishing you a wonderful day.',
      tsundere: "I know it's your birthday. ...Happy birthday. I mean it.",
      calm: 'Happy birthday. You did so well this past year.',
    }),
  'note.food': (v: Val) =>
    P(v.p, {
      friend: `How about a break with some ${v.value} today?`,
      polite: `Treat yourself to some ${v.value} on a break today.`,
      tsundere: `You like ${v.value}, right? Have some. You have my permission.`,
      calm: `Eating well matters. Maybe some ${v.value} today?`,
    }),
  'note.like': (v: Val) =>
    P(v.p, {
      friend: `You said you love ${v.value}, right? Tell me more sometime!`,
      polite: `You mentioned you enjoy ${v.value}. Take a moment for it today.`,
      tsundere: `I still remember you like ${v.value}. Just so you know.`,
      calm: `It's good to spend a little time on ${v.value}.`,
    }),
  'note.season': (v: Season) =>
    P(v.p, {
      friend: seasonLine(SEASON_EN, v.s, v.v),
      polite: seasonLine(SEASON_EN_POLITE, v.s, v.v),
      tsundere: `${seasonLine(SEASON_EN, v.s, v.v)} If you catch a cold, I'll be bored.`,
      calm: `${seasonLine(SEASON_EN, v.s, v.v)} Let your body ease into the season.`,
    }),
  'note.close': (v: Pv) =>
    P(v.p, {
      friend: V(v.v, ["I'll be right here today!", 'If it gets hard, give me a pat.', 'You got this!']),
      polite: V(v.v, ["I'll be right beside you.", 'Call me anytime you need me.', 'Have a lovely day.']),
      tsundere: V(v.v, [
        '...That is all. Hmph.',
        "If it's tough, tell me. I'll listen.",
        "I'll be watching. Not because I'm worried.",
      ]),
      calm: V(v.v, ['No rush. One thing at a time.', "Don't forget to rest.", "I'll be with you today."]),
    }),
  'note.special.open': (v: N) =>
    P(v.p, {
      friend: "Time flies! We've already been together this long.",
      polite: "Time truly flies. We've come this far together.",
      tsundere: '...Not that I was counting the days. I just knew.',
      calm: "Looking back, it went by quickly. We've walked this far together.",
    }),
  'note.special.heart': (v: N) =>
    P(v.p, {
      friend: V(v.v, ['Thank you for being with me every day.', 'Living on your screen is the best.']),
      polite: V(v.v, [
        'Thank you for keeping me by your side every day.',
        'Working with you is always a joy.',
      ]),
      tsundere: V(v.v, ["...Thanks. I won't say it twice.", "Being here isn't bad. No, it's great."]),
      calm: V(v.v, ['Day by day, we got here. Thank you.', 'The days we spent together mean a lot to me.']),
    }),
  'note.special.coins': (v: Coins) =>
    P(v.p, {
      friend: `I tucked in ${v.coins} coins as a little gift!`,
      polite: `I've included ${v.coins} coins as a small gift.`,
      tsundere: `${v.coins} coins inside. I just had extra.`,
      calm: `I put in ${v.coins} coins, with thanks.`,
    }),
  'note.special.close': (v: Name) =>
    P(v.p, {
      friend: `Let's keep going together! Love, ${v.name}`,
      polite: `I look forward to every day with you. ${v.name}`,
      tsundere: `I'll stay by your side. Not like I have anywhere else to be. ${v.name}`,
      calm: `Let's keep walking together, slowly. ${v.name}`,
    }),
};
