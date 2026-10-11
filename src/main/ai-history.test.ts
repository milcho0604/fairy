import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { aiHistoryBytes, aiWorkDir, claudeProjectName, clearAiHistory } from './ai-history.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-aihist-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('claude 프로젝트 폴더 이름은 글자, 숫자 말고 모두 -', () => {
  assert.equal(
    claudeProjectName('/Users/kim/Library/Application Support/jjakkung/ai-workdir'),
    '-Users-kim-Library-Application-Support-jjakkung-ai-workdir',
  );
  assert.equal(
    claudeProjectName('C:\\Users\\kim\\AppData\\Roaming\\jjakkung\\ai-workdir'),
    'C--Users-kim-AppData-Roaming-jjakkung-ai-workdir',
  );
});

test('짝꿍 폴더만 지운다: 사용자의 다른 claude 프로젝트, codex 로그인은 남긴다', () => {
  const home = join(root, 'home');
  const userData = join(root, 'data', 'jjakkung');
  const projects = join(home, '.claude', 'projects');
  const mine = join(projects, claudeProjectName(aiWorkDir(userData)));
  const other = join(projects, '-Users-kim-work-app');
  mkdirSync(mine, { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(join(mine, 's.jsonl'), 'screen data');
  writeFileSync(join(other, 's.jsonl'), 'keep');
  writeFileSync(join(home, '.claude', 'settings.json'), '{}');
  const codexHome = join(userData, 'codex-home');
  mkdirSync(join(codexHome, 'sessions', '2026'), { recursive: true });
  writeFileSync(join(codexHome, 'sessions', '2026', 'r.jsonl'), 'x');
  writeFileSync(join(codexHome, 'history.jsonl'), 'x');
  writeFileSync(join(codexHome, 'auth.json'), '{}');
  const d = { userData, home };
  assert.ok(aiHistoryBytes(d) > 0);
  clearAiHistory(d);
  assert.ok(!existsSync(mine));
  assert.ok(existsSync(join(other, 's.jsonl')));
  assert.ok(existsSync(join(home, '.claude', 'settings.json')));
  assert.ok(!existsSync(join(codexHome, 'sessions')));
  assert.ok(!existsSync(join(codexHome, 'history.jsonl')));
  assert.ok(existsSync(join(codexHome, 'auth.json')));
  assert.equal(aiHistoryBytes(d), 0);
});

test('데이터 폴더를 fairy 로 옮긴 뒤에도 예전 이름(jjakkung) 작업 폴더의 claude 기록까지 지운다', () => {
  const home = join(root, 'home2');
  const userData = join(root, 'data2', 'fairy');
  const projects = join(home, '.claude', 'projects');
  const now = join(projects, claudeProjectName(aiWorkDir(userData)));
  const old = join(projects, claudeProjectName(aiWorkDir(join(root, 'data2', 'jjakkung'))));
  const other = join(projects, claudeProjectName(aiWorkDir(join(root, 'data2', 'someone-else'))));
  for (const p of [now, old, other]) {
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 's.jsonl'), 'x');
  }
  clearAiHistory({ userData, home });
  assert.ok(!existsSync(now));
  assert.ok(!existsSync(old));
  assert.ok(existsSync(join(other, 's.jsonl')));
});
