import { withParticle } from '../josa.ts';
import type { Translation } from './types.ts';

// AI 연결, 성격, 오류, 사용량 글
export const ko = {
  // 성격 (설정 화면에 보인다)
  'ai.persona.friend.label': '다정한 친구',
  'ai.persona.friend.hint': '반말로 다정하게. 기본.',
  'ai.persona.polite.label': '존댓말 비서',
  'ai.persona.polite.hint': '존댓말로 차분하고 깔끔하게.',
  'ai.persona.tsundere.label': '츤데레',
  'ai.persona.tsundere.hint': '툴툴대지만 결국 잘 챙겨 준다.',
  'ai.persona.calm.label': '차분한 선생님',
  'ai.persona.calm.hint': '반말로 천천히, 이유를 짚어 준다.',
  // 설치, 로그인 안내
  'ai.install.claude': 'Claude Code를 설치하고 터미널에서 claude로 한 번 로그인해 줘.',
  'ai.login.claude': '터미널에서 claude로 로그인해 줘.',
  'ai.install.codex': 'Codex CLI를 설치하고 터미널에서 codex를 실행해 Sign in with ChatGPT로 로그인해 줘.',
  'ai.login.codex': '터미널에서 codex를 실행해 Sign in with ChatGPT로 로그인해 줘.',
  'ai.install.cursor': 'Cursor Agent CLI를 설치하고 터미널에서 cursor-agent login으로 로그인해 줘.',
  'ai.login.cursor': '터미널에서 cursor-agent login으로 로그인해 줘.',
  'ai.install.gemini': 'Gemini CLI를 설치하고 터미널에서 gemini를 한 번 실행해 로그인해 줘.',
  'ai.login.gemini': '터미널에서 gemini를 실행해 Sign in with Google로 로그인해 줘.',
  'ai.install.custom': (v: { bin: string }) => `터미널에서 ${v.bin} 명령이 실행되는지 확인해 줘.`,
  // 설치 방법 펼쳐 보기 (#29, 명령과 주소는 shared/ai/install-guide.ts)
  'ai.guide.show': '설치 방법 보기',
  'ai.guide.hide': '설치 방법 접기',
  'ai.guide.title': (v: { label: string }) => `${v.label} 설치하고 로그인하기`,
  'ai.guide.step1.mac':
    '1. 터미널 앱을 열어 줘 (Spotlight에서 "터미널" 검색). 아래 명령 중 하나를 붙여 넣고 Enter를 눌러.',
  'ai.guide.step1.win': '1. 시작 메뉴에서 PowerShell을 열어 줘. 아래 명령 중 하나를 붙여 넣고 Enter를 눌러.',
  'ai.guide.step1.linux': '1. 터미널을 열어 줘. 아래 명령 중 하나를 붙여 넣고 Enter를 눌러.',
  'ai.guide.node': (v: { version: string }) => `npm으로 깔려면 Node.js ${v.version} 이상이 먼저 있어야 해.`,
  'ai.guide.nodeLink': 'Node.js 받기',
  'ai.guide.step2': (v: { cmd: string }) =>
    `2. 다 깔리면 터미널을 새로 열고 ${withParticle(v.cmd, '을')} 실행해. 브라우저가 열리면 거기서 로그인하면 끝이야.`,
  'ai.guide.step2Pick': (v: { cmd: string; pick: string }) =>
    `2. 다 깔리면 터미널을 새로 열고 ${withParticle(v.cmd, '을')} 실행해. ${v.pick} 항목을 고르고 브라우저에서 로그인하면 끝이야.`,
  'ai.guide.step3': '3. 여기로 돌아와 다시 확인을 눌러 줘.',
  'ai.guide.stillTitle': '깔았는데도 못 찾으면',
  'ai.guide.still.check': (v: { cmd: string }) =>
    `새 터미널에서 ${v.cmd} 명령이 되는지 먼저 봐 줘. 안 되면 설치가 덜 끝난 거라 위 명령을 다시 실행해 줘.`,
  'ai.guide.still.path': (v: { dir: string }) =>
    `터미널에서도 command not found가 나오면 설치 폴더(${v.dir})가 PATH에 없는 거야. 설치 끝에 나온 PATH 안내나 공식 안내를 따라 넣어 줘.`,
  'ai.guide.still.mac':
    '터미널에서는 되는데 여기서만 못 찾으면: Dock이나 Finder로 연 앱은 터미널의 PATH를 물려받지 못해서, 페어리는 셸 설정 파일(~/.zshrc, ~/.zprofile)에서 PATH를 따로 읽어. PATH를 거기에 넣었는지 보고 다시 확인을 눌러 줘. 그래도 안 되면 페어리를 껐다 켜 줘.',
  'ai.guide.still.linux':
    '터미널에서는 되는데 여기서만 못 찾으면: 페어리는 셸 설정 파일(~/.bashrc, ~/.profile 등)에서 PATH를 읽어. PATH를 거기에 넣었는지 보고 다시 확인을 눌러 줘. 그래도 안 되면 페어리를 껐다 켜 줘.',
  'ai.guide.still.win':
    '터미널에서는 되는데 여기서만 못 찾으면 페어리를 완전히 껐다 켜 줘 (트레이 아이콘에서 끝내기). 윈도우 앱은 켤 때의 PATH를 써서, 설치하면서 바뀐 PATH는 다시 켜야 보여.',
  'ai.guide.docs': '공식 설치 안내 열기',
  'ai.guide.copyLabel': (v: { cmd: string }) => `명령 복사: ${v.cmd}`,
  // 로그인 안 됨도 같은 틀로 (설치는 건너뛰고 로그인부터)
  'ai.guide.showLogin': '로그인 방법 보기',
  'ai.guide.hideLogin': '로그인 방법 접기',
  'ai.guide.loginTitle': (v: { label: string }) => `${v.label} 로그인하기`,
  'ai.guide.login.step1.mac':
    '1. 터미널 앱을 열어 줘 (Spotlight에서 "터미널" 검색). 아래 명령을 붙여 넣고 Enter를 눌러.',
  'ai.guide.login.step1.win': '1. 시작 메뉴에서 PowerShell을 열어 줘. 아래 명령을 붙여 넣고 Enter를 눌러.',
  'ai.guide.login.step1.linux': '1. 터미널을 열어 줘. 아래 명령을 붙여 넣고 Enter를 눌러.',
  'ai.guide.login.pick': (v: { pick: string }) => `${v.pick} 항목을 고르고 브라우저에서 로그인해 줘.`,
  'ai.guide.login.browser': '브라우저가 열리면 거기서 로그인해 줘.',
  'ai.guide.login.step2': '2. 여기로 돌아와 다시 확인을 누르고 질문을 다시 보내 줘.',
  'ai.guide.login.stillTitle': '로그인했는데도 안 되면',
  'ai.guide.login.still.status': (v: { cmd: string }) =>
    `터미널에서 ${withParticle(v.cmd, '으로')} 로그인 상태를 볼 수 있어. 로그인 안 됨으로 나오면 위 명령을 다시 실행해 줘.`,
  'ai.guide.login.still.account': '계정이나 요금제에 따라 이 AI를 못 쓸 수도 있어. 공식 안내에서 확인해 줘.',
  'ai.guide.loginDocs': '공식 안내 열기',
  // 직접 추가한 AI: 설치 명령은 모르니 실행되는지, 전체 경로로 다시 추가하는 길을 알려 준다
  'ai.guide.custom.title': (v: { label: string }) => `${v.label} 연결하기`,
  'ai.guide.custom.step1': (v: { bin: string }) =>
    `1. 직접 추가한 AI라 설치는 그 AI의 공식 안내를 따라 줘. 깔았으면 새 터미널에서 ${withParticle(v.bin, '이')} 실행되는지 봐 줘.`,
  'ai.guide.custom.step2':
    '2. 터미널에서는 되는데 여기서만 못 찾으면 아래 명령으로 전체 경로를 알아내. AI 관리에서 이 AI를 빼고 명령 칸에 그 경로를 넣어 다시 추가해 줘.',
  'ai.guide.custom.abs': (v: { bin: string }) =>
    `2. 적어 둔 경로(${v.bin})에 실행 파일이 있는지 봐 줘. 옮겼거나 지웠으면 AI 관리에서 이 AI를 빼고 새 경로로 다시 추가해 줘.`,
  'ai.guide.custom.login': (v: { label: string }) =>
    `1. ${withParticle(v.label, '은')} 직접 추가한 AI라 로그인 방법은 그 AI의 공식 안내를 따라 줘. 터미널에서 먼저 로그인해 두면 돼.`,
  'ai.custom.noName': '이름을 적어 줘.',
  'ai.custom.badBin': '명령은 실행 파일 이름 하나만 적어 줘. 나머지는 인자 칸에.',
  // 오류
  'ai.error.rateLimitAt': (v: { label: string; at: string }) =>
    `${v.label} 사용 한도에 걸렸어. ${v.at} 이후에 다시 물어봐 줘.`,
  'ai.error.rateLimit': (v: { label: string }) => `${v.label} 사용 한도에 걸렸어. 조금 뒤에 다시 물어봐 줘.`,
  'ai.error.notLoggedIn': (v: { label: string; hint: string }) =>
    `${v.label}에 로그인이 안 돼 있어. ${v.hint}`,
  'ai.error.loginHint': '터미널에서 로그인해 줘.',
  'ai.error.failed': (v: { label: string; detail: string }) =>
    `${withParticle(v.label, '이')} 답하다 멈췄어.${v.detail}`,
  'ai.error.notInstalled': (v: { label: string; hint: string }) =>
    `${withParticle(v.label, '을')} 이 컴퓨터에서 못 찾았어. ${v.hint}`,
  'ai.error.timeout': (v: { label: string; seconds: number }) =>
    `${withParticle(v.label, '이')} ${v.seconds}초 동안 답이 없어서 멈췄어. 다시 물어봐 줘.`,
  'ai.error.cancelled': '질문을 멈췄어.',
  'ai.local.label': '무료 AI',
  'ai.local.install': '앱 안에 들어 있어. 처음 쓸 때 모델을 한 번 받아.',
  'ai.local.needsModel':
    '무료 AI는 처음 한 번 모델을 받아야 답할 수 있어 ({mb}MB). 아래 단추로 받으면 이 질문에 바로 이어서 답할게.',
  'ai.local.download': '받기 ({mb}MB)',
  'ai.local.downloading': '받는 중 {pct}%',
  'ai.local.downloadFailed': '모델을 못 받았어. 인터넷 연결을 보고 다시 눌러 줘.',
  'ai.local.slow': '무료 AI가 너무 오래 걸려. 다시 물어봐 줘.',
  'ai.local.failed': '무료 AI가 답을 못 만들었어. 다시 물어봐 줘.',
  'ai.local.crashed': '무료 AI가 멈췄어. 다시 물어봐 줘.',
  'ai.error.exitCode': (v: { code: string }) => `종료 코드 ${v.code}`,
  // 사용량
  'ai.usage.days': (v: { n: number }) => `${v.n}일`,
  'ai.usage.hours': (v: { n: number }) => `${v.n}시간`,
  'ai.usage.minutes': (v: { n: number }) => `${v.n}분`,
  'ai.usage.resetSoon': '곧 초기화',
  'ai.usage.resetMinutes': (v: { n: number }) => `${v.n}분 뒤 초기화`,
  'ai.usage.resetHours': (v: { n: number }) => `${v.n}시간 뒤 초기화`,
  'ai.usage.resetAt': (v: { when: string }) => `${v.when} 초기화`,
  // AI 에게 보내는 질문에 붙이는 틀 (화면에는 안 보이고 AI 가 읽는다. 화면 말과 같은 말로 보낸다)
  'ai.ctx.head': (v: { day: string }) => `[내 오늘 상황, ${v.day}]`,
  'ai.ctx.events': '남은 일정:',
  'ai.ctx.allDay': '종일',
  'ai.ctx.todos': '안 끝낸 할 일:',
  'ai.ctx.important': '[중요] ',
  'ai.ctx.overdue': ' (마감 지남)',
  'ai.ctx.dueToday': ' (오늘 마감)',
  'ai.ctx.due': (v: { day: string }) => ` (마감 ${v.day})`,
  'ai.ctx.more': (v: { n: number }) => `(그 밖에 ${v.n}개 더)`,
  'ai.ctx.question': '[질문]',
  'ai.history.head': '지금까지 대화:',
  'ai.history.user': '사용자',
  'ai.history.you': '너',
  'ai.history.question': '사용자 질문',
};

export const en: Translation<typeof ko> = {
  'ai.persona.friend.label': 'Warm friend',
  'ai.persona.friend.hint': 'Casual and kind. The default.',
  'ai.persona.polite.label': 'Polite assistant',
  'ai.persona.polite.hint': 'Polite, calm and tidy.',
  'ai.persona.tsundere.label': 'Tsundere',
  'ai.persona.tsundere.hint': 'Grumbles a bit, but always looks out for you.',
  'ai.persona.calm.label': 'Calm teacher',
  'ai.persona.calm.hint': 'Casual and unhurried, explains the why.',
  'ai.install.claude': 'Install Claude Code and log in once by running claude in a terminal.',
  'ai.login.claude': 'Log in by running claude in a terminal.',
  'ai.install.codex': 'Install the Codex CLI, then run codex in a terminal and pick Sign in with ChatGPT.',
  'ai.login.codex': 'Run codex in a terminal and pick Sign in with ChatGPT.',
  'ai.install.cursor': 'Install the Cursor Agent CLI and log in with cursor-agent login in a terminal.',
  'ai.login.cursor': 'Log in with cursor-agent login in a terminal.',
  'ai.install.gemini': 'Install the Gemini CLI and run gemini once in a terminal to log in.',
  'ai.login.gemini': 'Run gemini in a terminal and pick Sign in with Google.',
  'ai.install.custom': (v) => `Check that the ${v.bin} command runs in a terminal.`,
  'ai.guide.show': 'How to install',
  'ai.guide.hide': 'Hide install steps',
  'ai.guide.title': (v) => `Install and log in to ${v.label}`,
  'ai.guide.step1.mac':
    '1. Open the Terminal app (search "Terminal" in Spotlight). Paste one of the commands below and press Enter.',
  'ai.guide.step1.win':
    '1. Open PowerShell from the Start menu. Paste one of the commands below and press Enter.',
  'ai.guide.step1.linux': '1. Open a terminal. Paste one of the commands below and press Enter.',
  'ai.guide.node': (v) => `Installing with npm needs Node.js ${v.version} or later first.`,
  'ai.guide.nodeLink': 'Get Node.js',
  'ai.guide.step2': (v) =>
    `2. When it's done, open a new terminal and run ${v.cmd}. Log in when your browser opens and you're set.`,
  'ai.guide.step2Pick': (v) =>
    `2. When it's done, open a new terminal and run ${v.cmd}. Pick ${v.pick} and log in from your browser and you're set.`,
  'ai.guide.step3': '3. Come back here and press Check again.',
  'ai.guide.stillTitle': 'Installed but still not found?',
  'ai.guide.still.check': (v) =>
    `First check that ${v.cmd} works in a new terminal. If it doesn't, the install didn't finish, so run the command above again.`,
  'ai.guide.still.path': (v) =>
    `If the terminal also says command not found, the install folder (${v.dir}) isn't on your PATH. Follow the PATH note the installer printed, or the official guide.`,
  'ai.guide.still.mac':
    "If it works in a terminal but not here: apps opened from the Dock or Finder don't inherit your terminal's PATH, so Fairy reads PATH from your shell config (~/.zshrc, ~/.zprofile). Make sure PATH is set there, then press Check again. Still nothing? Quit Fairy and open it again.",
  'ai.guide.still.linux':
    'If it works in a terminal but not here: Fairy reads PATH from your shell config (~/.bashrc, ~/.profile and so on). Make sure PATH is set there, then press Check again. Still nothing? Quit Fairy and open it again.',
  'ai.guide.still.win':
    'If it works in a terminal but not here, quit Fairy completely (Quit from the tray icon) and open it again. Windows apps keep the PATH they started with, so a PATH the installer changed only shows up after a restart.',
  'ai.guide.docs': 'Open the official install guide',
  'ai.guide.copyLabel': (v) => `Copy command: ${v.cmd}`,
  'ai.guide.showLogin': 'How to log in',
  'ai.guide.hideLogin': 'Hide login steps',
  'ai.guide.loginTitle': (v) => `Log in to ${v.label}`,
  'ai.guide.login.step1.mac':
    '1. Open the Terminal app (search "Terminal" in Spotlight). Paste the command below and press Enter.',
  'ai.guide.login.step1.win':
    '1. Open PowerShell from the Start menu. Paste the command below and press Enter.',
  'ai.guide.login.step1.linux': '1. Open a terminal. Paste the command below and press Enter.',
  'ai.guide.login.pick': (v) => `Pick ${v.pick} and log in from your browser.`,
  'ai.guide.login.browser': 'Log in when your browser opens.',
  'ai.guide.login.step2': '2. Come back here, press Check again, then send your question again.',
  'ai.guide.login.stillTitle': 'Logged in but still not working?',
  'ai.guide.login.still.status': (v) =>
    `Run ${v.cmd} in a terminal to see your login status. If it says you're not logged in, run the command above again.`,
  'ai.guide.login.still.account': 'Some accounts or plans may not include this AI. Check the official guide.',
  'ai.guide.loginDocs': 'Open the official guide',
  'ai.guide.custom.title': (v) => `Connect ${v.label}`,
  'ai.guide.custom.step1': (v) =>
    `1. You added this AI yourself, so install it the way its official guide says. Once it's installed, check that ${v.bin} runs in a new terminal.`,
  'ai.guide.custom.step2':
    '2. If it runs in a terminal but not here, find its full path with the command below. Remove this AI in Manage AIs and add it again with that path in the Command field.',
  'ai.guide.custom.abs': (v) =>
    `2. Check that a program is still at the path you entered (${v.bin}). If you moved or removed it, remove this AI in Manage AIs and add it again with the new path.`,
  'ai.guide.custom.login': (v) =>
    `1. You added ${v.label} yourself, so follow its official guide to log in. Log in from a terminal first.`,
  'ai.custom.noName': 'Give it a name.',
  'ai.custom.badBin': 'Put just the program name in Command. The rest goes in Arguments.',
  'ai.error.rateLimitAt': (v) => `${v.label} hit its usage limit. Ask again after ${v.at}.`,
  'ai.error.rateLimit': (v) => `${v.label} hit its usage limit. Ask again in a bit.`,
  'ai.error.notLoggedIn': (v) => `You're not logged in to ${v.label}. ${v.hint}`,
  'ai.error.loginHint': 'Log in from a terminal.',
  'ai.error.failed': (v) => `${v.label} stopped while answering.${v.detail}`,
  'ai.error.notInstalled': (v) => `Couldn't find ${v.label} on this computer. ${v.hint}`,
  'ai.error.timeout': (v) => `${v.label} didn't answer for ${v.seconds} seconds, so I stopped. Ask again.`,
  'ai.error.cancelled': 'Stopped the question.',
  'ai.local.label': 'Free AI',
  'ai.local.install': 'Built into the app. The model downloads once on first use.',
  'ai.local.needsModel':
    "The free AI needs a one-time model download before it can answer ({mb} MB). Download it below and I'll answer this question right after.",
  'ai.local.download': 'Download ({mb} MB)',
  'ai.local.downloading': 'Downloading {pct}%',
  'ai.local.downloadFailed': "Couldn't download the model. Check your connection and try again.",
  'ai.local.slow': 'The free AI is taking too long. Try asking again.',
  'ai.local.failed': "The free AI couldn't answer. Try asking again.",
  'ai.local.crashed': 'The free AI stopped. Try asking again.',
  'ai.error.exitCode': (v) => `Exit code ${v.code}`,
  'ai.usage.days': (v) => `${v.n}d`,
  'ai.usage.hours': (v) => `${v.n}h`,
  'ai.usage.minutes': (v) => `${v.n}m`,
  'ai.usage.resetSoon': 'Resets soon',
  'ai.usage.resetMinutes': (v) => `Resets in ${v.n} min`,
  'ai.usage.resetHours': (v) => (Number(v.n) === 1 ? 'Resets in 1 hour' : `Resets in ${v.n} hours`),
  'ai.usage.resetAt': (v) => `Resets ${v.when}`,
  'ai.ctx.head': (v) => `[My day so far, ${v.day}]`,
  'ai.ctx.events': 'Events left today:',
  'ai.ctx.allDay': 'All day',
  'ai.ctx.todos': 'Open to-dos:',
  'ai.ctx.important': '[important] ',
  'ai.ctx.overdue': ' (overdue)',
  'ai.ctx.dueToday': ' (due today)',
  'ai.ctx.due': (v) => ` (due ${v.day})`,
  'ai.ctx.more': (v) => `(${v.n} more)`,
  'ai.ctx.question': '[Question]',
  'ai.history.head': 'Conversation so far:',
  'ai.history.user': 'User',
  'ai.history.you': 'You',
  'ai.history.question': 'User question',
};
