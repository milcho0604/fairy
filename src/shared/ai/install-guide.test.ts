import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang, t } from '../i18n/index.ts';
import { safeExternalUrl } from '../links.ts';
import {
  guideModeOf,
  guideOs,
  hasGuide,
  installGuide,
  isGuideProvider,
  NODE_DOWNLOAD,
  whereCommand,
} from './install-guide.ts';
import { BUILTIN_PROVIDERS, customProvider } from './providers.ts';

const PLATFORMS = ['darwin', 'win32', 'linux'] as const;

test('설치해야 하는 기본 AI 는 모두 운영체제마다 설치, 로그인, 공식 안내가 있다 (#29)', () => {
  const needInstall = BUILTIN_PROVIDERS.filter((p) => p.id !== 'local').map((p) => p.id);
  assert.deepEqual(needInstall.sort(), ['claude', 'codex', 'cursor', 'gemini']);
  for (const id of needInstall) {
    const bin = BUILTIN_PROVIDERS.find((p) => p.id === id)?.bin ?? '';
    for (const platform of PLATFORMS) {
      const g = installGuide(id, platform);
      assert.ok(g, `${id} ${platform}`);
      assert.ok(g.install.length > 0);
      // 로그인, 확인 명령은 짝꿍이 찾는 실행 파일 이름으로 (cursor 는 agent 가 아니라 cursor-agent)
      assert.ok(g.login.startsWith(bin), `${id}: ${g.login}`);
      assert.ok(g.check.startsWith(`${bin} `), `${id}: ${g.check}`);
      // 열 주소는 메인의 openLink 가 통과시키는 https 만
      assert.equal(safeExternalUrl(g.docs), g.docs);
      assert.ok(g.docs.startsWith('https://'));
    }
  }
  assert.equal(safeExternalUrl(NODE_DOWNLOAD), NODE_DOWNLOAD);
});

test('무료 AI 와 사용자 추가 AI 는 설치 안내가 없다', () => {
  assert.equal(installGuide('local', 'darwin'), undefined);
  assert.equal(installGuide('custom-1', 'darwin'), undefined);
  assert.equal(isGuideProvider('gemini'), true);
  assert.equal(isGuideProvider('toString'), false);
});

test('운영체제에 맞는 명령을 고른다: 윈도우는 PowerShell, 맥과 리눅스는 셸', () => {
  assert.equal(guideOs('darwin'), 'mac');
  assert.equal(guideOs('win32'), 'win');
  assert.equal(guideOs('freebsd'), 'linux');
  assert.equal(
    installGuide('claude', 'win32')?.install[0]?.command,
    'irm https://claude.ai/install.ps1 | iex',
  );
  assert.equal(
    installGuide('claude', 'darwin')?.install[0]?.command,
    'curl -fsSL https://claude.ai/install.sh | bash',
  );
  assert.ok(installGuide('gemini', 'win32')?.install.every((c) => c.command.startsWith('npm ')));
  assert.equal(installGuide('gemini', 'win32')?.needsNode, '20');
  // 윈도우는 PATH 를 셸 설정에서 읽지 않아 폴더 안내를 하지 않는다 (앱 다시 켜기 안내만)
  assert.equal(installGuide('claude', 'win32')?.binDir, undefined);
  assert.equal(installGuide('claude', 'darwin')?.binDir, '~/.local/bin');
});

test('안내 글: 로그인 명령과 고를 항목에 맞는 조사, 운영체제별 못 찾음 도움', () => {
  setLang('ko');
  assert.equal(
    t('ai.guide.step2Pick', { cmd: 'gemini', pick: 'Sign in with Google' }),
    '2. 다 깔리면 터미널을 새로 열고 gemini를 실행해. Sign in with Google 항목을 고르고 브라우저에서 로그인하면 끝이야.',
  );
  assert.match(t('ai.guide.step2', { cmd: 'cursor-agent login' }), /cursor-agent login을 실행해/);
  assert.match(t('ai.guide.still.mac'), /~\/\.zshrc/);
  assert.match(t('ai.guide.still.win'), /껐다 켜/);
  assert.match(t('ai.install.gemini'), /gemini를 한 번 실행해 로그인/);
  setLang('en');
  assert.match(t('ai.guide.still.mac'), /Dock or Finder/);
  setLang('ko');
});

test('로그인 안 됨도 같은 틀: 상태와 오류 종류에서 펼칠 안내를 고른다', () => {
  assert.equal(guideModeOf({ kind: 'not-installed' }), 'install');
  assert.equal(guideModeOf({ kind: 'not-logged-in' }), 'login');
  assert.equal(guideModeOf({ kind: 'rate-limit' }), undefined);
  assert.equal(guideModeOf({ kind: 'timeout' }), undefined);
  assert.equal(guideModeOf({ installed: false }), 'install');
  assert.equal(guideModeOf({ installed: true, loggedIn: false }), 'login');
  // 로그인 확인을 못 하는 AI(undefined)와 준비된 AI 는 안내를 펼치지 않는다
  assert.equal(guideModeOf({ installed: true }), undefined);
  assert.equal(guideModeOf({ installed: true, loggedIn: true }), undefined);
  assert.equal(guideModeOf(undefined), undefined);
});

test('로그인 상태 명령은 공식 문서에 있는 것만, 짝꿍이 찾는 실행 파일 이름으로', () => {
  for (const platform of PLATFORMS) {
    assert.equal(installGuide('claude', platform)?.status, 'claude auth status');
    assert.equal(installGuide('codex', platform)?.status, 'codex login status');
    assert.equal(installGuide('cursor', platform)?.status, 'cursor-agent status');
    // Gemini 는 공식 문서에 상태 명령이 없다
    assert.equal(installGuide('gemini', platform)?.status, undefined);
  }
});

test('직접 추가한 AI 도 안내가 있다: 설치 명령 대신 경로 찾기 명령', () => {
  const spec = customProvider({ label: 'Llama', bin: 'ollama', args: 'run llama3.2 {prompt}' }, 'custom-1');
  assert.ok(typeof spec !== 'string');
  assert.equal(hasGuide({ id: spec.id, custom: spec.custom, bin: spec.bin }), true);
  // 실행 파일 이름을 모르면(옛 상태) 경로 명령을 만들 수 없어 단추를 두지 않는다
  assert.equal(hasGuide({ id: 'custom-2', custom: true }), false);
  assert.equal(hasGuide({ id: 'local' }), false);
  assert.equal(hasGuide({ id: 'gemini' }), true);
  assert.equal(whereCommand('ollama', 'darwin'), 'command -v ollama');
  assert.equal(whereCommand('ollama', 'linux'), 'command -v ollama');
  assert.equal(whereCommand('ollama', 'win32'), 'where.exe ollama');
});

test('Gemini 도 로그인 안 됨 오류에 로그인 방법을 말한다', () => {
  setLang('ko');
  const gemini = BUILTIN_PROVIDERS.find((p) => p.id === 'gemini');
  assert.match(gemini?.loginHint ?? '', /Sign in with Google/);
  setLang('en');
  assert.match(gemini?.loginHint ?? '', /Sign in with Google/);
  setLang('ko');
});

test('로그인, 직접 추가 안내 글 (ko, en)', () => {
  setLang('ko');
  assert.equal(t('ai.guide.showLogin'), '로그인 방법 보기');
  assert.equal(t('ai.guide.loginTitle', { label: 'Codex' }), 'Codex 로그인하기');
  assert.equal(
    t('ai.guide.login.still.status', { cmd: 'claude auth status' }),
    '터미널에서 claude auth status로 로그인 상태를 볼 수 있어. 로그인 안 됨으로 나오면 위 명령을 다시 실행해 줘.',
  );
  assert.match(t('ai.guide.custom.step1', { bin: 'ollama' }), /ollama가 실행되는지/);
  assert.match(t('ai.guide.custom.step2'), /AI 관리에서 이 AI를 빼고/);
  setLang('en');
  assert.equal(t('ai.guide.showLogin'), 'How to log in');
  assert.equal(t('ai.guide.loginTitle', { label: 'Codex' }), 'Log in to Codex');
  assert.match(t('ai.guide.custom.step2'), /Manage AIs/);
  setLang('ko');
});
