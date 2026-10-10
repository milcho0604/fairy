import type { Translation } from './types.ts';

// 의견 보내기: 진단 기록 붙이기, 파일로 저장, 문제 알리기 (설정의 베타 기록 칸)
export const ko = {
  'feedback.include': '진단 기록도 같이 붙이기',
  'feedback.hint':
    '앱이 남긴 최근 기록이야. 문제를 찾는 데 큰 도움이 돼. 붙이기 전에 보낼 글을 그대로 보여 줄게. 폴더 경로 속 이름, 이메일, 주소 뒤에 붙은 값, 토큰, IP는 가려 두었어.',
  'feedback.loading': '기록 읽는 중',
  'feedback.readFailed': '기록을 읽지 못했어. 조금 뒤에 다시 켜 줘',
  'feedback.refresh': '새로 읽기',
  'feedback.previewLabel': '보낼 글 미리 보기',
  'feedback.summary': '최근 기록 {n}줄, 가린 곳 {hidden}군데',
  'feedback.copy': '이대로 복사',
  'feedback.save': '파일로 저장',
  'feedback.copied': '복사했어. 의견에 그대로 붙여 넣어 줘',
  'feedback.saved': '저장했어: {file}',
  'feedback.saveFailed': '저장하지 못했어',
  'feedback.saveTitle': '진단 기록 저장',
  'feedback.fileName': '짝꿍-진단기록-{day}.txt',
  'feedback.fileType': '글 파일',
  'feedback.issue': 'GitHub에 문제 알리기',
  'feedback.issueHint': '새 이슈 화면이 열려. 판과 운영체제만 채워 두니 기록은 직접 붙여 넣어 줘.',
  'feedback.issueTitle': '문제 알리기: ',
  'feedback.issueBody':
    '**판** {version}\n**운영체제** {os}\n\n**어떤 일이 있었어?**\n\n\n**어떻게 하면 다시 생겨?**\n\n\n**진단 기록** (설정 > 내 기록에서 "이대로 복사" 한 글을 붙여 줘)\n',
  'feedback.logHeader': '진단 기록 (최근 {n}줄, 가린 곳 {hidden}군데)',
  'feedback.logEmpty': '진단 기록 (아직 없음)',
};

export const en: Translation<typeof ko> = {
  'feedback.include': 'Attach diagnostics too',
  'feedback.hint':
    "Recent notes the app kept. They help a lot with finding problems. You'll see exactly what gets copied first. Your name in folder paths, emails, link parameters, tokens and IPs are hidden.",
  'feedback.loading': 'Reading notes',
  'feedback.readFailed': "Couldn't read the notes. Try turning it on again in a bit",
  'feedback.refresh': 'Reload',
  'feedback.previewLabel': 'Preview of what gets sent',
  'feedback.summary': 'Last {n} lines, {hidden} spots hidden',
  'feedback.copy': 'Copy as is',
  'feedback.save': 'Save to file',
  'feedback.copied': 'Copied. Paste it into your feedback as is',
  'feedback.saved': 'Saved: {file}',
  'feedback.saveFailed': "Couldn't save",
  'feedback.saveTitle': 'Save diagnostics',
  'feedback.fileName': 'jjakkung-diagnostics-{day}.txt',
  'feedback.fileType': 'Text file',
  'feedback.issue': 'Report a problem on GitHub',
  'feedback.issueHint':
    'Opens a new issue with the version and OS filled in. Paste the diagnostics yourself.',
  'feedback.issueTitle': 'Problem: ',
  'feedback.issueBody':
    '**Version** {version}\n**OS** {os}\n\n**What happened?**\n\n\n**How can it happen again?**\n\n\n**Diagnostics** (paste what "Copy as is" copied from Settings > My stats)\n',
  'feedback.logHeader': 'Diagnostics (last {n} lines, {hidden} spots hidden)',
  'feedback.logEmpty': 'Diagnostics (none yet)',
};
