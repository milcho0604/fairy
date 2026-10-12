import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 채팅 창의 같이 보기 (shared/chat-look.ts)
type Name = { name: string };
type Label = { label: string };

export const ko = {
  'chatLook.toggle': '화면 같이 보기',
  'chatLook.toggleTitle': '켜 두면 보낼 때마다 지금 화면을 한 장 찍어 질문과 함께 보내',
  'chatLook.confirmTitle': (v: Name) => `${withParticle(v.name, '이랑')} 화면을 같이 볼까?`,
  'chatLook.what':
    '켜 두면 질문을 보낼 때마다 채팅 창이 있는 모니터 화면 전체를 한 장 찍어. 채팅 창과 페어리는 빼고 찍어.',
  'chatLook.where': (v: Label) =>
    `찍은 화면은 질문과 함께 ${v.label}에 보내져서 이 컴퓨터 밖으로 나가. 파일로 남기지 않고 ${v.label} 대화 기록에도 남기지 않아. 이 창에는 작은 그림으로만 보여.`,
  'chatLook.whereNoAi': (v: Label) =>
    `지금 고른 ${withParticle(v.label, '은')} 화면을 못 봐서 켜 둬도 글만 보내. Claude나 Codex로 바꾸면 그쪽으로 화면을 보내.`,
  'chatLook.agree': '켜기',
  'chatLook.on': (v: Label) => `같이 보는 중: 보낼 때 이 모니터 화면을 찍어 ${v.label}에 같이 보내`,
  'chatLook.pick': '한 곳만 고르기',
  'chatLook.pickTitle': '화면에서 볼 곳을 끌어서 고르면 입력칸에 붙어 (바로 보내지 않아)',
  'chatLook.noPermission': (v: Name) =>
    `화면 기록 권한이 없어서 ${withParticle(v.name, '이')} 화면을 못 봐. 지금은 글만 보내.`,
  'chatLook.noPermissionMac':
    '시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 녹음에서 fairy를 켠 다음 페어리를 다시 켜 줘.',
  'chatLook.noImages': (v: Label) =>
    `${withParticle(v.label, '은')} 화면을 못 봐서 글만 보내. Claude나 Codex로 바꾸면 같이 볼 수 있어.`,
  'chatLook.notReady': (v: Label) =>
    `${withParticle(v.label, '이')} 아직 준비되지 않아서 화면을 못 봐. 준비되면 같이 볼게.`,
  'chatLook.shooting': '화면 찍는 중',
  'chatLook.shotFailed': '화면을 찍지 못해서 보내지 않았어. 다시 보내 보거나 같이 보기를 꺼 줘.',
  'chatLook.ask': (v: Name) => `${v.name}에게 지금 화면도 보여 줄까?`,
  'chatLook.askYes': '같이 보기 켜고 보내기',
  'chatLook.askNo': '글만 보내기',
};

export const en: Translation<typeof ko> = {
  'chatLook.toggle': 'Look at my screen',
  'chatLook.toggleTitle': 'While on, every message also sends one shot of your screen',
  'chatLook.confirmTitle': (v: Name) => `Look at your screen with ${v.name}?`,
  'chatLook.what':
    'While on, each time you send a message I take one shot of the whole monitor the chat window is on. The chat window and your fairy are left out.',
  'chatLook.where': (v: Label) =>
    `The shot goes to ${v.label} with your message, so it leaves this computer. It isn't saved as a file or kept in ${v.label}'s chat history. Here it only shows as a small picture.`,
  'chatLook.whereNoAi': (v: Label) =>
    `${v.label} can't see images, so only your text is sent even when this is on. Switch to Claude or Codex to send the screen there.`,
  'chatLook.agree': 'Turn on',
  'chatLook.on': (v: Label) => `Looking together: each message sends this monitor's screen to ${v.label}`,
  'chatLook.pick': 'Pick an area',
  'chatLook.pickTitle': 'Drag over the part to look at. It goes into the input box (not sent yet)',
  'chatLook.noPermission': (v: Name) =>
    `${v.name} can't see your screen without screen recording permission. Only text is sent for now.`,
  'chatLook.noPermissionMac':
    'Turn on fairy in System Settings > Privacy & Security > Screen & System Audio Recording, then restart fairy.',
  'chatLook.noImages': (v: Label) =>
    `${v.label} can't see images, so only text is sent. Switch to Claude or Codex to look together.`,
  'chatLook.notReady': (v: Label) => `${v.label} isn't ready yet, so it can't see your screen.`,
  'chatLook.shooting': 'Capturing screen',
  'chatLook.shotFailed':
    "Couldn't capture the screen, so nothing was sent. Try again or turn off Look at my screen.",
  'chatLook.ask': (v: Name) => `Show ${v.name} your screen too?`,
  'chatLook.askYes': 'Turn on and send',
  'chatLook.askNo': 'Send text only',
};
