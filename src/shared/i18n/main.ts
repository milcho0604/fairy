import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// main 영역 글
export const ko = {
  'main.onboardingTitle': '짝꿍 시작하기',
  'main.model.offline': '인터넷에 연결되어 있지 않아 받지 못했어. 연결을 확인하고 다시 해 줘.',
  'main.model.network': '연결이 불안정해서 받지 못했어. 인터넷 연결을 확인하고 잠시 뒤 다시 해 줘.',
  'main.model.server': (v: { status: number }) =>
    `받을 곳의 서버가 지금 답하지 않아 (${v.status}). 잠시 뒤 다시 해 줘.`,
  'main.model.gone': (v: { status: number }) =>
    `받을 파일이 서버에 없어 (${v.status}). 짝꿍을 최신 버전으로 업데이트한 뒤 다시 해 줘.`,
  'main.model.badHash':
    '받은 파일이 원래 파일과 달라서 버렸어. 다시 해 줘. 계속 그러면 회사 망이나 프록시가 파일을 바꾸는지 확인해 줘.',
  'main.model.diskFull': (v: { mb: number }) =>
    `저장 공간이 모자라 받지 못했어. ${v.mb}MB 넘게 비운 뒤 다시 해 줘.`,
  'main.model.busy': '이 모델은 이미 받는 중이야. 끝나면 다시 해 줘.',
  'main.model.cancelled': '받기를 멈췄어.',
  'main.model.failed': '받지 못했어. 잠시 뒤 다시 해 줘.',
  'main.file.diskFull': '저장 공간이 모자라 저장하지 못했어. 공간을 비운 뒤 다시 해 줘.',
  'main.file.noPermission': '짝꿍 폴더에 쓸 수 없어 저장하지 못했어. 짝꿍을 다시 켜고 해 줘.',
  'main.file.saveFailed': '저장하지 못했어. 다시 해 줘.',
  'main.update.off': '꺼져 있어',
  'main.update.none': '아직 받을 수 있는 버전이 없어',
  'main.update.failedStatus': (v: { status: number }) => `확인하지 못했어 (${v.status})`,
  'main.update.latest': '최신 버전이야',
  'main.update.skipped': '건너뛴 버전이야',
  'main.update.bubble': (v: { version: string }) => `새 버전 ${withParticle(v.version, '이')} 나왔어.`,
  'main.update.get': '받으러 가기',
  'main.update.skip': '이 버전은 건너뛰기',
  'main.update.found': (v: { version: string }) => `새 버전 ${v.version}`,
  'main.update.offline': '확인하지 못했어 (인터넷 연결을 봐 줘)',
  'main.update.badResponse': '확인하지 못했어 (받은 응답을 읽을 수 없어)',
  'main.update.forced': (v: { version: string; min: string }) =>
    `이 버전은 이제 쓸 수 없어. ${v.min} 이상이 필요해서 새 버전 ${withParticle(v.version, '으로')} 업데이트해 줘. 그때까지 AI 대화는 쉴게.`,
  'main.update.forcedFound': (v: { min: string }) =>
    `업데이트가 필요해 (${v.min} 이상). 그때까지 AI 대화는 잠겨`,
  'main.update.lockedShort': 'AI 대화는 업데이트한 뒤에 쓸 수 있어',
  'main.update.ready': (v: { version: string }) =>
    `새 버전 ${withParticle(v.version, '을')} 받아 뒀어. 끝낼 때 설치할게.`,
  // 맥은 끝낼 때 저절로 설치하지 않는다 (main/update.ts installOnQuit)
  'main.update.readyRestart': (v: { version: string }) =>
    `새 버전 ${withParticle(v.version, '을')} 받아 뒀어. 다시 켜면 바로 바뀌어.`,
  'main.update.restart': '다시 켜서 업데이트',
  'main.backup.exportTitle': '백업을 둘 폴더',
  'main.backup.importTitle': '가져올 백업 폴더',
  'main.backup.notBackup': '짝꿍 백업 폴더가 아니야',
  'main.backup.newer': '더 새 판 짝꿍이 만든 백업이야. 짝꿍을 새 버전으로 올린 뒤 가져와 줘.',
  'main.backup.confirm': '지금 할 일, 메모, 펫을 이 백업으로 바꿀까?',
  'main.backup.confirmDetail':
    '설정, 짝꿍 규칙, 캘린더 주소도 백업 것으로 바뀌어. 지금 데이터는 사용자 데이터 폴더의 before-import 폴더에 남겨 둬. 바꾼 뒤 짝꿍을 다시 켜.',
  'main.backup.customAiSkipped': '백업에 있던 사용자 AI {n}개는 옮기지 않았어.',
  'main.backup.customAiSkippedDetail':
    '사용자 AI 는 이 컴퓨터에서 실행할 명령이라 백업에서 가져오지 않아. 필요하면 다시 켠 뒤 채팅에서 다시 추가해 줘.',
  'main.backup.replace': '바꾸기',
  'main.backup.cancel': '그만두기',
  'main.backup.restarting': '다시 켜는 중',
  'main.pet.exportTitle': '펫 내보내기',
  'main.pet.importTitle': '펫 가져오기',
  'main.pet.fileType': '짝꿍 펫',
  'main.pet.friendsMax': (v: { max: number }) => `친구 펫은 ${v.max}마리까지야.`,
  'main.pet.friendCame': (v: { name: string }) => `${withParticle(v.name, '이')} 친구로 왔어`,
  'main.pet.replaceAsk': (v: { name: string }) => `${withParticle(v.name, '으로')} 바꿀까?`,
  'main.pet.replaceDetail': '지금 펫의 이름과 모습이 바뀌어. 할 일, 코인, 친밀도는 그대로야.',
  'main.pet.came': (v: { name: string }) => `${withParticle(v.name, '이')} 왔어`,
  'main.pet.unreadable': '펫 파일을 읽지 못했어. 파일이 그 자리에 있는지 보고 다시 골라 줘.',
  'main.maker.reopen': '창을 다시 열어 줘.',
  'main.maker.badFormat': '그림 형식이 이상해.',
  'main.maker.tooBigAny': '그림이 너무 크거나 PNG, GIF, WebP 가 아니야.',
  'main.maker.tooBigPng': '그림이 너무 크거나 PNG 가 아니야.',
  'main.maker.title': '사진으로 펫 만들기',
  'main.maker.noVisionAi':
    '사진을 볼 수 있는 AI(Claude, Codex)가 없어. 채팅에서 하나를 설치하고 로그인하면 쓸 수 있어.',
  'main.maker.shapeCancelled': '입체 만들기를 멈췄어.',
  'main.maker.shapeBad': 'AI 답에서 설계도를 못 읽었어. 한 번 더 해 볼래?',
  'main.illust.quota': '오늘 무료 사용량을 다 썼어. 내일 다시 하거나 무료 Hugging Face 토큰을 넣어 줘.',
  'main.illust.quotaToken': '이 토큰의 오늘 무료 사용량을 다 썼어. 내일 다시 해 줘.',
  'main.illust.limit': '토큰 없이는 이 그림을 못 그린대. 무료 Hugging Face 토큰을 넣고 다시 해 줘.',
  'main.illust.auth': 'Hugging Face 토큰이 맞지 않아. 토큰을 지우거나 새로 넣어 줘.',
  'main.illust.offline': '그림 서버에 연결하지 못했어. 인터넷 연결을 보고 다시 해 줘.',
  'main.illust.timeout': '너무 오래 걸려서 멈췄어. 조금 있다가 다시 해 줘.',
  'main.illust.cancelled': '그리기를 멈췄어.',
  'main.illust.bad': '그림 서버가 새 그림을 주지 않았어. 다시 그려 보거나 사진 그대로 해 줘.',
  'main.illust.down': '무료 그림 서버가 지금 바쁘거나 쉬는 중이야. 조금 있다가 다시 해 줘.',
  'main.illust.tokenShape': '토큰 모양이 이상해. hf_ 로 시작하는 토큰을 붙여 넣어 줘.',
  'main.remake.notFigure': '입체 피규어로 만든 사진 펫만 몸을 다시 만들 수 있어.',
  'main.remake.changed': '그사이 펫이 바뀌어서 새 몸은 버렸어.',
  'main.db.recovered':
    '저장 파일이 깨져 있었어. 지우지 않고 {moved} 로 옮겨 두고, {when} 에 남겨 둔 복사본으로 되살렸어. 그 뒤에 한 것은 빠졌을 수 있어.',
  'main.db.fresh':
    '저장 파일이 깨져 있었어. 지우지 않고 {moved} 로 옮겨 두고 새로 시작했어. 백업이 있으면 설정에서 가져올 수 있어.',
  'main.db.newer':
    '저장 파일이 더 새 판 짝꿍에서 만들어졌어. 덮어쓰지 않게 이번에는 저장하지 않고 켰어. 짝꿍을 최신 버전으로 업데이트해 줘.',
  'main.db.unavailable': '저장 파일을 열지 못했어. 이번에는 저장하지 않고 켰어. 짝꿍을 다시 켜 봐.',
  'main.db.showFile': '파일 보기',
};

export const en: Translation<typeof ko> = {
  'main.onboardingTitle': 'Getting started',
  'main.model.offline': "You're not connected to the internet. Check your connection and try again.",
  'main.model.network':
    "The connection wasn't stable enough to download. Check your internet connection and try again in a moment.",
  'main.model.server': (v: { status: number }) =>
    `The download server isn't responding right now (${v.status}). Try again in a moment.`,
  'main.model.gone': (v: { status: number }) =>
    `The file is no longer on the server (${v.status}). Update Jjakkung to the latest version, then try again.`,
  'main.model.badHash':
    "The downloaded file didn't match the original, so I threw it away. Try again. If it keeps happening, check whether a work network or proxy is changing files.",
  'main.model.diskFull': (v: { mb: number }) =>
    `Not enough disk space to download. Free up more than ${v.mb} MB and try again.`,
  'main.model.busy': 'This model is already downloading. Try again when it finishes.',
  'main.model.cancelled': 'Download stopped.',
  'main.model.failed': "Couldn't download it. Try again in a moment.",
  'main.file.diskFull': 'Not enough disk space to save. Free up some space and try again.',
  'main.file.noPermission':
    "Couldn't write to the Jjakkung folder, so nothing was saved. Restart Jjakkung and try again.",
  'main.file.saveFailed': "Couldn't save. Please try again.",
  'main.update.off': "It's turned off",
  'main.update.none': 'No version to download yet',
  'main.update.failedStatus': (v: { status: number }) => `Couldn't check (${v.status})`,
  'main.update.latest': "You're on the latest version",
  'main.update.skipped': 'You skipped this version',
  'main.update.bubble': (v: { version: string }) => `Version ${v.version} is out.`,
  'main.update.get': 'Get it',
  'main.update.skip': 'Skip this version',
  'main.update.found': (v: { version: string }) => `New version ${v.version}`,
  'main.update.offline': "Couldn't check (check your internet connection)",
  'main.update.badResponse': "Couldn't check (the response couldn't be read)",
  'main.update.forced': (v: { version: string; min: string }) =>
    `This version can't be used anymore. Version ${v.min} or later is required, so please update to ${v.version}. AI chat is paused until then.`,
  'main.update.forcedFound': (v: { min: string }) =>
    `Update required (${v.min} or later). AI chat is locked until then`,
  'main.update.lockedShort': 'AI chat is available after you update',
  'main.update.ready': (v: { version: string }) =>
    `Version ${v.version} is downloaded. It installs when you quit.`,
  'main.update.readyRestart': (v: { version: string }) =>
    `Version ${v.version} is downloaded. Restart to switch to it.`,
  'main.update.restart': 'Restart to update',
  'main.backup.exportTitle': 'Folder for the backup',
  'main.backup.importTitle': 'Backup folder to import',
  'main.backup.notBackup': "That's not a Jjakkung backup folder",
  'main.backup.newer': 'This backup was made by a newer Jjakkung. Update Jjakkung first, then import it.',
  'main.backup.confirm': 'Replace your current to-dos, notes and pet with this backup?',
  'main.backup.confirmDetail':
    "Your settings, pet rules and calendar address change to the backup's too. Your current data stays in the before-import folder inside the user data folder. Jjakkung restarts after the switch.",
  'main.backup.customAiSkipped': "Custom AIs from the backup ({n}) weren't brought over.",
  'main.backup.customAiSkippedDetail':
    'Custom AIs are commands that run on this computer, so backups never import them. Add them again in the chat after the restart if you need them.',
  'main.backup.replace': 'Replace',
  'main.backup.cancel': 'Cancel',
  'main.backup.restarting': 'Restarting',
  'main.pet.exportTitle': 'Export pet',
  'main.pet.importTitle': 'Import pet',
  'main.pet.fileType': 'Jjakkung pet',
  'main.pet.friendsMax': (v: { max: number }) => `You can have up to ${v.max} friend pets.`,
  'main.pet.friendCame': (v: { name: string }) => `${v.name} came over as a friend`,
  'main.pet.replaceAsk': (v: { name: string }) => `Switch to ${v.name}?`,
  'main.pet.replaceDetail': "Your pet's name and look will change. To-dos, coins and bond stay the same.",
  'main.pet.came': (v: { name: string }) => `${v.name} is here`,
  'main.pet.unreadable': "Couldn't read the pet file. Check that it's still there and pick it again.",
  'main.maker.reopen': 'Please reopen the window.',
  'main.maker.badFormat': 'The picture format looks off.',
  'main.maker.tooBigAny': 'The picture is too big or not a PNG, GIF or WebP.',
  'main.maker.tooBigPng': 'The picture is too big or not a PNG.',
  'main.maker.title': 'Make a pet from a photo',
  'main.maker.noVisionAi':
    'No AI that can see photos (Claude, Codex). Install and sign in to one from the chat to use this.',
  'main.maker.shapeCancelled': 'Stopped making the 3D pet.',
  'main.maker.shapeBad': "Couldn't read a blueprint from the AI's answer. Try again?",
  'main.illust.quota':
    "You've used up today's free drawings. Try again tomorrow, or add a free Hugging Face token.",
  'main.illust.quotaToken': "This token has used up today's free drawings. Try again tomorrow.",
  'main.illust.limit': 'This drawing needs a token. Add a free Hugging Face token and try again.',
  'main.illust.auth': "The Hugging Face token didn't work. Remove it or add a new one.",
  'main.illust.offline': "Couldn't reach the drawing server. Check your internet and try again.",
  'main.illust.timeout': 'It took too long, so I stopped. Try again in a bit.',
  'main.illust.cancelled': 'Stopped drawing.',
  'main.illust.bad': "The drawing server didn't send a new picture. Draw again, or use the photo as is.",
  'main.illust.down': 'The free drawing server is busy or resting right now. Try again in a bit.',
  'main.illust.tokenShape': "That doesn't look like a token. Paste one that starts with hf_.",
  'main.remake.notFigure': 'Only photo pets made as a 3D figure can get a new body.',
  'main.remake.changed': 'The pet changed in the meantime, so the new body was dropped.',
  'main.db.recovered':
    'Your save file was damaged. I kept it as {moved} and brought back the copy saved on {when}. Anything after that may be missing.',
  'main.db.fresh':
    'Your save file was damaged. I kept it as {moved} and started fresh. If you have a backup, you can import it in Settings.',
  'main.db.newer':
    "Your save file is from a newer Jjakkung. So I won't overwrite it, nothing is saved this time. Please update Jjakkung.",
  'main.db.unavailable':
    "I couldn't open your save file, so nothing is saved this time. Try restarting Jjakkung.",
  'main.db.showFile': 'Show file',
};
