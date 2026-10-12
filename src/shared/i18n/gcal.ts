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
    '브라우저에서 허락을 기다리는 중이야. 구글 화면에서 캘린더 일정 권한을 체크하고 계속을 눌러 줘.',
  'gcal.cancel': '그만두기',
  'gcal.disconnect': '연결 끊기',
  'gcal.disconnected': '구글 연결을 끊었어',
  'gcal.connected': '구글 캘린더에 연결됐어',
  'gcal.push': '페어리 일정을 구글 캘린더로 보내기',
  'gcal.pushHint': '어제 이후 일정부터 보내. 끄면 더 보내지 않고, 이미 보낸 일정은 구글에 그대로 둬.',
  'gcal.pull': '구글 캘린더 일정 가져오기',
  'gcal.pullHint':
    '고른 캘린더의 지난 7일부터 앞으로 60일까지 일정을 15분마다 읽어 와. 제목과 시각만 읽고, 페어리에서 보낸 일정은 또 가져오지 않아. 끄면 가져온 일정은 페어리에서 사라져.',
  'gcal.calendar': '보내고 가져올 캘린더',
  'gcal.calendarHint':
    '비우면 기본 캘린더야. 다른 캘린더는 구글 캘린더 설정 > 캘린더 통합의 "캘린더 ID"를 붙여 넣어.',
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
    '캘린더 일정 권한 하나만 받아 (캘린더 목록, 설정, 공유는 못 봐). 가져온 일정은 제목과 시각만 이 컴퓨터에 둬. 연결 토큰은 이 컴퓨터에만 두고 설정, 백업에 넣지 않아.',
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
  'gcal.readOnlyTip': '구글 캘린더에서 가져온 일정이라 여기서는 못 고쳐. 구글 캘린더에서 고치면 따라와',
  'gcal.hideTip': '페어리에서만 지워. 구글 캘린더에는 그대로 있어',
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
    'Waiting for you in the browser. On the Google screen, check the calendar events permission and press Continue.',
  'gcal.cancel': 'Cancel',
  'gcal.disconnect': 'Disconnect',
  'gcal.disconnected': 'Disconnected from Google',
  'gcal.connected': 'Connected to Google Calendar',
  'gcal.push': 'Send fairy events to Google Calendar',
  'gcal.pushHint':
    'Sends events from yesterday on. Turning it off stops sending; events already sent stay in Google.',
  'gcal.pull': 'Bring in Google Calendar events',
  'gcal.pullHint':
    "Reads the chosen calendar's events from 7 days ago to 60 days ahead every 15 minutes. Only titles and times, and never the events fairy sent. Turning it off removes them from fairy.",
  'gcal.calendar': 'Calendar',
  'gcal.calendarHint':
    'Leave empty for your main calendar. For another one, paste its "Calendar ID" from Google Calendar settings > Integrate calendar.',
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
    "Asks for one permission, calendar events (it can't see your calendar list, settings or sharing). Events it brings in keep only their title and time, on this computer. The sign-in token stays on this computer, never in settings or backups.",
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
  'gcal.readOnlyTip':
    "Brought in from Google Calendar, so it can't be edited here. Edit it in Google Calendar and fairy follows",
  'gcal.hideTip': 'Removes it from fairy only. It stays in Google Calendar',
};
