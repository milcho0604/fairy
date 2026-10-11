import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 첫 실행 안내 창
export const ko = {
  'onboarding.pages': (v: { page: number; total: number }) => `${v.total}쪽 중 ${v.page}쪽`,
  'onboarding.hello.title': '반가워! 화면 위에서 같이 일할 페어리야.',
  'onboarding.hello.lead': '할 일을 끝내면 코인이 쌓이고, 코인으로 밥과 장난감을 사 줄 수 있어.',
  'onboarding.hello.name': '이름',
  'onboarding.hello.nameEmpty': '이름은 비울 수 없어. 원래 이름으로 둘게.',
  'onboarding.hello.nameMax': '이름은 {max}자까지야.',
  'onboarding.hello.look': '모습',
  'onboarding.hello.kinds': '기본 페어리 모양',
  /** 그림으로 들어 있는 친구 (밀크, 초코) 묶음 화면 읽기 */
  'onboarding.hello.starters': '그림 친구',
  'onboarding.hello.photo': '사진으로',
  'onboarding.hello.photoHint': '반려동물이나 인형 사진 한 장으로 만들 수도 있어. 나중에 설정에서 바꿔도 돼.',
  'onboarding.look.title': '같이 보기',
  'onboarding.look.lead': (v: { name: string }) =>
    `${withParticle(v.name, '을')} 우클릭하고 "${withParticle(v.name, '이랑')} 같이 보기"를 고르면, 화면 일부를 찍어 AI에게 물어볼 수 있어. 찍은 화면은 저장하지 않고 고른 AI에게만 보내.`,
  'onboarding.look.granted': '화면 기록 권한이 있어',
  'onboarding.look.needed': '화면 기록 권한이 필요해',
  'onboarding.look.howTo':
    '시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 녹음에서 fairy를 켜 줘. 켠 다음에는 페어리를 껐다 켜야 해. ' +
    '이미 켜져 있는데도 이렇게 나오면 목록에서 fairy를 골라 − 버튼으로 지우고, 페어리를 다시 켠 뒤 같이 보기에서 맥이 물을 때 허용해 줘. ' +
    '같이 보기를 안 쓸 거면 넘어가도 돼.',
  'onboarding.look.openSettings': '시스템 설정 열기',
  'onboarding.look.windows': '윈도우는 따로 권한이 필요 없어',
  'onboarding.look.ai':
    'AI는 이 컴퓨터에 설치해 로그인해 둔 Claude Code, Codex, Cursor, Gemini 중 하나를 써. 채팅 창에서 고를 수 있어.',
  'onboarding.look.aiFree': (v: { size: string }) =>
    `AI 프로그램이 없어도 무료 AI로 대화할 수 있어. 처음 한 번 모델(${v.size})을 받고, 그 뒤로는 이 컴퓨터 안에서만 돌아.`,
  'onboarding.tips.title': '알아 두면 좋은 것',
  'onboarding.tips.click': (v: { name: string }) => `${withParticle(v.name, '을')} 누르면`,
  'onboarding.tips.clickDesc': '할 일, 메모, 일정, 상점 패널',
  'onboarding.tips.right': '우클릭',
  'onboarding.tips.rightDesc': '대화, 같이 보기, 밥, 놀기, 숨기기',
  'onboarding.tips.rub': '좌우로 문지르기',
  'onboarding.tips.rubDesc': '쓰다듬기. 하트가 떠',
  'onboarding.tips.throw': '잡아서 휙 놓기',
  'onboarding.tips.throwDesc': '던지기. 떨어져서 통통 튀어',
  'onboarding.tips.quickDesc': '어디서든 할 일이나 일정 한 줄 ("내일 3시 회의")',
  'onboarding.tips.hideDesc': '잠깐 숨기기, 다시 보이기',
  'onboarding.prev': '이전',
  'onboarding.skip': '건너뛰기',
  'onboarding.next': '다음',
  'onboarding.start': '시작하기',
};

export const en: Translation<typeof ko> = {
  'onboarding.pages': (v) => `Page ${v.page} of ${v.total}`,
  'onboarding.hello.title': "Hi! I'm your new buddy, here on your screen to work alongside you.",
  'onboarding.hello.lead': 'Finish to-dos to earn coins, then spend them on food and toys for me.',
  'onboarding.hello.name': 'Name',
  'onboarding.hello.nameEmpty': "A name can't be empty. Keeping the old one.",
  'onboarding.hello.nameMax': 'Names can be up to {max} characters.',
  'onboarding.hello.look': 'Look',
  'onboarding.hello.kinds': 'Default fairy look',
  'onboarding.hello.starters': 'Illustrated friends',
  'onboarding.hello.photo': 'From a photo',
  'onboarding.hello.photoHint':
    'You can also make one from a single photo of a pet or a plush. You can change it later in settings.',
  'onboarding.look.title': 'Look together',
  'onboarding.look.lead': (v) =>
    `Right-click ${v.name} and pick "Look together with ${v.name}" to capture part of your screen and ask AI about it. Captures aren't saved, they only go to the AI you picked.`,
  'onboarding.look.granted': 'Screen recording is allowed',
  'onboarding.look.needed': 'Screen recording permission needed',
  'onboarding.look.howTo':
    'Turn on fairy in System Settings > Privacy & Security > Screen & System Audio Recording, then restart fairy. ' +
    'Already on and still seeing this? Select fairy in the list, remove it with the − button, restart fairy and allow it when macOS asks again. ' +
    "If you won't use Look together, you can skip this.",
  'onboarding.look.openSettings': 'Open System Settings',
  'onboarding.look.windows': 'No extra permission needed on Windows',
  'onboarding.look.ai':
    'AI uses Claude Code, Codex, Cursor or Gemini, whichever you installed and signed in to on this computer. You can pick one in the chat window.',
  'onboarding.look.aiFree': (v) =>
    `No AI app? You can still chat with the free AI. It downloads a model (${v.size}) once, then runs only on this computer.`,
  'onboarding.tips.title': 'Good to know',
  'onboarding.tips.click': (v) => `Click ${v.name}`,
  'onboarding.tips.clickDesc': 'To-dos, notes, events and shop panel',
  'onboarding.tips.right': 'Right-click',
  'onboarding.tips.rightDesc': 'Chat, look together, feed, play, hide',
  'onboarding.tips.rub': 'Rub side to side',
  'onboarding.tips.rubDesc': 'Petting. Hearts pop up',
  'onboarding.tips.throw': 'Grab and fling',
  'onboarding.tips.throwDesc': 'Throwing. I fall and bounce',
  'onboarding.tips.quickDesc': 'Add a to-do or event in one line, from anywhere ("meeting tomorrow 3pm")',
  'onboarding.tips.hideDesc': 'Hide for a bit, show again',
  'onboarding.prev': 'Back',
  'onboarding.skip': 'Skip',
  'onboarding.next': 'Next',
  'onboarding.start': 'Get started',
};
