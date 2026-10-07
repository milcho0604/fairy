import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { type Db, migrate, SCHEMA_VERSION, schemaVersion } from '../shared/db-schema.ts';
import { openDbFile } from './db-open.ts';

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function place() {
  const dir = mkdtempSync(join(tmpdir(), 'jj-db-open-'));
  dirs.push(dir);
  return { dir, file: join(dir, 'jjakkung.db') };
}
const quiet = () => {};
const AT = new Date(2026, 9, 7, 9, 30, 0).getTime();

/** 할 일 하나가 든 정상 저장 파일 */
function goodDb(path: string, title: string) {
  const db = new DatabaseSync(path);
  migrate(db as unknown as Db);
  db.prepare('insert into todo (title, created_at) values (?, ?)').run(title, AT);
  db.close();
}
const titles = (db: DatabaseSync) =>
  (db.prepare('select title from todo').all() as { title: string }[]).map((r) => r.title);

test('정상 파일은 그대로 열고 문제가 없다', () => {
  const { file } = place();
  goodDb(file, '할 일');
  const r = openDbFile(file, quiet, AT);
  assert.equal(r.trouble, undefined);
  assert.equal(r.memory, false);
  assert.deepEqual(titles(r.db), ['할 일']);
  r.db.close();
});

test('깨진 파일은 지우지 않고 옆으로 옮긴 뒤 새로 시작한다', () => {
  const { dir, file } = place();
  const junk = Buffer.from('not a sqlite file '.repeat(300));
  writeFileSync(file, junk);
  const r = openDbFile(file, quiet, AT);
  assert.equal(r.trouble?.kind, 'fresh');
  assert.equal(r.memory, false);
  const moved = r.trouble && 'moved' in r.trouble ? r.trouble.moved : '';
  assert.equal(moved, join(dir, 'jjakkung-broken-20261007-093000.db'));
  assert.deepEqual(readFileSync(moved), junk); // 내용 그대로
  assert.equal(schemaVersion(r.db as unknown as Db), SCHEMA_VERSION);
  assert.deepEqual(titles(r.db), []);
  r.db.close();
});

test('중간이 깨진 파일(quick_check 실패)도 깨진 것으로 보고, 남은 복사본 중 쓸 만한 새것으로 되살린다', () => {
  const { dir, file } = place();
  const day = (n: number) => new Date(AT - n * 86_400_000);
  // 옛 복사본 (5일 전, 판 올리기 전 복사)
  goodDb(`${file}.bak-v3`, '옛 복사본');
  utimesSync(`${file}.bak-v3`, day(5), day(5));
  // 백업 가져오기 전 복사 (1일 전): 이것이 쓰인다
  const imported = join(dir, 'before-import-20261006-0930');
  mkdirSync(imported);
  goodDb(join(imported, 'jjakkung.db'), '새 복사본');
  utimesSync(join(imported, 'jjakkung.db'), day(1), day(1));
  // 더 새것이지만 못 쓰는 것: 0바이트, 다른 앱의 SQLite (판 0)
  writeFileSync(`${file}.bak-v4`, '');
  const other = new DatabaseSync(`${file}.bak-v1`);
  other.exec('create table notes (x)');
  other.close();
  // 원본: 정상 파일의 가운데를 덮어 깨뜨린다
  goodDb(file, '깨질 원본');
  const db = new DatabaseSync(file);
  for (let i = 0; i < 300; i++)
    db.prepare('insert into todo (title, created_at) values (?, ?)').run('x'.repeat(200), AT);
  db.exec('pragma wal_checkpoint(truncate)');
  db.close();
  const buf = readFileSync(file);
  buf.fill(7, 4096 * 2, 4096 * 6);
  writeFileSync(file, buf);

  const r = openDbFile(file, quiet, AT);
  assert.equal(r.trouble?.kind, 'recovered');
  assert.equal(r.trouble?.kind === 'recovered' && r.trouble.from, join(imported, 'jjakkung.db'));
  assert.deepEqual(titles(r.db), ['새 복사본']);
  assert.ok(existsSync(join(imported, 'jjakkung.db')), '복사본은 남는다');
  assert.ok(existsSync(join(dir, 'jjakkung-broken-20261007-093000.db')), '깨진 원본도 남는다');
  r.db.close();
});

test('새 판 파일은 덮어쓰지 않고 메모리로 연다', () => {
  const { file } = place();
  goodDb(file, '새 판 데이터');
  const raw = new DatabaseSync(file);
  raw.exec(`pragma user_version = ${SCHEMA_VERSION + 1}`);
  raw.close();
  const before = readFileSync(file);
  const r = openDbFile(file, quiet, AT);
  assert.deepEqual(r.trouble, { kind: 'newer', version: SCHEMA_VERSION + 1 });
  assert.equal(r.memory, true);
  r.db.prepare('insert into todo (title, created_at) values (?, ?)').run('메모리에만', AT);
  r.db.close();
  assert.deepEqual(readFileSync(file), before);
  assert.equal(readdirSync(join(file, '..')).filter((f) => f.includes('broken')).length, 0);
});
