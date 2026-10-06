import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// 설정 창, 단축키, 베타 기록 글
export const ko = {
  'settings.loading': '불러오는 중',
  'settings.saved': '저장했어',
  'settings.title': '설정',
  'settings.copied': '복사했어',

  // 펫
  'settings.pet': '펫',
  'settings.name': '이름',
  'settings.nameChanged': '이름을 바꿨어',
  'settings.nameHint': (v: { name: string; max: number }) =>
    `메뉴에는 "${withParticle(v.name, '이랑')} 같이 보기", "${withParticle(v.name, '과')} 대화"처럼 보여. ${v.max}자까지.`,
  'settings.look': '모습',
  'settings.changePhotoPet': '사진 펫 바꾸기',
  'settings.makePhotoPet': '사진으로 펫 만들기',
  'settings.photoPetNow': '지금은 사진으로 만든 펫이야. 기본 펫으로 돌아가기도 거기서 해.',
  'settings.photoPetHint': '반려동물이나 인형 사진 한 장으로 펫을 바꿀 수 있어.',
  'settings.petKind': '기본 펫 모양',
  'settings.poses': '상태별 포즈',
  'settings.poseChange': '{label} 바꾸기',
  'settings.posePhoto': '{label} 사진',
  'settings.posesHint': '기쁠 때, 졸릴 때, 배고플 때 다른 사진으로 바뀌어. 없으면 기본 사진 그대로야.',
  'settings.size': '크기',
  'settings.sizeHint': '펫 위에서 {mod} + 휠, 트랙패드 핀치로도 바꿀 수 있어.',
  'settings.wander': '가끔 돌아다니기',
  'settings.wanderHint': '가만히 있다가 가끔 걷고 앉아. 끄면 늘 그 자리에 있어.',

  // 친구 펫
  'settings.friends': '친구 펫',
  'settings.friendsChanged': '친구 펫을 바꿨어',
  'settings.friends.hint': '친구 펫은 같이 돌아다니고 놀아. 할 일과 대화는 기본 펫이 맡아. {max}마리까지.',
  'settings.friends.photo': '사진',
  'settings.friends.sendHome': '집에 보내기',
  'settings.friends.name': '친구 이름',
  'settings.friends.kind': '친구 모양',
  'settings.friends.add': '데려오기',
  'settings.friends.import': '.jjpet 파일로 데려오기',

  // 삐짐
  'settings.sulk': '삐짐',
  'settings.restDays': '쉬는 날 (이날은 안 와도 안 삐져)',
  'settings.restDaysAria': '쉬는 날',
  /** 일요일부터 쉼표로 나눈 일곱 요일 */
  'settings.weekdays': '일,월,화,수,목,금,토',
  'settings.spicy': '매운맛',
  'settings.spicyHint': '안 온 날이 4일을 넘으면 더 크게 삐져(7일까지). 잃는 건 없고 할 일 하나면 바로 풀려.',

  // 말풍선
  'settings.bubbles': '말풍선',
  'settings.bubblesAria': '말풍선 빈도',
  'settings.chatterHint.quiet': '답이 왔다는 알림만 해.',
  'settings.chatterHint.normal': '바쁠 때 같은 상태 알림까지, 한 시간에 {n}개까지.',
  'settings.chatterHint.chatty': '혼잣말도 하고, 한 시간에 {n}개까지.',

  // AI
  'settings.ai': 'AI',
  'settings.persona': '성격과 말투',
  'settings.personaNext': '다음 질문부터 바뀌어.',
  'settings.aiKnowsTodos': '내 할 일 같이 보내기',
  'settings.aiKnowsTodosHint':
    "질문할 때 안 끝낸 할 일 제목과 마감, 오늘 남은 일정 제목을 AI 에 같이 보내. '오늘 뭐부터 할까?'에 답할 수 있어. 채팅 창 아래에서도 켜고 끌 수 있어.",
  'settings.myMcp': '내 MCP 도구 쓰기',
  'settings.myMcpOff':
    '아래 "내 AI 설정 없이 부르기"를 끄면 쓸 수 있어. Claude Code 에 연결해 둔 노션, 슬랙 같은 MCP 도구를 채팅에서 써.',
  'settings.myMcpOn': (v: { n: number }) =>
    `Claude Code 에 연결해 둔 MCP 도구(${v.n}개 서버)를 채팅에서 묻지 않고 써. 파일, 명령 도구는 여전히 꺼 둬. 글쓰기 같은 도구도 쓸 수 있으니 켤 때 주의해 줘.`,
  'settings.aiIsolation': '내 AI 설정 없이 부르기 (권장)',
  'settings.aiIsolationHint':
    'Claude Code 와 Codex 를 부를 때 내 훅, MCP, 스킬을 싣지 않아. 끄면 내 설정을 그대로 쓰는데 답이 느려지고 한도를 더 쓸 수 있어. 바꾸면 새 대화로 시작해.',

  // 다른 AI 에서 쓰기 (MCP)
  'settings.mcpSection': '다른 AI 에서 짝꿍 쓰기 (MCP)',
  'settings.mcp.intro':
    'Claude Code, Codex 에 짝꿍을 연결하면 그 안에서 "이거 짝꿍 할 일에 넣어 줘", "내일 3시 회의 일정 잡아 줘"가 돼. 할 일, 메모, 일정을 넣고 볼 수 있어. 넣은 것은 몇 초 안에 패널에 보여.',
  'settings.mcp.claude': 'Claude Code: 터미널에서 한 번 실행',
  'settings.mcp.copyCmd': '명령 복사',
  'settings.mcp.codex': 'Codex: ~/.codex/config.toml 에 붙여 넣기',
  'settings.mcp.copyConfig': '설정 복사',
  'settings.mcp.moved': '짝꿍을 다른 폴더로 옮기거나 다시 설치하면 경로가 바뀌니 다시 등록해 줘.',

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
  'settings.launchPackaged': '로그인하면 짝꿍이 저절로 떠.',
  'settings.launchDev': '설치한 앱에서만 바꿀 수 있어. 지금은 개발 중 실행이야.',

  // 하루 회고
  'settings.review': '하루 회고',
  'settings.reviewTime': '회고 시각',
  'settings.reviewHint':
    '이 시각이 지나고 처음 자리에 있을 때 오늘 끝낸 일을 알려 주고, 남은 오늘 마감을 내일로 넘길지 물어봐.',

  // 캘린더
  'settings.calendar': '캘린더 가져오기',
  'settings.cal.url': '캘린더 주소 (.ics)',
  'settings.cal.hint':
    '구글 캘린더: 설정 → 내 캘린더 → 캘린더 통합 → "iCal 형식의 비공개 주소"를 붙여 넣어. 30분마다 앞으로 60일 일정을 가져와서 펫이 알려 줘. 이 주소는 이 컴퓨터에만 둬. (읽기만 하고, 짝꿍에서 넣은 일정은 구글로 가지 않아.)',
  'settings.cal.fetch': '지금 가져오기',
  'settings.cal.clear': '지우기',

  // 백업
  'settings.backup': '백업과 옮기기',
  'settings.backupHint': '할 일, 메모, 일정, 코인, 펫, 설정을 폴더 하나로 내보내고, 다른 컴퓨터에서 가져와.',
  'settings.export': '내보내기',
  'settings.exported': '내보냈어',
  'settings.import': '가져오기',
  'settings.petOnlyHint': '펫만 친구에게 주려면 .jjpet 파일로.',
  'settings.exportPet': '펫 내보내기',
  'settings.petExported': '펫 파일을 만들었어',
  'settings.importPet': '펫 가져오기',

  // 업데이트
  'settings.update': '업데이트',
  'settings.updateCheck': '새 버전 알림',
  'settings.updateHint':
    '하루에 한 번 새 버전이 나왔는지 보고, 나왔으면 펫이 알려 줘. 앱 이름과 버전 말고는 보내지 않아.',
  'settings.checkNow': '지금 확인',
  'settings.onboardingAgain': '시작 안내 다시 보기',

  // 단축키
  'settings.shortcuts': '단축키',
  'settings.shortcutChanged': '단축키를 바꿨어',
  'settings.zoomKeys': '크게, 작게, 원래대로 (마우스가 펫 위에 있을 때)',
  'settings.shortcut.hide': '숨기기, 다시 보이기',
  'settings.shortcut.quickAdd': '할 일 한 줄 넣기 (어디서든)',
  'settings.shortcut.recording': '키를 눌러 줘 (Esc 는 그만)',
  'settings.shortcut.recordingBtn': '기록 중',
  'settings.shortcut.change': '바꾸기',
  'settings.shortcut.default': '기본으로',
  'settings.shortcut.badKey': '이 키는 단축키로 못 써. 글자, 숫자, F1~F24 같은 키를 눌러 줘.',
  'settings.shortcut.needMod': '{mod} 나 {alt} 를 같이 눌러 줘. 다른 앱 입력을 빼앗지 않게.',

  // 베타 기록
  'settings.statsCopied': '복사했어. 의견과 같이 붙여 넣어 줘',
  'settings.version': '짝꿍 {v}',
  'settings.stats.title': '내 기록 (베타)',
  'settings.stats.intro':
    '짝꿍이 쓸 만한지 보는 숫자야. 이 컴퓨터에만 있고 어디로도 보내지 않아. 의견을 보낼 때 복사해서 같이 붙여 주면 큰 도움이 돼.',
  'settings.stats.daysUsed': '쓴 날',
  'settings.stats.dayValue': '{day}일째 (켠 날 {used}일)',
  'settings.stats.dayValueOne': '{day}일째 (켠 날 {used}일)',
  'settings.stats.fromToday': '오늘부터',
  'settings.stats.daysGoal': '14일째에도 켜 두기',
  'settings.stats.doneMedian': '하루 끝낸 할 일 (중앙값)',
  'settings.stats.count': '{n}개',
  'settings.stats.countAtLeast': '{n}개 이상',
  'settings.stats.hidden': '펫을 숨긴 시간',
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
  'settings.report.title': '짝꿍 베타 기록 ({version}, {os})',
  'settings.report.first': '처음 켠 날 {first}, 오늘 {day}일째, 켠 날 {used}일',
  'settings.report.none': '아직 기록 없음',
  'settings.report.done': '하루 완료 할 일 중앙값 {n}개 (목표 {goal}개 이상)',
  'settings.report.hidden': '펫 숨긴 시간 {n}% (목표 {goal}% 미만)',
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

  'settings.pet': 'Pet',
  'settings.name': 'Name',
  'settings.nameChanged': 'Name changed',
  'settings.nameHint': (v) => `Menus will say things like "Chat with ${v.name}". Up to ${v.max} characters.`,
  'settings.look': 'Look',
  'settings.changePhotoPet': 'Change photo pet',
  'settings.makePhotoPet': 'Make a pet from a photo',
  'settings.photoPetNow': 'This pet is made from a photo. You can go back to the default pet there too.',
  'settings.photoPetHint': 'Turn one photo of your pet or a plush toy into your pet.',
  'settings.petKind': 'Default pet',
  'settings.poses': 'Poses by mood',
  'settings.poseChange': '{label}: change',
  'settings.posePhoto': '{label}: add photo',
  'settings.posesHint':
    'Shows a different photo when happy, sleepy or hungry. Without one, the main photo stays.',
  'settings.size': 'Size',
  'settings.sizeHint': 'You can also use {mod} + scroll or a trackpad pinch over the pet.',
  'settings.wander': 'Wander around',
  'settings.wanderHint': 'Sits still, then walks and sits now and then. Turn off to stay put.',

  'settings.friends': 'Pet friends',
  'settings.friendsChanged': 'Pet friends updated',
  'settings.friends.hint':
    'Pet friends wander and play along. Your main pet handles to-dos and chat. Up to {max}.',
  'settings.friends.photo': 'Photo',
  'settings.friends.sendHome': 'Send home',
  'settings.friends.name': 'Friend name',
  'settings.friends.kind': 'Friend look',
  'settings.friends.add': 'Bring over',
  'settings.friends.import': 'Bring one from a .jjpet file',

  'settings.sulk': 'Sulking',
  'settings.restDays': 'Days off (no sulking if you skip these)',
  'settings.restDaysAria': 'Days off',
  'settings.weekdays': 'Su,Mo,Tu,We,Th,Fr,Sa',
  'settings.spicy': 'Spicy mode',
  'settings.spicyHint':
    'After 4 days away, it sulks harder (up to 7 days). You lose nothing, and one to-do makes up.',

  'settings.bubbles': 'Speech bubbles',
  'settings.bubblesAria': 'Bubble frequency',
  'settings.chatterHint.quiet': 'Only tells you when an answer arrives.',
  'settings.chatterHint.normal': 'Also status notes like when you look busy, up to {n} an hour.',
  'settings.chatterHint.chatty': 'Talks to itself too, up to {n} an hour.',

  'settings.ai': 'AI',
  'settings.persona': 'Personality and tone',
  'settings.personaNext': 'Applies from your next question.',
  'settings.aiKnowsTodos': 'Share my to-dos',
  'settings.aiKnowsTodosHint':
    'Sends your open to-do titles and due dates, plus the titles of today\'s remaining events, with each question. Then it can answer "What should I do first?". You can also switch this under the chat box.',
  'settings.myMcp': 'Use my MCP tools',
  'settings.myMcpOff':
    'Turn off "Call without my AI setup" below to use this. Lets chat use MCP tools you connected to Claude Code, like Notion or Slack.',
  'settings.myMcpOn': (v) =>
    `Chat uses the MCP tools you connected to Claude Code (${v.n} ${v.n === 1 ? 'server' : 'servers'}) without asking. File and command tools stay off. Some tools can write things, so be careful.`,
  'settings.aiIsolation': 'Call without my AI setup (recommended)',
  'settings.aiIsolationHint':
    'Calls Claude Code and Codex without your hooks, MCP and skills. Turn off to use your own setup, but answers get slower and may use more of your limit. Changing this starts a new chat.',

  'settings.mcpSection': 'Use Jjakkung from other AIs (MCP)',
  'settings.mcp.intro':
    'Connect Jjakkung to Claude Code or Codex and you can say "Add this to my Jjakkung to-dos" or "Schedule a meeting tomorrow at 3". It can add and read to-dos, notes and events. New items show up in the panel within seconds.',
  'settings.mcp.claude': 'Claude Code: run once in a terminal',
  'settings.mcp.copyCmd': 'Copy command',
  'settings.mcp.codex': 'Codex: paste into ~/.codex/config.toml',
  'settings.mcp.copyConfig': 'Copy config',
  'settings.mcp.moved': 'If you move or reinstall Jjakkung, the path changes, so register it again.',

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
  'settings.launchPackaged': 'Jjakkung shows up when you log in.',
  'settings.launchDev': 'Only works in the installed app. This is a dev build.',

  'settings.review': 'Daily review',
  'settings.reviewTime': 'Review time',
  'settings.reviewHint':
    "The first time you're around after this time, it shows what you finished today and asks whether to move today's leftover due dates to tomorrow.",

  'settings.calendar': 'Import calendar',
  'settings.cal.url': 'Calendar address (.ics)',
  'settings.cal.hint':
    'Google Calendar: Settings → My calendars → Integrate calendar → paste the "Secret address in iCal format". Every 30 minutes it fetches the next 60 days and your pet reminds you. The address stays on this computer. (Read only. Events you add in Jjakkung are not sent to Google.)',
  'settings.cal.fetch': 'Fetch now',
  'settings.cal.clear': 'Clear',

  'settings.backup': 'Backup and transfer',
  'settings.backupHint':
    'Export to-dos, notes, events, coins, pets and settings into one folder, then import them on another computer.',
  'settings.export': 'Export',
  'settings.exported': 'Exported',
  'settings.import': 'Import',
  'settings.petOnlyHint': 'To give just your pet to a friend, use a .jjpet file.',
  'settings.exportPet': 'Export pet',
  'settings.petExported': 'Pet file created',
  'settings.importPet': 'Import pet',

  'settings.update': 'Updates',
  'settings.updateCheck': 'New version alerts',
  'settings.updateHint':
    'Checks once a day for a new version, and your pet lets you know. Only the app name and version are sent.',
  'settings.checkNow': 'Check now',
  'settings.onboardingAgain': 'Show the intro again',

  'settings.shortcuts': 'Shortcuts',
  'settings.shortcutChanged': 'Shortcut changed',
  'settings.zoomKeys': 'Bigger, smaller, reset (mouse over the pet)',
  'settings.shortcut.hide': 'Hide and show',
  'settings.shortcut.quickAdd': 'Quick add a to-do (anywhere)',
  'settings.shortcut.recording': 'Press keys (Esc to stop)',
  'settings.shortcut.recordingBtn': 'Recording',
  'settings.shortcut.change': 'Change',
  'settings.shortcut.default': 'Reset',
  'settings.shortcut.badKey': "That key can't be a shortcut. Try a letter, a number or F1 to F24.",
  'settings.shortcut.needMod': 'Hold {mod} or {alt} too, so other apps keep their keys.',

  'settings.statsCopied': 'Copied. Paste it along with your feedback',
  'settings.version': 'Jjakkung {v}',
  'settings.stats.title': 'My stats (beta)',
  'settings.stats.intro':
    'Numbers that show whether Jjakkung is useful. They stay on this computer and go nowhere. Copying them into your feedback helps a lot.',
  'settings.stats.daysUsed': 'Days used',
  'settings.stats.dayValue': 'Day {day} ({used} days opened)',
  'settings.stats.dayValueOne': 'Day {day} ({used} day opened)',
  'settings.stats.fromToday': 'Starts today',
  'settings.stats.daysGoal': 'Still on at day 14',
  'settings.stats.doneMedian': 'To-dos done a day (median)',
  'settings.stats.count': '{n}',
  'settings.stats.countAtLeast': '{n} or more',
  'settings.stats.hidden': 'Time pet was hidden',
  'settings.stats.under': 'Under {n}%',
  'settings.stats.look': 'Look together (last 7 days)',
  'settings.stats.times': (v) => `${v.n} ${Number(v.n) === 1 ? 'time' : 'times'}`,
  'settings.stats.timesAtLeast': (v) => `${v.n}+ times`,
  'settings.stats.crash': 'Freezes and crashes (last 7 days)',
  'settings.stats.goal': 'Goal: {goal}',
  'settings.stats.met': 'met',
  'settings.stats.copy': 'Copy stats',
  'settings.stats.privacy': 'The copy has only dates and numbers. No to-do titles or chats.',

  'settings.report.title': 'Jjakkung beta stats ({version}, {os})',
  'settings.report.first': 'First day {first}, today is day {day}, opened on {used} days',
  'settings.report.none': 'No stats yet',
  'settings.report.done': 'Median to-dos done a day: {n} (goal {goal} or more)',
  'settings.report.hidden': 'Pet hidden: {n}% (goal under {goal}%)',
  'settings.report.look': 'Look together, last 7 days: {n} (goal {goal}+ a week)',
  'settings.report.crash': 'Crashes and freezes, last 7 days: {n} (goal {goal})',
  'settings.report.header': 'Date, on time, hidden, done, look together, crashes, focus',
  'settings.report.min': '{n}m',
  'settings.report.hours': '{n}h',

  'settings.os.mac': 'macOS',
  'settings.os.win': 'Windows',
};
