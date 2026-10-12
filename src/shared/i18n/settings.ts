import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 설정 창, 단축키, 베타 기록 글
export const ko = {
  'settings.loading': '불러오는 중',
  'settings.saved': '저장했어',
  'settings.title': '설정',
  'settings.copied': '복사했어',
  'settings.copyFailed': '복사하지 못했어. 글을 직접 골라 복사해 줘',

  // 펫
  'settings.pet': '페어리',
  'settings.name': '이름',
  'settings.nameChanged': '이름을 바꿨어',
  'settings.nameHint': (v: { name: string; n: number; max: number }) =>
    `메뉴에는 "${withParticle(v.name, '이랑')} 같이 보기", "${withParticle(v.name, '과')} 대화"처럼 보여. ${v.max}자까지 (${v.n}/${v.max}).`,
  'settings.nameEmpty': '이름은 비울 수 없어. 원래 이름으로 둘게',
  'settings.nameMax': '이름은 {max}자까지야',
  'settings.look': '모습',
  'settings.makePhotoPet': '사진으로 페어리 만들기',
  'settings.poses': '상태별 포즈',
  'settings.poseChange': '{label} 바꾸기',
  'settings.posePhoto': '{label} 사진',
  'settings.posesHint': '기쁠 때, 졸릴 때, 배고플 때 다른 사진으로 바뀌어. 없으면 기본 사진 그대로야.',
  'settings.size': '크기',
  'settings.sizeHint': '페어리 위에서 {mod} + 휠, 트랙패드 핀치로도 바꿀 수 있어.',
  'settings.pet3d': '입체로 보기',
  'settings.pet3dHint': '기본 페어리를 피규어처럼 입체로 그려. 끄면 예전 납작한 그림이야.',
  'settings.petStyle': '입체 모습',
  'settings.petStyle.figure': '피규어',
  'settings.petStyle.game': '게임 캐릭터',
  'settings.petStyle.real': '실사',
  'settings.petStyle.fluffy': '복슬복슬 (시험)',
  'settings.petStyleHint.fluffy':
    '이음새 없는 한 덩어리 몸에 길고 폭신한 털. 곱슬 털, 뭉친 털도 페어리마다 달라. 시험판이라 계속 다듬는 중이고 그래픽을 더 써.',
  'settings.petStyleHint.figure': '말랑한 비닐 피규어처럼 반짝여.',
  'settings.petStyleHint.game': '게임 캐릭터처럼 명암을 또렷하게 나누고 테두리 선을 둘러. 눈도 조금 더 커.',
  'settings.petStyleHint.real':
    '털 한 올 한 올, 유리알 같은 눈, 부드러운 빛으로 진짜 동물처럼 그려. 그래픽을 조금 더 써.',
  'settings.gait': '걸음새',
  'settings.gait.auto': '자동',
  'settings.gait.biped': '두 발',
  'settings.gait.quadruped': '네 발',
  'settings.gait.body.biped': '두 발',
  'settings.gait.body.quadruped': '네 발',
  'settings.gait.autoNow': (v: { gait: string }) =>
    `몸 모양을 보고 정해. 지금은 ${withParticle(v.gait, '으로')} 걸어. 페어리마다 따로 기억해.`,
  'settings.gait.kept': '페어리마다 따로 기억해. 보관함에서 다른 페어리를 꺼내도 각자 값이야.',
  'settings.stand.toggle': '네 발로 선 피규어 (밀크, 초코처럼)',
  'settings.stand.hint': (v: { name: string }) =>
    `${withParticle(v.name, '이')} 진짜 동물처럼 네 발로 서서 걷고, 앉고, 엎드려. 지금 색과 무늬, 눈, 귀 모양을 그대로 써서 AI를 다시 부르지 않아. 끄면 원래 몸으로 돌아와.`,
  'settings.stand.odd': (v: { name: string }) =>
    `${withParticle(v.name, '은')} 토끼나 햄스터처럼 귀와 꼬리, 몸 생김새가 고양이(밀크), 강아지(초코) 뼈대와 많이 달라서 네 발로 세우면 ${v.name}처럼 보이지 않아. 그래서 지금 몸 그대로 둬.`,
  'settings.gait.odd': (v: { name: string; body: string }) =>
    `${withParticle(v.name, '은')} ${v.body} 몸이라 조금 어색해 보일 수 있어.`,
  'settings.gait.flat':
    '사진(평면, 2.5D) 페어리는 다리가 따로 없어서 고를 수 없어. 페어리 만들기에서 입체 피규어로 만들면 고를 수 있어.',
  'settings.gait.off3d': '입체로 보기를 켜면 고를 수 있어. 지금은 사진으로 보여서 다리가 없어.',
  'settings.gait.stand': (v: { name: string }) =>
    `${withParticle(v.name, '은')} 네 발로 선 피규어라 늘 네 발로 걸어.`,
  'settings.gait.mismatch': (v: { name: string; body: string; pick: string }) =>
    `${withParticle(v.name, '은')} ${v.body} 몸으로 만들어졌어. 그대로 ${withParticle(v.pick, '으로')} 걸으면 어색해 보일 수 있어.`,
  'settings.gait.remake': (v: { pick: string }) => `${v.pick} 몸으로 다시 만들기`,
  'settings.gait.remakeHint':
    '같은 사진과 요청사항으로 AI가 몸만 다시 만들어. 이름과 포즈는 그대로야. 30초에서 1분쯤 걸려.',
  'settings.gait.justSwitch': (v: { pick: string }) => `그냥 ${withParticle(v.pick, '으로')} 걷기`,
  'settings.gait.keep': '그대로 두기',
  'settings.gait.remaking': (v: { pick: string }) => `${v.pick} 몸으로 다시 만드는 중이야.`,
  'settings.gait.stop': '그만두기',
  'settings.gait.remade': (v: { name: string }) => `${v.name} 몸을 새로 만들었어`,
  'settings.gait.friendAria': (v: { name: string }) => `${v.name} 걸음새`,
  'settings.wander': '가끔 돌아다니기',
  'settings.wanderHint': '가만히 있다가 가끔 걷고 앉아. 끄면 늘 그 자리에 있어.',
  'settings.lookAtCursor': '마우스 쳐다보기',
  'settings.lookAtCursorHint': '한가할 때 마우스가 가까이 오면 그쪽을 봐.',
  'settings.dayRhythm': '하루 리듬',
  'settings.dayRhythmHint':
    '아침엔 잠이 덜 깨고 낮엔 활발하고 밤엔 졸려. 만나는 시간을 정했으면 그 시간에 맞춰. 쉬지 않고 오래 일하면 같이 지쳐.',
  'settings.sounds': '효과음',
  'settings.soundsHint':
    '할 일 끝낼 때, 밥 먹을 때, 일정 알림에 작은 소리를 내. 집중하거나 잘 때는 조용히 있어.',
  // 이름은 이 키 하나만 바꾸면 된다
  'settings.boost': '부스트 모드',
  'settings.boostHint':
    '사양이 좋은 컴퓨터용. 페어리가 더 부드럽게 움직이고 마우스를 더 촘촘히 따라 봐. 무료 AI는 30분 동안 데워 둬서 답이 빨라. CPU와 메모리를 조금 더 써. 노트북이 배터리로 돌 때는 쉬어.',
  'settings.boostResting': '지금은 배터리라 쉬는 중이야. 전원을 꽂으면 켜져.',
  'settings.sysMonitor': '메뉴 막대에 컴퓨터 상태',
  'settings.sysMonitorHint':
    'CPU 사용률을 메뉴 막대에 띄우고, 한가하면 지금 페어리가 앉아서 졸고, 바쁠수록 걷다가 달리고 땀 흘리며 질주해. 메뉴를 열면 메모리, 디스크, 그래픽도 보여. 화면을 잠그거나 자리를 비우면 쉬고, 배터리일 때는 페어리가 멈춰 서.',
  'settings.sysMonitorWin': '알림 영역에 컴퓨터 상태',
  'settings.sysMonitorWinHint':
    '알림 영역 아이콘에 마우스를 올리면 CPU 사용률이 보이고, 한가하면 지금 페어리가 앉아서 졸고, 바쁠수록 걷다가 달리고 땀 흘리며 질주해. 메뉴를 열면 메모리, 디스크, 그래픽도 보여. 화면을 잠그거나 자리를 비우면 쉬고, 배터리나 발표 중에는 페어리가 멈춰 서.',

  // 친구의 페어리 초대하기
  'settings.friends': '친구의 페어리 초대하기',
  'settings.friendsChanged': '친구 페어리를 바꿨어',
  'settings.friends.hint':
    '초대한 친구 페어리는 같이 돌아다니고 놀아. 할 일과 대화는 기본 페어리가 맡아. {max}마리까지.',
  'settings.friends.photo': '사진',
  'settings.friends.sendHome': '집에 보내기',
  'settings.friends.name': '친구 이름',
  'settings.friends.kind': '친구 모양',
  'settings.friends.add': '초대하기',
  'settings.friends.import': '.fairy 파일로 초대하기',
  'settings.friends.addAnyway': '그래도 초대하기',
  'settings.friends.dupe': (v: { name: string }) =>
    `${withParticle(v.name, '은')} 이미 있는 이름이야. 그래도 초대할까? 한 번 더 누르면 초대해.`,
  'settings.friends.sendHomeSure': '정말 보낼까?',
  'settings.friends.sendHomeAria': (v: { name: string }) => `${withParticle(v.name, '을')} 집에 보내기`,
  'settings.friends.sendHomeSureAria': (v: { name: string }) =>
    `${withParticle(v.name, '을')} 정말 집에 보내기 (한 번 더 누르면 보내)`,
  'settings.friends.photoGone': (v: { name: string }) =>
    `${withParticle(v.name, '은')} 사진 친구라 보내면 그림도 지워져. 다시 보려면 .fairy 파일로 다시 초대해야 해.`,

  // 삐짐
  'settings.sulk': '삐짐',
  'settings.restDays': '쉬는 날 (이날은 안 와도 안 삐져)',
  'settings.restDaysAria': '쉬는 날',
  'settings.restDaysByRoutine': (v: { days: string }) =>
    `쉬는 날은 만나는 시간을 따라가. 만나지 않는 날(${v.days})엔 안 와도 안 삐져.`,
  'settings.restDaysByRoutineNone': '쉬는 날은 만나는 시간을 따라가. 지금은 매일 만나서 쉬는 날이 없어.',
  /** 일요일부터 쉼표로 나눈 일곱 요일 */
  'settings.weekdays': '일,월,화,수,목,금,토',
  'settings.spicy': '매운맛',
  'settings.spicyHint':
    '하루 중에도 잘 토라져. 안 놀아 주거나, 밥이 늦거나, 할 일을 미루거나, 쉬자는 말을 넘기면 고개를 돌리고, 더 삐지면 등을 돌려. 쓰다듬기, 밥, 놀기, 칭찬 한마디로 풀리고 가만둬도 두 시간 안에 풀려. 안 온 날은 7일까지 세. 잃는 건 없어.',

  // 말풍선
  'settings.bubbles': '말풍선',
  'settings.bubblesAria': '말풍선 빈도',
  'settings.osNotify': '페어리가 안 보일 때 시스템 알림으로',
  'settings.osNotifyHint':
    '전체 화면이나 숨김이라 페어리 말풍선을 못 볼 때 일정 알림을 컴퓨터 알림으로도 한 번 보내. 누르면 회의를 열거나 페어리를 불러.',
  'settings.chatterHint.quiet': '답이 왔다는 알림만 해.',
  'settings.chatterHint.normal': '바쁠 때 같은 상태 알림까지, 한 시간에 {n}개까지.',
  'settings.chatterHint.chatty': '혼잣말을 자주 하고(4~6분마다), 한 시간에 {n}개까지.',

  // AI
  'settings.ai': 'AI',
  'settings.persona': '성격과 말투',
  'settings.personaNext': '다음 질문부터 바뀌어.',
  'settings.aiKnowsTodos': '내 할 일 같이 보내기',
  'settings.diaryAi': '일기를 AI로 다듬기',
  'settings.diaryAiHint':
    '지난 날 페어리 일기를 고른 AI가 페어리 말투로 다듬어. 숫자와 일기 문장만 보내고 할 일 제목은 안 보내.',
  'settings.aiKnowsTodosHint':
    "질문할 때 안 끝낸 할 일 제목과 마감, 오늘 남은 일정 제목을 AI에 같이 보내. '오늘 뭐부터 할까?'에 답할 수 있어. 채팅 창 아래에서도 켜고 끌 수 있어.",
  'settings.aiPetTools': '페어리 도구 쓰기',
  'settings.aiPetToolsHint':
    "채팅에서 '내일 장보기 할 일로 넣어 줘'처럼 말하면 AI가 페어리의 할 일, 메모, 일정을 직접 읽고 넣어. Claude나 Codex에서 돼. 할 일 목록을 읽을 수 있어서 기본은 꺼 뒀어. 파일, 명령 도구는 여전히 꺼 둬.",
  'settings.myMcp': '내 MCP 도구 쓰기',
  'settings.myMcpOff':
    '위의 "내 AI 설정 없이 부르기"를 끄면 쓸 수 있어. Claude Code에 연결해 둔 노션, 슬랙 같은 MCP 도구를 채팅에서 써.',
  'settings.myMcpOn': (v: { n: number }) =>
    `Claude Code에 연결해 둔 MCP 도구(${v.n}개 서버)를 채팅에서 묻지 않고 써. 파일, 명령 도구는 여전히 꺼 둬. 글쓰기 같은 도구도 쓸 수 있으니 켤 때 주의해 줘.`,
  'settings.aiIsolation': '내 AI 설정 없이 부르기 (권장)',
  'settings.aiIsolationHint':
    'Claude Code와 Codex를 부를 때 내 훅, MCP, 스킬을 싣지 않아. 끄면 내 설정을 그대로 쓰는데 답이 느려지고 한도를 더 쓸 수 있어. 바꾸면 새 대화로 시작해.',

  // 모델 고르기 (v2)
  'settings.models': 'AI 모델',
  'settings.pets.hint':
    '기본 페어리, 그림 친구 밀크와 초코, 전에 만든 페어리 가운데 골라. 지금 사진 페어리는 지우지 않고 보관함에 둬. 보관한 페어리는 × 를 두 번 누르면 지워져.',
  'settings.pets.now': '지금',
  'settings.pets.figure': '입체',
  'settings.pets.relief': '2.5D',
  'settings.pets.age.baby': '아기',
  'settings.pets.age.teen': '청소년',
  'settings.pets.age.adult': '어른',
  'settings.pets.remove': (v: { name: string }) => `${v.name} 지우기`,
  /** 밀크, 초코 고르기 칸 화면 읽기 */
  'settings.pets.starter': (v: { name: string; desc: string }) => `${v.name}, ${v.desc}`,
  'settings.pets.removeSure': '지울까?',
  'settings.pets.removed': '보관한 페어리를 지웠어',
  'settings.rules': '페어리 규칙',
  'settings.rules.label': '대화할 때 늘 지켜 줄 것',
  'settings.rules.placeholder': '예)\n답은 세 줄 안으로\n코드는 TypeScript로\n나를 "대장"이라고 불러',
  'settings.rules.hint': '한 줄에 하나씩. 모든 AI에 같이 보내고 성격보다 먼저 따라. 칸을 벗어나면 저장해.',
  'settings.rules.saved': '규칙을 저장했어',
  'settings.memory': '페어리가 기억하는 것',
  'settings.memory.hint': (v: { max: number; len: number }) =>
    `페어리한테 늘 알려 줄 나에 대한 것. 질문할 때마다 AI에 같이 보내니 비밀은 적지 마. ${v.max}개, 하나에 ${v.len}자까지. 꽉 차면 오래된 것부터 빠져.`,
  'settings.memory.empty':
    '아직 기억하는 게 없어. 여기에 적거나, AI 도구에서 "페어리한테 기억해 줘"라고 한 것을 허락하면 생겨.',
  'settings.memory.placeholder': '예) 아침엔 회의가 많아',
  'settings.memory.add': '기억하기',
  'settings.memory.delete': '잊기',
  'settings.memory.deleteSure': '정말 잊을까?',
  'settings.memory.deleteAria': (v: { text: string }) => `"${v.text}" 잊기`,
  'settings.memory.added': '기억했어',
  'settings.memory.deleted': '잊었어',
  'settings.memory.dupe': '이미 기억하고 있어',
  'settings.memory.pending': '페어리가 기억하자고 한 것',
  'settings.memory.pendingHint': 'AI 도구가 기억해 두자고 한 거야. 허락한 것만 기억해서 AI에 같이 보내.',
  'settings.memory.approve': '기억하기',
  'settings.memory.approveAria': (v: { text: string }) => `"${v.text}" 기억하기`,
  'settings.memory.dismiss': '버리기',
  'settings.memory.dismissAria': (v: { text: string }) => `"${v.text}" 버리기`,
  'settings.memory.dismissed': '버렸어',
  'settings.memory.full': '기억이 꽉 찼어 ({max}개). 하나 잊고 다시 해 줘',
  'settings.storage': '저장 공간',
  'settings.storage.llm': (v: { name: string }) => `무료 AI 모델 ${v.name}`,
  'settings.storage.bg': '사진 배경 지우기 모델',
  'settings.storage.depth': '2.5D 깊이 모델',
  'settings.storage.ort': '사진 AI 엔진 (배경 지우기, 2.5D)',
  'settings.storage.localDraw': '내 컴퓨터에서 그리기 (mflux 도구와 모델)',
  'settings.storage.localDrawSd': '내 컴퓨터에서 그리기 (sd.cpp 도구와 모델)',
  'settings.storage.oldFile': (v: { name: string }) => `안 쓰는 모델 파일 ${v.name}`,
  'settings.storage.delete': '지우기',
  'settings.storage.sure': '정말 지울까?',
  'settings.storage.deleted': '모델을 지웠어',
  'settings.storage.busy': '받는 중이거나 답하는 중이라 지금은 못 지워. 끝나면 다시 해 줘.',
  'settings.storage.empty': '받아 둔 모델이 없어.',
  'settings.storage.copyBeforeImport': (v: { when: string }) => `백업을 가져오기 전 데이터 (${v.when})`,
  'settings.storage.copyDbVersion': (v: { when: string }) => `업데이트 전 저장 파일 복사 (${v.when})`,
  'settings.storage.copyBroken': (v: { name: string }) => `깨져서 옮겨 둔 파일 ${v.name}`,
  'settings.storage.copyDeleted': '복사본을 지웠어',
  'settings.aiHistory': 'AI 기록',
  'settings.aiHistory.hint':
    'Claude, Codex는 페어리와 한 대화를 자기 기록 폴더에 저장해. 페어리 전용 폴더에 남은 것만 지워 (내 ~/.claude, ~/.codex의 다른 기록과 로그인은 그대로). 화면을 보여 준 질문은 처음부터 저장하지 않아.',
  'settings.aiHistory.size': (v: { size: string }) => `지금 ${v.size}`,
  'settings.aiHistory.none': '지금 남은 기록이 없어.',
  'settings.aiHistory.clear': 'AI 기록 지우기',
  'settings.aiHistory.sure': '정말 지울까?',
  'settings.aiHistory.cleared': 'AI 기록을 지웠어. 다음 질문부터 새 대화로 시작해.',
  'settings.aiHistory.failed': '일부는 못 지웠어. AI가 답하는 중이면 끝난 뒤 다시 해 줘.',
  'settings.storage.hint': (v: { total: string }) =>
    `모두 ${v.total}. 지워도 그 기능을 다시 쓰면 그때 다시 받아.`,
  'settings.models.hint':
    '고르지 않으면 그 AI의 기본 모델을 써. Claude는 요금제 기본(Pro, Max는 Opus)이야. 가벼운 모델을 고르면 한도를 아낄 수 있어.',
  'settings.models.default': '기본',
  'settings.models.latest': (v: { label: string }) => `${v.label} (최신 자동)`,
  'settings.models.pinned': (v: { label: string }) => `${v.label} (이 버전 고정)`,
  'settings.models.free': '무료 AI',
  'settings.models.freeReady': (v: { mb: number; license: string }) => `받아 둠 (${v.mb}MB, ${v.license})`,
  'settings.models.freeLater': (v: { mb: number; license: string }) =>
    `처음 쓸 때 받아 (${v.mb}MB, ${v.license})`,

  // 다른 AI 에서 쓰기 (MCP)
  'settings.mcpSection': '다른 AI에서 페어리 쓰기 (MCP)',
  'settings.mcp.intro':
    'Claude Code, Codex에 페어리를 연결하면 그 안에서 "이거 페어리 할 일에 넣어 줘", "내일 3시 회의 일정 잡아 줘"가 돼. 할 일, 메모, 일정을 넣고 볼 수 있어. 넣은 것은 몇 초 안에 패널에 보여.',
  'settings.mcp.claude': 'Claude Code: 터미널에서 한 번 실행',
  'settings.mcp.copyCmd': '명령 복사',
  'settings.mcp.codex': 'Codex: ~/.codex/config.toml에 붙여 넣기',
  'settings.mcp.copyConfig': '설정 복사',
  'settings.mcp.moved':
    '페어리 앱을 다른 폴더로 옮기거나 다시 설치하면 경로가 바뀌니 다시 등록해 줘. 예전 이름(jjakkung)으로 등록해 뒀다면 지우고 이 명령으로 다시 등록해 줘.',

  // 언어
  'settings.lang': '언어',
  'settings.langAria': '화면 언어',
  'settings.lang.auto': '자동',
  'settings.lang.ko': '한국어',
  'settings.lang.en': 'English',
  'settings.langHint': '자동은 컴퓨터 언어를 따라가.',
  'settings.langRestart': '다시 켜면 바뀐 말로 보여.',
  'settings.restart': '다시 켜기',

  // 시작
  'settings.start': '시작',
  'settings.launchAtLogin': '컴퓨터를 켜면 같이 켜기',
  'settings.launchPackaged': '로그인하면 페어리가 저절로 떠.',
  'settings.launchDev': '설치한 앱에서만 바꿀 수 있어. 지금은 개발 중 실행이야.',

  // 하루 회고
  'settings.review': '하루 회고',
  'settings.reviewOn': '하루 회고 받기',
  'settings.reviewOnHint':
    '수다 빈도와 따로야. 조용히여도 켜 두면 하루 한 번 와. 못 보고 지나가면 패널의 놓친 알림에 남아.',
  'settings.reviewTime': '회고 시각',
  'settings.reviewHint':
    '이 시각이 지나고 처음 자리에 있을 때 오늘 끝낸 일을 알려 주고, 남은 오늘 마감을 내일로 넘길지 물어봐.',

  // 캘린더
  'settings.calendar': '캘린더 가져오기',
  'settings.cal.url': '캘린더 주소 (.ics)',
  'settings.cal.hint':
    '구글 캘린더: 설정 > 내 캘린더 > 캘린더 통합 > "iCal 형식의 비공개 주소"를 붙여 넣어. 30분마다 앞으로 60일 일정을 가져와서 페어리가 알려 줘. 이 주소는 이 컴퓨터에만 둬. (읽기만 해. 페어리에서 넣은 일정을 구글로 보내려면 아래 "구글 캘린더로 보내기"를 켜.)',
  'settings.cal.fetch': '지금 가져오기',
  'settings.cal.clear': '지우기',

  // 백업
  'settings.backup': '백업과 옮기기',
  'settings.backupHint':
    '할 일, 메모, 일정, 코인, 페어리, 설정을 폴더 하나로 내보내고, 다른 컴퓨터에서 가져와.',
  'settings.export': '내보내기',
  'settings.exported': '내보냈어',
  'settings.exportFailed': '내보내지 못했어',
  'settings.importFailed': '가져오지 못했어',
  'settings.import': '가져오기',
  'settings.petOnlyHint': '페어리만 친구에게 주려면 .fairy 파일로.',
  'settings.exportPet': '페어리 내보내기',
  'settings.petExported': '페어리 파일을 만들었어',
  'settings.petExportFailed': '페어리 파일을 만들지 못했어. 다른 폴더에 저장해 봐',
  'settings.importPet': '페어리 가져오기',

  // 업데이트
  'settings.update': '업데이트',
  'settings.updateCheck': '새 버전 알림',
  'settings.updateHint':
    '하루에 한 번 새 버전이 나왔는지 보고, 나왔으면 페어리가 알려 줘. 설치판은 미리 받아 두고, "다시 켜서 업데이트"를 누를 때 설치해. 꼭 필요한 업데이트가 나오면 업데이트 전까지 AI 대화가 잠겨 (확인을 못 하면 잠그지 않아). 꺼 두면 새 버전 말풍선만 쉬고, 꼭 필요한 업데이트는 계속 확인해. 앱 이름과 버전 말고는 보내지 않아.',
  'settings.checkNow': '지금 확인',
  'settings.onboardingAgain': '시작 안내 다시 보기',

  // 단축키
  'settings.shortcuts': '단축키',
  'settings.shortcutChanged': '단축키를 바꿨어',
  'settings.zoomKeys': '크게, 작게, 원래대로 (마우스가 페어리 위에 있을 때)',
  'settings.shortcut.hide': '숨기기, 다시 보이기',
  'settings.shortcut.quickAdd': '할 일 한 줄 넣기 (어디서든)',
  'settings.shortcut.chat': '대화 열기',
  'settings.shortcut.look': '같이 보기',
  'settings.shortcut.recording': '키를 눌러 줘 (Esc는 그만)',
  'settings.shortcut.recordingBtn': '기록 중',
  'settings.shortcut.change': '바꾸기',
  'settings.shortcut.default': '기본으로',
  'settings.shortcut.none': '없음',
  'settings.shortcut.badKey': '이 키는 단축키로 못 써. 글자, 숫자, F1~F24 같은 키를 눌러 줘.',
  'settings.shortcut.taken': "이미 '{name}' 단축키야. 다른 키를 눌러 줘.",
  'settings.shortcut.needMod': '{mod} 키에 {alt} 키나 Shift 키를 더해 눌러 줘. 다른 앱 입력을 빼앗지 않게.',
  'settings.shortcut.needMore':
    '{one} 키 하나만으로는 다른 앱 단축키와 겹쳐. {more} 중 하나를 더 같이 눌러 줘.',
  'settings.shortcut.optionOnly': 'Option 조합은 특수 문자를 칠 때 써. Cmd 키나 Ctrl 키를 같이 눌러 줘.',
  'settings.shortcut.fKey': 'F1~F12는 다른 앱이 많이 써. 수식키를 하나 같이 누르거나 F13~F24를 써 줘.',
  'settings.shortcut.windowsKey': 'Windows 키 조합은 Windows가 써. Ctrl 키나 Alt 키로 골라 줘.',
  'settings.shortcut.reserved': '{what}에 쓰는 조합이라 못 써 ({keys}). 다른 키를 눌러 줘.',
  'settings.shortcut.what.copy': '복사',
  'settings.shortcut.what.paste': '붙여넣기',
  'settings.shortcut.what.pastePlain': '서식 없이 붙여넣기',
  'settings.shortcut.what.cut': '잘라내기',
  'settings.shortcut.what.selectAll': '전체 선택',
  'settings.shortcut.what.undo': '실행 취소',
  'settings.shortcut.what.redo': '다시 실행',
  'settings.shortcut.what.save': '저장',
  'settings.shortcut.what.saveAs': '다른 이름으로 저장',
  'settings.shortcut.what.quit': '앱 종료',
  'settings.shortcut.what.logout': '로그아웃',
  'settings.shortcut.what.lock': '화면 잠금',
  'settings.shortcut.what.closeWindow': '창 닫기',
  'settings.shortcut.what.minimize': '창 내리기',
  'settings.shortcut.what.hideApp': '앱 가리기',
  'settings.shortcut.what.switchApp': '앱 전환',
  'settings.shortcut.what.switchWindow': '창 전환',
  'settings.shortcut.what.switchTab': '탭 전환',
  'settings.shortcut.what.spotlight': '검색(Spotlight)',
  'settings.shortcut.what.inputSource': '입력 언어 전환',
  'settings.shortcut.what.emoji': '이모지 입력',
  'settings.shortcut.what.screenshot': '화면 캡처',
  'settings.shortcut.what.fullScreen': '전체 화면',
  'settings.shortcut.what.dock': 'Dock 가리기',
  'settings.shortcut.what.missionControl': 'Mission Control',
  'settings.shortcut.what.help': '도움말 검색',
  'settings.shortcut.what.voiceOver': 'VoiceOver',
  'settings.shortcut.what.windowMenu': '창 메뉴',
  'settings.shortcut.what.contextMenu': '오른쪽 클릭 메뉴',
  'settings.shortcut.what.rotate': '화면 회전',

  // 베타 기록
  'settings.statsCopied': '복사했어. 의견과 같이 붙여 넣어 줘',
  'settings.version': '페어리 {v}',
  'settings.licenses': '오픈소스 라이선스',
  'settings.licensesHint':
    '페어리는 MIT 라이선스 오픈소스야. 함께 들어 있는 다른 오픈소스의 고지를 볼 수 있어.',
  'settings.licensesOpen': '고지 보기',
  'settings.licensesFailed': '고지 파일을 열지 못했어.',
  'settings.stats.title': '내 기록',
  'settings.stats.intro':
    '페어리가 쓸 만한지 보는 숫자야. 이 컴퓨터에만 있고 어디로도 보내지 않아. 의견을 보낼 때 복사해서 같이 붙여 주면 큰 도움이 돼.',
  'settings.stats.daysUsed': '쓴 날',
  'settings.stats.dayValue': '{day}일째 (켠 날 {used}일)',
  'settings.stats.dayValueOne': '{day}일째 (켠 날 {used}일)',
  'settings.stats.fromToday': '오늘부터',
  'settings.stats.daysGoal': '14일째에도 켜 두기',
  'settings.stats.doneMedian': '하루 끝낸 할 일 (중앙값)',
  'settings.stats.count': '{n}개',
  'settings.stats.countAtLeast': '{n}개 이상',
  'settings.stats.hidden': '페어리를 숨긴 시간',
  'settings.stats.under': '{n}% 미만',
  'settings.stats.look': '같이 보기 (최근 7일)',
  'settings.stats.times': (v: { n: number }) => `${v.n}번`,
  'settings.stats.timesAtLeast': (v: { n: number }) => `${v.n}번 이상`,
  'settings.stats.crash': '멈춤과 갑자기 꺼짐 (최근 7일)',
  'settings.stats.goal': '목표 {goal}',
  'settings.stats.met': '달성',
  'settings.stats.copy': '기록 복사',
  'settings.stats.privacy': '복사한 글에는 날짜와 숫자만 들어가. 할 일 제목이나 대화 내용은 없어.',

  // 복사해서 보내는 베타 기록 글
  'settings.report.title': '페어리 내 기록 ({version}, {os})',
  'settings.report.first': '처음 켠 날 {first}, 오늘 {day}일째, 켠 날 {used}일',
  'settings.report.none': '아직 기록 없음',
  'settings.report.done': '하루 완료 할 일 중앙값 {n}개 (목표 {goal}개 이상)',
  'settings.report.hidden': '페어리 숨긴 시간 {n}% (목표 {goal}% 미만)',
  'settings.report.look': '같이 보기 최근 7일 {n}번 (목표 주 {goal}번 이상)',
  'settings.report.crash': '비정상 종료와 멈춤 최근 7일 {n}번 (목표 {goal}번)',
  'settings.report.header': '날짜, 켠 시간, 숨김, 완료, 같이 보기, 종료, 집중',
  'settings.report.min': '{n}분',
  'settings.report.hours': '{n}시간',

  // 운영체제 이름 (기록 복사)
  'settings.os.mac': '맥',
  'settings.os.win': '윈도우',
};

export const en: Translation<typeof ko> = {
  'settings.loading': 'Loading',
  'settings.saved': 'Saved',
  'settings.title': 'Settings',
  'settings.copied': 'Copied',
  'settings.copyFailed': "Couldn't copy. Select the text and copy it yourself",

  'settings.pet': 'Fairy',
  'settings.name': 'Name',
  'settings.nameChanged': 'Name changed',
  'settings.nameHint': (v) =>
    `Menus will say things like "Chat with ${v.name}". Up to ${v.max} characters (${v.n}/${v.max}).`,
  'settings.nameEmpty': "A name can't be empty. Keeping the old one",
  'settings.nameMax': 'Names can be up to {max} characters',
  'settings.look': 'Look',
  'settings.makePhotoPet': 'Make a fairy from a photo',
  'settings.poses': 'Poses by mood',
  'settings.poseChange': '{label}: change',
  'settings.posePhoto': '{label}: add photo',
  'settings.posesHint':
    'Shows a different photo when happy, sleepy or hungry. Without one, the main photo stays.',
  'settings.size': 'Size',
  'settings.sizeHint': 'You can also use {mod} + scroll or a trackpad pinch over your fairy.',
  'settings.pet3d': 'Show in 3D',
  'settings.pet3dHint': 'Draws the default fairy in 3D like a little figure. Turn off for the flat drawing.',
  'settings.petStyle': '3D look',
  'settings.petStyle.figure': 'Figure',
  'settings.petStyle.game': 'Game character',
  'settings.petStyle.real': 'Realistic',
  'settings.petStyle.fluffy': 'Fluffy (experimental)',
  'settings.petStyleHint.fluffy':
    'A seamless body with long, soft fur that can be curly or tufted per fairy. Still experimental and uses more graphics power.',
  'settings.petStyleHint.figure': 'Glossy, like a soft vinyl figure.',
  'settings.petStyleHint.game':
    'Crisp cel shading with outlines, like a game character. Slightly bigger eyes too.',
  'settings.petStyleHint.real':
    'Draws your fairy like a real animal: fine fur, glassy eyes and soft light. Uses a little more graphics power.',
  'settings.gait': 'Walks on',
  'settings.gait.auto': 'Auto',
  'settings.gait.biped': 'Two legs',
  'settings.gait.quadruped': 'Four legs',
  'settings.gait.body.biped': 'two-legged',
  'settings.gait.body.quadruped': 'four-legged',
  'settings.gait.autoNow': (v) =>
    `Decided from the body shape. Right now it walks on ${v.gait.toLowerCase()}. Remembered for each fairy.`,
  'settings.gait.kept':
    'Remembered for each fairy, so a fairy you bring back from your collection keeps its own choice.',
  'settings.stand.toggle': 'Stand on four legs (like Milk and Choco)',
  'settings.stand.hint': (v) =>
    `${v.name} stands, walks, sits and lies down on four legs like a real animal. It keeps its colors, markings, eyes and ear shape, so no AI is needed. Turn it off to get the old body back.`,
  'settings.stand.odd': (v) =>
    `Like a rabbit or a hamster, ${v.name} has ears, a tail and a body too different from the cat (Milk) and dog (Choco) skeletons, so standing on four legs would stop it looking like ${v.name}. It keeps its own body.`,
  'settings.gait.odd': (v) => `${v.name} has a ${v.body} body, so this may look a little odd.`,
  'settings.gait.flat':
    "Photo fairies (flat or 2.5D) don't have separate legs, so there's nothing to choose. Make a 3D figure in Make a fairy to choose.",
  'settings.gait.off3d': 'Turn on Show in 3D to choose. Right now it shows as a photo with no legs.',
  'settings.gait.stand': (v) =>
    `${v.name} is a figure standing on four legs, so it always walks on four legs.`,
  'settings.gait.mismatch': (v) =>
    `${v.name} was made with a ${v.body} body. Walking on ${v.pick.toLowerCase()} as is may look odd.`,
  'settings.gait.remake': (v) => `Rebuild for ${v.pick.toLowerCase()}`,
  'settings.gait.remakeHint':
    'Your AI rebuilds only the body from the same photo and wish. Name and poses stay. Takes 30 seconds to a minute.',
  'settings.gait.justSwitch': (v) => `Just walk on ${v.pick.toLowerCase()}`,
  'settings.gait.keep': 'Keep as is',
  'settings.gait.remaking': (v) => `Rebuilding the body for ${v.pick.toLowerCase()}.`,
  'settings.gait.stop': 'Stop',
  'settings.gait.remade': (v) => `${v.name} has a new body`,
  'settings.gait.friendAria': (v) => `How ${v.name} walks`,
  'settings.wander': 'Wander around',
  'settings.wanderHint': 'Sits still, then walks and sits now and then. Turn off to stay put.',
  'settings.lookAtCursor': 'Watch the mouse',
  'settings.lookAtCursorHint': 'When idle, looks toward the mouse pointer if it comes close.',
  'settings.dayRhythm': 'Daily rhythm',
  'settings.dayRhythmHint':
    'Groggy in the morning, lively by day, sleepy at night. Follows your meeting time if you set one. Gets worn out with you after long stretches of work.',
  'settings.sounds': 'Sound effects',
  'settings.soundsHint':
    'Soft little sounds for finished to-dos, meals, and event reminders. Stays quiet while you focus or while it sleeps.',
  'settings.boost': 'Boost mode',
  'settings.boostHint':
    'For powerful computers. Your fairy moves more smoothly and follows the mouse more closely, and the free AI stays warm for 30 minutes so answers come faster. Uses a bit more CPU and memory. Takes a break while a laptop runs on battery.',
  'settings.boostResting': 'Resting now: on battery. It turns on when you plug in.',
  'settings.sysMonitor': 'Computer status in the menu bar',
  'settings.sysMonitorHint':
    'Shows CPU use in the menu bar, and your fairy naps while the computer is idle, then walks, runs and sprints with a sweat the busier it gets. Open the menu for memory, disk and graphics. It rests while the screen is locked or you are away, and your fairy stands still on battery.',
  'settings.sysMonitorWin': 'Computer status in the notification area',
  'settings.sysMonitorWinHint':
    'Hover the notification area icon to see CPU use, and your fairy naps while the computer is idle, then walks, runs and sprints with a sweat the busier it gets. Open the menu for memory, disk and graphics. It rests while the screen is locked or you are away, and your fairy stands still on battery or while presenting.',

  'settings.friends': "Invite a friend's fairy",
  'settings.friendsChanged': 'Friend fairies updated',
  'settings.friends.hint':
    'Invited fairies wander and play along. Your main fairy handles to-dos and chat. Up to {max}.',
  'settings.friends.photo': 'Photo',
  'settings.friends.sendHome': 'Send home',
  'settings.friends.name': 'Friend name',
  'settings.friends.kind': 'Friend look',
  'settings.friends.add': 'Invite',
  'settings.friends.import': 'Invite one from a .fairy file',
  'settings.friends.addAnyway': 'Invite anyway',
  'settings.friends.dupe': (v) =>
    `"${v.name}" is already taken. Invite them anyway? Press again to invite them.`,
  'settings.friends.sendHomeSure': 'Really?',
  'settings.friends.sendHomeAria': (v) => `Send ${v.name} home`,
  'settings.friends.sendHomeSureAria': (v) => `Really send ${v.name} home (press again to send)`,
  'settings.friends.photoGone': (v) =>
    `${v.name} is a photo friend, so their picture goes too. To see them again, invite them back from the .fairy file.`,

  'settings.sulk': 'Sulking',
  'settings.restDays': 'Days off (no sulking if you skip these)',
  'settings.restDaysAria': 'Days off',
  'settings.restDaysByRoutine': (v: { days: string }) =>
    `Days off follow your meeting time. No sulking on days we don't meet (${v.days}).`,
  'settings.restDaysByRoutineNone':
    'Days off follow your meeting time. We meet every day, so there are none right now.',
  'settings.weekdays': 'Su,Mo,Tu,We,Th,Fr,Sa',
  'settings.spicy': 'Spicy mode',
  'settings.spicyHint':
    'Pouts easily, even mid-day. Skip playtime, feed late, put off to-dos, or brush off a break, and it turns its head; push it further and it turns its back. Petting, food, play, or a kind word makes up, and it wears off within two hours anyway. Days away count up to 7. You lose nothing.',

  'settings.bubbles': 'Speech bubbles',
  'settings.bubblesAria': 'Bubble frequency',
  'settings.osNotify': "System notifications when you can't see me",
  'settings.osNotifyHint':
    "If you can't see my bubble (full screen, hidden), I'll also send event reminders as a system notification, once. Click it to join the meeting or call me back.",
  'settings.chatterHint.quiet': 'Only tells you when an answer arrives.',
  'settings.chatterHint.normal': 'Also status notes like when you look busy, up to {n} an hour.',
  'settings.chatterHint.chatty': 'Chats to itself often (every 4 to 6 min), up to {n} an hour.',

  'settings.ai': 'AI',
  'settings.persona': 'Personality and tone',
  'settings.personaNext': 'Applies from your next question.',
  'settings.aiKnowsTodos': 'Share my to-dos',
  'settings.diaryAi': 'Polish the diary with AI',
  'settings.diaryAiHint':
    "Your chosen AI rewrites past diary entries in your fairy's voice. Only the numbers and diary lines are sent, never to-do titles.",
  'settings.aiKnowsTodosHint':
    'Sends your open to-do titles and due dates, plus the titles of today\'s remaining events, with each question. Then it can answer "What should I do first?". You can also switch this under the chat box.',
  'settings.aiPetTools': 'Let chat use fairy tools',
  'settings.aiPetToolsHint':
    "Say things like 'add groceries to my to-dos for tomorrow' and the AI reads and adds your fairy's to-dos, notes, and events itself. Works with Claude or Codex. It can read your to-do list, so it's off by default. File and command tools stay off.",
  'settings.myMcp': 'Use my MCP tools',
  'settings.myMcpOff':
    'Turn off "Call without my AI setup" above to use this. Lets chat use MCP tools you connected to Claude Code, like Notion or Slack.',
  'settings.myMcpOn': (v) =>
    `Chat uses the MCP tools you connected to Claude Code (${v.n} ${v.n === 1 ? 'server' : 'servers'}) without asking. File and command tools stay off. Some tools can write things, so be careful.`,
  'settings.aiIsolation': 'Call without my AI setup (recommended)',
  'settings.aiIsolationHint':
    'Calls Claude Code and Codex without your hooks, MCP and skills. Turn off to use your own setup, but answers get slower and may use more of your limit. Changing this starts a new chat.',

  'settings.models': 'AI models',
  'settings.pets.hint':
    'Pick a default fairy, the illustrated friends Milk and Choco, or one you made before. Your current photo fairy is kept, not deleted. Press × twice to delete a kept fairy.',
  'settings.pets.now': 'Now',
  'settings.pets.figure': '3D',
  'settings.pets.relief': '2.5D',
  'settings.pets.age.baby': 'Baby',
  'settings.pets.age.teen': 'Teen',
  'settings.pets.age.adult': 'Adult',
  'settings.pets.remove': (v) => `Delete ${v.name}`,
  'settings.pets.starter': (v) => `${v.name}, ${v.desc}`,
  'settings.pets.removeSure': 'Delete?',
  'settings.pets.removed': 'Deleted the kept fairy',
  'settings.rules': 'Fairy rules',
  'settings.rules.label': 'Always follow these when chatting',
  'settings.rules.placeholder':
    'e.g.\nKeep answers under three lines\nWrite code in TypeScript\nCall me "Boss"',
  'settings.rules.hint':
    'One per line. Sent to every AI and followed before the personality. Saved when you leave the box.',
  'settings.rules.saved': 'Rules saved',
  'settings.memory': 'Things your fairy remembers',
  'settings.memory.hint': (v) =>
    `Things about you your fairy should always know. They're sent to the AI with every question, so don't put secrets here. Up to ${v.max}, ${v.len} characters each. When it's full, the oldest go first.`,
  'settings.memory.empty':
    'Nothing remembered yet. Add one here, or allow something your AI tool asked your fairy to remember.',
  'settings.memory.placeholder': 'e.g. Lots of morning meetings',
  'settings.memory.add': 'Remember',
  'settings.memory.delete': 'Forget',
  'settings.memory.deleteSure': 'Really forget?',
  'settings.memory.deleteAria': (v) => `Forget "${v.text}"`,
  'settings.memory.added': 'Got it, remembered',
  'settings.memory.deleted': 'Forgotten',
  'settings.memory.dupe': 'Already remembered',
  'settings.memory.pending': 'Things your fairy was asked to remember',
  'settings.memory.pendingHint':
    'Your AI tool asked to remember these. Only the ones you allow are remembered and sent to the AI.',
  'settings.memory.approve': 'Remember',
  'settings.memory.approveAria': (v) => `Remember "${v.text}"`,
  'settings.memory.dismiss': 'Dismiss',
  'settings.memory.dismissAria': (v) => `Dismiss "${v.text}"`,
  'settings.memory.dismissed': 'Dismissed',
  'settings.memory.full': 'Memory is full ({max}). Forget one and try again',
  'settings.storage': 'Storage',
  'settings.storage.llm': (v) => `Free AI model ${v.name}`,
  'settings.storage.bg': 'Photo background removal model',
  'settings.storage.depth': '2.5D depth model',
  'settings.storage.ort': 'Photo AI engine (background removal, 2.5D)',
  'settings.storage.localDraw': 'Draw on this computer (mflux tools and model)',
  'settings.storage.localDrawSd': 'Draw on this computer (sd.cpp tools and model)',
  'settings.storage.oldFile': (v) => `Unused model file ${v.name}`,
  'settings.storage.delete': 'Delete',
  'settings.storage.sure': 'Really delete?',
  'settings.storage.deleted': 'Model deleted',
  'settings.storage.busy': "It's downloading or answering right now. Try again when it's done.",
  'settings.storage.empty': 'No downloaded models.',
  'settings.storage.copyBeforeImport': (v) => `Data from before a backup import (${v.when})`,
  'settings.storage.copyDbVersion': (v) => `Save file copy from before an update (${v.when})`,
  'settings.storage.copyBroken': (v) => `Damaged file set aside: ${v.name}`,
  'settings.storage.copyDeleted': 'Copy deleted',
  'settings.aiHistory': 'AI history',
  'settings.aiHistory.hint':
    "Claude and Codex save your chats with fairy in their own history folders. This deletes only what's left in fairy's own folders (other history and your login in ~/.claude and ~/.codex stay). Questions that showed your screen are never saved.",
  'settings.aiHistory.size': (v) => `${v.size} now`,
  'settings.aiHistory.none': 'Nothing saved right now.',
  'settings.aiHistory.clear': 'Clear AI history',
  'settings.aiHistory.sure': 'Really clear?',
  'settings.aiHistory.cleared': 'AI history cleared. Your next question starts a new chat.',
  'settings.aiHistory.failed':
    "Some of it couldn't be deleted. If the AI is answering, try again when it's done.",
  'settings.storage.hint': (v) =>
    `${v.total} in total. Deleted models download again when you use that feature.`,
  'settings.models.hint':
    "If you don't pick one, each AI uses its default. Claude uses your plan's default (Opus on Pro and Max). A lighter model saves your limit.",
  'settings.models.default': 'Default',
  'settings.models.latest': (v: { label: string }) => `${v.label} (always latest)`,
  'settings.models.pinned': (v: { label: string }) => `${v.label} (pinned)`,
  'settings.models.free': 'Free AI',
  'settings.models.freeReady': (v: { mb: number; license: string }) =>
    `Downloaded (${v.mb} MB, ${v.license})`,
  'settings.models.freeLater': (v: { mb: number; license: string }) =>
    `Downloads on first use (${v.mb} MB, ${v.license})`,

  'settings.mcpSection': 'Use fairy from other AIs (MCP)',
  'settings.mcp.intro':
    'Connect fairy to Claude Code or Codex and you can say "Add this to my fairy to-dos" or "Schedule a meeting tomorrow at 3". It can add and read to-dos, notes and events. New items show up in the panel within seconds.',
  'settings.mcp.claude': 'Claude Code: run once in a terminal',
  'settings.mcp.copyCmd': 'Copy command',
  'settings.mcp.codex': 'Codex: paste into ~/.codex/config.toml',
  'settings.mcp.copyConfig': 'Copy config',
  'settings.mcp.moved':
    'If you move or reinstall the fairy app, the path changes, so register it again. If you registered it under the old name (jjakkung), remove that and register again with this command.',

  'settings.lang': 'Language',
  'settings.langAria': 'Display language',
  'settings.lang.auto': 'Auto',
  'settings.lang.ko': '한국어',
  'settings.lang.en': 'English',
  'settings.langHint': "Auto follows your computer's language.",
  'settings.langRestart': 'Restart to see the new language.',
  'settings.restart': 'Restart',

  'settings.start': 'Startup',
  'settings.launchAtLogin': 'Open at login',
  'settings.launchPackaged': 'Fairy shows up when you log in.',
  'settings.launchDev': 'Only works in the installed app. This is a dev build.',

  'settings.review': 'Daily review',
  'settings.reviewOn': 'Get a daily review',
  'settings.reviewOnHint':
    "Separate from how chatty I am. Even on Quiet, it comes once a day if this is on. If you miss it, it stays in the panel's missed alerts.",
  'settings.reviewTime': 'Review time',
  'settings.reviewHint':
    "The first time you're around after this time, it shows what you finished today and asks whether to move today's leftover due dates to tomorrow.",

  'settings.calendar': 'Import calendar',
  'settings.cal.url': 'Calendar address (.ics)',
  'settings.cal.hint':
    'Google Calendar: Settings > My calendars > Integrate calendar > paste the "Secret address in iCal format". Every 30 minutes it fetches the next 60 days and your fairy reminds you. The address stays on this computer. (Read only. To send events you add in fairy to Google, use "Send to Google Calendar" below.)',
  'settings.cal.fetch': 'Fetch now',
  'settings.cal.clear': 'Clear',

  'settings.backup': 'Backup and transfer',
  'settings.backupHint':
    'Export to-dos, notes, events, coins, fairies and settings into one folder, then import them on another computer.',
  'settings.export': 'Export',
  'settings.exported': 'Exported',
  'settings.exportFailed': "Couldn't export",
  'settings.importFailed': "Couldn't import",
  'settings.import': 'Import',
  'settings.petOnlyHint': 'To give just your fairy to a friend, use a .fairy file.',
  'settings.exportPet': 'Export fairy',
  'settings.petExported': 'Fairy file created',
  'settings.petExportFailed': "Couldn't create the fairy file. Try saving to another folder",
  'settings.importPet': 'Import fairy',

  'settings.update': 'Updates',
  'settings.updateCheck': 'New version alerts',
  'settings.updateHint':
    'Checks once a day for a new version, and your fairy lets you know. The installed app downloads ahead and installs when you press "Restart to update". If a required update comes out, AI chat is locked until you update (never when the check fails). Turning this off only silences new version bubbles; required updates are still checked. Only the app name and version are sent.',
  'settings.checkNow': 'Check now',
  'settings.onboardingAgain': 'Show the intro again',

  'settings.shortcuts': 'Shortcuts',
  'settings.shortcutChanged': 'Shortcut changed',
  'settings.zoomKeys': 'Bigger, smaller, reset (mouse over your fairy)',
  'settings.shortcut.hide': 'Hide and show',
  'settings.shortcut.quickAdd': 'Quick add a to-do (anywhere)',
  'settings.shortcut.chat': 'Open chat',
  'settings.shortcut.look': 'Look together',
  'settings.shortcut.recording': 'Press keys (Esc to stop)',
  'settings.shortcut.recordingBtn': 'Recording',
  'settings.shortcut.change': 'Change',
  'settings.shortcut.default': 'Reset',
  'settings.shortcut.none': 'None',
  'settings.shortcut.badKey': "That key can't be a shortcut. Try a letter, a number or F1 to F24.",
  'settings.shortcut.taken': 'That\'s already the "{name}" shortcut. Try other keys.',
  'settings.shortcut.needMod': 'Hold {mod} plus {alt} or Shift, so other apps keep their keys.',
  'settings.shortcut.needMore': '{one} alone clashes with other apps. Add one of {more}.',
  'settings.shortcut.optionOnly': 'Option combos type special characters. Add Cmd or Ctrl.',
  'settings.shortcut.fKey': 'Other apps use F1 to F12. Add a modifier key, or use F13 to F24.',
  'settings.shortcut.windowsKey': 'Windows keeps the Windows key combos. Use Ctrl or Alt instead.',
  'settings.shortcut.reserved': 'That combo is for {what} ({keys}). Try other keys.',
  'settings.shortcut.what.copy': 'copy',
  'settings.shortcut.what.paste': 'paste',
  'settings.shortcut.what.pastePlain': 'paste without formatting',
  'settings.shortcut.what.cut': 'cut',
  'settings.shortcut.what.selectAll': 'select all',
  'settings.shortcut.what.undo': 'undo',
  'settings.shortcut.what.redo': 'redo',
  'settings.shortcut.what.save': 'save',
  'settings.shortcut.what.saveAs': 'save as',
  'settings.shortcut.what.quit': 'quitting apps',
  'settings.shortcut.what.logout': 'logging out',
  'settings.shortcut.what.lock': 'locking the screen',
  'settings.shortcut.what.closeWindow': 'closing windows',
  'settings.shortcut.what.minimize': 'minimizing windows',
  'settings.shortcut.what.hideApp': 'hiding apps',
  'settings.shortcut.what.switchApp': 'switching apps',
  'settings.shortcut.what.switchWindow': 'switching windows',
  'settings.shortcut.what.switchTab': 'switching tabs',
  'settings.shortcut.what.spotlight': 'Spotlight search',
  'settings.shortcut.what.inputSource': 'switching input languages',
  'settings.shortcut.what.emoji': 'the emoji picker',
  'settings.shortcut.what.screenshot': 'screenshots',
  'settings.shortcut.what.fullScreen': 'full screen',
  'settings.shortcut.what.dock': 'hiding the Dock',
  'settings.shortcut.what.missionControl': 'Mission Control',
  'settings.shortcut.what.help': 'help search',
  'settings.shortcut.what.voiceOver': 'VoiceOver',
  'settings.shortcut.what.windowMenu': 'the window menu',
  'settings.shortcut.what.contextMenu': 'the right-click menu',
  'settings.shortcut.what.rotate': 'rotating the screen',

  'settings.statsCopied': 'Copied. Paste it along with your feedback',
  'settings.version': 'fairy {v}',
  'settings.licenses': 'Open source licenses',
  'settings.licensesHint':
    'The fairy app is open source under the MIT license. See the notices for the other open source software it includes.',
  'settings.licensesOpen': 'View notices',
  'settings.licensesFailed': "Couldn't open the notices file.",
  'settings.stats.title': 'My stats',
  'settings.stats.intro':
    'Numbers that show whether fairy is useful. They stay on this computer and go nowhere. Copying them into your feedback helps a lot.',
  'settings.stats.daysUsed': 'Days used',
  'settings.stats.dayValue': 'Day {day} ({used} days opened)',
  'settings.stats.dayValueOne': 'Day {day} ({used} day opened)',
  'settings.stats.fromToday': 'Starts today',
  'settings.stats.daysGoal': 'Still on at day 14',
  'settings.stats.doneMedian': 'To-dos done a day (median)',
  'settings.stats.count': '{n}',
  'settings.stats.countAtLeast': '{n} or more',
  'settings.stats.hidden': 'Time your fairy was hidden',
  'settings.stats.under': 'Under {n}%',
  'settings.stats.look': 'Look together (last 7 days)',
  'settings.stats.times': (v) => `${v.n} ${Number(v.n) === 1 ? 'time' : 'times'}`,
  'settings.stats.timesAtLeast': (v) => `${v.n}+ times`,
  'settings.stats.crash': 'Freezes and crashes (last 7 days)',
  'settings.stats.goal': 'Goal: {goal}',
  'settings.stats.met': 'met',
  'settings.stats.copy': 'Copy stats',
  'settings.stats.privacy': 'The copy has only dates and numbers. No to-do titles or chats.',

  'settings.report.title': 'fairy stats ({version}, {os})',
  'settings.report.first': 'First day {first}, today is day {day}, opened on {used} days',
  'settings.report.none': 'No stats yet',
  'settings.report.done': 'Median to-dos done a day: {n} (goal {goal} or more)',
  'settings.report.hidden': 'Fairy hidden: {n}% (goal under {goal}%)',
  'settings.report.look': 'Look together, last 7 days: {n} (goal {goal}+ a week)',
  'settings.report.crash': 'Crashes and freezes, last 7 days: {n} (goal {goal})',
  'settings.report.header': 'Date, on time, hidden, done, look together, crashes, focus',
  'settings.report.min': '{n}m',
  'settings.report.hours': '{n}h',

  'settings.os.mac': 'macOS',
  'settings.os.win': 'Windows',
};
