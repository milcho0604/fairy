import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiChildEnv, allowedEnvName } from './child-env.ts';

test('AI 도구에는 고른 환경 변수만 간다', () => {
  const env = aiChildEnv(
    {
      HOME: '/Users/kim',
      LANG: 'ko_KR.UTF-8',
      LC_ALL: 'ko_KR.UTF-8',
      HTTPS_PROXY: 'http://proxy:8080',
      ANTHROPIC_BASE_URL: 'https://x',
      CODEX_HOME: '/u/.codex',
      GITHUB_TOKEN: 'ghp_secret',
      AWS_PROFILE: 'work',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require evil.js',
      JJ_USER_DATA: '/tmp/x',
      SLACK_TOKEN: 'xoxb',
      Path: 'C:\\old',
    },
    { PATH: '/usr/bin', NO_COLOR: '1' },
  );
  assert.deepEqual(Object.keys(env).sort(), [
    'ANTHROPIC_BASE_URL',
    'AWS_PROFILE',
    'CODEX_HOME',
    'HOME',
    'HTTPS_PROXY',
    'LANG',
    'LC_ALL',
    'NO_COLOR',
    'PATH',
  ]);
  assert.equal(env.PATH, '/usr/bin');
});

test('윈도우 이름은 대소문자를 가리지 않는다', () => {
  assert.ok(allowedEnvName('SystemRoot'));
  assert.ok(allowedEnvName('ProgramFiles(x86)'));
  assert.ok(allowedEnvName('https_proxy'));
  assert.ok(!allowedEnvName('npm_config_token'));
});
