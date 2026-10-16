// 도움 보내기 진단 묶음 (이슈 #126): 머리 내용과, 실제 기록 표본 모양의 줄에서 비밀이 가려지는지
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHelpPack, HELP_FLAGS, type HelpFacts, helpSummary, serverLine } from './help-pack.ts';
import { setLang } from './i18n/index.ts';
import { redactLogDetail } from './redact-log.ts';

const HOME = '/Users/kimcs';
const redact = {
  home: HOME,
  user: 'kimcs',
  host: 'Kimcs-MacBook-Pro.local',
  secrets: ['치과 예약 3시', '엄마 생신 선물 고르기', '분기 매출 보고서 초안', '오늘 점심 뭐 먹지'],
};

// 가짜 비밀 (모양만 같다)
const FD = `fd_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6nP9rS2u'}`;
const FS = `fs_${'Zq9Xw8Ve7Ur6Ts5Rq4Po3Nm2Lk1Jh0Gf9Ed8Cb7Aa6'}`;
const TS = 'tskey-auth-kAbCdE1234CNTRL-abcdefghijklmnopqrstuvwxyz1234';
const GO = 'GOCSPX-abcdEFGH1234ijklMNOP5678qrst';
const GH = `ghp_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'}`;
const SK = 'sk-ant-api03-abcdEFGH1234_ijklMNOP5678-qrstUVWX9012';

const SAMPLE_LOG = [
  `2026-10-15T09:00:01.123Z [boot] 시작 0.4.3 darwin arm64 ${HOME}/Library/Application Support/fairy`,
  `2026-10-15T09:00:02.000Z [server] 세션 받음 ${FS} 기기 ${FD}`,
  '2026-10-15T09:00:03.000Z [server] 요청 실패 https://api.fairy.example/v1/sync?token=abc123&x=1 503',
  `2026-10-15T09:00:04.000Z [net] tailscale ${TS} up`,
  `2026-10-15T09:00:05.000Z [gcal] 인증 실패 client_secret=${GO} code=4/0AbCdEfGhIjKlMnOp`,
  `2026-10-15T09:00:06.000Z [update] GitHub ${GH} 로 확인`,
  `2026-10-15T09:00:07.000Z [chat] error claude ${SK} Error: spawn ENOENT at ${HOME}/.local/bin/claude`,
  '2026-10-15T09:00:08.000Z [chat] 오류 me@gmail.com 로그인 필요',
  '2026-10-15T09:00:09.000Z [todo] 저장 실패: 치과 예약 3시 (SQLITE_BUSY)',
  '2026-10-15T09:00:10.000Z [chat] 답이 끊김 "엄마 생신 선물 고르기" 이어서',
  '2026-10-15T09:00:11.000Z [cal] 일정 못 읽음 분기 매출 보고서 초안 10:00',
  '2026-10-15T09:00:12.000Z [pc] Kimcs-MacBook-Pro.local 192.168.0.12 접속',
  '2026-10-15T09:00:13.000Z [server] 기기 코드 F-ABCD-2345 확인',
];

const facts = (over: Partial<HelpFacts> = {}): HelpFacts => ({
  version: '0.4.3',
  packaged: true,
  os: '맥 15.1 arm64',
  arch: 'arm64',
  lang: 'ko',
  electron: '41.0.0',
  provider: 'claude',
  settings: {
    ...Object.fromEntries(HELP_FLAGS.map((k, i) => [k, i % 2 === 0])),
    persona: 'friend',
    petKind: 'kong',
    lang: 'auto',
  } as HelpFacts['settings'],
  detect: [
    { id: 'claude', state: 'found' },
    { id: 'codex', state: 'login' },
    { id: 'cursor', state: 'missing' },
  ],
  server: {
    enabled: true,
    on: true,
    device: true,
    signedIn: true,
    problem: null,
    pending: 2,
    lastSyncAt: 1_000_000,
    ai: true,
    code: 'F-ABCD-2345',
  },
  now: 1_000_000 + 5 * 60_000,
  ...over,
});

test('머리: 판, 운영체제, 아키텍처, 켜진 기능, AI 감지, 서버 연결 상태', () => {
  setLang('ko');
  const head = helpSummary(facts()).join('\n');
  assert.match(head, /앱 판: 0\.4\.3 \(설치판\)/);
  assert.match(head, /운영체제: 맥 15\.1 arm64/);
  assert.match(head, /아키텍처: arm64, Electron 41/);
  assert.match(head, /claude=found codex=login cursor=missing/);
  assert.match(head, /wander=1 aiIsolation=0/);
  assert.match(head, /서버: 켜짐, 계정 구글 로그인, 문제 없음, 못 보낸 코인 기록 2개, 마지막 맞추기 5분 전/);
  assert.match(head, /기기 코드: F-ABCD-2345/);
});

const SERVER = facts().server as NonNullable<HelpFacts['server']>;

test('서버 상태: 주소 없는 판, 꺼짐, 문제, 한 번도 못 맞춤', () => {
  setLang('ko');
  assert.match(serverLine(undefined, 0), /서버 주소가 없는 판/);
  assert.match(serverLine({ ...SERVER, enabled: false }, 0), /서버 주소가 없는 판/);
  assert.match(serverLine({ ...SERVER, on: false }, 0), /서버 모드 꺼짐/);
  const s = serverLine({ ...SERVER, problem: 'offline', lastSyncAt: null, signedIn: false }, 0);
  assert.match(s, /기기 계정만/);
  assert.match(s, /문제 offline/);
  assert.match(s, /아직 없음/);
});

test('머리에는 서버 주소, 토큰, 닉네임, 할 일 같은 값이 들어갈 자리가 없다', () => {
  const head = helpSummary(facts()).join('\n');
  assert.doesNotMatch(head, /https?:\/\//);
  assert.doesNotMatch(head, /fd_|fs_/);
  // 설정 요약은 켜짐 꺼짐만: 이름 설정은 이름 칸에 넣을 수 없다
  for (const key of ['petName', 'petRules', 'petMemory', 'icsUrl', 'aiModels'])
    assert.equal((HELP_FLAGS as readonly string[]).includes(key), false, key);
});

test('가리기: 실제 기록 표본에서 토큰, 이메일, 사용자 이름, 내용이 모두 사라진다', () => {
  setLang('ko');
  const pack = buildHelpPack({
    summary: helpSummary(facts()),
    stats: '베타 기록\n켜 둔 날 3일',
    rawLog: SAMPLE_LOG.join('\n'),
    redact,
  });
  const out = pack.text;
  for (const secret of [FD, FS, TS, GO, GH, SK, 'me@gmail.com', 'abc123', '4/0AbCdEfGhIjKlMnOp']) {
    assert.equal(out.includes(secret), false, `남음: ${secret}`);
  }
  for (const content of ['치과 예약 3시', '엄마 생신 선물 고르기', '분기 매출 보고서 초안']) {
    assert.equal(out.includes(content), false, `내용이 남음: ${content}`);
  }
  // 홈 경로의 사용자 이름, 컴퓨터 이름, 밖에서 보이는 IP
  assert.equal(out.includes('kimcs'), false);
  assert.equal(/kimcs-macbook/i.test(out), false);
  assert.equal(out.includes('192.168.0.12'), false);
  assert.match(out, /~\/\.local\/bin\/claude/);
  // 남겨야 하는 것: 기기 코드, 판, 시각, 태그
  assert.match(out, /F-ABCD-2345/);
  assert.match(out, /앱 판: 0\.4\.3/);
  assert.match(out, /2026-10-15T09:00:13\.000Z \[server\]/);
  assert.ok(pack.hidden >= 10, `가린 곳 ${pack.hidden}`);
  assert.equal(pack.lines, SAMPLE_LOG.length);
});

test('머리에 비밀이 섞여 와도 가린다 (머리도 같은 규칙을 거친다)', () => {
  setLang('ko');
  const pack = buildHelpPack({
    summary: [`서버: ${FD}`, `사용자 /Users/kimcs/x`, '치과 예약 3시'],
    stats: '',
    rawLog: '',
    redact,
  });
  assert.equal(pack.text.includes(FD), false);
  assert.equal(pack.text.includes('kimcs'), false);
  assert.equal(pack.text.includes('치과 예약 3시'), false);
});

test('두 번 가려도 같은 글이다 (이미 가린 자리를 다시 세지 않는다)', () => {
  const once = redactLogDetail(SAMPLE_LOG.join('\n'), redact);
  const twice = redactLogDetail(once.text, redact);
  assert.equal(twice.text, once.text);
});

test('토큰 머리 종류별로 한 줄씩', () => {
  const lines: [string, string][] = [
    [`device ${FD}`, 'device <secret>'],
    [`session=${FS}`, 'session=<secret>'],
    [`key ${TS}`, 'key <secret>'],
    [`secret ${GO} x`, 'secret <secret> x'],
    [`pat ${GH}`, 'pat <secret>'],
    [`anthropic ${SK}`, 'anthropic <secret>'],
    ['stripe sk_live_abcdEFGH12345678', 'stripe <secret>'],
    ['npm npm_abcdEFGH1234567890abcdEFGH12', 'npm <secret>'],
  ];
  for (const [raw, want] of lines) assert.equal(redactLogDetail(raw, redact).text, want, raw);
});

test('큰 기록도 상한 안에서 끝 쪽만 쓴다', () => {
  const big = Array.from({ length: 5000 }, (_, i) => `2026-10-15T09:00:00.000Z [x] 줄 ${i}`).join('\n');
  const pack = buildHelpPack({ summary: [], stats: '', rawLog: big, redact });
  assert.ok(pack.lines <= 200);
  assert.match(pack.text, /줄 4999/);
  assert.equal(pack.text.includes('줄 100\n'), false);
});
