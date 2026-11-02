// 메모 목록의 "충돌 사본" 표시가 쓰는 번호 찾기 (rows.copyNoteIds)
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../../shared/db-schema.ts';
import { FakeSyncServer, pair, settle, spin } from './harness.ts';
import { copyNoteIds } from './rows.ts';

test('충돌 사본인 메모의 번호만 돌려준다 (원본과 보통 메모는 아니다)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '일기', body: '오늘은 맑음' }, Date.now());
  const plain = a.notes.add({ title: '보통', body: '그냥 메모' }, Date.now());
  await settle([a, b]);
  const bid = (b.db.prepare('select id from note where title = ?').get('일기') as { id: number }).id;
  spin();
  a.notes.update(n.id, { body: '완전히 다른 A 의 글' }, Date.now());
  spin();
  b.notes.update(bid, { body: '완전히 다른 B 의 글' }, Date.now());
  await a.engine.run(true);
  await b.engine.run(true);
  await settle([a, b]);
  for (const d of [a, b]) {
    const ids = copyNoteIds(d.db);
    assert.equal(ids.size, 1, d.name);
    const title = (d.db.prepare('select title from note where id = ?').get([...ids][0]) as { title: string })
      .title;
    assert.match(title, /충돌 사본/);
    const orig = (d.db.prepare('select id from note where title = ?').get('일기') as { id: number }).id;
    assert.ok(!ids.has(orig), '원본에는 표시가 없다');
  }
  assert.ok(!copyNoteIds(a.db).has(plain.id));
});

test('동기화 표가 없는 저장 파일이거나 사본이 없으면 빈 집합', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  assert.equal(copyNoteIds(db).size, 0);
  const bare = new DatabaseSync(':memory:') as unknown as Db;
  bare.exec('create table note (id integer primary key, uid text, deleted_at integer)');
  assert.equal(copyNoteIds(bare).size, 0);
});
