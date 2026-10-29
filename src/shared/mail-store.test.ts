import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import { MAIL_LOCAL_MAX, MAIL_TRASH_DAYS, type MailPut, MailStore } from './mail-store.ts';

const DAY = 86_400_000;
const fresh = () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return new MailStore(db);
};
const put = (id: string, at: number, over: Partial<MailPut> = {}): MailPut => ({
  id,
  source: 'local',
  kind: 'daily',
  day: '2026-10-28',
  at,
  look: 'note',
  milestone: null,
  coins: null,
  payload: { lines: [{ key: 'note.open', vars: { p: 'friend', v: 1 } }] },
  ...over,
});

test('쪽지를 넣고 읽는다: 최근 것이 앞, 줄 글과 값이 그대로 돌아온다', () => {
  const s = fresh();
  s.put(put('2026-10-27', 1000));
  s.put(put('2026-10-28', 2000, { kind: 'letter', look: 'letter', milestone: 7, coins: 5 }));
  const all = s.all();
  assert.deepEqual(
    all.map((r) => r.id),
    ['2026-10-28', '2026-10-27'],
  );
  const a = all[0];
  assert.equal(a?.kind, 'letter');
  assert.equal(a?.look, 'letter');
  assert.equal(a?.milestone, 7);
  assert.equal(a?.coins, 5);
  assert.deepEqual(a?.payload, { lines: [{ key: 'note.open', vars: { p: 'friend', v: 1 } }] });
  assert.equal(a?.readAt, null);
  assert.equal(s.get('nope'), undefined);
});

test('다시 넣으면 내용만 바뀌고 읽음, 보관, 지움, 고정은 그대로다', () => {
  const s = fresh();
  s.put(put('a', 1000));
  s.setRead('a', 5);
  s.setArchived('a', 6);
  s.setPinned('a', 7);
  s.setDeleted('a', 8);
  s.put(put('a', 2000, { payload: { lines: [] }, kind: 'week', readAt: null }));
  const r = s.get('a');
  assert.deepEqual([r?.readAt, r?.archivedAt, r?.pinnedAt, r?.deletedAt], [5, 6, 7, 8]);
  assert.equal(r?.kind, 'week');
  assert.equal(r?.at, 2000);
});

test('처음 넣을 때만 읽음을 줄 수 있다 (옛 파일에서 옮길 때 읽은 쪽지는 읽은 채로)', () => {
  const s = fresh();
  s.put(put('a', 1, { readAt: 99 }));
  assert.equal(s.get('a')?.readAt, 99);
  s.put(put('a', 1, { readAt: null }));
  assert.equal(s.get('a')?.readAt, 99);
});

test('읽음, 안 읽음, 모두 읽음 (이미 읽은 것은 시각을 안 바꾼다)', () => {
  const s = fresh();
  for (const id of ['a', 'b', 'c']) s.put(put(id, 1));
  assert.equal(s.setRead('a', 10), true);
  assert.equal(s.setRead('none', 10), false);
  assert.equal(s.readAll(['a', 'b', 'c', 'none'], 20), 2);
  assert.equal(s.get('a')?.readAt, 10);
  assert.equal(s.get('b')?.readAt, 20);
  s.setRead('b', null);
  assert.equal(s.get('b')?.readAt, null);
});

test('휴지통: 지운 쪽지는 30일 뒤 영구 삭제, 되살리면 남는다', () => {
  const s = fresh();
  s.put(put('old', 1));
  s.put(put('new', 2));
  s.put(put('keep', 3));
  const now = 1000 * DAY;
  s.setDeleted('old', now - (MAIL_TRASH_DAYS + 1) * DAY);
  s.setDeleted('new', now - (MAIL_TRASH_DAYS - 1) * DAY);
  s.setDeleted('keep', now - (MAIL_TRASH_DAYS + 5) * DAY);
  s.setDeleted('keep', null);
  assert.deepEqual(s.tidy(now), { purged: 1, trashed: 0 });
  assert.equal(s.get('old'), undefined);
  assert.ok(s.get('new'));
  assert.ok(s.get('keep'));
});

test('이 컴퓨터 쪽지가 상한을 넘으면 가장 오래된 읽은 것부터 휴지통으로 (고정, 보관, 안 읽음은 남긴다)', () => {
  const s = fresh();
  const n = MAIL_LOCAL_MAX + 3;
  for (let i = 0; i < n; i++) {
    s.put(put(`m${String(i).padStart(5, '0')}`, i + 1));
    s.setRead(`m${String(i).padStart(5, '0')}`, 1);
  }
  s.setPinned('m00000', 1);
  s.setArchived('m00001', 1);
  s.setRead('m00002', null);
  const r = s.tidy(10 * DAY);
  assert.equal(r.trashed, 3);
  // 가장 오래된 것은 고정, 보관, 안 읽음이라 건너뛰고 그다음 것들
  assert.equal(s.get('m00000')?.deletedAt, null);
  assert.equal(s.get('m00001')?.deletedAt, null);
  assert.equal(s.get('m00002')?.deletedAt, null);
  assert.ok(s.get('m00003')?.deletedAt);
  assert.ok(s.get('m00005')?.deletedAt);
  assert.equal(s.get('m00006')?.deletedAt, null);
});

test('서버 쪽지는 상한에 안 들고, 서버 목록에서 사라진 것은 정리한다', () => {
  const s = fresh();
  s.put(put('inbox:1', 100, { source: 'server', kind: 'grant' }));
  s.put(put('inbox:2', 200, { source: 'server', kind: 'grant' }));
  s.put(put('inbox:3', 50, { source: 'server', kind: 'grant' }));
  s.put(put('2026-10-28', 300));
  // 서버가 준 쪽 (at >= 100) 에서 inbox:1 만 남았다
  assert.equal(s.dropServerNotIn(new Set(['inbox:1']), 100), 1);
  assert.ok(s.get('inbox:1'));
  assert.equal(s.get('inbox:2'), undefined);
  assert.ok(s.get('inbox:3'), '받은 쪽보다 오래된 것은 건드리지 않는다');
  assert.ok(s.get('2026-10-28'), '펫 쪽지는 건드리지 않는다');
});

test('특별한 편지 날 수는 따로 기억한다 (편지를 지워도 다시 주지 않게)', () => {
  const s = fresh();
  assert.deepEqual(s.marks(), []);
  s.setMarks([7, 30, 7]);
  assert.deepEqual(s.marks(), [7, 30]);
  s.setMeta('marks', 'broken');
  assert.deepEqual(s.marks(), []);
  assert.equal(s.meta('nothing'), undefined);
});

test('깨진 글 칸이 있어도 목록은 읽힌다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  db.prepare(
    "insert into mail (id, source, kind, day, at, look, payload) values ('x', 'weird', 'weird', '2026-10-28', 1, 'note', '{not json')",
  ).run();
  const r = new MailStore(db).get('x');
  assert.equal(r?.source, 'local');
  assert.equal(r?.kind, 'daily');
  assert.equal(r?.payload, null);
});
