import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { bakOf, brokenName, readJsonFile, writeJsonFile } from './json-file.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-json-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('쓰고 읽는다. 임시 파일이 남지 않는다', () => {
  const f = join(root, 'a', 'settings.json');
  writeJsonFile(f, { v: 1 });
  writeJsonFile(f, { v: 2 });
  assert.deepEqual(readJsonFile(f).value, { v: 2 });
  assert.deepEqual(
    readdirSync(join(root, 'a')).filter((n) => n.endsWith('.tmp')),
    [],
  );
});

test('토큰처럼 mode 를 주면 그 권한으로 쓴다', { skip: process.platform === 'win32' }, () => {
  const f = join(root, 'token.json');
  writeJsonFile(f, { t: 'x' }, { mode: 0o600 });
  assert.equal(statSync(f).mode & 0o777, 0o600);
});

test('잘 읽으면 .bak 을 남기고, 깨지면 옆으로 옮긴 뒤 .bak 으로 되살린다', () => {
  const f = join(root, 'planner.json');
  writeJsonFile(f, { good: true });
  assert.deepEqual(readJsonFile(f, { keepBak: true }).value, { good: true });
  assert.ok(existsSync(bakOf(f)));
  writeFileSync(f, '{"good": tr'); // 반쯤 쓴 파일
  const at = new Date(2026, 9, 11, 9, 30, 0).getTime();
  const r = readJsonFile(f, { keepBak: true, now: at });
  assert.deepEqual(r.value, { good: true });
  assert.equal(r.trouble?.restored, true);
  assert.equal(r.trouble?.moved, join(root, 'planner-broken-20261011-093000.json'));
  assert.equal(readFileSync(r.trouble.moved, 'utf8'), '{"good": tr');
  // 원래 자리에 되살린 내용이 다시 써져 다음에 켜도 그대로
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { good: true });
});

test('복사본이 없으면 옮기고 값 없음으로 (조용히 지우지 않는다)', () => {
  const f = join(root, 'chat.json');
  writeFileSync(f, 'not json');
  const r = readJsonFile(f);
  assert.equal(r.value, undefined);
  assert.equal(r.trouble?.restored, false);
  assert.ok(existsSync(r.trouble?.moved ?? ''));
  assert.ok(!existsSync(f));
});

test('없는 파일은 문제 없이 값 없음', () => {
  assert.deepEqual(readJsonFile(join(root, 'none.json')), {});
});

test('깨진 파일 이름이 겹치면 -2 를 붙인다', () => {
  const f = join(root, 'x.json');
  const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
  const first = brokenName(f, at);
  writeFileSync(first, '');
  assert.equal(brokenName(f, at), join(root, 'x-broken-20260102-030405-2.json'));
});

test('복사본을 두는 파일이 JSON 이어도 객체가 아니면(null 등) 깨진 것으로 보고 좋은 .bak 을 지킨다 (버그잡이 4)', () => {
  const f = join(root, 'settings-null.json');
  writeJsonFile(f, { petName: '콩이' });
  assert.deepEqual(readJsonFile(f, { keepBak: true }).value, { petName: '콩이' });
  for (const bad of ['null', '"글"', '3', 'true']) {
    writeFileSync(f, bad);
    const r = readJsonFile(f, { keepBak: true });
    assert.deepEqual(r.value, { petName: '콩이' }, bad);
    assert.equal(r.trouble?.restored, true);
    assert.equal(readFileSync(bakOf(f), 'utf8'), JSON.stringify({ petName: '콩이' }, null, 2));
  }
  // 배열은 그대로 (사용자 AI 목록)
  writeJsonFile(f, [1]);
  assert.deepEqual(readJsonFile(f, { keepBak: true }).value, [1]);
  // 복사본을 두지 않는 파일은 예전처럼 값 그대로
  const g = join(root, 'plain-null.json');
  writeFileSync(g, 'null');
  assert.equal(readJsonFile(g).value, null);
});
