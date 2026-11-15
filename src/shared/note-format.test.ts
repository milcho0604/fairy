// 메모 형식 (26판): 저장 파일 올리기, 기본값, 바꾸기, 동기화 칸
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { NOTE_FORMAT_MIGRATION_SQL } from './db-schema-sync.ts';
import { NoteStore, noteFormatOf } from './note-store.ts';
import { SYNC_FIELDS } from './sync-fields.ts';

const mem = (): Db => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return db;
};
const clocks = (db: Db, uid: string): string[] =>
  (
    db.prepare("select field from sync_clock where kind = 'note' and uid = ? order by field").all(uid) as {
      field: string;
    }[]
  ).map((r) => r.field);
const uidOf = (db: Db, id: number): string =>
  (db.prepare('select uid from note where id = ?').get(id) as { uid: string }).uid;

test('형식 올리기는 MIGRATIONS 끝에 붙고, 옛 판 파일의 메모는 모두 txt 가 된다', () => {
  const at = MIGRATIONS.indexOf(NOTE_FORMAT_MIGRATION_SQL);
  assert.ok(at >= 24, '24판 동기화 바탕 뒤에 붙는다');
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, at)) db.exec(sql);
  db.exec(`pragma user_version = ${at}; commit`);
  db.prepare('insert into note (title, body, created_at, updated_at) values (?, ?, 0, 0)').run(
    '옛 메모',
    '# 글',
  );
  assert.deepEqual(migrate(db), { from: at, to: SCHEMA_VERSION });
  const row = db.prepare('select format, body from note').get() as { format: string; body: string };
  assert.equal(row.format, 'txt');
  assert.equal(row.body, '# 글', '본문은 그대로');
});

test('새 메모의 형식은 기본 txt, 주면 md, 이상한 값은 txt', () => {
  const store = new NoteStore(mem());
  assert.equal(store.add({ body: 'a' }, 1).format, 'txt');
  assert.equal(store.add({ body: 'b', format: 'md' }, 2).format, 'md');
  assert.equal(store.add({ body: 'c', format: 'rtf' as never }, 3).format, 'txt');
  assert.equal(noteFormatOf(undefined), 'txt');
  assert.equal(noteFormatOf('md'), 'md');
  assert.equal(noteFormatOf('MD'), 'txt');
});

test('형식 바꾸기: 글과 고친 시각은 그대로, 같은 형식이면 칸 시각이 오르지 않는다', () => {
  const db = mem();
  const store = new NoteStore(db);
  const n = store.add({ title: '회의', body: '- a' }, 100);
  db.exec('delete from sync_clock');
  const same = store.setFormat(n.id, 'txt');
  assert.equal(same?.format, 'txt');
  assert.deepEqual(clocks(db, uidOf(db, n.id)), [], '같은 형식은 쓰지 않는다');
  const md = store.setFormat(n.id, 'md');
  assert.equal(md?.format, 'md');
  assert.equal(md?.body, '- a');
  assert.equal(md?.updatedAt, 100, '고친 시각은 그대로');
  assert.deepEqual(clocks(db, uidOf(db, n.id)), ['format'], '동기화 칸 시각은 format 하나만');
  assert.equal(store.get(n.id)?.format, 'md');
  assert.equal(store.setFormat(999, 'md'), undefined);
});

test('본문을 고쳐도 형식은 그대로 (update, updateFrom)', () => {
  const store = new NoteStore(mem());
  const n = store.add({ body: 'a', format: 'md' }, 1);
  assert.equal(store.update(n.id, { body: 'b' }, 2)?.format, 'md');
  assert.equal(store.updateFrom(n.id, { body: 'c' }, { body: 'b' }, 3)?.format, 'md');
});

test('지운 메모 되살려도 형식이 남는다', () => {
  const store = new NoteStore(mem());
  const n = store.add({ body: 'a', format: 'md' }, 1);
  store.remove(n.id, 2);
  store.restore(n.id);
  assert.equal(store.get(n.id)?.format, 'md');
});

test('SYNC_FIELDS.note 에 format 이 있고 새 메모는 format 칸 시각을 적는다', () => {
  assert.ok(SYNC_FIELDS.note.includes('format'));
  const db = mem();
  const n = new NoteStore(db).add({ body: 'a', format: 'md' }, 1);
  assert.ok(clocks(db, uidOf(db, n.id)).includes('format'));
});
