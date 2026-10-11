import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { returnCodexAuth } from './codex-auth.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-codexauth-'));
after(() => rmSync(root, { recursive: true, force: true }));
const user = join(root, 'user');
const home = join(root, 'home');
mkdirSync(user);
mkdirSync(home);
const userAuth = join(user, 'auth.json');

test('짝꿍 쪽 복사본이 새 토큰을 받았으면 사용자 쪽에 되돌려 쓴다', () => {
  writeFileSync(userAuth, '{"t":"old"}');
  utimesSync(userAuth, 1000, 1000);
  writeFileSync(join(home, 'auth.json'), '{"t":"new"}');
  assert.equal(returnCodexAuth(home, userAuth), true);
  assert.equal(readFileSync(userAuth, 'utf8'), '{"t":"new"}');
  // 같으면 다시 쓰지 않는다
  assert.equal(returnCodexAuth(home, userAuth), false);
});

test('사용자 쪽이 더 새것이거나, 짝꿍 쪽이 깨졌거나 링크면 그대로 둔다', () => {
  writeFileSync(join(home, 'auth.json'), '{"t":"mine"}');
  utimesSync(join(home, 'auth.json'), 1000, 1000);
  writeFileSync(userAuth, '{"t":"theirs"}');
  assert.equal(returnCodexAuth(home, userAuth), false);
  writeFileSync(join(home, 'auth.json'), '{"t":');
  utimesSync(userAuth, 1000, 1000);
  assert.equal(returnCodexAuth(home, userAuth), false);
  assert.equal(readFileSync(userAuth, 'utf8'), '{"t":"theirs"}');
  rmSync(join(home, 'auth.json'));
  symlinkSync(userAuth, join(home, 'auth.json'));
  assert.equal(returnCodexAuth(home, userAuth), false);
});
