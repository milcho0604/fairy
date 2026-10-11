import type { Translation } from './types.ts';

// 구글 캘린더에 쓰기 (6단계): 설정 창 칸, 펫 알림, 연결 뒤 브라우저에 보이는 쪽
export const ko = {
  'gcal.title': '구글 캘린더로 보내기',
  'gcal.intro':
    '짝꿍에서 넣은 일정을 내 구글 캘린더에도 넣어. 짝꿍에서 고치거나 지우면 구글에서도 바뀌어. 캘린더에서 가져온 일정은 다시 보내지 않아.',
  'gcal.connect': '구글 계정 연결',
  'gcal.connecting':
    '브라우저에서 허락을 기다리는 중이야. 구글 화면에서 캘린더 일정 권한을 체크하고 계속을 눌러 줘.',
  'gcal.cancel': '그만두기',
  'gcal.disconnect': '연결 끊기',
  'gcal.disconnected': '구글 연결을 끊었어',
  'gcal.connected': '구글 캘린더에 연결됐어',
  'gcal.push': '짝꿍 일정을 구글 캘린더로 보내기',
  'gcal.pushHint': '어제 이후 일정부터 보내. 끄면 더 보내지 않고, 이미 보낸 일정은 구글에 그대로 둬.',
  'gcal.calendar': '보낼 캘린더',
  'gcal.calendarHint':
    '비우면 기본 캘린더야. 다른 캘린더는 구글 캘린더 설정 > 캘린더 통합의 "캘린더 ID"를 붙여 넣어.',
  'gcal.calendarBad': '캘린더 ID 모양이 아니야. 메일 주소처럼 생긴 ID를 넣어 줘',
  'gcal.syncNow': '지금 보내기',
  'gcal.state.synced': '다 보냈어 ({when})',
  'gcal.state.pending': '보낼 일정 {n}개가 남았어',
  'gcal.state.idle': '아직 보낸 일정이 없어',
  'gcal.privacy':
    '일정 쓰기 권한만 받아 (다른 캘린더 정보는 못 봐). 연결 토큰은 이 컴퓨터에만 두고 설정, 백업에 넣지 않아.',
  'gcal.problem.expired': '구글 연결이 끝났어. 구글에서 권한을 거뒀거나 오래돼서 그래. 다시 연결해 줄래?',
  'gcal.problem.denied': '구글에서 허락하지 않았어. 다시 연결하면 처음부터 할 수 있어.',
  'gcal.problem.scope': '캘린더 권한이 체크되지 않았어. 다시 연결할 때 캘린더 일정 칸을 체크해 줘.',
  'gcal.problem.timeout': '브라우저에서 너무 오래 기다렸어. 다시 연결해 줘.',
  'gcal.problem.offline': '인터넷이 안 돼서 아직 못 보냈어. 되면 알아서 다시 보낼게.',
  'gcal.problem.calendar': '그 캘린더에 쓸 수 없어. 캘린더 ID와 그 캘린더에 쓸 권한이 있는지 봐 줘.',
  'gcal.problem.failed': '연결하지 못했어. 잠시 뒤 다시 해 줘.',
  'gcal.page.okTitle': '짝꿍이 구글 캘린더에 연결됐어',
  'gcal.page.okBody': '이 창은 닫아도 돼. 짝꿍으로 돌아가 줘.',
  'gcal.page.failTitle': '연결하지 못했어',
  'gcal.page.failBody': '짝꿍 설정에서 다시 연결해 줘. 이 창은 닫아도 돼.',
  'gcal.lost': '구글 캘린더 연결이 끝났어. 설정에서 다시 연결해 줄래?',
};

export const en: Translation<typeof ko> = {
  'gcal.title': 'Send to Google Calendar',
  'gcal.intro':
    'Adds events you create in Jjakkung to your Google Calendar too. Edits and deletions in Jjakkung follow. Events imported from a calendar are never sent back.',
  'gcal.connect': 'Connect Google account',
  'gcal.connecting':
    'Waiting for you in the browser. On the Google screen, check the calendar events permission and press Continue.',
  'gcal.cancel': 'Cancel',
  'gcal.disconnect': 'Disconnect',
  'gcal.disconnected': 'Disconnected from Google',
  'gcal.connected': 'Connected to Google Calendar',
  'gcal.push': 'Send Jjakkung events to Google Calendar',
  'gcal.pushHint':
    'Sends events from yesterday on. Turning it off stops sending; events already sent stay in Google.',
  'gcal.calendar': 'Calendar',
  'gcal.calendarHint':
    'Leave empty for your main calendar. For another one, paste its "Calendar ID" from Google Calendar settings > Integrate calendar.',
  'gcal.calendarBad': "That doesn't look like a calendar ID. It looks like an email address",
  'gcal.syncNow': 'Send now',
  'gcal.state.synced': 'All sent ({when})',
  'gcal.state.pending': '{n} events left to send',
  'gcal.state.idle': 'Nothing sent yet',
  'gcal.privacy':
    "Asks only for permission to edit events (it can't see your other calendar settings). The sign-in token stays on this computer, never in settings or backups.",
  'gcal.problem.expired':
    'Your Google connection ended (access was removed in Google, or it expired). Could you connect again?',
  'gcal.problem.denied': "Google access wasn't allowed. You can connect again to start over.",
  'gcal.problem.scope':
    "The calendar permission wasn't checked. When you connect again, check the calendar events box.",
  'gcal.problem.timeout': 'Waited too long for the browser. Please connect again.',
  'gcal.problem.offline': "No internet, so nothing was sent yet. I'll retry on my own.",
  'gcal.problem.calendar': "Can't write to that calendar. Check the calendar ID and that you can edit it.",
  'gcal.problem.failed': "Couldn't connect. Please try again in a bit.",
  'gcal.page.okTitle': 'Jjakkung is connected to Google Calendar',
  'gcal.page.okBody': 'You can close this tab and go back to Jjakkung.',
  'gcal.page.failTitle': "Couldn't connect",
  'gcal.page.failBody': 'Try again from Jjakkung settings. You can close this tab.',
  'gcal.lost': 'Your Google Calendar connection ended. Could you reconnect it in settings?',
};
