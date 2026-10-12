import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang, t } from '../i18n/index.ts';
import { safeExternalUrl } from '../links.ts';
import { guideOs, installGuide, isGuideProvider, NODE_DOWNLOAD } from './install-guide.ts';
import { BUILTIN_PROVIDERS } from './providers.ts';

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
