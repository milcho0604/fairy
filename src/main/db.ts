import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';
import { StatStore } from '../shared/beta-stats.ts';
import { type Db, migrate, SCHEMA_VERSION, schemaVersion } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { NoteStore } from '../shared/note-store.ts';
import { TodoStore } from '../shared/todo-store.ts';

/**
 * 저장 파일(jjakkung.db)을 열고 최신 판으로 올린다 (P2-01).
 * WAL 로 쓰므로 앱이 갑자기 꺼져도 끝난 쓰기는 남는다. 판을 올리기 전에 파일을 한 벌 복사해 둔다.
 */
export function openStore(log: (tag: string, ...rest: unknown[]) => void): {
  store: TodoStore;
  stats: StatStore;
  notes: NoteStore;
  events: EventStore;
  /** 다른 연결(펫 MCP 서버)이 쓰면 바뀌는 수. 바뀌었으면 화면을 다시 그린다 */
  dataVersion: () => number;
} {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'jjakkung.db');
  const existed = existsSync(file);
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma busy_timeout = 2000;');
  const from = schemaVersion(db as unknown as Db);
  if (existed && from > 0 && from < SCHEMA_VERSION) {
    db.exec('pragma wal_checkpoint(truncate)');
    copyFileSync(file, `${file}.bak-v${from}`);
    log('db', `판을 올리기 전 복사: ${from}판`);
  }
  const result = migrate(db as unknown as Db);
  if (result.from !== result.to) log('db', `저장 파일 ${result.from}판 → ${result.to}판`);
  app.on('will-quit', () => db.close());
  const d = db as unknown as Db;
  return {
    store: new TodoStore(d),
    stats: new StatStore(d),
    notes: new NoteStore(d),
    events: new EventStore(d),
    dataVersion: () =>
      Number((d.prepare('pragma data_version').get() as { data_version: number }).data_version),
  };
}
