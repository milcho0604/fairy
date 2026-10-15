import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// main 영역 글
export const ko = {
  'main.onboardingTitle': '페어리 시작하기',
  'main.model.offline': '인터넷에 연결되어 있지 않아 받지 못했어. 인터넷 연결을 확인하고 다시 해 줘.',
  'main.model.network': '연결이 불안정해서 받지 못했어. 인터넷 연결을 확인하고 잠시 뒤 다시 해 줘.',
  'main.model.server': (v: { status: number }) =>
    `받을 곳의 서버가 지금 답하지 않아 (${v.status}). 잠시 뒤 다시 해 줘.`,
  'main.model.gone': (v: { status: number }) =>
    `받을 파일이 서버에 없어 (${v.status}). 페어리를 최신 버전으로 업데이트한 뒤 다시 해 줘.`,
  'main.model.badHash':
    '받은 파일이 원래 파일과 달라서 버렸어. 다시 해 줘. 계속 그러면 회사 망이나 프록시가 파일을 바꾸는지 확인해 줘.',
  'main.model.diskFull': (v: { mb: number }) =>
    `저장 공간이 모자라 받지 못했어. ${v.mb}MB 넘게 비운 뒤 다시 해 줘.`,
  'main.model.busy': '이 모델은 이미 받는 중이야. 끝나면 다시 해 줘.',
  'main.model.cancelled': '받기를 멈췄어.',
  'main.model.failed': '받지 못했어. 잠시 뒤 다시 해 줘.',
  'main.file.diskFull': '저장 공간이 모자라 저장하지 못했어. 공간을 비운 뒤 다시 해 줘.',
  'main.file.noPermission': '페어리 폴더에 쓸 수 없어 저장하지 못했어. 페어리를 다시 켜고 해 줘.',
  'main.file.saveFailed': '저장하지 못했어. 다시 해 줘.',
  'main.update.off': '꺼져 있어',
  'main.update.unavailable': '지금은 확인할 수 없어 (릴리스 페이지가 아직 공개되지 않았어)',
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
  // 끝낼 때 저절로 설치하지 않는다 (main/update.ts installOnQuit). 위 ready 는 그 값을 켤 때 쓴다
  'main.update.readyRestart': (v: { version: string }) =>
    `새 버전 ${withParticle(v.version, '을')} 받아 뒀어. 다시 켜면 바로 바뀌어.`,
  'main.update.restart': '다시 켜서 업데이트',
  // 다시 켜서 업데이트가 거절됐다 (맥 서명 확인 실패 등). 홈페이지 설치 안내를 연 뒤 말한다 (main/update.ts)
  'main.update.installFailed':
    '자동으로 설치하지 못해서 설치 안내를 열었어. 거기서 받아 설치해 줘. 처음 열 때 경고 창이 뜨면 안내대로 넘기면 돼.',
  // 개인 백업 파일 (이슈 #90). 파일 이름은 날짜만 바뀐다: 페어리 백업 2026-10-15.fairybackup
  'main.backup.saveTitle': '백업 파일 저장',
  'main.backup.fileName': '페어리 백업 {date}',
  'main.backup.fileType': '페어리 백업',
  'main.backup.importTitle': '가져올 백업 파일',
  'main.backup.importFolderTitle': '가져올 예전 백업 폴더',
  'main.backup.notBackup': '페어리 백업이 아니야',
  'main.backup.newer': '더 새 판 페어리가 만든 백업이야. 페어리를 업데이트한 뒤 가져와 줘.',
  'main.backup.tooBig': '백업 파일이 너무 커서 열지 않았어.',
  'main.backup.damaged': '백업 파일이 깨졌어. 다른 백업 파일로 해 봐.',
  'main.backup.unsafe': '백업 파일 안에 이상한 경로가 있어서 열지 않았어.',
  'main.backup.busy': '백업을 살펴보는 중이야. 잠깐만 기다려 줘.',
  'main.backup.noUndo': '되돌릴 데이터가 없어.',
  'main.backup.offerGone': '이 백업은 이제 가져올 수 없어. 다시 골라 줘.',
  'main.backup.exportTooBig': '데이터가 너무 커서 백업 파일 하나에 담지 못했어.',
  'main.backup.replace': '바꾸기',
  'main.backup.cancel': '그만두기',
  'main.backup.restarting': '다시 켜는 중',
  'main.pet.exportTitle': '페어리 내보내기',
  'main.pet.importTitle': '페어리 가져오기',
  'main.pet.fileType': '페어리 파일',
  'main.pet.friendsMax': (v: { max: number }) => `친구 페어리는 ${v.max}마리까지 초대할 수 있어.`,
  'main.pet.friendCame': (v: { name: string }) => `${withParticle(v.name, '이')} 친구로 왔어`,
  'main.pet.replaceAsk': (v: { name: string }) => `${withParticle(v.name, '으로')} 바꿀까?`,
  'main.pet.replaceDetail': '지금 페어리의 이름과 모습이 바뀌어. 할 일, 코인, 친밀도는 그대로야.',
  'main.pet.came': (v: { name: string }) => `${withParticle(v.name, '이')} 왔어`,
  'main.pet.unreadable': '페어리 파일을 읽지 못했어. 파일이 그 자리에 있는지 보고 다시 골라 줘.',
  // Codex 펫 파일 (.codex-pet.zip) 가져오기 (main/codex-pet.ts)
  'main.codex.fileType': 'Codex 펫 파일',
  'main.codex.notZip': 'Codex 펫 파일(zip)로 읽을 수 없어.',
  'main.codex.unsafe': '파일 안에 이상한 경로가 있어서 열지 않았어.',
  'main.codex.tooBig': 'Codex 펫 파일이 너무 커.',
  'main.codex.noManifest': 'pet.json이 없거나 깨졌어.',
  'main.codex.noSheet': '펫 그림(spritesheet)이 없어.',
  'main.codex.badSheet': '펫 그림이 Codex 펫 크기(1536x1872 PNG, WebP)가 아니야.',
  'main.codex.noIdle': '서 있는 그림(첫 줄 첫 칸)이 비어 있어.',
  'main.codex.personal':
    'Codex 펫은 남이 만든 그림일 수 있어서 개인 용도로 데려와. 페어리 갤러리에는 올라가지 않아.',
  'main.maker.reopen': '창을 다시 열어 줘.',
  'main.maker.badFormat': '그림 형식이 이상해.',
  'main.maker.tooBigAny': '그림이 너무 크거나 PNG, GIF, WebP가 아니야.',
  'main.maker.tooBigPng': '그림이 너무 크거나 PNG가 아니야.',
  'main.maker.title': '사진으로 페어리 만들기',
  'main.maker.noVisionAi':
    '사진을 볼 수 있는 AI(Claude, Codex)가 없어. 채팅에서 하나를 설치하고 로그인하면 쓸 수 있어.',
  'main.maker.shapeCancelled': '입체 만들기를 멈췄어.',
  'main.maker.shapeBad': 'AI 답에서 설계도를 못 읽었어. 한 번 더 해 볼래?',
  'main.maker.noTextAi': '연결된 AI를 찾지 못했어. 채팅에서 AI를 설치하고 로그인하면 말로 만들 수 있어.',
  'main.maker.textEmpty': '만들고 싶은 모습을 먼저 적어 줘.',
  'main.maker.textFailed': '이번엔 AI가 답하지 못했어. 조금 뒤에 다시 해 볼래?',
  'main.maker.textBad': 'AI 답에서 페어리 설계도를 못 읽었어. 조금 다르게 적어서 한 번 더 해 볼래?',
  'main.illust.quota':
    "오늘 무료 그림 횟수를 다 썼어. 이 횟수는 다른 사람과 나눠 쓰는 게 아니라 네 인터넷 연결마다 따로 세고, 하루가 지나면 다시 채워져. 지금 바로 만들려면 아래 'Gemini 앱(무료)에서 만들기'를 쓰거나, 무료 Hugging Face 토큰을 넣어 줘.",
  'main.illust.quotaLocal':
    "오늘 무료 그림 횟수를 다 썼어. 이 횟수는 다른 사람과 나눠 쓰는 게 아니라 네 인터넷 연결마다 따로 세고, 하루가 지나면 다시 채워져. 지금 바로 만들려면 아래 'Gemini 앱(무료)에서 만들기'나 '내 컴퓨터에서 그리기'를 쓰거나, 무료 Hugging Face 토큰을 넣어 줘.",
  'main.illust.quotaToken':
    "이 토큰의 오늘 무료 사용량을 다 썼어. 하루가 지나면 다시 채워져. 지금 바로 만들려면 아래 'Gemini 앱(무료)에서 만들기'를 써 줘.",
  'main.illust.limit': '토큰 없이는 이 그림을 못 그린대. 아래에서 무료 Hugging Face 토큰을 넣고 다시 해 줘.',
  'main.illust.auth': 'Hugging Face 토큰이 맞지 않아. 토큰을 지우거나 새로 넣어 줘.',
  'main.illust.refused':
    "그림 서버가 이유 없이 거절했어. 대개 오늘 무료 횟수(네 인터넷 연결마다 따로, 하루면 다시 채워져)를 다 썼을 때 이래. 아래 'Gemini 앱(무료)에서 만들기'를 쓰거나, 무료 Hugging Face 토큰을 넣어 줘.",
  'main.illust.refusedLocal':
    "그림 서버가 이유 없이 거절했어. 대개 오늘 무료 횟수(네 인터넷 연결마다 따로, 하루면 다시 채워져)를 다 썼을 때 이래. 아래 'Gemini 앱(무료)에서 만들기'나 '내 컴퓨터에서 그리기'를 쓰거나, 무료 Hugging Face 토큰을 넣어 줘.",
  'main.illust.refusedToken':
    '그림 서버가 이유 없이 거절했어. 대개 이 토큰의 오늘 무료 사용량을 다 썼을 때 이래. 조금 있다가 또는 내일 다시 해 줘.',
  'main.illust.offline': '그림 서버에 연결하지 못했어. 인터넷 연결을 확인하고 다시 해 줘.',
  'main.illust.timeout': '너무 오래 걸려서 멈췄어. 조금 있다가 다시 해 줘.',
  'main.illust.cancelled': '그리기를 멈췄어.',
  'main.illust.bad': '그림 서버가 새 그림을 주지 않았어. 다시 그려 보거나 사진 그대로 해 줘.',
  'main.illust.down': '무료 그림 서버가 지금 바쁘거나 쉬는 중이야. 조금 있다가 다시 해 줘.',
  'main.illust.tokenShape': '토큰 모양이 이상해. hf_로 시작하는 토큰을 붙여 넣어 줘.',
  'main.sprites.quota':
    "오늘 무료 그림 횟수를 다 썼어. 여기까지 만든 동작은 그대로 저장할 수 있어 (빠진 자세는 가까운 그림으로 채워져). 횟수는 네 인터넷 연결마다 따로 세고 하루가 지나면 다시 채워져. 더 만들려면 '사진으로 페어리 만들기'의 'AI 일러스트로 다시 그리기'에서 무료 Hugging Face 토큰을 넣어 줘.",
  'main.sprites.quotaToken':
    '이 토큰의 오늘 무료 사용량을 다 썼어. 여기까지 만든 동작은 그대로 저장할 수 있고, 하루가 지나면 남은 동작을 다시 만들 수 있어.',
  'main.sprites.refused':
    '그림 서버가 이유 없이 거절했어. 대개 오늘 무료 횟수(네 인터넷 연결마다 따로, 하루면 다시 채워져)를 다 썼을 때 이래. 여기까지 만든 동작은 그대로 저장할 수 있어.',
  'main.sprites.refusedToken':
    '그림 서버가 이유 없이 거절했어. 대개 이 토큰의 오늘 무료 사용량을 다 썼을 때 이래. 여기까지 만든 동작은 그대로 저장할 수 있어.',
  'main.sprites.changed': '그사이 페어리가 바뀌었어. 창을 닫고 지금 페어리로 다시 만들어 줘.',
  'main.sprites.bad': '그림 세트가 규칙에 맞지 않아 저장하지 못했어. 다시 만들어 줘.',
  // 내 컴퓨터에서 그리기 (2026-10-10)
  'main.localDraw.unsupported':
    '이 컴퓨터에서는 그릴 수 없어. 메모리 8GB 이상에 x64(인텔/AMD) Windows나 macOS 12 이상이 필요해.',
  'main.localDraw.rosetta':
    '이 Mac은 Apple 칩인데 인텔용 페어리가 깔려 있어. Apple 칩용 페어리를 받아 깔면 그릴 수 있어.',
  'main.localDraw.notReady': '그림 도구가 아직 준비되지 않았거나 망가졌어. 준비하기를 다시 눌러 줘.',
  'main.localDraw.busy': '이미 그리거나 준비하는 중이야. 끝나면 다시 해 줘.',
  'main.localDraw.diskSetup': (v: { gb: number }) =>
    `저장 공간이 모자라. 준비하는 동안 ${v.gb}GB쯤 비어 있어야 해. 공간을 비우고 다시 눌러 줘.`,
  'main.localDraw.disk': '저장 공간이 모자라서 그리지 못했어. 1GB쯤 비우고 다시 해 줘.',
  'main.localDraw.offline':
    '받는 중에 인터넷 연결이 끊겼어. 인터넷 연결을 확인하고 준비하기를 다시 눌러 줘. 받은 데까지는 이어서 받아.',
  'main.localDraw.memory': '메모리가 모자라서 멈췄어. 다른 앱을 닫고 다시 해 줘.',
  'main.localDraw.battery': '배터리가 거의 없어서 멈췄어. 전원을 꽂고 다시 해 줘.',
  'main.localDraw.timeout': '너무 오래 걸려서 멈췄어. 다른 앱을 닫고 다시 해 줘.',
  'main.localDraw.setupCancelled': '준비를 멈췄어. 다시 누르면 받은 데부터 이어서 해.',
  'main.localDraw.bad': '그림이 제대로 나오지 않았어. 다시 그려 보거나 사진 그대로 해 줘.',
  'main.localDraw.setupFailed':
    '준비하다가 멈췄어. 다시 눌러 보고, 계속되면 설정의 저장 공간에서 지운 뒤 처음부터 해 줘. 자세한 기록은 local-draw 폴더에 남겼어.',
  'main.localDraw.failed':
    '그림 도구가 멈췄어. 다시 해 보고, 계속되면 설정의 저장 공간에서 지운 뒤 다시 준비해 줘. 자세한 기록은 local-draw 폴더에 남겼어.',
  'main.remake.notFigure': '입체 피규어로 만든 사진 페어리만 몸을 다시 만들 수 있어.',
  'main.remake.changed': '그사이 페어리가 바뀌어서 새 몸은 버렸어.',
  'main.db.recovered':
    '저장 파일이 깨져 있었어. 지우지 않고 {moved} 로 옮겨 두고, {when}에 남겨 둔 복사본으로 되살렸어. 그 뒤에 한 것은 빠졌을 수 있어.',
  'main.db.fresh':
    '저장 파일이 깨져 있었어. 지우지 않고 {moved} 로 옮겨 두고 새로 시작했어. 백업이 있으면 설정에서 가져올 수 있어.',
  'main.db.newer':
    '저장 파일이 더 새 판 페어리에서 만들어졌어. 덮어쓰지 않게 이번에는 저장하지 않고 켰어. 페어리를 최신 버전으로 업데이트해 줘.',
  'main.db.unavailable': '저장 파일을 열지 못했어. 이번에는 저장하지 않고 켰어. 페어리를 다시 켜 봐.',
  'main.db.showFile': '파일 보기',
  'main.petAction.ask': (v: { n: number }) => `AI가 ${v.n}가지를 바꾸려고 해. 할까?`,
  'main.petAction.delete_todo': (v: { name: string }) => `할 일 지우기: ${v.name}`,
  'main.petAction.update_todo': (v: { name: string }) => `할 일 고치기: ${v.name}`,
  'main.petAction.delete_event': (v: { name: string }) => `일정 지우기: ${v.name}`,
  'main.petAction.update_event': (v: { name: string }) => `일정 고치기: ${v.name}`,
  'main.petAction.append_note': (v: { name: string }) => `메모에 덧붙이기: ${v.name}`,
  'main.petAction.yes': '해 줘',
  'main.petAction.no': '안 할래',
  'main.petAction.done': (v: { n: number }) => `${v.n}가지 했어.`,
  'main.json.restored':
    '{file} 파일이 깨져 있었어. 지우지 않고 {moved} 로 옮겨 두고, 마지막으로 잘 읽은 복사본으로 되살렸어.',
  'main.json.reset':
    '{file} 파일이 깨져 있었어. 지우지 않고 {moved} 로 옮겨 두고 기본값으로 시작했어. 백업이 있으면 설정에서 가져올 수 있어.',
  'main.start.failed': '페어리를 켜지 못했어',
  'main.start.failedDetail':
    '켜는 중에 문제가 생겨 끝낼게. 다시 켜 봐. 계속 안 되면 기록 파일(logs/main.log)을 보내 줘.\n\n{error}',
  'main.data.oldRunning': '예전 짝꿍이 아직 켜져 있어',
  'main.data.oldRunningDetail':
    '짝꿍이 데이터를 쓰고 있어서 페어리로 옮기지 못했어. 짝꿍을 끝낸 뒤(메뉴 막대나 작업 표시줄 아이콘 → 끝내기) 페어리를 다시 켜 줘. 할 일과 설정은 그대로 있어.',
  'main.data.readOnly': '데이터 폴더에 쓸 수 없어서 페어리를 켜지 못했어',
  'main.data.readOnlyDetail': (v: { path: string }) =>
    `이 폴더에 쓸 권한이 없거나 읽기 전용이야: ${v.path}\n폴더 권한을 확인해 줘. 관리자 권한(sudo)으로 켠 적이 있다면 폴더 주인이 바뀌었을 수 있어. 고친 뒤 페어리를 다시 켜 줘. 할 일과 설정은 그대로 있어.`,
};

export const en: Translation<typeof ko> = {
  'main.onboardingTitle': 'Getting started',
  'main.model.offline': "You're not connected to the internet. Check your internet connection and try again.",
  'main.model.network':
    "The connection wasn't stable enough to download. Check your internet connection and try again in a moment.",
  'main.model.server': (v: { status: number }) =>
    `The download server isn't responding right now (${v.status}). Try again in a moment.`,
  'main.model.gone': (v: { status: number }) =>
    `The file is no longer on the server (${v.status}). Update fairy to the latest version, then try again.`,
  'main.model.badHash':
    "The downloaded file didn't match the original, so I threw it away. Try again. If it keeps happening, check whether a work network or proxy is changing files.",
  'main.model.diskFull': (v: { mb: number }) =>
    `Not enough disk space to download. Free up more than ${v.mb} MB and try again.`,
  'main.model.busy': 'This model is already downloading. Try again when it finishes.',
  'main.model.cancelled': 'Download stopped.',
  'main.model.failed': "Couldn't download it. Try again in a moment.",
  'main.file.diskFull': 'Not enough disk space to save. Free up some space and try again.',
  'main.file.noPermission':
    "Couldn't write to the fairy folder, so nothing was saved. Restart fairy and try again.",
  'main.file.saveFailed': "Couldn't save. Please try again.",
  'main.update.off': "It's turned off",
  'main.update.unavailable': "Can't check right now (the releases page isn't public yet)",
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
  'main.update.installFailed':
    "Couldn't install it automatically, so I opened the install guide. Download it there. If a warning shows the first time you open it, follow the guide.",
  'main.backup.saveTitle': 'Save backup file',
  'main.backup.fileName': 'fairy backup {date}',
  'main.backup.fileType': 'fairy backup',
  'main.backup.importTitle': 'Backup file to import',
  'main.backup.importFolderTitle': 'Old backup folder to import',
  'main.backup.notBackup': "That's not a fairy backup",
  'main.backup.newer':
    'This backup was made by a newer version of fairy. Update fairy first, then import it.',
  'main.backup.tooBig': "The backup file is too big, so I didn't open it.",
  'main.backup.damaged': 'The backup file is damaged. Try another backup file.',
  'main.backup.unsafe': "The backup file has a strange path inside, so I didn't open it.",
  'main.backup.busy': "I'm still looking at a backup. Give me a moment.",
  'main.backup.noUndo': "There's nothing to undo.",
  'main.backup.offerGone': "This backup can't be imported anymore. Please pick it again.",
  'main.backup.exportTooBig': 'Your data is too big to fit in one backup file.',
  'main.backup.replace': 'Replace',
  'main.backup.cancel': 'Cancel',
  'main.backup.restarting': 'Restarting',
  'main.pet.exportTitle': 'Export fairy',
  'main.pet.importTitle': 'Import fairy',
  'main.pet.fileType': 'fairy file',
  'main.pet.friendsMax': (v: { max: number }) => `You can invite up to ${v.max} friend fairies.`,
  'main.pet.friendCame': (v: { name: string }) => `${v.name} came over as a friend`,
  'main.pet.replaceAsk': (v: { name: string }) => `Switch to ${v.name}?`,
  'main.pet.replaceDetail': "Your fairy's name and look will change. To-dos, coins and bond stay the same.",
  'main.pet.came': (v: { name: string }) => `${v.name} is here`,
  'main.pet.unreadable': "Couldn't read the fairy file. Check that it's still there and pick it again.",
  'main.codex.fileType': 'Codex pet file',
  'main.codex.notZip': "Couldn't read that as a Codex pet file (zip).",
  'main.codex.unsafe': "That file has a strange path inside, so I didn't open it.",
  'main.codex.tooBig': 'That Codex pet file is too big.',
  'main.codex.noManifest': 'pet.json is missing or broken.',
  'main.codex.noSheet': 'The pet picture (spritesheet) is missing.',
  'main.codex.badSheet': "The pet picture isn't a Codex pet sheet (1536x1872 PNG or WebP).",
  'main.codex.noIdle': 'The standing picture (first cell of the first row) is empty.',
  'main.codex.personal':
    "A Codex pet may be someone else's drawing, so it comes in as personal use only. It won't go to the fairy gallery.",
  'main.maker.reopen': 'Please reopen the window.',
  'main.maker.badFormat': 'The picture format looks off.',
  'main.maker.tooBigAny': 'The picture is too big or not a PNG, GIF or WebP.',
  'main.maker.tooBigPng': 'The picture is too big or not a PNG.',
  'main.maker.title': 'Make a fairy from a photo',
  'main.maker.noVisionAi':
    'No AI that can see photos (Claude, Codex). Install and sign in to one from the chat to use this.',
  'main.maker.shapeCancelled': 'Stopped making the 3D fairy.',
  'main.maker.shapeBad': "Couldn't read a blueprint from the AI's answer. Try again?",
  'main.maker.noTextAi':
    "Couldn't find a connected AI. Install and sign in to one from the chat to make a fairy from words.",
  'main.maker.textEmpty': 'Tell me what you want it to look like first.',
  'main.maker.textFailed': "Your AI couldn't answer this time. Try again in a moment?",
  'main.maker.textBad':
    "Couldn't read a fairy blueprint from the AI's answer. Try saying it a little differently?",
  'main.illust.quota':
    "You've used up today's free drawings. This limit isn't shared with other people: it's counted per internet connection and refills after a day. To make one right now, use 'Make it in the Gemini app (free)' below, or add a free Hugging Face token.",
  'main.illust.quotaLocal':
    "You've used up today's free drawings. This limit isn't shared with other people: it's counted per internet connection and refills after a day. To make one right now, use 'Make it in the Gemini app (free)' or 'Draw on this computer' below, or add a free Hugging Face token.",
  'main.illust.quotaToken':
    "This token has used up today's free drawings. It refills after a day. To make one right now, use 'Make it in the Gemini app (free)' below.",
  'main.illust.limit': 'This drawing needs a token. Add a free Hugging Face token below and try again.',
  'main.illust.auth': "The Hugging Face token didn't work. Remove it or add a new one.",
  'main.illust.refused':
    "The drawing server said no without a reason. That usually means today's free drawings (counted per internet connection, refilled after a day) are used up. Use 'Make it in the Gemini app (free)' below, or add a free Hugging Face token.",
  'main.illust.refusedLocal':
    "The drawing server said no without a reason. That usually means today's free drawings (counted per internet connection, refilled after a day) are used up. Use 'Make it in the Gemini app (free)' or 'Draw on this computer' below, or add a free Hugging Face token.",
  'main.illust.refusedToken':
    "The drawing server said no without a reason. That usually means this token's free use for today is used up. Try again later or tomorrow.",
  'main.illust.offline': "Couldn't reach the drawing server. Check your internet connection and try again.",
  'main.illust.timeout': 'It took too long, so I stopped. Try again in a bit.',
  'main.illust.cancelled': 'Stopped drawing.',
  'main.illust.bad': "The drawing server didn't send a new picture. Draw again, or use the photo as is.",
  'main.illust.down': 'The free drawing server is busy or resting right now. Try again in a bit.',
  'main.illust.tokenShape': "That doesn't look like a token. Paste one that starts with hf_.",
  'main.sprites.quota':
    "You've used up today's free drawings. You can still save the moves made so far (missing poses borrow the closest picture). The limit is counted per internet connection and refills after a day. To make more now, add a free Hugging Face token under 'Redraw as an AI illustration' in 'Make a fairy from a photo'.",
  'main.sprites.quotaToken':
    "This token has used up today's free drawings. You can still save the moves made so far, and make the rest after a day.",
  'main.sprites.refused':
    "The drawing server said no without a reason. That usually means today's free drawings (counted per internet connection, refilled after a day) are used up. You can still save the moves made so far.",
  'main.sprites.refusedToken':
    "The drawing server said no without a reason. That usually means this token's free use for today is used up. You can still save the moves made so far.",
  'main.sprites.changed':
    'Your fairy changed in the meantime. Close this window and make the set again for the current fairy.',
  'main.sprites.bad': "The picture set didn't pass the checks, so it wasn't saved. Please make it again.",
  'main.localDraw.unsupported':
    "This computer can't draw locally. It needs 8 GB of memory or more and x64 (Intel/AMD) Windows or macOS 12 or later.",
  'main.localDraw.rosetta':
    'This Mac has an Apple chip but the Intel version of fairy is installed. Install the Apple chip version to draw.',
  'main.localDraw.notReady': "The drawing tools aren't ready or are broken. Press Set up again.",
  'main.localDraw.busy': "I'm already drawing or setting up. Try again when it's done.",
  'main.localDraw.diskSetup': (v) =>
    `Not enough disk space. Setup needs about ${v.gb} GB free. Free up some space and press Set up again.`,
  'main.localDraw.disk': 'Not enough disk space to draw. Free up about 1 GB and try again.',
  'main.localDraw.offline':
    'The internet connection dropped while downloading. Check your internet connection and press Set up again. It picks up where it left off.',
  'main.localDraw.memory': 'Ran out of memory, so I stopped. Close other apps and try again.',
  'main.localDraw.battery': 'The battery is almost empty, so I stopped. Plug in and try again.',
  'main.localDraw.timeout': 'It took too long, so I stopped. Close other apps and try again.',
  'main.localDraw.setupCancelled': 'Setup stopped. Press it again to continue from where it left off.',
  'main.localDraw.bad': "The drawing didn't come out right. Draw again, or use the photo as is.",
  'main.localDraw.setupFailed':
    'Setup stopped with an error. Try again, and if it keeps failing, delete it in Settings > Storage and start over. Details are in the local-draw folder.',
  'main.localDraw.failed':
    'The drawing tools stopped with an error. Try again, and if it keeps failing, delete them in Settings > Storage and set up again. Details are in the local-draw folder.',
  'main.remake.notFigure': 'Only photo fairies made as a 3D figure can get a new body.',
  'main.remake.changed': 'Your fairy changed in the meantime, so the new body was dropped.',
  'main.db.recovered':
    'Your save file was damaged. I kept it as {moved} and brought back the copy saved on {when}. Anything after that may be missing.',
  'main.db.fresh':
    'Your save file was damaged. I kept it as {moved} and started fresh. If you have a backup, you can import it in Settings.',
  'main.db.newer':
    'Your save file is from a newer version of fairy. To keep it safe, nothing will be saved this time. Please update fairy.',
  'main.db.unavailable':
    "I couldn't open your save file, so nothing is saved this time. Try restarting fairy.",
  'main.db.showFile': 'Show file',
  'main.petAction.ask': (v: { n: number }) =>
    `The AI wants to change ${v.n} thing${v.n === 1 ? '' : 's'}. OK?`,
  'main.petAction.delete_todo': (v: { name: string }) => `Delete to-do: ${v.name}`,
  'main.petAction.update_todo': (v: { name: string }) => `Edit to-do: ${v.name}`,
  'main.petAction.delete_event': (v: { name: string }) => `Delete event: ${v.name}`,
  'main.petAction.update_event': (v: { name: string }) => `Edit event: ${v.name}`,
  'main.petAction.append_note': (v: { name: string }) => `Add to note: ${v.name}`,
  'main.petAction.yes': 'Do it',
  'main.petAction.no': 'No thanks',
  'main.petAction.done': (v: { n: number }) => `Done (${v.n}).`,
  'main.json.restored':
    '{file} was damaged. I kept it as {moved} and brought back the last copy that read fine.',
  'main.json.reset':
    '{file} was damaged. I kept it as {moved} and started with defaults. If you have a backup, you can import it in Settings.',
  'main.start.failed': "Fairy couldn't start",
  'main.start.failedDetail':
    'Something went wrong while starting, so fairy will close. Try opening it again. If it keeps happening, please send the log file (logs/main.log).\n\n{error}',
  'main.data.oldRunning': 'The old Jjakkung app is still running',
  'main.data.oldRunningDetail':
    "Jjakkung is using your data, so it couldn't be moved to fairy yet. Quit Jjakkung (menu bar or taskbar icon → Quit), then open fairy again. Your to-dos and settings are safe.",
  'main.data.readOnly': "fairy can't write to its data folder, so it couldn't start",
  'main.data.readOnlyDetail': (v: { path: string }) =>
    `fairy doesn't have permission to write to this folder, or it is read-only: ${v.path}\nCheck the folder permissions. If you ever ran fairy with admin rights (sudo), the folder owner may have changed. Fix it, then open fairy again. Your to-dos and settings are safe.`,
};
