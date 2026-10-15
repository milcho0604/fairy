// 기동 때 SQL 마이그레이션을 번호 순으로 한 번씩 적용한다 (db/migrations/*.sql).
// 적용 기록은 _migrations 표. 파일마다 트랜잭션이라 실패하면 그 파일은 되돌리고 서버는 뜨지 않는다.
// 두 컨테이너가 동시에 떠도 advisory lock 으로 한쪽만 적용한다.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const DIR = join(import.meta.dirname, '..', 'db', 'migrations');
const LOCK = 7_302_017; // 페어리 마이그레이션 잠금 번호 (아무 고정 수)

export async function migrate(databaseUrl, log = console.log) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query('SELECT name FROM _migrations')).rows.map((r) => r.name));
    const files = (await readdir(DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const name of files) {
      if (done.has(name)) continue;
      const sql = await readFile(join(DIR, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        log(`[migrate] ${name} 적용`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`[migrate] ${name} 실패: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[migrate] DATABASE_URL 이 비어 있다');
    process.exit(1);
  }
  migrate(url).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
