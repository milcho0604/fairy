import type { Translation } from './types.ts';

// 구글 캘린더 (6단계 보내기, 이슈 #54 가져오기): 설정 창 칸, 펫 알림, 연결 뒤 브라우저에 보이는 쪽
export const ko = {
  'gcal.title': '구글 캘린더',
  'gcal.intro':
    '페어리에서 넣은 일정을 내 구글 캘린더에도 넣어. 페어리에서 고치거나 지우면 구글에서도 바뀌어. 캘린더에서 가져온 일정은 다시 보내지 않아.',
  'gcal.oneWay':
    '지금은 보내기만 해. 구글 캘린더에 원래 있던 일정도 페어리에서 보려면 아래 "구글 캘린더 일정 가져오기"를 켜 줘.',
  'gcal.twoWay':
    '구글 캘린더에 원래 있던 일정도 페어리로 가져와서 "구글에서" 표식을 달아 보여 줘. 가져온 일정은 페어리에서 고치지 않아. 구글 캘린더에서 고치거나 지우면 따라와.',
  'gcal.connect': '구글 계정 연결',
  'gcal.connecting':
    '브라우저에서 허락을 기다리는 중이야. 구글 화면에서 캘린더 일정과 캘린더 목록 권한을 체크하고 계속을 눌러 줘.',
  'gcal.cancel': '그만두기',
  // 같은 계정의 다른 기기에서 연결했을 때 (#115)
  'gcal.linkHint': '다른 기기에서 구글 일정을 연결했어. 이 기기도 연결할까?',
  'gcal.linkHintNo': '괜찮아, 다시 묻지 마',
  'gcal.disconnect': '연결 끊기',
  'gcal.disconnected': '구글 연결을 끊었어',
  'gcal.connected': '구글 캘린더에 연결됐어',
  'gcal.push': '페어리 일정을 구글 캘린더로 보내기',
  'gcal.pushHint': '어제 이후 일정부터 보내. 끄면 더 보내지 않고, 이미 보낸 일정은 구글에 그대로 둬.',
  'gcal.pull': '구글 캘린더 일정 가져오기',
  'gcal.pullHint':
    '고른 캘린더의 지난 7일부터 앞으로 60일까지 일정을 15분마다 읽어 와. 제목과 시각만 읽고, 페어리에서 보낸 일정은 또 가져오지 않아. 끄면 가져온 일정은 페어리에서 사라져.',
  'gcal.ai': 'AI가 구글 일정도 볼 수 있게',
  'gcal.aiHint':
    '켜면 가져온 구글 일정도 AI 대화, "오늘 뭐부터", 계획 다듬기, 페어리 도구(MCP)에서 같이 봐. 꺼 두면 AI에게는 안 보여.',
  'gcal.aiOnNote':
    '구글 일정 제목과 시각이 고른 AI로 가. 클라우드 AI면 이 컴퓨터 밖으로 나가. AI가 봐도 구글 일정은 고치지 못해.',
  'gcal.calendar': '보내고 가져올 캘린더',
  'gcal.calendarHint': '구글 캘린더 설정 > 그 캘린더 > 캘린더 통합의 "캘린더 ID"를 붙여 넣어.',
  'gcal.pick': '캘린더 고르기',
  'gcal.pickPull': (v: { names: string }) => `가져오기: ${v.names}`,
  'gcal.pickPush': (v: { name: string }) => `보내기: ${v.name}`,
  'gcal.pickNone': '없음',
  'gcal.pickRelink': '캘린더 목록을 보려면 한 번 다시 연결해 줘. 그동안은 지금처럼 해.',
  'gcal.sheet.title': '구글 캘린더 옵션',
  'gcal.sheet.intro':
    '캘린더마다 페어리로 가져올지 고르고, 페어리 일정을 보낼 캘린더를 하나 골라. 고르면 바로 저장돼.',
  'gcal.sheet.colCal': '캘린더',
  'gcal.sheet.colPull': '가져오기',
  'gcal.sheet.colPush': '보내기',
  'gcal.sheet.kind.primary': '기본 캘린더',
  'gcal.sheet.kind.mine': '내 캘린더',
  'gcal.sheet.kind.shared': '공유됨',
  'gcal.sheet.kind.readOnly': '읽기만',
  'gcal.sheet.custom': '직접 넣음',
  'gcal.sheet.hidden': '구글에서 숨김',
  'gcal.sheet.failed': '지난번에 못 읽었어',
  'gcal.sheet.pullOf': (v: { name: string }) => `가져오기: ${v.name}`,
  'gcal.sheet.pushTo': (v: { name: string }) => `보내기: ${v.name}`,
  'gcal.sheet.readOnlyTip': '보기만 할 수 있는 캘린더라 페어리 일정을 보낼 수 없어',
  'gcal.sheet.noPush': '보내지 않기',
  'gcal.sheet.noPushHint': '페어리 일정은 페어리에만 둬',
  'gcal.sheet.pushMoves': '보낼 캘린더를 바꾸면 이미 보낸 일정도 새 캘린더로 옮겨.',
  'gcal.sheet.loading': '캘린더 목록을 읽는 중이야',
  'gcal.sheet.listFailed': '캘린더 목록을 못 읽었어. 인터넷을 보고 다시 해 줘.',
  'gcal.sheet.retry': '다시 읽기',
  'gcal.sheet.relinkTitle': '캘린더 목록을 보려면 다시 연결해 줘',
  'gcal.sheet.relink':
    '예전에 연결할 때는 캘린더 목록 권한을 받지 않았어. 한 번 다시 연결하면 여기서 캘린더를 고를 수 있어. 그동안은 아래 캘린더로 지금처럼 해.',
  'gcal.sheet.relinkBtn': '다시 연결',
  'gcal.sheet.addId': '목록에 없는 캘린더 ID 직접 넣기',
  'gcal.sheet.add': '더하기',
  'gcal.sheet.done': '다 됐어',
  'gcal.calendarBad': '캘린더 ID 모양이 아니야. 메일 주소처럼 생긴 ID를 넣어 줘',
  'gcal.syncNow': '지금 보내기',
  'gcal.pullNow': '지금 가져오기',
  'gcal.syncBoth': '지금 맞추기',
  'gcal.state.synced': '다 보냈어 ({when})',
  'gcal.state.pending': (v: { n: number }) => `보낼 일정 ${v.n}개가 남았어`,
  'gcal.state.idle': '아직 보낸 일정이 없어',
  'gcal.state.pulled': (v: { n: number; when: string }) => `일정 ${v.n}개 가져왔어 (${v.when})`,
  'gcal.state.pullIdle': '곧 가져올게',
  'gcal.privacy':
    '캘린더 일정 권한과 캘린더 목록 보기 권한만 받아 (캘린더 설정, 공유는 못 봐). 페어리 할 일 캘린더를 쓰면 그때만 페어리가 만드는 캘린더 권한을 하나 더 물어. 가져온 일정은 제목과 시각, 캘린더 이름과 색만 이 컴퓨터에 둬. 연결 토큰은 이 컴퓨터에만 두고 설정, 백업에 넣지 않아.',
  'gcal.problem.expired': '구글 연결이 끝났어. 구글에서 권한을 거뒀거나 오래돼서 그래. 다시 연결해 줄래?',
  'gcal.problem.relink':
    '저장해 둔 구글 연결을 더는 열 수 없어. 앱 이름이나 열쇠고리가 바뀌면 이럴 수 있어. 한 번만 다시 연결해 줄래?',
  'gcal.problem.denied': '구글에서 허락하지 않았어. 다시 연결하면 처음부터 할 수 있어.',
  'gcal.problem.scope': '캘린더 권한이 체크되지 않았어. 다시 연결할 때 캘린더 일정 칸을 체크해 줘.',
  'gcal.problem.timeout': '브라우저에서 너무 오래 기다렸어. 다시 연결해 줘.',
  'gcal.problem.offline': '인터넷이 안 돼서 아직 못 보냈어. 되면 알아서 다시 보낼게.',
  'gcal.problem.calendar': '그 캘린더를 쓸 수 없어. 캘린더 ID와 그 캘린더에 권한이 있는지 봐 줘.',
  'gcal.problem.failed': '연결하지 못했어. 잠시 뒤 다시 해 줘.',
  'gcal.page.okTitle': '페어리가 구글 캘린더에 연결됐어',
  'gcal.page.okBody': '이 창은 닫아도 돼. 페어리로 돌아가 줘.',
  'gcal.page.failTitle': '연결하지 못했어',
  'gcal.page.failBody': '페어리 설정에서 다시 연결해 줘. 이 창은 닫아도 돼.',
  'gcal.lost': '구글 캘린더 연결이 끊겼어. 설정에서 다시 연결해 줄래?',
  // 일정 줄의 표식 (패널 일정 탭)
  'gcal.mark.sent': '구글',
  'gcal.mark.sentTip': '구글 캘린더에 보낸 일정이야',
  'gcal.mark.pending': '보내는 중',
  'gcal.mark.pendingTip': '구글 캘린더로 보낼 차례를 기다리는 중이야',
  'gcal.mark.offlineTip': '인터넷이 안 돼서 아직 못 보냈어. 되면 구글 캘린더로 보낼게',
  'gcal.mark.stuckTip': '구글 캘린더로 보내지 못하고 있어. 설정의 "구글 캘린더"를 봐 줘',
  'gcal.mark.failed': '못 보냄',
  'gcal.mark.failedTip': '구글이 이 일정을 받지 않았어. 일정을 고치면 다시 보내 볼게',
  'gcal.mark.local': '페어리만',
  'gcal.mark.localTip': '페어리에만 있는 일정이야. 구글 캘린더로 보내기가 꺼져 있어',
  'gcal.mark.imported': '가져옴',
  'gcal.mark.importedTip': '"캘린더 가져오기"로 들어온 일정이야. 구글 캘린더로 다시 보내지 않아',
  'gcal.mark.fromGoogle': '구글에서',
  'gcal.mark.fromGoogleTip':
    '구글 캘린더에 있던 일정이야. 고치려면 구글 캘린더에서 고쳐 줘. 알림은 페어리에서 바꿀 수 있어',
  'gcal.mark.fromCalTip': (v: { name: string }) =>
    `구글의 "${v.name}" 캘린더에 있던 일정이야. 고치려면 구글 캘린더에서 고쳐 줘. 알림은 페어리에서 바꿀 수 있어`,
  'gcal.readOnlyTip': '구글 캘린더에서 가져온 일정이라 여기서는 못 고쳐. 구글 캘린더에서 고치면 따라와',
  'gcal.hideTip': '페어리에서만 지워. 구글 캘린더에는 그대로 있어',
  // 할 일도 구글 캘린더에 올리기 (docs/gcal-todo-plan.md)
  'gcal.todo.title': '할 일도 구글 캘린더에 올리기',
  'gcal.todo.hint':
    '날짜가 있는 할 일을 구글 캘린더에 일정으로 올려서 휴대폰에서도 봐. 끄면 올리기만 멈추고, 이미 올린 건 구글에 그대로 둬.',
  'gcal.todo.state.sent': (v: { n: number }) => `구글에 올린 할 일 ${v.n}개`,
  'gcal.todo.state.pending': (v: { n: number }) => `올릴 할 일 ${v.n}개가 남았어`,
  'gcal.todo.state.idle': '아직 올린 할 일이 없어',
  'gcal.todo.whereFairy': '올리는 곳: 페어리 할 일 캘린더',
  'gcal.todo.wherePick': (v: { name: string }) => `올리는 곳: ${v.name}`,
  'gcal.todo.change': '올릴 곳 바꾸기',
  'gcal.todo.gone': '페어리 할 일 캘린더가 없어졌어. 구글에서 지웠다면 다시 만들 수 있어.',
  'gcal.todo.recreate': '다시 만들기',
  'gcal.todo.extras': (v: { n: number }) =>
    v.n === 1
      ? '페어리 할 일 캘린더가 둘 있어. 두 컴퓨터가 동시에 켜면 생겨.'
      : `페어리 할 일 캘린더가 ${v.n + 1}개 있어. 두 컴퓨터가 동시에 켜면 생겨.`,
  'gcal.todo.removeExtras': '남는 것 지우기',
  'gcal.todo.removeExtrasTitle': '남는 캘린더를 지울까?',
  'gcal.todo.removeExtrasBody':
    '하나만 남기고 나머지 페어리 할 일 캘린더를 구글에서 지워. 그 캘린더에 아직 올라간 할 일이 있으면 지우지 않아.',
  'gcal.todo.removeSent': '구글에 올린 할 일도 지우기',
  'gcal.todo.removeSentTitle': '구글에 올린 할 일을 지울까?',
  'gcal.todo.removeSentBody.fairy':
    '구글의 "페어리 할 일" 캘린더를 통째로 지워. 그 안의 일정이 모두 사라지고 휴대폰에서도 없어져. 페어리의 할 일은 그대로고, 할 일 올리기는 꺼져. 되돌릴 수 없어.',
  'gcal.todo.removeSentBody.pick':
    '페어리가 올린 할 일 일정만 하나씩 지워(전에 올린 다른 캘린더 것도 포함). 그 캘린더들의 다른 일정은 건드리지 않아. 페어리의 할 일은 그대로고, 할 일 올리기는 꺼져.',
  'gcal.todo.removeDo': '지우기',
  'gcal.todo.sheet.title': '할 일을 올릴 곳',
  'gcal.todo.sheet.intro': '날짜가 있는 할 일을 구글 캘린더 어디에 올릴지 골라.',
  'gcal.todo.sheet.fairy': '페어리 할 일 캘린더 새로 만들기 (추천)',
  'gcal.todo.sheet.fairyHint':
    '"페어리 할 일" 캘린더를 따로 만들어 거기에만 올려. 휴대폰 구글 캘린더 앱에서 이 캘린더만 끄면 할 일이 안 보여. 이미 있으면 그걸 써.',
  'gcal.todo.sheet.pick': '기존 캘린더에 올리기',
  'gcal.todo.sheet.pickHint': '이미 쓰는 캘린더에 올려. 쓸 수 있는 캘린더만 보여.',
  'gcal.todo.sheet.pickNone': '쓸 수 있는 캘린더가 아직 없어. 캘린더 목록을 읽은 뒤에 다시 열어 줘.',
  'gcal.todo.sheet.pickRelink':
    '캘린더 목록을 보려면 한 번 다시 연결해 줘. 그러면 여기서 캘린더를 고를 수 있어.',
  'gcal.todo.confirmFailed': '잘 안 됐어. 잠시 뒤 다시 해 줘.',
  'gcal.todo.sheet.pickOf': (v: { name: string }) => `${v.name}에 올리기`,
  'gcal.todo.sheet.mix': '이 캘린더는 페어리 일정을 보내는 곳이기도 해서, 할 일이 일정과 섞여 보여.',
  'gcal.todo.sheet.privacy':
    '할 일 제목과 날짜, 시각이 구글로 가. 기기 간 동기화를 잠가 둬도 구글에서는 보여.',
  'gcal.todo.sheet.go': '올리기',
  'gcal.todo.sheet.waiting':
    '브라우저에서 허락을 기다리는 중이야. 구글 화면에서 캘린더 만들기 칸까지 체크하고 계속을 눌러 줘.',
  'gcal.todo.sheet.usePick': '기존 캘린더에 올리기',
  'gcal.todo.grant.denied': '구글에서 허락하지 않았어. 다시 해 보거나 기존 캘린더에 올려도 돼.',
  'gcal.todo.grant.timeout': '브라우저에서 너무 오래 기다렸어. 다시 해 줘.',
  'gcal.todo.grant.offline': '인터넷이 안 돼. 연결을 보고 다시 해 줘.',
  'gcal.todo.grant.failed': '잘 안 됐어. 잠시 뒤 다시 해 줘.',
  'gcal.todo.grant.noEvents':
    '허락 화면에서 캘린더 일정 칸을 체크하지 않았어. 다시 하고 칸을 모두 체크해 줘.',
  'gcal.todo.grant.noApp':
    '캘린더 만들기 칸이 체크되지 않았어. 다시 하거나, 기존 캘린더에 올리기를 골라도 돼.',
  'gcal.todo.grant.noList': '캘린더 목록 칸이 체크되지 않았어. 같은 계정인지 볼 수 없어서 다시 체크해 줘.',
  'gcal.todo.grant.account': '다른 구글 계정이야. 바꾸려면 연결을 끊고 다시 연결해 줘.',
  'gcal.sheet.todoOnly': '할 일 전용',
  'gcal.sheet.todoOnlyTip': '할 일을 올리는 전용 캘린더라 일정을 보내거나 가져오지 않아',
};

export const en: Translation<typeof ko> = {
  'gcal.title': 'Google Calendar',
  'gcal.intro':
    'Adds events you create in fairy to your Google Calendar too. Edits and deletions in fairy follow. Events imported from a calendar are never sent back.',
  'gcal.oneWay':
    'Right now it only sends. To also see the events already in your Google Calendar, turn on "Bring in Google Calendar events" below.',
  'gcal.twoWay':
    'Events already in your Google Calendar come into fairy too, marked "From Google". Fairy doesn\'t edit them: change or delete them in Google Calendar and fairy follows.',
  'gcal.connect': 'Connect Google account',
  'gcal.connecting':
    'Waiting for you in the browser. On the Google screen, check the calendar events and calendar list permissions and press Continue.',
  'gcal.cancel': 'Cancel',
  'gcal.linkHint': 'You connected Google Calendar on another device. Connect this one too?',
  'gcal.linkHintNo': "No thanks, don't ask again",
  'gcal.disconnect': 'Disconnect',
  'gcal.disconnected': 'Disconnected from Google',
  'gcal.connected': 'Connected to Google Calendar',
  'gcal.push': 'Send fairy events to Google Calendar',
  'gcal.pushHint':
    'Sends events from yesterday on. Turning it off stops sending; events already sent stay in Google.',
  'gcal.pull': 'Bring in Google Calendar events',
  'gcal.pullHint':
    "Reads the chosen calendar's events from 7 days ago to 60 days ahead every 15 minutes. Only titles and times, and never the events fairy sent. Turning it off removes them from fairy.",
  'gcal.ai': 'Let AI see Google events too',
  'gcal.aiHint':
    'When on, events brought in from Google also show up for AI chat, "What should I do first?", plan polishing and fairy tools (MCP). When off, AI never sees them.',
  'gcal.aiOnNote':
    "Google event titles and times go to the AI you picked. With a cloud AI they leave this computer. AI still can't edit Google events.",
  'gcal.calendar': 'Calendar',
  'gcal.calendarHint':
    'Paste the "Calendar ID" from Google Calendar settings > that calendar > Integrate calendar.',
  'gcal.pick': 'Choose calendars',
  'gcal.pickPull': (v: { names: string }) => `Bring in: ${v.names}`,
  'gcal.pickPush': (v: { name: string }) => `Send to: ${v.name}`,
  'gcal.pickNone': 'none',
  'gcal.pickRelink': 'Reconnect once to see your calendar list. Until then, things work as before.',
  'gcal.sheet.title': 'Google Calendar options',
  'gcal.sheet.intro':
    'Pick which calendars to bring into fairy, and one calendar to send fairy events to. Changes save right away.',
  'gcal.sheet.colCal': 'Calendar',
  'gcal.sheet.colPull': 'Bring in',
  'gcal.sheet.colPush': 'Send',
  'gcal.sheet.kind.primary': 'Primary',
  'gcal.sheet.kind.mine': 'Mine',
  'gcal.sheet.kind.shared': 'Shared',
  'gcal.sheet.kind.readOnly': 'Read-only',
  'gcal.sheet.custom': 'Added by ID',
  'gcal.sheet.hidden': 'Hidden in Google',
  'gcal.sheet.failed': "Couldn't read it last time",
  'gcal.sheet.pullOf': (v: { name: string }) => `Bring in ${v.name}`,
  'gcal.sheet.pushTo': (v: { name: string }) => `Send to ${v.name}`,
  'gcal.sheet.readOnlyTip': "You can only view this calendar, so fairy events can't be sent there",
  'gcal.sheet.noPush': "Don't send",
  'gcal.sheet.noPushHint': 'Keep fairy events in fairy only',
  'gcal.sheet.pushMoves': 'Changing where to send also moves the events already sent.',
  'gcal.sheet.loading': 'Reading your calendar list',
  'gcal.sheet.listFailed': "Couldn't read your calendar list. Check your internet and try again.",
  'gcal.sheet.retry': 'Try again',
  'gcal.sheet.relinkTitle': 'Reconnect to see your calendar list',
  'gcal.sheet.relink':
    "When you connected before, fairy didn't ask to see your calendar list. Reconnect once to pick calendars here. Until then, the calendars below work as before.",
  'gcal.sheet.relinkBtn': 'Reconnect',
  'gcal.sheet.addId': 'Add a calendar ID not in the list',
  'gcal.sheet.add': 'Add',
  'gcal.sheet.done': 'Done',
  'gcal.calendarBad': "That doesn't look like a calendar ID. It looks like an email address",
  'gcal.syncNow': 'Send now',
  'gcal.pullNow': 'Bring in now',
  'gcal.syncBoth': 'Sync now',
  'gcal.state.synced': 'All sent ({when})',
  'gcal.state.pending': (v: { n: number }) =>
    Number(v.n) === 1 ? '1 event left to send' : `${v.n} events left to send`,
  'gcal.state.idle': 'Nothing sent yet',
  'gcal.state.pulled': (v: { n: number; when: string }) =>
    Number(v.n) === 1 ? `Brought in 1 event (${v.when})` : `Brought in ${v.n} events (${v.when})`,
  'gcal.state.pullIdle': 'Bringing them in shortly',
  'gcal.privacy':
    "Asks only for calendar events and seeing your calendar list (it can't see calendar settings or sharing). If you use the fairy to-dos calendar, it asks for one more permission, for calendars fairy makes, only then. Events it brings in keep only their title and time, plus the calendar's name and color, on this computer. The sign-in token stays on this computer, never in settings or backups.",
  'gcal.problem.expired':
    'Your Google connection ended (access was removed in Google, or it expired). Could you connect again?',
  'gcal.problem.relink':
    "The saved Google connection can't be opened anymore. This can happen when the app is renamed or the keychain changes. Could you connect once more?",
  'gcal.problem.denied': "Google access wasn't allowed. You can connect again to start over.",
  'gcal.problem.scope':
    "The calendar permission wasn't checked. When you connect again, check the calendar events box.",
  'gcal.problem.timeout': 'Waited too long for the browser. Please connect again.',
  'gcal.problem.offline': "No internet, so nothing was sent yet. I'll retry on my own.",
  'gcal.problem.calendar': "Can't use that calendar. Check the calendar ID and that you have access to it.",
  'gcal.problem.failed': "Couldn't connect. Please try again in a bit.",
  'gcal.page.okTitle': 'Connected to Google Calendar',
  'gcal.page.okBody': 'You can close this tab and go back to fairy.',
  'gcal.page.failTitle': "Couldn't connect",
  'gcal.page.failBody': 'Try again from fairy settings. You can close this tab.',
  'gcal.lost': 'Google Calendar got disconnected. Could you reconnect it in settings?',
  'gcal.mark.sent': 'Google',
  'gcal.mark.sentTip': 'Sent to your Google Calendar',
  'gcal.mark.pending': 'Sending',
  'gcal.mark.pendingTip': 'Waiting its turn to go to Google Calendar',
  'gcal.mark.offlineTip':
    "No internet, so it isn't sent yet. I'll send it to Google Calendar once you're back online",
  'gcal.mark.stuckTip': 'Sending to Google Calendar is stuck. Check "Google Calendar" in settings',
  'gcal.mark.failed': 'Not sent',
  'gcal.mark.failedTip': "Google didn't accept this event. Edit it and I'll try again",
  'gcal.mark.local': 'Fairy only',
  'gcal.mark.localTip': 'This event is only in fairy. Sending to Google Calendar is off',
  'gcal.mark.imported': 'Imported',
  'gcal.mark.importedTip': 'Came in through "Import calendar". It is never sent back to Google Calendar',
  'gcal.mark.fromGoogle': 'From Google',
  'gcal.mark.fromGoogleTip':
    'This event lives in your Google Calendar. Edit it there. You can still change its reminders in fairy',
  'gcal.mark.fromCalTip': (v: { name: string }) =>
    `This event lives in your "${v.name}" calendar in Google. Edit it there. You can still change its reminders in fairy`,
  'gcal.readOnlyTip':
    "Brought in from Google Calendar, so it can't be edited here. Edit it in Google Calendar and fairy follows",
  'gcal.hideTip': 'Removes it from fairy only. It stays in Google Calendar',
  'gcal.todo.title': 'Put to-dos on Google Calendar too',
  'gcal.todo.hint':
    'To-dos with a date go to Google Calendar as events, so you can see them on your phone. Turning it off only stops sending; what was sent stays in Google.',
  'gcal.todo.state.sent': (v: { n: number }) =>
    Number(v.n) === 1 ? '1 to-do is on Google' : `${v.n} to-dos are on Google`,
  'gcal.todo.state.pending': (v: { n: number }) =>
    Number(v.n) === 1 ? '1 to-do left to send' : `${v.n} to-dos left to send`,
  'gcal.todo.state.idle': 'No to-dos sent yet',
  'gcal.todo.whereFairy': 'Going to: the fairy to-dos calendar',
  'gcal.todo.wherePick': (v: { name: string }) => `Going to: ${v.name}`,
  'gcal.todo.change': 'Change where',
  'gcal.todo.gone': 'The fairy to-dos calendar is gone. If you deleted it in Google, you can make it again.',
  'gcal.todo.recreate': 'Make it again',
  'gcal.todo.extras': (v: { n: number }) =>
    v.n === 1
      ? 'There are two fairy to-dos calendars. This happens when two computers turn it on at once.'
      : `There are ${v.n + 1} fairy to-dos calendars. This happens when two computers turn it on at once.`,
  'gcal.todo.removeExtras': 'Delete the extra',
  'gcal.todo.removeExtrasTitle': 'Delete the extra calendars?',
  'gcal.todo.removeExtrasBody':
    "Keeps one and deletes the other fairy to-dos calendars in Google. A calendar that still has to-dos sent from here isn't deleted.",
  'gcal.todo.removeSent': 'Also delete to-dos sent to Google',
  'gcal.todo.removeSentTitle': 'Delete the to-dos sent to Google?',
  'gcal.todo.removeSentBody.fairy':
    'Deletes the whole "fairy to-dos" calendar in Google. Every event in it disappears, on your phone too. Your to-dos in fairy stay, and sending to-dos is turned off. This can\'t be undone.',
  'gcal.todo.removeSentBody.pick':
    "Deletes only the to-do events fairy sent, one by one (including ones sent earlier to other calendars). Other events in those calendars aren't touched. Your to-dos in fairy stay, and sending to-dos is turned off.",
  'gcal.todo.removeDo': 'Delete',
  'gcal.todo.sheet.title': 'Where to put to-dos',
  'gcal.todo.sheet.intro': 'Pick which Google calendar gets your to-dos that have a date.',
  'gcal.todo.sheet.fairy': 'Make a new fairy to-dos calendar (recommended)',
  'gcal.todo.sheet.fairyHint':
    'Makes a separate "fairy to-dos" calendar and sends only there. In the Google Calendar app on your phone, turn off just that calendar to hide them. If it already exists, it is reused.',
  'gcal.todo.sheet.pick': 'Use an existing calendar',
  'gcal.todo.sheet.pickHint':
    'Sends to a calendar you already use. Only calendars you can write to are shown.',
  'gcal.todo.sheet.pickNone':
    'No calendar you can write to yet. Open this again after the calendar list has loaded.',
  'gcal.todo.sheet.pickRelink':
    'Reconnect once to see your calendar list. Then you can pick a calendar here.',
  'gcal.todo.confirmFailed': "That didn't work. Please try again in a bit.",
  'gcal.todo.sheet.pickOf': (v: { name: string }) => `Put to-dos on ${v.name}`,
  'gcal.todo.sheet.mix': 'This calendar also gets your fairy events, so to-dos will be mixed in with them.',
  'gcal.todo.sheet.privacy':
    'To-do titles, dates and times go to Google. They show up there even if you lock device sync.',
  'gcal.todo.sheet.go': 'Start',
  'gcal.todo.sheet.waiting':
    'Waiting for you in the browser. On the Google screen, check every box including making calendars, then press Continue.',
  'gcal.todo.sheet.usePick': 'Use an existing calendar',
  'gcal.todo.grant.denied': "Google access wasn't allowed. Try again, or use an existing calendar.",
  'gcal.todo.grant.timeout': 'Waited too long for the browser. Please try again.',
  'gcal.todo.grant.offline': 'No internet. Check your connection and try again.',
  'gcal.todo.grant.failed': "That didn't work. Please try again in a bit.",
  'gcal.todo.grant.noEvents':
    "The calendar events box wasn't checked on the Google screen. Try again and check every box.",
  'gcal.todo.grant.noApp':
    "The box for making calendars wasn't checked. Try again, or use an existing calendar instead.",
  'gcal.todo.grant.noList':
    "The calendar list box wasn't checked, so fairy can't tell it's the same account. Please check it.",
  'gcal.todo.grant.account': 'That was a different Google account. To switch, disconnect and connect again.',
  'gcal.sheet.todoOnly': 'To-dos only',
  'gcal.sheet.todoOnlyTip':
    "This calendar is only for to-dos, so events aren't sent to it or brought in from it",
};
