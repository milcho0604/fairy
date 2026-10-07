import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, looksLikeOurs, MIGRATIONS, migrate } from './db-schema.ts';

const open = (path = ':memory:') => new DatabaseSync(path) as unknown as Db & { close(): void };

test('짝꿍 저장 파일 확인: 판 1 이상이고 1판 표가 있어야 한다 (백업 확인, 버그잡이 6차)', () => {
  const ours = open();
  migrate(ours);
  assert.equal(looksLikeOurs(ours), true);

  // 1판만 있는 옛 백업도 받는다
  const v1 = open();
  v1.exec(MIGRATIONS[0] ?? '');
  v1.exec('pragma user_version = 1');
  assert.equal(looksLikeOurs(v1), true);

  // 판 0 인 빈 파일, 표는 있지만 판이 0 인 것
  assert.equal(looksLikeOurs(open()), false);
  const v0 = open();
  v0.exec(MIGRATIONS[0] ?? '');
  assert.equal(looksLikeOurs(v0), false);
  // 판만 올린 다른 앱의 SQLite
  const other = open();
  other.exec('create table notes (x); pragma user_version = 3');
  assert.equal(looksLikeOurs(other), false);
  // 표 하나가 빠진 것
  const partial = open();
  partial.exec('create table todo (x); create table coin_log (x); pragma user_version = 1');
  assert.equal(looksLikeOurs(partial), false);

  // 0바이트 파일
  const dir = mkdtempSync(join(tmpdir(), 'jj-schema-'));
  try {
    writeFileSync(join(dir, 'zero.db'), '');
    const zero = open(join(dir, 'zero.db'));
    assert.equal(looksLikeOurs(zero), false);
    zero.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
