// 동기화 기록을 남기지 않고 쓰기. app_meta 의 sync_applying 이 '1' 이면 24판 트리거가 아무것도 적지 않는다.
// 기계적 고침(시간대 맞춤, 시계 점프 보정 등)과 다른 기기 변경 적용이 쓴다. 표식은 같은 묶음(savepoint) 안에서만 켜고 끈다.
import type { Db } from './db-schema.ts';
import { SYNC_META_APPLYING } from './sync-fields.ts';

export function quietly<T>(db: Db, fn: () => T): T {
  db.exec('savepoint sync_quiet');
  try {
    const prior = db.prepare('select value from app_meta where key = ?').get(SYNC_META_APPLYING) as
      | { value: string }
      | undefined;
    db.prepare('insert or replace into app_meta (key, value) values (?, ?)').run(SYNC_META_APPLYING, '1');
    const result = fn();
    if (prior)
      db.prepare('insert or replace into app_meta (key, value) values (?, ?)').run(
        SYNC_META_APPLYING,
        prior.value,
      );
    else db.prepare('delete from app_meta where key = ?').run(SYNC_META_APPLYING);
    db.exec('release sync_quiet');
    return result;
  } catch (err) {
    db.exec('rollback to sync_quiet');
    db.exec('release sync_quiet');
    throw err;
  }
}

/**
 * 앱이 켜질 때 남아 있는 표식을 지운다. 표식은 한 묶음 안에서만 켜므로 저장된 채 보이는 '1' 은 낡은 것이다.
 * 지운 것이 있으면 true
 */
export function clearStaleApplying(db: Db): boolean {
  if (!db.prepare('select 1 from app_meta where key = ?').get(SYNC_META_APPLYING)) return false;
  db.prepare('delete from app_meta where key = ?').run(SYNC_META_APPLYING);
  return true;
}
