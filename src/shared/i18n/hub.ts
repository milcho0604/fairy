import type { Translation } from './types.ts';

// 큰 창의 페어리, 비서 구역 (설정에서 꺼낸 것, ui/settings-slim)과 설정 쪽 안내.
// 줄표와 가운뎃점은 쓰지 않고(i18n.test.ts), "모드"라는 말도 쓰지 않는다.
export const ko = {
  'home.nav.pet': '페어리',
  'home.nav.assist': '비서',
  'hub.jump': '이 구역의 묶음',
  'pet.menu.openPet': '페어리 꾸미기',
  'pet.menu.openAssist': '비서 기능',
  // 페어리 구역
  'hub.pet.intro': '이름과 모습, 말투, 움직임처럼 페어리를 꾸미고 길들이는 것을 모았어.',
  'hub.pet.look': '이름과 모습',
  'hub.pet.look.lede': '이름을 짓고, 모습을 고르거나 사진으로 만들고, 크기와 옷을 바꿔.',
  'hub.pet.voice': '말투',
  'hub.pet.voice.lede': '성격을 고르거나 말끝을 직접 정하면 대사가 바뀌어. 아래 미리 듣기에서 바로 확인해.',
  'hub.pet.move': '움직임과 반응',
  'hub.pet.move.lede': '돌아다니는 방식, 눌렀을 때 하는 일, 마우스를 보는 눈 같은 반응을 정해.',
  'hub.pet.friends': '친구 페어리와 갤러리',
  'hub.pet.friends.lede': '함께 지낼 친구 페어리를 데려오고, 만든 페어리를 나누거나 받아 와.',
  'hub.pet.mood': '삐짐',
  'hub.pet.mood.lede': '쉬는 날과 얼마나 잘 토라지는지를 정해.',
  'hub.pet.perf': '성능',
  'hub.pet.perf.lede':
    '움직임을 더 부드럽게 하거나 컴퓨터 상태에 반응하게 해. 배터리 절약은 설정의 일반에 있어.',
  // 비서 구역
  'hub.assist.intro': '페어리가 먼저 말을 걸고, 하루를 챙기고, 일정을 알려 주는 기능을 모았어.',
  'hub.assist.talk': '말 걸기',
  'hub.assist.talk.lede':
    '페어리가 혼자 한마디 하는 빈도를 골라. 말 안 하는 시간과 알림은 설정의 일반에 있어.',
  'hub.assist.routine': '만나는 시간',
  'hub.assist.routine.lede': '일을 시작하고 끝내는 시간에 맞춰 인사하고 오늘 브리핑을 보여 줘.',
  'hub.assist.review': '하루 회고와 쪽지',
  'hub.assist.review.lede': '하루를 마칠 때 돌아보는 글과, 아침과 저녁에 받는 쪽지를 켜고 꺼. 할 일 마감 알림은 설정의 일반, 알림과 소리에서 끄고 켜.',
  'hub.assist.calendar': '캘린더 연결',
  'hub.assist.calendar.lede': '쓰던 캘린더의 일정을 가져와서 일정 구역과 브리핑에 함께 보여 줘.',
  'hub.assist.ai': 'AI 도우미',
  'hub.assist.ai.lede':
    '대화할 때 내 할 일을 알려 주거나 도구를 쓰게 할지 정해. 어떤 AI를 쓸지는 설정의 AI에 있어.',
  'hub.assist.memory': '규칙과 기억',
  'hub.assist.memory.lede': '대화할 때 늘 지킬 규칙과, 페어리가 나에 대해 기억해 둘 것을 적어.',
  // 설정 쪽
  'settings.notify': '알림과 소리',
  'settings.hubSign': '페어리의 모습, 말투, 움직임과 비서 기능은 큰 창 사이드바에 있어.',
  'settings.hubOpenPet': '페어리 열기',
  'settings.hubOpenAssist': '비서 열기',
  'settings.moved.title': '다른 곳에 있는 항목',
  'settings.moved.in': (v: { where: string; group: string }) => `${v.where} 구역의 ${v.group}`,
  'settings.moved.open': (v: { where: string }) => `${v.where} 구역 열기`,
  'hub.loading': '불러오는 중',
};

export const en: Translation<typeof ko> = {
  'home.nav.pet': 'Fairy',
  'home.nav.assist': 'Assistant',
  'hub.jump': 'Groups in this section',
  'pet.menu.openPet': 'Customize fairy',
  'pet.menu.openAssist': 'Assistant features',
  'hub.pet.intro': 'Everything for dressing up and training your fairy: name, look, voice and movement.',
  'hub.pet.look': 'Name and look',
  'hub.pet.look.lede': 'Name it, pick a look or make one from a photo, and change its size and outfit.',
  'hub.pet.voice': 'Voice',
  'hub.pet.voice.lede':
    'Pick a personality or set sentence endings yourself. Lines change, and you can hear a preview below.',
  'hub.pet.move': 'Movement and reactions',
  'hub.pet.move.lede': 'How it wanders, what happens when you click it, and how it follows your mouse.',
  'hub.pet.friends': 'Friend fairies and gallery',
  'hub.pet.friends.lede': 'Bring friend fairies to live with yours, and share or collect fairies.',
  'hub.pet.mood': 'Sulking',
  'hub.pet.mood.lede': 'Set the rest days and how easily it sulks.',
  'hub.pet.perf': 'Performance',
  'hub.pet.perf.lede':
    'Smoother movement and reactions to your computer. Battery saving is under General in Settings.',
  'hub.assist.intro': 'Your fairy starts conversations, looks after your day and reminds you of events.',
  'hub.assist.talk': 'Speaking up',
  'hub.assist.talk.lede':
    'Choose how often it talks on its own. Quiet hours and alerts are under General in Settings.',
  'hub.assist.routine': 'Meeting time',
  'hub.assist.routine.lede': 'Greets you when work starts and ends, and shows today’s briefing.',
  'hub.assist.review': 'Daily review and notes',
  'hub.assist.review.lede': 'Turn on the end-of-day look back and the morning and evening notes. Due-soon alerts for to-dos are under General, Alerts and sound in Settings.',
  'hub.assist.calendar': 'Calendar link',
  'hub.assist.calendar.lede':
    'Bring in events from the calendar you already use, shown in Events and the briefing.',
  'hub.assist.ai': 'AI helper',
  'hub.assist.ai.lede':
    'Decide whether chat knows your to-dos or can use tools. Which AI to use is under AI in Settings.',
  'hub.assist.memory': 'Rules and memory',
  'hub.assist.memory.lede': 'Write the rules it always follows and what it should remember about you.',
  'settings.notify': 'Alerts and sound',
  'settings.hubSign':
    'The fairy’s look, voice and movement, and the assistant features, are in the large window sidebar.',
  'settings.hubOpenPet': 'Open Fairy',
  'settings.hubOpenAssist': 'Open Assistant',
  'settings.moved.title': 'Found elsewhere',
  'settings.moved.in': (v: { where: string; group: string }) => `${v.group} in ${v.where}`,
  'settings.moved.open': (v: { where: string }) => `Open ${v.where}`,
  'hub.loading': 'Loading',
};
