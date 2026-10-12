import type { Translation } from './types.ts';

// fun 영역 글: 끝말잇기, 웃겨 줘(말장난, 몸개그), 하이파이브, 간지럼 (shared/fun.ts, shared/word-chain.ts)
export const ko = {
  'fun.menu.chain': '끝말잇기 (채팅)',
  'fun.menu.joke': '웃겨 줘',
  'fun.menu.five': '하이파이브',

  'fun.joke.1.q': '왕이 넘어지면 뭐게?',
  'fun.joke.1.a': '킹콩! 헤헤.',
  'fun.joke.2.q': '소금의 유통기한은?',
  'fun.joke.2.a': '천일! 천일염이니까.',
  'fun.joke.3.q': '바나나가 웃으면?',
  'fun.joke.3.a': '바나나킥! 킥킥.',
  'fun.joke.4.q': '깨가 죽으면 뭐게?',
  'fun.joke.4.a': '주근깨!',
  'fun.joke.5.q': '오리가 얼면?',
  'fun.joke.5.a': '언덕! 언 덕(duck).',
  'fun.joke.6.q': '자동차를 톡 치면?',
  'fun.joke.6.a': '카톡!',
  'fun.joke.7.q': '세상에서 제일 빠른 닭은?',
  'fun.joke.7.a': '후다닥!',
  'fun.joke.8.q': '딸기가 회사에서 잘리면?',
  'fun.joke.8.a': '딸기시럽! 실업...',
  'fun.joke.9.q': '소가 웃으면?',
  'fun.joke.9.a': '우하하!',
  'fun.joke.10.q': '세상에서 제일 가난한 왕은?',
  'fun.joke.10.a': '최저임금!',
  'fun.joke.11.q': '몸개그 하나 보여 줄게!',
  'fun.joke.11.a': '꽈당! ...일부러 넘어진 거야. 진짜야.',
  'fun.joke.12.q': '엉덩이로 이름 쓰기 해 볼게!',
  'fun.joke.12.a': '씰룩씰룩... 다 썼다! 읽을 수 있어?',
  'fun.joke.13.q': '내 꼬리 잡아 볼게!',
  'fun.joke.13.a': '빙글빙글... 어지러워. 꼬리가 도망갔어.',
  'fun.joke.14.q': '바다가 해변한테 뭐라고 했게?',
  'fun.joke.14.a': '아무 말 안 했어. 손만 흔들었지! (파도)',

  'fun.five.ask': '하이파이브! 손바닥 줘!',
  'fun.five.button': '✋ 짝!',
  'fun.five.hit.1': '짝! 손바닥이 찌릿찌릿해!',
  'fun.five.hit.2': '짝! 우리 호흡 최고야.',
  'fun.five.hit.3': '짝! 오늘도 한 건 했다!',
  'fun.five.miss': '...허공이랑 하이파이브했어. 헤헤.',

  'fun.tickle.1': '꺄하하! 간지러워!',
  'fun.tickle.2': '히히히, 거기 간지럽단 말이야!',
  'fun.tickle.3': '깔깔깔! 그만, 그만!',
  'fun.tickle.4': '으하하, 배꼽 빠지겠어!',

  /** 이을 글자: '과' 자, '력' 자나 '역' 자 */
  'fun.chain.need': (v: { ch: string; alt: string }) =>
    v.alt ? `'${v.ch}' 자나 '${v.alt}' 자` : `'${v.ch}' 자`,
  'fun.chain.start': (v: { word: string; need: string }) =>
    `끝말잇기 하자! 내가 먼저 할게. ${v.word}! 이제 ${v.need}로 시작하는 말을 해 줘. 그만하려면 "그만".`,
  'fun.chain.next.1': (v: { word: string; need: string }) => `${v.word}! 이제 ${v.need}로 시작하는 말!`,
  'fun.chain.next.2': (v: { word: string; need: string }) => `음... ${v.word}! 다음은 ${v.need}로!`,
  'fun.chain.next.3': (v: { word: string; need: string }) => `${v.word}! 어때? ${v.need}로 이어 줘.`,
  'fun.chain.wrongStart': (v: { need: string }) => `앗, ${v.need}로 시작해야 해! 다시 해 봐.`,
  'fun.chain.used': (v: { word: string }) => `${v.word}, 그건 벌써 나왔어! 다른 말로.`,
  'fun.chain.short': '두 글자 이상인 말로 해 줘!',
  'fun.chain.stumped': (v: { need: string }) => `으앙, ${v.need}로 시작하는 말이 생각이 안 나! 네가 이겼어.`,
  'fun.chain.stumpedCoins': (v: { need: string; coins: number }) =>
    `으앙, ${v.need}로 시작하는 말이 생각이 안 나! 네가 이겼어. 코인 ${v.coins}개.`,
  'fun.chain.tired': (v: { n: number }) => `${v.n}번이나 이었어! 머리가 핑핑 돌아. 이번엔 네가 이겼어.`,
  'fun.chain.tiredCoins': (v: { n: number; coins: number }) =>
    `${v.n}번이나 이었어! 머리가 핑핑 돌아. 이번엔 네가 이겼어. 코인 ${v.coins}개.`,
  'fun.chain.giveUp': '헤헤, 내가 이겼다! 다음에 또 하자.',
  'fun.chain.tag': '끝말잇기',
  'fun.chain.tagTitle': 'AI 없이 하는 놀이야. "그만"이라고 하면 끝나.',
};

/** 문장 앞 영어 단어는 첫 글자를 크게 */
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export const en: Translation<typeof ko> = {
  'fun.menu.chain': 'Word chain (chat)',
  'fun.menu.joke': 'Make me laugh',
  'fun.menu.five': 'High five',

  'fun.joke.1.q': 'Why did the cookie go to the doctor?',
  'fun.joke.1.a': 'It felt crummy!',
  'fun.joke.2.q': 'What do you call a sleeping bull?',
  'fun.joke.2.a': 'A bulldozer!',
  'fun.joke.3.q': "Why can't a bicycle stand up on its own?",
  'fun.joke.3.a': "It's two tired!",
  'fun.joke.4.q': "What do you call cheese that isn't yours?",
  'fun.joke.4.a': 'Nacho cheese!',
  'fun.joke.5.q': 'Why did the scarecrow win an award?',
  'fun.joke.5.a': 'He was outstanding in his field!',
  'fun.joke.6.q': 'What do you call a fish with no eyes?',
  'fun.joke.6.a': 'A fsh!',
  'fun.joke.7.q': "Why don't eggs tell jokes?",
  'fun.joke.7.a': "They'd crack each other up!",
  'fun.joke.8.q': 'How does a penguin build its house?',
  'fun.joke.8.a': 'Igloos it together!',
  'fun.joke.9.q': 'What do you call a bear with no teeth?',
  'fun.joke.9.a': 'A gummy bear!',
  'fun.joke.10.q': 'What do you call a dinosaur that is sleeping?',
  'fun.joke.10.a': 'A dino-snore!',
  'fun.joke.11.q': 'Watch this trick!',
  'fun.joke.11.a': 'Oops, I tripped! ...I meant to do that. Really.',
  'fun.joke.12.q': "I'll write my name with my bottom!",
  'fun.joke.12.a': 'Wiggle wiggle... done! Can you read it?',
  'fun.joke.13.q': "I'll catch my tail!",
  'fun.joke.13.a': 'Round and round... so dizzy. It got away.',
  'fun.joke.14.q': 'What did the ocean say to the beach?',
  'fun.joke.14.a': 'Nothing. It just waved!',

  'fun.five.ask': 'High five! Gimme your hand!',
  'fun.five.button': '✋ Slap!',
  'fun.five.hit.1': 'Slap! My paw is tingling!',
  'fun.five.hit.2': 'Slap! We make a great team.',
  'fun.five.hit.3': 'Slap! Nailed it!',
  'fun.five.miss': '...I just high-fived the air. Hehe.',

  'fun.tickle.1': 'Hahaha! That tickles!',
  'fun.tickle.2': "Hehehe, that's my ticklish spot!",
  'fun.tickle.3': 'Giggle giggle! Stop, stop!',
  'fun.tickle.4': "Ahaha, I'm gonna burst!",

  'fun.chain.need': (v: { ch: string; alt: string }) =>
    v.alt ? `"${v.ch.toUpperCase()}" or "${v.alt.toUpperCase()}"` : `"${v.ch.toUpperCase()}"`,
  'fun.chain.start': (v: { word: string; need: string }) =>
    `Let's play word chain! I'll go first. ${cap(v.word)}! Now say a word starting with ${v.need}. Say "stop" to end.`,
  'fun.chain.next.1': (v: { word: string; need: string }) =>
    `${cap(v.word)}! Now one starting with ${v.need}!`,
  'fun.chain.next.2': (v: { word: string; need: string }) => `Hmm... ${cap(v.word)}! Next, ${v.need}!`,
  'fun.chain.next.3': (v: { word: string; need: string }) =>
    `${cap(v.word)}! How's that? Your turn: ${v.need}.`,
  'fun.chain.wrongStart': (v: { need: string }) => `Oops, it has to start with ${v.need}! Try again.`,
  'fun.chain.used': (v: { word: string }) => `${cap(v.word)} was already used! Try another.`,
  'fun.chain.short': 'Use a word with at least two letters!',
  'fun.chain.stumped': (v: { need: string }) =>
    `Waah, I can't think of a word starting with ${v.need}! You win.`,
  'fun.chain.stumpedCoins': (v: { need: string; coins: number }) =>
    `Waah, I can't think of a word starting with ${v.need}! You win. ${v.coins} ${Number(v.coins) === 1 ? 'coin' : 'coins'}.`,
  'fun.chain.tired': (v: { n: number }) => `We chained ${v.n} words! My head is spinning. You win this one.`,
  'fun.chain.tiredCoins': (v: { n: number; coins: number }) =>
    `We chained ${v.n} words! My head is spinning. You win this one. ${v.coins} ${Number(v.coins) === 1 ? 'coin' : 'coins'}.`,
  'fun.chain.giveUp': "Hehe, I win! Let's play again later.",
  'fun.chain.tag': 'Word chain',
  'fun.chain.tagTitle': 'A game played without AI. Say "stop" to end.',
};
