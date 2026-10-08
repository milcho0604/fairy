import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createLogFile, formatLogLine, LOG_LINE_MAX, redactLine } from './log-file.ts';

const root = mkdtempSync(join(tmpdir(), 'jj-log-'));
after(() => rmSync(root, { recursive: true, force: true }));
const AT = new Date('2026-10-07T01:02:03.000Z');

test('경로 속 사용자 이름을 가린다: 홈은 ~, 다른 사람 홈과 윈도우 경로는 <user>', () => {
  const home = '/Users/kim';
  assert.equal(redactLine('open /Users/kim/Library/x.db failed', home), 'open ~/Library/x.db failed');
  assert.equal(redactLine('at /Users/lee/app/main.js:10:3', home), 'at /Users/<user>/app/main.js:10:3');
  assert.equal(redactLine('/home/park/.config', home), '/home/<user>/.config');
  assert.equal(redactLine('C:\\Users\\Choi\\AppData', home), 'C:\\Users\\<user>\\AppData');
  // JSON 으로 바뀌어 역슬래시가 둘이 된 것도
  assert.equal(redactLine('"C:\\\\Users\\\\Choi\\\\x"', home), '"C:\\\\Users\\\\<user>\\\\x"');
  // 경로가 아닌 글은 그대로
  assert.equal(redactLine('Users like this', home), 'Users like this');
  // 홈이 / 처럼 짧으면 홈 바꾸기는 건너뛴다 (모든 / 가 ~ 가 되지 않게)
  assert.equal(redactLine('/a/b', '/'), '/a/b');
});

test('기록 한 줄: 시각, 태그, 오류는 호출 기록째, 객체는 JSON', () => {
  assert.equal(
    formatLogLine(AT, 'db', ['열기', 3, { a: 1 }], '/Users/kim'),
    `${AT.toISOString()} [db] 열기 3 {"a":1}\n`,
  );
  const err = new Error('boom');
  err.stack = 'Error: boom\n    at /Users/kim/x.js:1:1';
  assert.equal(
    formatLogLine(AT, 'error', [err], '/Users/kim'),
    `${AT.toISOString()} [error] Error: boom\n    at ~/x.js:1:1\n`,
  );
  const long = formatLogLine(AT, 't', ['x'.repeat(LOG_LINE_MAX * 2)], '/Users/kim');
  assert.ok(long.length < LOG_LINE_MAX + 100);
});

test('1MB(여기서는 작게)를 넘으면 main.old.log 로 돌리고 새로 쓴다. 파일은 둘까지', () => {
  const dir = join(root, 'rotate');
  const write = createLogFile(dir, '/Users/kim', 200);
  for (let i = 0; i < 3; i++) write('t', [`line-${i}-${'x'.repeat(40)}`], AT);
  // 한 줄 약 80B: 둘까지는 main.log, 셋째에서 넘는다
  assert.ok(existsSync(join(dir, 'main.old.log')));
  assert.match(readFileSync(join(dir, 'main.old.log'), 'utf8'), /line-0[\s\S]*line-1/);
  assert.match(readFileSync(join(dir, 'main.log'), 'utf8'), /line-2/);
  assert.doesNotMatch(readFileSync(join(dir, 'main.log'), 'utf8'), /line-1/);
  for (let i = 3; i < 20; i++) write('t', [`line-${i}-${'x'.repeat(40)}`], AT);
  assert.ok(statSync(join(dir, 'main.log')).size <= 200);
  assert.ok(statSync(join(dir, 'main.old.log')).size <= 200);
  assert.doesNotMatch(readFileSync(join(dir, 'main.old.log'), 'utf8'), /line-0-/);
});

test('켤 때 이미 있는 main.log 크기를 이어서 센다', () => {
  const dir = join(root, 'resume');
  const first = createLogFile(dir, '/x/y', 200);
  first('t', ['a'.repeat(150)], AT);
  const again = createLogFile(dir, '/x/y', 200);
  again('t', ['b'.repeat(80)], AT);
  assert.ok(existsSync(join(dir, 'main.old.log')));
});

test('누가 main.log 를 지워도 멈추지 않고 새로 쓴다', () => {
  const dir = join(root, 'deleted');
  const write = createLogFile(dir, '/x/y', 200);
  write('t', ['a'.repeat(150)], AT);
  rmSync(join(dir, 'main.log'));
  write('t', ['b'.repeat(80)], AT);
  write('t', ['c'], AT);
  assert.match(readFileSync(join(dir, 'main.log'), 'utf8'), /\[t\] c/);
});

test('쓸 수 없는 곳이어도 던지지 않는다', () => {
  const file = join(root, 'not-a-dir');
  writeFileSync(file, 'x');
  const write = createLogFile(join(file, 'logs'), '/x/y');
  assert.doesNotThrow(() => write('t', ['a'], AT));
});
