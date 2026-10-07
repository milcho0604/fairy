import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// main 영역 글
export const ko = {
  'main.onboardingTitle': '짝꿍 시작하기',
  'main.model.downloadFailed': (v: { status: number }) => `모델을 받지 못했어 (${v.status})`,
  'main.model.badHash': '받은 모델 파일이 맞지 않아 (SHA-256 다름). 다시 시도해 줘.',
  'main.model.busy': '이 모델은 이미 받는 중이야. 끝나면 다시 해 줘.',
  'main.update.off': '꺼져 있어',
  'main.update.none': '아직 받을 수 있는 버전이 없어',
  'main.update.failedStatus': (v: { status: number }) => `확인하지 못했어 (${v.status})`,
  'main.update.latest': '최신 버전이야',
  'main.update.skipped': '건너뛴 버전이야',
  'main.update.bubble': (v: { version: string }) => `새 버전 ${v.version} 이 나왔어.`,
  'main.update.get': '받으러 가기',
  'main.update.skip': '이 버전은 건너뛰기',
  'main.update.found': (v: { version: string }) => `새 버전 ${v.version}`,
  'main.update.offline': '확인하지 못했어 (인터넷 연결을 봐 줘)',
  'main.update.forced': (v: { version: string; min: string }) =>
    `이 버전은 이제 쓸 수 없어. ${v.min} 이상이 필요해서 새 버전 ${v.version} 으로 업데이트해 줘. 그때까지 AI 대화는 쉴게.`,
  'main.update.forcedFound': (v: { min: string }) =>
    `업데이트가 필요해 (${v.min} 이상). 그때까지 AI 대화는 잠겨`,
  'main.update.lockedShort': 'AI 대화는 업데이트한 뒤에 쓸 수 있어',
  'main.update.ready': (v: { version: string }) => `새 버전 ${v.version} 을 받아 뒀어. 끝낼 때 설치할게.`,
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
  'main.maker.reopen': '창을 다시 열어 줘.',
  'main.maker.badFormat': '그림 형식이 이상해.',
  'main.maker.tooBigAny': '그림이 너무 크거나 PNG, GIF, WebP 가 아니야.',
  'main.maker.tooBigPng': '그림이 너무 크거나 PNG 가 아니야.',
  'main.maker.title': '사진으로 펫 만들기',
  'main.maker.noVisionAi':
    '사진을 볼 수 있는 AI(Claude, Codex)가 없어. 채팅에서 하나를 설치하고 로그인하면 쓸 수 있어.',
  'main.maker.shapeCancelled': '입체 만들기를 멈췄어.',
  'main.maker.shapeBad': 'AI 답에서 설계도를 못 읽었어. 한 번 더 해 볼래?',
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
  'main.model.downloadFailed': (v: { status: number }) => `Couldn't download the model (${v.status})`,
  'main.model.badHash': "The downloaded model file doesn't match (SHA-256 differs). Please try again.",
  'main.model.busy': 'This model is already downloading. Try again when it finishes.',
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
  'main.update.forced': (v: { version: string; min: string }) =>
    `This version can't be used anymore. Version ${v.min} or later is required, so please update to ${v.version}. AI chat is paused until then.`,
  'main.update.forcedFound': (v: { min: string }) =>
    `Update required (${v.min} or later). AI chat is locked until then`,
  'main.update.lockedShort': 'AI chat is available after you update',
  'main.update.ready': (v: { version: string }) =>
    `Version ${v.version} is downloaded. It installs when you quit.`,
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
  'main.maker.reopen': 'Please reopen the window.',
  'main.maker.badFormat': 'The picture format looks off.',
  'main.maker.tooBigAny': 'The picture is too big or not a PNG, GIF or WebP.',
  'main.maker.tooBigPng': 'The picture is too big or not a PNG.',
  'main.maker.title': 'Make a pet from a photo',
  'main.maker.noVisionAi':
    'No AI that can see photos (Claude, Codex). Install and sign in to one from the chat to use this.',
  'main.maker.shapeCancelled': 'Stopped making the 3D pet.',
  'main.maker.shapeBad': "Couldn't read a blueprint from the AI's answer. Try again?",
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
