import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codexMcpNames } from '../../shared/ai/codex-config.ts';
import { prepareIsolatedHome } from './codex-isolate.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'fairy-codex-isolate-'));

test('로그인 파일이 없어도(API 키, 키체인) 빈 격리 폴더를 돌려주고 사용자 폴더로 돌아가지 않는다 (R3)', () => {
  const root = tmp();
  try {
    const user = join(root, 'user');
    const mine = join(root, 'mine');
    mkdirSync(user, { recursive: true });
    // 윤초 시각이라 해석을 못 하고, gmail 서버가 적혀 있고, auth.json 이 없다
    writeFileSync(
      join(user, 'config.toml'),
      't = 2026-12-31T23:59:60Z\n[mcp_servers.gmail]\ncommand = "x"\n',
    );
    assert.equal(codexMcpNames('t = 2026-12-31T23:59:60Z\n[mcp_servers.gmail]\ncommand = "x"\n'), undefined);
    const home = prepareIsolatedHome(mine, user, join(root, 'nohome'));
    assert.equal(home, mine);
    assert.ok(existsSync(mine));
    // 격리 폴더에는 사용자 설정도 로그인 파일도 없다
    assert.equal(existsSync(join(mine, 'config.toml')), false);
    assert.equal(existsSync(join(mine, 'auth.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('이전에 연결해 둔 로그인 파일은 사용자가 로그아웃하면 지운다', () => {
  const root = tmp();
  try {
    const user = join(root, 'user');
    const mine = join(root, 'mine');
    mkdirSync(user, { recursive: true });
    writeFileSync(join(user, 'auth.json'), '{}');
    prepareIsolatedHome(mine, user, join(root, 'nohome'));
    assert.ok(lstatSync(join(mine, 'auth.json')).isSymbolicLink() || existsSync(join(mine, 'auth.json')));
    rmSync(join(user, 'auth.json'));
    prepareIsolatedHome(mine, user, join(root, 'nohome'));
    assert.equal(lstatSync(join(mine, 'auth.json'), { throwIfNoEntry: false }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('로그인 파일이 있으면 격리 폴더에 그 파일만 연결한다', () => {
  const root = tmp();
  try {
    const user = join(root, 'user');
    const mine = join(root, 'mine');
    mkdirSync(user, { recursive: true });
    writeFileSync(join(user, 'auth.json'), '{"a":1}');
    writeFileSync(join(user, 'config.toml'), '[mcp_servers.x]\n');
    prepareIsolatedHome(mine, user, join(root, 'nohome'));
    assert.ok(existsSync(join(mine, 'auth.json')));
    assert.equal(existsSync(join(mine, 'config.toml')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
