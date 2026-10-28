import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 펫 경험 (동료이자 친구): 기억하는 혼잣말, 철과 특별한 날, 새벽, 끝낸 일 축하, 만난 날 기념, 친구 펫끼리 수다.
// 혼잣말(idle.*) 값: name 펫 이름, n 숫자(어제 끝낸 수, 연속 날, 이번 주 끝낸 수, 함께한 날), min 오늘 집중한 분, hour 지금 시 (shared/idle-talk.ts idleVars)
type N = {
  name: string;
  yesterday?: number;
  streak?: number;
  week?: number;
  focusMin?: number;
  days?: number;
  hour?: number;
};
type Cheer = { name: string; n: number };
type Anniv = { name: string; n: number };
type Pair = { name: string; friend: string };

const s = (n: number | undefined, one: string, many: string) => (n === 1 ? one : many);

export const ko = {
  // 기억: 어제, 연속 기록, 이번 주, 오늘 집중, 함께한 날
  'idle.memory.yesterday.1': (v: N) =>
    `어제 ${v.yesterday ?? 0}개 끝낸 거 ${withParticle(v.name, '이')} 기억해. 오늘도 가 보자!`,
  'idle.memory.yesterday.2': (v: N) => `어제도 잘했잖아. ${v.yesterday ?? 0}개나! 오늘은 쉬운 거부터.`,
  'idle.streak.1': (v: N) =>
    `${v.streak ?? 0}일째 하나씩 끝내고 있어. ${withParticle(v.name, '이')} 세고 있었지!`,
  'idle.streak.2': (v: N) => `연속 ${v.streak ?? 0}일! 오늘도 하나만 끝내면 이어져.`,
  'idle.week.1': (v: N) => `이번 주에 ${v.week ?? 0}개 끝냈어. 한 주 진짜 알찼다!`,
  'idle.week.2': (v: N) => `이번 주 끝낸 일 ${v.week ?? 0}개. ${withParticle(v.name, '이')} 다 봤어.`,
  'idle.focus.1': (v: N) => `오늘 벌써 ${v.focusMin ?? 0}분 집중했어. 멋지다!`,
  'idle.focus.2': (v: N) => `집중 ${v.focusMin ?? 0}분째! ${withParticle(v.name, '은')} 조용히 박수 치는 중.`,
  'idle.together.1': (v: N) =>
    `우리 같이 지낸 지 ${v.days ?? 0}일째야. ${withParticle(v.name, '은')} 매일이 좋아.`,
  // 새벽 (1~5시): 지금 시를 말한다
  'idle.night.1': (v: N) => `벌써 새벽 ${v.hour ?? 1}시야. ${withParticle(v.name, '은')} 눈이 반쯤 감겼어.`,
  'idle.night.2': (v: N) => `새벽 ${v.hour ?? 1}시... 이거 끝나면 꼭 자기로 약속!`,
  // 철 (아무 때나 하는 말에 섞는다)
  'idle.season.spring.1': () => '봄이다! 창문 열면 꽃 냄새 날 것 같아.',
  'idle.season.spring.2': (v: N) => `${withParticle(v.name, '은')} 봄바람 맞으면서 산책하고 싶어.`,
  'idle.season.summer.1': () => '덥지? 시원한 물 한 잔 마시고 하자.',
  'idle.season.summer.2': (v: N) => `${withParticle(v.name, '은')} 털이 많아서 여름엔 녹아내려...`,
  'idle.season.autumn.1': () => '가을이라 그런지 집중이 잘 되는 것 같아.',
  'idle.season.autumn.2': (v: N) => `${withParticle(v.name, '은')} 낙엽 밟는 소리가 좋아. 바스락!`,
  'idle.season.winter.1': () => '손 시리지 않아? 따뜻한 거 하나 챙겨.',
  'idle.season.winter.2': (v: N) => `${withParticle(v.name, '은')} 이불 속에 쏙 들어가고 싶은 날씨야.`,
  // 특별한 날
  'idle.special.newyear': (v: N) => `새해 복 많이 받아! 올해도 ${withParticle(v.name, '이')} 옆에 있을게.`,
  'idle.special.christmas': (v: N) =>
    `메리 크리스마스! ${withParticle(v.name, '은')} 선물로 쓰다듬기 받고 싶어.`,
  'idle.special.yearend': () => '올해 마지막 날이야. 한 해 동안 정말 수고 많았어.',
  // 끝낸 일 축하 (그날 한 번씩, shared/companion.ts completionCheer)
  'companion.cheer.clear': () => '오늘 할 일 다 끝! 축하해!',
  'companion.cheer.streak': (v: Cheer) => `오늘 첫 끝내기! 이걸로 ${v.n}일 연속이야.`,
  'companion.cheer.count': (v: Cheer) => `오늘 벌써 ${v.n}개째! ${withParticle(v.name, '은')} 놀라는 중.`,
  // 만난 날 기념 (shared/companion.ts anniversaryDue)
  'companion.anniv.day': (v: Anniv) =>
    `오늘이 우리 만난 지 ${v.n}일째 되는 날이야! 앞으로도 ${withParticle(v.name, '을')} 잘 부탁해.`,
  'companion.anniv.late': (v: Anniv) => `우리 만난 지 ${v.n}일이 살짝 지났어! 늦었지만 축하해, 고마워.`,
  'companion.anniv.year': (v: Anniv) =>
    `우리 만난 지 벌써 ${v.n}년이야! ${withParticle(v.name, '은')} 너랑 지낸 날이 다 좋았어.`,
  // 친구 펫끼리 수다 (a 는 기본 펫이 친구에게, b 는 친구가 대답)
  'companion.friend.1.a': (v: Pair) => `${withParticle(v.friend, '아')}, 오늘 뭐 했어?`,
  'companion.friend.1.b': () => '낮잠! 아주 길게.',
  'companion.friend.2.a': (v: Pair) => `${withParticle(v.friend, '아')}, 우리 주인 오늘 열심히 하지?`,
  'companion.friend.2.b': () => '응, 우리가 응원해서 그래!',
  'companion.friend.3.a': () => '간식 숨겨 둔 데 알아?',
  'companion.friend.3.b': () => '쉿, 우리 둘만 아는 비밀이야.',
  'companion.friend.4.a': (v: Pair) => `${withParticle(v.friend, '아')}, 나중에 공놀이 하자!`,
  'companion.friend.4.b': () => '좋아, 내가 먼저 잡을 거야!',
  'companion.friend.5.a': () => '오늘 날씨 좋다, 그치?',
  'companion.friend.5.b': () => '화면 안은 늘 맑음이지!',
  'companion.friend.6.a': (v: Pair) => `${withParticle(v.friend, '아')}, 보고 싶었어!`,
  'companion.friend.6.b': (v: Pair) => `나도! ${withParticle(v.name, '이')} 제일 좋아.`,
};

export const en: Translation<typeof ko> = {
  'idle.memory.yesterday.1': (v: N) =>
    `${v.name} remembers you finished ${v.yesterday ?? 0} yesterday. Let's go again!`,
  'idle.memory.yesterday.2': (v: N) =>
    `You did great yesterday, ${v.yesterday ?? 0} ${s(v.yesterday, 'to-do', 'to-dos')}! Start easy today.`,
  'idle.streak.1': (v: N) =>
    `${v.streak ?? 0} days in a row of getting things done. ${v.name} has been counting!`,
  'idle.streak.2': (v: N) => `${v.streak ?? 0}-day streak! Finish just one today to keep it going.`,
  'idle.week.1': (v: N) => `${v.week ?? 0} ${s(v.week, 'to-do', 'to-dos')} done this week. What a week!`,
  'idle.week.2': (v: N) => `${v.week ?? 0} done this week. ${v.name} saw every one.`,
  'idle.focus.1': (v: N) => `${v.focusMin ?? 0} minutes of focus today already. Nice!`,
  'idle.focus.2': (v: N) => `${v.focusMin ?? 0} minutes of focus! ${v.name} is quietly clapping.`,
  'idle.together.1': (v: N) => `Day ${v.days ?? 0} together. ${v.name} loves every one of them.`,
  'idle.night.1': (v: N) => `It's already ${v.hour ?? 1} a.m. ${v.name}'s eyes are half closed.`,
  'idle.night.2': (v: N) => `${v.hour ?? 1} a.m.... Promise you'll sleep after this one!`,
  'idle.season.spring.1': () => 'Spring is here! The window probably smells like flowers.',
  'idle.season.spring.2': (v: N) => `${v.name} wants a walk in the spring breeze.`,
  'idle.season.summer.1': () => "Hot, isn't it? Grab some cold water first.",
  'idle.season.summer.2': (v: N) => `${v.name} is melting. Too much fur for summer...`,
  'idle.season.autumn.1': () => 'Something about autumn makes it easy to focus.',
  'idle.season.autumn.2': (v: N) => `${v.name} loves the crunch of fall leaves. Crunch!`,
  'idle.season.winter.1': () => 'Cold hands? Grab something warm.',
  'idle.season.winter.2': (v: N) => `${v.name} wants to burrow under a blanket today.`,
  'idle.special.newyear': (v: N) => `Happy New Year! ${v.name} will be right here all year.`,
  'idle.special.christmas': (v: N) => `Merry Christmas! ${v.name} would love a pat as a present.`,
  'idle.special.yearend': () => 'Last day of the year. You worked so hard. Thank you.',
  'companion.cheer.clear': () => 'All done for today! Yay!',
  'companion.cheer.streak': (v: Cheer) => `First one today! That makes ${v.n} days in a row.`,
  'companion.cheer.count': (v: Cheer) => `That's ${v.n} today already! ${v.name} is amazed.`,
  'companion.anniv.day': (v: Anniv) => `Today marks ${v.n} days together! ${v.name} is so glad it's you.`,
  'companion.anniv.late': (v: Anniv) => `We just passed ${v.n} days together! A little late, but thank you.`,
  'companion.anniv.year': (v: Anniv) =>
    `${v.n} ${s(v.n, 'year', 'years')} together already! ${v.name} loved every day of it.`,
  'companion.friend.1.a': (v: Pair) => `${v.friend}, what did you do today?`,
  'companion.friend.1.b': () => 'Napped! A really long one.',
  'companion.friend.2.a': (v: Pair) => `${v.friend}, our human is working hard today, right?`,
  'companion.friend.2.b': () => "Yep, that's because we're cheering!",
  'companion.friend.3.a': () => 'Know where the snacks are hidden?',
  'companion.friend.3.b': () => "Shh, that's our little secret.",
  'companion.friend.4.a': (v: Pair) => `${v.friend}, let's play ball later!`,
  'companion.friend.4.b': () => "Deal, I'm catching it first!",
  'companion.friend.5.a': () => 'Nice weather today, huh?',
  'companion.friend.5.b': () => "It's always sunny inside the screen!",
  'companion.friend.6.a': (v: Pair) => `${v.friend}, I missed you!`,
  'companion.friend.6.b': (v: Pair) => `Me too! ${v.name} is my favorite.`,
};
