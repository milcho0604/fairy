import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { SCHEMA_VERSION } from '../shared/db-schema.ts';

// 이 페어리보다 새 판 저장 파일: MCP 서버는 거절만 하고 파일을 바꾸지 않는다 (버그잡이 4)
const dir = mkdtempSync(join(tmpdir(), 'jj-mcp-newer-'));
process.env.JJ_USER_DATA = dir;
const file = join(dir, 'jjakkung.db');
const seed = new DatabaseSync(file);
seed.exec(`create table todo (id integer primary key); pragma user_version = ${SCHEMA_VERSION + 1};`);
seed.close();
const { handle } = await import('./mcp-server.ts');
after(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

test('새 판 저장 파일: 거절하고 저널 방식(WAL)을 바꾸지 않는다', () => {
  const r = handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'list_todos', arguments: {} },
  }) as {
    result?: { isError?: boolean; content?: { text: string }[] };
  };
  assert.equal(r.result?.isError, true);
  assert.match(r.result?.content?.[0]?.text ?? '', /판이 달라/);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(
      (db.prepare('pragma journal_mode').get() as { journal_mode: string }).journal_mode,
      'delete',
    );
  } finally {
    db.close();
  }
});
