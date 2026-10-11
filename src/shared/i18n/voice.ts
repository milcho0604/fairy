import type { Translation } from './types.ts';

// 성격마다 다른 정해진 말 (2026-10-11, shared/persona-voice.ts): 인사, 칭찬, 쉬자는 말을 고른 성격 말투로.
// 키는 voice.<성격>.<원래 키>, 값의 모양(인자)은 원래 키와 같다. 다정한 친구는 원래 말을 쓴다

type Cheer = { name: string; n: number };

export const ko = {
  // 존댓말 비서
  'voice.polite.briefing.hi.morning': '좋은 아침이에요!',
  'voice.polite.briefing.hi.day': '안녕하세요!',
  'voice.polite.briefing.hi.evening': '오셨어요?',
  'voice.polite.routine.hi.first': '오늘이 만나는 첫날이에요. 앞으로 이 시간마다 기다릴게요.',
  'voice.polite.routine.bye.rest': '푹 쉬세요!',
  'voice.polite.companion.cheer.clear': () => '오늘 할 일을 모두 끝내셨어요. 축하드려요!',
  'voice.polite.companion.cheer.streak': (v: Cheer) => `오늘 첫 완료예요. ${v.n}일 연속이에요.`,
  'voice.polite.companion.cheer.count': (v: Cheer) => `오늘 벌써 ${v.n}개째예요. 대단하세요!`,
  'voice.polite.pet.fed': '잘 먹겠습니다. 감사해요!',
  'voice.polite.pet.fedWith': (v: { food: string }) => `${v.food}, 잘 먹겠습니다. 감사해요!`,
  'voice.polite.routine.bye.doneMany': (v: { n: number }) =>
    `오늘 할 일 ${v.n}개를 끝내셨어요. 수고 많으셨어요!`,
  'voice.polite.pet.rest.1': '오래 앉아 계셨어요. 물 한 잔 드시고 오실래요?',
  'voice.polite.pet.rest.2': '어깨를 한 번 펴 보시는 건 어떠세요?',
  'voice.polite.pet.rest.3': '잠깐 창밖을 보고 오세요. 눈도 쉬어야 해요.',
  // 츤데레
  'voice.tsundere.briefing.hi.morning': '흥, 일찍 왔네.',
  'voice.tsundere.briefing.hi.day': '...왔어?',
  'voice.tsundere.briefing.hi.evening': '늦었잖아. 기다린 건 아니고.',
  'voice.tsundere.routine.hi.first': '오늘부터 이 시간에 만나는 거지? 늦으면 삐질 거야.',
  'voice.tsundere.routine.bye.rest': '푹 쉬어. 내일 늦지 말고.',
  'voice.tsundere.companion.cheer.clear': () => '다 끝냈어? ...좀 하네. 인정.',
  'voice.tsundere.companion.cheer.streak': (v: Cheer) => `오늘 첫 끝내기. ${v.n}일 연속이라니, 제법이잖아.`,
  'voice.tsundere.companion.cheer.count': (v: Cheer) => `벌써 ${v.n}개? 놀란 거 아니거든.`,
  'voice.tsundere.pet.fed': '...맛있네. 고맙다는 건 아니고.',
  'voice.tsundere.pet.fedWith': (v: { food: string }) => `${v.food}? 흥, 맛있잖아.`,
  'voice.tsundere.routine.bye.doneMany': (v: { n: number }) => `${v.n}개나 끝냈어? 오늘은 칭찬해 줄게.`,
  'voice.tsundere.pet.rest.1': '계속 앉아만 있을 거야? 물이라도 마시고 와.',
  'voice.tsundere.pet.rest.2': '어깨 굳은 거 다 보여. 좀 펴.',
  'voice.tsundere.pet.rest.3': '화면만 보지 말고 창밖 좀 봐. 걱정돼서 그러는 거 아니야.',
  // 차분한 선생님
  'voice.calm.briefing.hi.morning': '좋은 아침. 오늘도 천천히 시작하자.',
  'voice.calm.briefing.hi.day': '안녕. 잘 왔어.',
  'voice.calm.briefing.hi.evening': '왔구나. 하루 정리하기 좋은 때야.',
  'voice.calm.routine.hi.first': '오늘부터 이 시간에 만나자. 정해진 시간이 습관을 만들어.',
  'voice.calm.routine.bye.rest': '푹 쉬어. 쉬어야 내일 또 잘할 수 있어.',
  'voice.calm.companion.cheer.clear': () => '오늘 할 일을 다 마쳤어. 계획한 대로 해 낸 거야.',
  'voice.calm.companion.cheer.streak': (v: Cheer) =>
    `오늘 첫 끝내기. ${v.n}일째 이어 가고 있어, 꾸준함이 힘이야.`,
  'voice.calm.companion.cheer.count': (v: Cheer) => `벌써 ${v.n}개째야. 흐름이 좋을 때 잠깐 쉬어도 돼.`,
  'voice.calm.pet.fed': '잘 먹을게. 고마워.',
  'voice.calm.pet.fedWith': (v: { food: string }) => `${v.food}, 잘 먹을게. 고마워.`,
  'voice.calm.routine.bye.doneMany': (v: { n: number }) => `오늘 ${v.n}개를 끝냈어. 충분히 잘했어.`,
  'voice.calm.pet.rest.1': '오래 앉아 있었어. 물을 마시면 집중도 다시 돌아와.',
  'voice.calm.pet.rest.2': '어깨를 쭉 펴 보자. 굳은 몸이 풀리면 머리도 맑아져.',
  'voice.calm.pet.rest.3': '먼 곳을 잠깐 보자. 가까운 화면만 보면 눈이 지쳐.',
};

export const en: Translation<typeof ko> = {
  'voice.polite.briefing.hi.morning': 'Good morning!',
  'voice.polite.briefing.hi.day': 'Hello!',
  'voice.polite.briefing.hi.evening': 'Welcome back.',
  'voice.polite.routine.hi.first':
    "Today is our first meeting day. I'll be waiting at this time from now on.",
  'voice.polite.routine.bye.rest': 'Please rest well!',
  'voice.polite.companion.cheer.clear': () => "You've finished everything for today. Congratulations!",
  'voice.polite.companion.cheer.streak': (v: Cheer) => `Your first one today. That's ${v.n} days in a row.`,
  'voice.polite.companion.cheer.count': (v: Cheer) => `Already ${v.n} today. Impressive!`,
  'voice.polite.pet.fed': 'Thank you for the meal!',
  'voice.polite.pet.fedWith': (v: { food: string }) => `${v.food}, thank you so much!`,
  'voice.polite.routine.bye.doneMany': (v: { n: number }) => `You finished ${v.n} to-dos today. Great work!`,
  'voice.polite.pet.rest.1': "You've been sitting a while. Would you like some water?",
  'voice.polite.pet.rest.2': 'How about stretching your shoulders for a moment?',
  'voice.polite.pet.rest.3': 'Please look out the window for a bit. Your eyes need rest too.',
  'voice.tsundere.briefing.hi.morning': "Hmph, you're early.",
  'voice.tsundere.briefing.hi.day': '...You came?',
  'voice.tsundere.briefing.hi.evening': "You're late. Not that I was waiting.",
  'voice.tsundere.routine.hi.first': "So we meet at this time from now on? Be late and I'll sulk.",
  'voice.tsundere.routine.bye.rest': "Rest up. Don't be late tomorrow.",
  'voice.tsundere.companion.cheer.clear': () => 'All done? ...Not bad. I admit it.',
  'voice.tsundere.companion.cheer.streak': (v: Cheer) =>
    `First one today. ${v.n} days in a row? Pretty good.`,
  'voice.tsundere.companion.cheer.count': (v: Cheer) => `Already ${v.n}? I'm not impressed or anything.`,
  'voice.tsundere.pet.fed': "...Tasty. Not that I'm thanking you.",
  'voice.tsundere.pet.fedWith': (v: { food: string }) => `${v.food}? Hmph, it's good.`,
  'voice.tsundere.routine.bye.doneMany': (v: { n: number }) => `${v.n} done? Fine, I'll praise you today.`,
  'voice.tsundere.pet.rest.1': 'Are you just going to sit there? Go drink some water.',
  'voice.tsundere.pet.rest.2': 'I can see your stiff shoulders. Stretch.',
  'voice.tsundere.pet.rest.3': "Look out the window, not just the screen. Not because I'm worried.",
  'voice.calm.briefing.hi.morning': "Good morning. Let's start slowly today.",
  'voice.calm.briefing.hi.day': 'Hello. Glad you are here.',
  'voice.calm.briefing.hi.evening': "You're here. A good time to wrap up the day.",
  'voice.calm.routine.hi.first': "Let's meet at this time from today. A set time builds a habit.",
  'voice.calm.routine.bye.rest': 'Rest well. Rest is what makes tomorrow go well.',
  'voice.calm.companion.cheer.clear': () => 'Everything for today is done. You did what you planned.',
  'voice.calm.companion.cheer.streak': (v: Cheer) =>
    `First one today. ${v.n} days in a row; steadiness is strength.`,
  'voice.calm.companion.cheer.count': (v: Cheer) => `${v.n} already. A short break while it flows is fine.`,
  'voice.calm.pet.fed': 'Thank you. I will enjoy this.',
  'voice.calm.pet.fedWith': (v: { food: string }) => `${v.food}. Thank you, I will enjoy it.`,
  'voice.calm.routine.bye.doneMany': (v: { n: number }) => `${v.n} done today. That's plenty.`,
  'voice.calm.pet.rest.1': "You've been sitting a while. Water helps focus come back.",
  'voice.calm.pet.rest.2': "Let's stretch your shoulders. A loose body clears the mind.",
  'voice.calm.pet.rest.3': 'Look at something far away. Close screens tire the eyes.',
};
