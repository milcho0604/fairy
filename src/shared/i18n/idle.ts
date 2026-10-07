import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 혼잣말과 칭찬 (수다쟁이). 펫 이름이 들어간다. 반말, 짧게.
type N = { name: string };

export const ko = {
  'idle.any.1': (v: N) => `${withParticle(v.name, '은')} 여기서 조용히 응원 중.`,
  'idle.any.2': (v: N) => `${withParticle(v.name, '이')} 보기엔 지금 잘하고 있어.`,
  'idle.any.3': () => '물 마신 지 좀 됐지? 한 모금 마시고 와.',
  'idle.any.4': (v: N) => `심심하면 ${withParticle(v.name, '을')} 쓰다듬어 줘도 돼.`,
  'idle.any.5': () => '어깨 힘 빼. 그거면 반은 한 거야.',
  'idle.morning.1': (v: N) => `좋은 아침! ${v.name}도 방금 일어났어.`,
  'idle.morning.2': () => '아침엔 쉬운 거 하나부터 끝내 보자.',
  'idle.monday.1': (v: N) => `월요일이다. ${withParticle(v.name, '이')} 옆에 딱 붙어 있을게.`,
  'idle.lunch.1': () => '슬슬 배고프지 않아? 점심 맛있는 거 먹어.',
  'idle.lunch.2': (v: N) => `밥은 먹고 하자. ${v.name}도 배고파.`,
  'idle.afternoon.1': () => '오후엔 원래 졸려. 기지개 한 번 켜자.',
  'idle.afternoon.2': (v: N) => `${withParticle(v.name, '은')} 지금 하품 참는 중.`,
  'idle.friday.1': () => '금요일 오후다! 조금만 더 힘내.',
  'idle.evening.1': () => '오늘 하루 길었지? 수고 많았어.',
  'idle.evening.2': (v: N) => `저녁이네. ${withParticle(v.name, '은')} 슬슬 졸려.`,
  'idle.late.1': () => '벌써 이렇게 늦었어. 오늘은 여기까지 할까?',
  'idle.late.2': (v: N) => `${withParticle(v.name, '은')} 눈이 감겨. 너도 얼른 자.`,
  'idle.praise.1': (v: N) => `벌써 하나 끝냈네. ${withParticle(v.name, '이')} 다 봤어.`,
  'idle.praise.3': (v: N) => `오늘 세 개 넘게 끝냈어! ${withParticle(v.name, '은')} 뿌듯해.`,
  'idle.praise.5': () => '오늘 완전 날아다니네. 대단해!',
};

export const en: Translation<typeof ko> = {
  'idle.any.1': (v: N) => `${v.name} is quietly cheering you on.`,
  'idle.any.2': (v: N) => `${v.name} thinks you're doing great.`,
  'idle.any.3': () => "When's the last time you had water? Go grab a sip.",
  'idle.any.4': (v: N) => `Bored? You can pet ${v.name}, you know.`,
  'idle.any.5': () => 'Drop your shoulders. That alone helps.',
  'idle.morning.1': (v: N) => `Morning! ${v.name} just woke up too.`,
  'idle.morning.2': () => "Let's knock out something easy first.",
  'idle.monday.1': (v: N) => `It's Monday. ${v.name} is sticking right by you.`,
  'idle.lunch.1': () => 'Getting hungry? Go have something good for lunch.',
  'idle.lunch.2': (v: N) => `Eat first, then work. ${v.name} is hungry too.`,
  'idle.afternoon.1': () => 'Afternoons are sleepy. Time for a big stretch.',
  'idle.afternoon.2': (v: N) => `${v.name} is trying not to yawn.`,
  'idle.friday.1': () => "It's Friday afternoon! Almost there.",
  'idle.evening.1': () => 'Long day, huh? You did good.',
  'idle.evening.2': (v: N) => `It's evening. ${v.name} is getting sleepy.`,
  'idle.late.1': () => "It's getting late. Call it a day?",
  'idle.late.2': (v: N) => `${v.name} can barely keep their eyes open. Get some sleep too.`,
  'idle.praise.1': (v: N) => `One down already. ${v.name} saw that.`,
  'idle.praise.3': (v: N) => `Three or more done today! ${v.name} is so proud.`,
  'idle.praise.5': () => "You're on fire today. Amazing!",
};
