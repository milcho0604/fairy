import { withParticle } from '../josa.ts';
import * as fun from './fun.ts';
import * as pet from './pet.ts';
import * as play from './play.ts';
import type { Translation } from './types.ts';

// 존댓말 비서의 놀이 말과 친구 펫 인사 (이슈 #65, shared/persona-voice.ts). 놀이(비눗방울, 레이저, 간식, 가위바위보,
// 술래잡기, 두더지, 웃겨 줘, 하이파이브, 간지럼, 끝말잇기)와 친구 펫 인사는 반말이라 존댓말 비서로 골라도 반말이었다.
// 같은 뜻을 존댓말로. 츤데레, 차분한 선생님은 반말이라 원래 말을 같이 쓴다.
// 영어는 반말, 존댓말 구분이 없어 원래 말 그대로 (키 모양만 맞춘다)
type Need = { word: string; need: string };

export const ko = {
  // 놀이 못 할 때
  'voice.polite.play.block.focus': '지금은 집중 시간이라 자는 중이에요. 끝나면 같이 놀아요!',
  'voice.polite.play.block.resting': '집에서 쉬는 중이에요. 나오면 놀아요!',
  'voice.polite.play.block.hungry': '배고파서 뛸 힘이 없어요. 밥 먼저 주실래요?',
  'voice.polite.play.block.noFriend': '같이 뛰어놀 친구가 이 화면 바닥에 없어요.',
  'voice.polite.play.block.hidden': '지금은 숨어 있어요.',
  'voice.polite.play.block.locked': '화면이 잠겨 있어요.',
  'voice.polite.play.block.held': '내려 주시면 놀아요!',
  'voice.polite.play.block.playing': '이미 노는 중이에요!',
  // 짧은 놀이
  'voice.polite.play.bubbles.start': '비눗방울 불게요! 눌러서 터뜨려 보세요.',
  'voice.polite.play.bubbles.end': (v: { popped: number }) => `비눗방울 ${v.popped}개 펑! 재밌었어요.`,
  'voice.polite.play.bubbles.endCoins': (v: { popped: number; coins: number }) =>
    `비눗방울 ${v.popped}개 펑! 코인 ${v.coins}개 드려요.`,
  'voice.polite.play.bubbles.none': '다 날아가 버렸네요. 다음엔 같이 터뜨려요!',
  'voice.polite.play.laser.start': '빨간 점이에요! 커서를 바닥 쪽으로 데려와 주세요. 잡아 볼게요.',
  'voice.polite.play.laser.end': (v: { n: number }) => `${v.n}번 잡았어요! 헥헥.`,
  'voice.polite.play.laser.endCoins': (v: { n: number; coins: number }) =>
    `${v.n}번 잡았어요! 헥헥. 코인 ${v.coins}개 드려요.`,
  'voice.polite.play.laser.none': '하나도 못 잡았어요. 너무 빨라요!',
  'voice.polite.play.treats.start': '간식이에요! 받아먹을게요.',
  'voice.polite.play.treats.end': (v: { n: number }) => `날아오는 간식 ${v.n}개를 받아먹었어요! 냠냠.`,
  'voice.polite.play.treats.endFloor': '바닥에 떨어진 것도 다 주워 먹었어요. 냠냠.',
  'voice.polite.play.treats.endHungry': '맛있어요! 그래도 아직 배고파요. 밥도 주실래요?',
  'voice.polite.play.rps.ask': '가위바위보! 하나 골라 주세요.',
  'voice.polite.play.rps.again': '한 번 더요! 골라 주세요.',
  'voice.polite.play.rps.win': (v: { hand: string }) => `저는 ${v.hand}! 이기셨어요.`,
  'voice.polite.play.rps.winCoins': (v: { hand: string; coins: number }) =>
    `저는 ${v.hand}! 이기셨어요. 코인 ${v.coins}개 드려요.`,
  'voice.polite.play.rps.lose': (v: { hand: string }) => `저는 ${v.hand}! 제가 이겼어요!`,
  'voice.polite.play.rps.draw': (v: { hand: string }) => `저도 ${v.hand}! 비겼어요.`,
  'voice.polite.play.rps.tired': '계속 비기네요. 다음에 또 해요!',
  'voice.polite.play.tag.start': (v: { name: string }) => `${v.name}, 술래잡기 해요! 제가 술래예요!`,
  'voice.polite.play.tag.swap': (v: { name: string }) =>
    `잡았다! 이번엔 ${withParticle(v.name, '이')} 술래예요!`,
  'voice.polite.play.tag.end': (v: { name: string }) =>
    `${withParticle(v.name, '이랑')} 뛰어노니까 재밌어요!`,
  'voice.polite.play.mole.start':
    '숨었다 쏙 나올게요! 나오면 눌러 주세요. 돌멩이랑 나뭇잎은 누르지 마시고요!',
  'voice.polite.play.mole.end': (v: { n: number }) => `${v.n}번 잡혔어요! 뿅뿅.`,
  'voice.polite.play.mole.endCoins': (v: { n: number; coins: number }) =>
    `${v.n}번 잡혔어요! 뿅뿅. 코인 ${v.coins}개 드려요.`,
  'voice.polite.play.mole.none': '한 번도 안 잡혔지요! 제가 숨기 선수예요.',
  // 웃겨 줘
  'voice.polite.fun.joke.1.q': '왕이 넘어지면 뭘까요?',
  'voice.polite.fun.joke.1.a': '킹콩이에요! 헤헤.',
  'voice.polite.fun.joke.2.q': '소금의 유통기한은 얼마일까요?',
  'voice.polite.fun.joke.2.a': '천일이에요! 천일염이니까요.',
  'voice.polite.fun.joke.3.q': '바나나가 웃으면 뭘까요?',
  'voice.polite.fun.joke.3.a': '바나나킥이에요! 킥킥.',
  'voice.polite.fun.joke.4.q': '깨가 죽으면 뭘까요?',
  'voice.polite.fun.joke.4.a': '주근깨예요!',
  'voice.polite.fun.joke.5.q': '오리가 얼면 뭘까요?',
  'voice.polite.fun.joke.5.a': '언덕이에요! 언 덕(duck).',
  'voice.polite.fun.joke.6.q': '자동차를 톡 치면 뭘까요?',
  'voice.polite.fun.joke.6.a': '카톡이에요!',
  'voice.polite.fun.joke.7.q': '세상에서 제일 빠른 닭은 뭘까요?',
  'voice.polite.fun.joke.7.a': '후다닥이에요!',
  'voice.polite.fun.joke.8.q': '딸기가 회사에서 잘리면 뭘까요?',
  'voice.polite.fun.joke.8.a': '딸기시럽이에요! 실업...',
  'voice.polite.fun.joke.9.q': '소가 웃으면 뭘까요?',
  'voice.polite.fun.joke.9.a': '우하하예요!',
  'voice.polite.fun.joke.10.q': '세상에서 제일 가난한 왕은 누굴까요?',
  'voice.polite.fun.joke.10.a': '최저임금이에요!',
  'voice.polite.fun.joke.11.q': '몸개그 하나 보여 드릴게요!',
  'voice.polite.fun.joke.11.a': '꽈당! ...일부러 넘어진 거예요. 진짜예요.',
  'voice.polite.fun.joke.12.q': '엉덩이로 이름 써 볼게요!',
  'voice.polite.fun.joke.12.a': '씰룩씰룩... 다 썼어요! 읽으실 수 있어요?',
  'voice.polite.fun.joke.13.q': '제 꼬리 잡아 볼게요!',
  'voice.polite.fun.joke.13.a': '빙글빙글... 어지러워요. 꼬리가 도망갔어요.',
  'voice.polite.fun.joke.14.q': '바다가 해변한테 뭐라고 했을까요?',
  'voice.polite.fun.joke.14.a': '아무 말 안 했어요. 손만 흔들었죠! (파도)',
  // 하이파이브, 간지럼
  'voice.polite.fun.five.ask': '하이파이브! 손바닥 주세요!',
  'voice.polite.fun.five.hit.1': '짝! 손바닥이 찌릿찌릿해요!',
  'voice.polite.fun.five.hit.2': '짝! 우리 호흡 최고예요.',
  'voice.polite.fun.five.hit.3': '짝! 오늘도 한 건 했어요!',
  'voice.polite.fun.five.miss': '...허공이랑 하이파이브했어요. 헤헤.',
  'voice.polite.fun.tickle.1': '꺄하하! 간지러워요!',
  'voice.polite.fun.tickle.2': '히히히, 거기 간지럽단 말이에요!',
  'voice.polite.fun.tickle.3': '깔깔깔! 그만, 그만요!',
  'voice.polite.fun.tickle.4': '으하하, 배꼽 빠지겠어요!',
  // 끝말잇기 (채팅)
  'voice.polite.fun.chain.start': (v: Need) =>
    `끝말잇기 해요! 제가 먼저 할게요. ${v.word}! 이제 ${v.need}로 시작하는 말을 해 주세요. 그만하시려면 "그만".`,
  'voice.polite.fun.chain.next.1': (v: Need) => `${v.word}! 이제 ${v.need}로 시작하는 말이에요!`,
  'voice.polite.fun.chain.next.2': (v: Need) => `음... ${v.word}! 다음은 ${v.need}로요!`,
  'voice.polite.fun.chain.next.3': (v: Need) => `${v.word}! 어때요? ${v.need}로 이어 주세요.`,
  'voice.polite.fun.chain.wrongStart': (v: { need: string }) =>
    `앗, ${v.need}로 시작해야 해요! 다시 해 보세요.`,
  'voice.polite.fun.chain.used': (v: { word: string }) => `${v.word}, 그건 벌써 나왔어요! 다른 말로요.`,
  'voice.polite.fun.chain.short': '두 글자 이상인 말로 해 주세요!',
  'voice.polite.fun.chain.stumped': (v: { need: string }) =>
    `으앙, ${v.need}로 시작하는 말이 생각이 안 나요! 이기셨어요.`,
  'voice.polite.fun.chain.stumpedCoins': (v: { need: string; coins: number }) =>
    `으앙, ${v.need}로 시작하는 말이 생각이 안 나요! 이기셨어요. 코인 ${v.coins}개 드려요.`,
  'voice.polite.fun.chain.tired': (v: { n: number }) =>
    `${v.n}번이나 이었어요! 머리가 핑핑 돌아요. 이번엔 이기셨어요.`,
  'voice.polite.fun.chain.tiredCoins': (v: { n: number; coins: number }) =>
    `${v.n}번이나 이었어요! 머리가 핑핑 돌아요. 이번엔 이기셨어요. 코인 ${v.coins}개 드려요.`,
  'voice.polite.fun.chain.giveUp': '헤헤, 제가 이겼어요! 다음에 또 해요.',
  // 친구 펫 인사
  'voice.polite.pet.hello.1': '안녕하세요!',
  'voice.polite.pet.hello.2': '같이 놀아요!',
  'voice.polite.pet.hello.3': '오늘도 힘내세요!',
  'voice.polite.pet.hello.4': '쉬엄쉬엄 하세요.',
  'voice.polite.pet.hello.5': '저 여기 있어요!',
};

const enAll: Record<string, unknown> = { ...play.en, ...fun.en, ...pet.en };
const enOf = (key: string) => enAll[key.replace('voice.polite.', '')];

export const en = Object.fromEntries(
  Object.keys(ko).map((key) => [key, enOf(key)]),
) as unknown as Translation<typeof ko>;
