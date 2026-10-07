import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';

// 서버는 JJ_USER_DATA 의 jjakkung.db 를 연다. 시험용 빈 폴더에 짝꿍이 하듯 최신 판으로 만들어 둔다.
const dir = mkdtempSync(join(tmpdir(), 'jj-mcp-'));
process.env.JJ_USER_DATA = dir;
const seed = new DatabaseSync(join(dir, 'jjakkung.db'));
migrate(seed as unknown as Db);
seed.close();
const { handle } = await import('./mcp-server.ts');
after(() => rmSync(dir, { recursive: true, force: true }));

let id = 0;
const call = (method: string, params?: Record<string, unknown>) =>
  handle({ jsonrpc: '2.0', id: ++id, method, params }) as {
    result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } & Record<
      string,
      unknown
    >;
    error?: { code: number };
  };
const tool = (name: string, args: Record<string, unknown>) => call('tools/call', { name, arguments: args });
const text = (r: ReturnType<typeof call>) => r.result?.content?.[0]?.text ?? '';

test('시작 인사: 요청한 판을 맞추고, 모르는 판이면 최신, 알림에는 답하지 않는다', () => {
  assert.equal(call('initialize', { protocolVersion: '2025-03-26' }).result?.protocolVersion, '2025-03-26');
  assert.equal(call('initialize', { protocolVersion: '1999-01-01' }).result?.protocolVersion, '2025-06-18');
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal(call('nope').error?.code, -32601);
});

test('객체가 아닌 요청(null, 배열)은 죽지 않고 -32600 으로 답한다', () => {
  for (const bad of [null, [], 3]) {
    const r = handle(bad as unknown as Record<string, unknown>) as { error?: { code: number } };
    assert.equal(r.error?.code, -32600);
  }
});

test('도구 목록', () => {
  assert.deepEqual(
    call('tools/list').result?.tools?.map((t) => t.name),
    ['add_todo', 'list_todos', 'complete_todo', 'add_note', 'add_event', 'list_events'],
  );
});

test('할 일 넣고 보고 끝내기', () => {
  const added = text(tool('add_todo', { title: '보고서', due: '2099-01-02', important: true }));
  assert.match(added, /넣었어 \(id 1\): 보고서, 마감 2099-01-02/);
  assert.match(text(tool('list_todos', {})), /\[1\] \(중요\) 보고서 \(마감 2099-01-02\)/);
  assert.match(text(tool('complete_todo', { id: 1 })), /끝냈어: 보고서 \(코인 15개\)/);
  assert.match(text(tool('complete_todo', { id: 1 })), /이미 끝낸/);
});

test('잘못된 입력은 도구 오류로 (요청 자체는 성공)', () => {
  const bad = tool('add_todo', { title: '  ' });
  assert.equal(bad.result?.isError, true);
  assert.equal(tool('add_todo', { title: 'x', due: '내일' }).result?.isError, true);
  assert.equal(tool('add_event', { title: 'x', start: '3시' }).result?.isError, true);
  assert.equal(call('tools/call', { name: 'rm_rf', arguments: {} }).error?.code, -32602);
});

test('메모와 일정', () => {
  assert.match(text(tool('add_note', { body: '# 회의\n- 결정' })), /메모를 남겼어/);
  const now = new Date(Date.now() + 2 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const start = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T15:30`;
  assert.match(text(tool('add_event', { title: '면접', start, duration_min: 60 })), /일정을 넣었어/);
  assert.match(text(tool('list_events', { days: 7 })), new RegExp(`${start.replace('T', ' ')} 면접`));
});
