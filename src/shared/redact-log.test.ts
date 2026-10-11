import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIAG_MAX_BYTES, redactLog, redactLogDetail, tailLines } from './redact-log.ts';

const MAC = { home: '/Users/kimcs', user: 'kimcs', host: 'Kimcs-MacBook-Pro.local' };
const WIN = { home: 'C:\\Users\\Kimcs', user: 'Kimcs', host: 'DESKTOP-KIMCS' };

test('홈 폴더는 ~, 다른 사람 홈의 이름은 <user>', () => {
  assert.equal(redactLog('open /Users/kimcs/Library/x.db failed', MAC), 'open ~/Library/x.db failed');
  assert.equal(redactLog('at /Users/lee/app/main.js:10:3', MAC), 'at /Users/<user>/app/main.js:10:3');
  assert.equal(redactLog('/home/park/.config', MAC), '/home/<user>/.config');
  // 윈도우: 그대로, 대소문자 달라도, JSON 의 겹 역슬래시, 슬래시로 바꾼 꼴
  assert.equal(redactLog('C:\\Users\\Kimcs\\AppData\\x', WIN), '~\\AppData\\x');
  assert.equal(redactLog('c:\\users\\kimcs\\x', WIN), '~\\x');
  assert.equal(redactLog('"C:\\\\Users\\\\Kimcs\\\\x"', WIN), '"~\\\\x"');
  assert.equal(redactLog('C:/Users/Kimcs/x', WIN), '~/x');
  assert.equal(redactLog('D:\\Users\\Other\\x', WIN), 'D:\\Users\\<user>\\x');
  // 홈 끝의 / 는 무시, 너무 짧은 홈은 건너뛴다
  assert.equal(redactLog('/Users/kimcs/a', { home: '/Users/kimcs/' }), '~/a');
  assert.equal(redactLog('/a/b', { home: '/' }), '/a/b');
});

test('사용자 이름과 컴퓨터 이름은 낱말로 있을 때만', () => {
  assert.equal(redactLog('login kimcs ok', MAC), 'login <user> ok');
  assert.equal(redactLog('KIMCS done', MAC), '<user> done');
  // 다른 낱말 안의 같은 글자는 둔다
  assert.equal(redactLog('kimcsx xkimcs', MAC), 'kimcsx xkimcs');
  assert.equal(redactLog('host Kimcs-MacBook-Pro.local up', MAC), 'host <host> up');
  assert.equal(redactLog('host Kimcs-MacBook-Pro up', MAC), 'host <host> up');
  assert.equal(redactLog('pc DESKTOP-KIMCS', WIN), 'pc <host>');
  // 이름이 "user" 여도 이미 가린 <user> 를 또 바꾸지 않는다
  assert.equal(redactLog('/Users/user/x and user', { home: '/Users/user', user: 'user' }), '~/x and <user>');
  // 한 글자 이름은 건너뛴다
  assert.equal(redactLog('a b c', { user: 'a' }), 'a b c');
});

test('토큰: 서비스 머리, Bearer, 비밀 키 다음 값', () => {
  const cases: [string, string][] = [
    ['token hf_AbCdEfGh12345678 used', 'token <secret> used'],
    ['key sk-ant-api03-abcdEFGH1234_xyz', 'key <secret>'],
    ['sk-proj-abcdefgh12345678', '<secret>'],
    ['ghp_abcdefghijklmnop1234 gho_ABCDEFGH12345678', '<secret> <secret>'],
    ['github_pat_11ABCDEFG_abcdefghijk', '<secret>'],
    ['slack xoxb-1234-5678-abcdefgh', 'slack <secret>'],
    ['glpat-abcdefgh12345678', '<secret>'],
    ['AKIAABCDEFGHIJKLMNOP', '<secret>'],
    ['AIzaSyA-abcdefghijklmnopqrstuv', '<secret>'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdEFGH_12', 'jwt <secret>'],
    ['Authorization: Bearer abc.def-123456', 'Authorization: <secret> <secret>'],
    ['header bearer abcdef123456', 'header bearer <secret>'],
    ['token=abc123 next', 'token=<secret> next'],
    ['{"access_token":"zzz999","n":1}', '{"access_token":"<secret>","n":1}'],
    ['password: hunter2', 'password: <secret>'],
    ['api_key=XYZ apiKey: QQQ', 'api_key=<secret> apiKey: <secret>'],
    ['client_secret = s3cr3t', 'client_secret = <secret>'],
    ['Cookie: sid=abc', 'Cookie: <secret>'],
  ];
  for (const [input, want] of cases) assert.equal(redactLog(input), want, input);
  // 비밀 같은 낱말이어도 값이 없으면 둔다
  assert.equal(redactLog('[maker] hf token save failed'), '[maker] hf token save failed');
  assert.equal(redactLog('author: kim'), 'author: kim');
});

test('주소: 쿼리와 # 뒤, 아이디:비번, 긴 아이디 조각을 가린다. 호스트와 경로는 남긴다', () => {
  assert.equal(
    redactLog('GET https://api.github.com/repos/a/b/releases/latest?access=1&x=2 failed'),
    'GET https://api.github.com/repos/a/b/releases/latest?<redacted> failed',
  );
  assert.equal(
    redactLog('https://zoom.us/j/123?pwd=abc#success'),
    'https://zoom.us/<meeting>?<redacted>#<redacted>',
  );
  assert.equal(redactLog('https://user:pass@example.com/x'), 'https://<secret>@example.com/x');
  // 쿼리 속 토큰은 쿼리째 한 번에, 경로 속 토큰은 토큰으로
  assert.equal(redactLog('https://h.co/x?token=hf_abcdefgh12345678 next'), 'https://h.co/x?<redacted> next');
  assert.equal(redactLog('https://h.co/u/hf_abcdefgh12345678/y'), 'https://h.co/u/<secret>/y');
  assert.equal(
    redactLog('https://huggingface.co/a/b/resolve/0123456789abcdef0123456789abcdef01234567/m.gguf'),
    'https://huggingface.co/a/b/resolve/<id>/m.gguf',
  );
  // 문장 끝 부호와 짝 없는 괄호는 주소가 아니다
  assert.equal(redactLog('(see https://a.com/x?q=1).'), '(see https://a.com/x?<redacted>).');
  // 쿼리 없는 주소는 그대로
  assert.equal(
    redactLog('fetch https://example.com/path/file.json'),
    'fetch https://example.com/path/file.json',
  );
});

test('캘린더 주소는 경로 전체가 비밀이라 호스트만 남긴다', () => {
  assert.equal(
    redactLog(
      'ics https://calendar.google.com/calendar/ical/kim%40gmail.com/private-0123456789abcdef/basic.ics bad',
    ),
    'ics https://calendar.google.com/<calendar> bad',
  );
  assert.equal(
    redactLog('webcal://p01-caldav.icloud.com/published/2/MTIzNDU2Nzg5'),
    'webcal://p01-caldav.icloud.com/<calendar>',
  );
  assert.equal(
    redactLog('https://outlook.office365.com/owa/calendar/abc/def/reachcalendar.ics'),
    'https://outlook.office365.com/<calendar>',
  );
  assert.equal(redactLog('https://example.com/feeds/my.ics'), 'https://example.com/<calendar>');
});

test('이메일은 <email>, %40 으로 바뀐 것도', () => {
  assert.equal(redactLog('from kim.cs+jj@gmail.com to a@b.co.kr'), 'from <email> to <email>');
  assert.equal(redactLog('id=kim%40gmail.com'), 'id=<email>');
  // npm 범위 이름은 이메일이 아니다
  assert.equal(redactLog('node_modules/@electron/get'), 'node_modules/@electron/get');
});

test('IP: 바깥 주소는 <ip>, 이 컴퓨터 자신과 판 번호, 시각은 둔다', () => {
  assert.equal(redactLog('connect 192.168.0.12:443 ok'), 'connect <ip>:443 ok');
  assert.equal(redactLog('from 8.8.8.8'), 'from <ip>');
  assert.equal(redactLog('127.0.0.1 and 0.0.0.0'), '127.0.0.1 and 0.0.0.0');
  assert.equal(redactLog('Chrome/130.0.6723.191 v0.1.0'), 'Chrome/130.0.6723.191 v0.1.0');
  assert.equal(redactLog('fe80::1ff:fe23:4567:890a%en0'), '<ip>%en0');
  assert.equal(redactLog('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), '<ip>');
  assert.equal(redactLog('::1 is local'), '::1 is local');
  assert.equal(redactLog('2026-10-07T01:02:03.000Z [db] x'), '2026-10-07T01:02:03.000Z [db] x');
  assert.equal(redactLog('at f (~/a/main.js:10:3)'), 'at f (~/a/main.js:10:3)');
  assert.equal(redactLog('12:34:56 tick'), '12:34:56 tick');
  assert.equal(redactLog('std::string Foo::Bar'), 'std::string Foo::Bar');
});

test('사용자 글(할 일, 일정, 메모 제목, 캘린더 주소)은 글자 그대로 있으면 <private>', () => {
  const secrets = [
    '치과 예약',
    '엄마 생일',
    'Quarterly review with Dana',
    'ok',
    'https://cal.example.com/s3cret.ics',
    '  ',
  ];
  const out = redactLog(
    '[error] 치과 예약 저장 실패; event Quarterly review with Dana; ok; https://cal.example.com/s3cret.ics',
    { secrets },
  );
  assert.equal(out, '[error] <private> 저장 실패; event <private>; ok; <private>');
  // 긴 것부터: 짧은 제목이 긴 제목 안에 있어도 긴 것이 통째로 가려진다
  assert.equal(redactLog('엄마 생일 파티', { secrets: ['엄마', '엄마 생일 파티'] }), '<private>');
  // 영문만 3자 이하는 건너뛴다 (기록의 흔한 낱말을 지우지 않게), 한글은 2자부터
  assert.equal(redactLog('db pet 운동', { secrets: ['db', 'pet', '운동'] }), 'db pet <private>');
});

test('가린 곳 수를 센다. 이미 가린 글을 다시 넣어도 같은 글', () => {
  const raw =
    '2026-10-07T01:02:03.000Z [error] Error: boom\n    at /Users/kimcs/x.js:1:1 token=abc https://a.com/x?q=1 kim@x.com 10.0.0.2';
  const once = redactLogDetail(raw, MAC);
  assert.equal(
    once.text,
    '2026-10-07T01:02:03.000Z [error] Error: boom\n    at ~/x.js:1:1 token=<secret> https://a.com/x?<redacted> <email> <ip>',
  );
  assert.equal(once.count, 5);
  const twice = redactLogDetail(once.text, MAC);
  assert.equal(twice.text, once.text);
  assert.equal(twice.count, 0);
});

test('실제 기록 꼴 한 덩어리', () => {
  const log = [
    '2026-10-07T01:00:00.000Z [db] 못 엶 SQLITE_BUSY: /Users/kimcs/Library/Application Support/fairy/jjakkung.db',
    '2026-10-07T01:00:01.000Z [calendar] 실패 TypeError',
    '2026-10-07T01:00:02.000Z [update] 확인 실패 net::ERR_NAME_NOT_RESOLVED https://api.github.com/repos/milcho0604/fairy/releases/latest',
    '2026-10-07T01:00:03.000Z [maker] illust Error: 401 https://router.huggingface.co/x?token=hf_abcdefgh12345678',
    '2026-10-07T01:00:04.000Z [link] open zoom.us',
  ].join('\n');
  const out = redactLog(log, MAC);
  assert.ok(!out.includes('kimcs'));
  assert.ok(!out.includes('hf_'));
  assert.ok(out.includes('~/Library/Application Support/fairy/jjakkung.db'));
  assert.ok(out.includes('net::ERR_NAME_NOT_RESOLVED'));
  assert.ok(out.includes('https://api.github.com/repos/milcho0604/fairy/releases/latest'));
  assert.ok(out.includes('https://router.huggingface.co/x?<redacted>'));
});

test('끝 쪽 줄만: 줄 수 상한과 바이트 상한', () => {
  const text = `${Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n')}\n\n`;
  const kept = tailLines(text);
  assert.equal(kept.length, 200);
  assert.equal(kept[0], 'line 100');
  assert.equal(kept.at(-1), 'line 299');
  // 바이트 상한: 앞에서부터 덜어 낸다
  const big = Array.from({ length: 50 }, (_, i) => `${i}:${'가'.repeat(1000)}`).join('\n');
  const cut = tailLines(big, 200, DIAG_MAX_BYTES);
  const bytes = cut.reduce((n, l) => n + new TextEncoder().encode(l).length + 1, 0);
  assert.ok(bytes <= DIAG_MAX_BYTES, String(bytes));
  assert.ok(cut.at(-1)?.startsWith('49:'));
  // 한 줄이 상한보다 길면 끝 쪽만, 깨진 글자 없이
  const one = tailLines('가'.repeat(100), 200, 31);
  const only = one[0] ?? '';
  assert.ok(only.length > 0 && new TextEncoder().encode(only).length <= 30);
  assert.ok(!only.includes('\uFFFD'));
  assert.deepEqual(tailLines(''), []);
  assert.deepEqual(tailLines('a\r\nb'), ['a', 'b']);
});

test('보안 검토 (2026-10-10): 따옴표 값 통째로, 쿠키 줄 끝까지, Google 토큰, PEM, 긴 비밀 덩어리', () => {
  assert.equal(redactLog('password: "my pass word"'), 'password: "<secret>"');
  assert.equal(redactLog('"token": "abc def"'), '"token": "<secret>"');
  assert.equal(redactLog("token='a&b' x"), "token='<secret>' x");
  assert.equal(redactLog('Cookie: a=1; sid=abcdef123'), 'Cookie: <secret>');
  assert.equal(redactLog('got ya29.a0AfH6SMBxyz123456 ok'), 'got <secret> ok');
  assert.equal(redactLog('refresh 1//0gAbCdEfGhIjKl'), 'refresh <secret>');
  assert.equal(redactLog('code=4/0AX4XfWhabcdefghij state=x'), 'code=<secret> state=x');
  assert.equal(redactLog('session_id=0123456789abcdef'), 'session_id=<secret>');
  assert.equal(redactLog('-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----'), '<secret>');
  assert.equal(redactLog('blob QmFzZTY0IGJsb2IgdGhhdCBpcyBsb25nIGVub3VnaDEyMw=='), 'blob <secret>');
  // 16진수만인 해시, 진단에 쓰는 오류 코드는 둔다
  const sha = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
  assert.equal(redactLog(`sha256 ${sha}`), `sha256 ${sha}`);
  assert.equal(redactLog('code=ENOENT exitCode=1'), 'code=ENOENT exitCode=1');
});

test('보안 검토: \\/ 로 쓴 JSON 주소와 경로, NFD 한글과 대소문자, 띄어쓰기 수가 다른 사용자 글', () => {
  assert.equal(
    redactLog('{"u":"https:\\/\\/calendar.google.com\\/calendar\\/ical\\/x\\/private-abc\\/basic.ics"}'),
    '{"u":"https://calendar.google.com/<calendar>"}',
  );
  assert.equal(redactLog('{"path":"\\/Users\\/johndoe\\/x"}'), '{"path":"/Users/<user>/x"}');
  const secrets = ['치과 예약', 'Secret Project X'];
  assert.equal(redactLog(`open ${'치과 예약'.normalize('NFD')}.md`, { secrets }), 'open <private>.md');
  assert.equal(redactLog('secret project x done', { secrets }), '<private> done');
  assert.equal(redactLog('치과  예약 알림', { secrets }), '<private> 알림');
  assert.equal(
    redactLog('https://cloud.example.com/remote.php/dav/public-calendars/AbCd'),
    'https://cloud.example.com/<calendar>',
  );
});

test('보안 검토: 한글 이메일, localhost, %2B 인코딩', () => {
  assert.equal(redactLog('to 김철수@회사.kr ok'), 'to <email> ok');
  assert.equal(redactLog('user@localhost'), '<email>');
  assert.equal(redactLog('q=john%2Bx%40example.com'), 'q=<email>');
});

test('보안 검토: 긴 글자 줄도 빨리 (정규식이 줄 길이의 제곱으로 느려지지 않게)', () => {
  const lines = ['a', '_', '1.', 'a-', 'Ab1+'].flatMap((u) =>
    Array(10).fill(u.repeat(Math.ceil(4000 / u.length))),
  );
  const at = performance.now();
  redactLog(lines.join('\n'), {
    secrets: ['치과 예약'],
    home: '/Users/kimcs',
    user: 'kimcs',
    host: 'kim-mac',
  });
  assert.ok(performance.now() - at < 400, `${Math.round(performance.now() - at)}ms`);
});

test('한국 전화번호와 주민등록번호를 가린다. 날짜, 시각, 버전은 둔다', () => {
  for (const phone of [
    '010-1234-5678',
    '01012345678',
    '010 1234 5678',
    '010.1234.5678',
    '+82 10-1234-5678',
    '+821012345678',
    '02-123-4567',
    '031-1234-5678',
    '070-1234-5678',
  ])
    assert.equal(redactLog(`전화 ${phone} 로`), '전화 <phone> 로', phone);
  assert.equal(redactLog('주민 900101-1234567 끝'), '주민 <rrn> 끝');
  assert.equal(redactLog('주민 9001011234567 끝'), '주민 <rrn> 끝');
  const keep = '2026-10-11 09:30:00 v0.2.0 pid=12345 size=1048576 port 9851';
  assert.equal(redactLog(keep), keep);
});

test('맨 key=, pass=, pw= 값을 가린다', () => {
  assert.equal(redactLog('key=abcd1234 pass=hunter2 pw: "p w"'), 'key=<secret> pass=<secret> pw: "<secret>"');
  assert.equal(redactLog('private_key=xyz access-key: AB12'), 'private_key=<secret> access-key: <secret>');
  // 다른 낱말 속 key 는 두지 않는다 (monkey, keyboard)
  assert.equal(redactLog('keyboard layout, monkey=3'), 'keyboard layout, monkey=3');
});

test('화상 회의 주소와 Meet 코드를 가린다', () => {
  assert.equal(redactLog('https://us02web.zoom.us/j/81234567890'), 'https://us02web.zoom.us/<meeting>');
  assert.equal(redactLog('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/<meeting>');
  assert.equal(
    redactLog('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0'),
    'https://teams.microsoft.com/<meeting>',
  );
  assert.equal(redactLog('https://example.com/j/9988776655 ok'), 'https://example.com/j/<meeting> ok');
  assert.equal(redactLog('코드 abc-defg-hij 로 들어와'), '코드 <meeting> 로 들어와');
  // 회의 호스트라도 첫 화면은 둔다
  assert.equal(redactLog('https://zoom.us/'), 'https://zoom.us/');
});
