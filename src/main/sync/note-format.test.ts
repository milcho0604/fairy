// 메모 형식(format)이 기기 사이를 오가는 길: 두 기기, 형식 칸이 없는 옛 앱의 항목, 충돌 사본
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeItems, type SyncItem } from '../../shared/sync-item.ts';
import { FakeSyncServer, pair, settle, spin } from './harness.ts';
import { applyItem, readItem } from './rows.ts';

const fmtOf = (db: { prepare(sql: string): { get(...a: unknown[]): unknown } }, title: string): string =>
  (db.prepare('select format from note where title = ?').get(title) as { format: string }).format;
const uidOf = (db: { prepare(sql: string): { get(...a: unknown[]): unknown } }, title: string): string =>
  (db.prepare('select uid from note where title = ?').get(title) as { uid: string }).uid;

test('형식은 기기 사이를 오가고 글은 건드리지 않는다 (md 로 만들고, 다른 기기에서 txt 로 바꿈)', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '마크다운', body: '# 제목\n- 하나', format: 'md' }, Date.now());
  a.notes.add({ title: '그냥 글', body: '# 이건 글자 그대로' }, Date.now());
  await settle([a, b]);
  assert.equal(fmtOf(b.db, '마크다운'), 'md');
  assert.equal(fmtOf(b.db, '그냥 글'), 'txt');
  const bid = (b.db.prepare('select id from note where title = ?').get('마크다운') as { id: number }).id;
  spin();
  b.notes.setFormat(bid, 'txt');
  await settle([a, b]);
  assert.equal(fmtOf(a.db, '마크다운'), 'txt');
  assert.equal(
    (a.db.prepare('select body from note where title = ?').get('마크다운') as { body: string }).body,
    '# 제목\n- 하나',
  );
});

test('보낼 항목에 format 칸과 칸 시각이 든다', () => {
  const server = new FakeSyncServer();
  return pair(server).then(({ a }) => {
    a.notes.add({ title: '메모', body: 'x', format: 'md' }, Date.now());
    const it = readItem(a.db, 'note', uidOf(a.db, '메모'), { id: 'dev-a' });
    assert.equal(it?.f.format, 'md');
    assert.equal(typeof it?.c.format, 'number');
    assert.ok((it?.c.format ?? 0) > 0);
  });
});

test('형식 칸이 없는 항목(옛 앱)은 새 메모면 txt 로 쓰고, 이미 있는 메모의 형식은 지우지 않는다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  a.notes.add({ title: '메모', body: '# 글', format: 'md' }, Date.now());
  const uid = uidOf(a.db, '메모');
  const full = readItem(a.db, 'note', uid, { id: 'dev-a' }) as SyncItem;
  // 옛 앱이 보낸 모양: format 칸도, 그 칸 시각도 없다
  const { format: _f, ...f } = full.f;
  const { format: _c, ...c } = full.c;
  const old: SyncItem = { ...full, f, c };

  // 새 메모로 받으면 txt
  assert.equal(applyItem(b.db, old, { now: 1 }), 'ok');
  assert.equal(fmtOf(b.db, '메모'), 'txt');

  // 이미 md 인 메모에 형식 없는 항목을 덮어써도 md 그대로 (합친 항목이 형식을 들고 있고, 칸이 없어도 가진 값을 지킨다)
  b.notes.setFormat((b.db.prepare('select id from note').get() as { id: number }).id, 'md');
  assert.equal(applyItem(b.db, old, { now: 2 }), 'ok');
  assert.equal(fmtOf(b.db, '메모'), 'md');
});

test('합치기: 한쪽에 형식 칸이 없으면 있는 쪽이 남고, 둘 다 있으면 칸 시각이 큰 쪽', () => {
  const base = (f: Record<string, string | number | null>, c: Record<string, number>): SyncItem => ({
    kind: 'note',
    uid: 'u1',
    f: { title: 't', body: 'b', ...f },
    c: { title: 1, body: 1, ...c },
    dev: 'x',
  });
  const withFormat = base({ format: 'md' }, { format: 5 });
  const without = base({}, {});
  assert.equal(mergeItems(withFormat, without, undefined).item.f.format, 'md');
  assert.equal(mergeItems(without, withFormat, undefined).item.f.format, 'md');
  assert.equal(mergeItems(without, withFormat, undefined).changed.includes('format'), true);
  // 늦게 바꾼 쪽이 이긴다
  const later = base({ format: 'txt' }, { format: 9 });
  assert.equal(mergeItems(withFormat, later, undefined).item.f.format, 'txt');
  assert.equal(mergeItems(later, withFormat, undefined).item.f.format, 'txt');
});

test('충돌 사본은 원본의 형식을 따라간다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '일기', body: '# 오늘은 맑음', format: 'md' }, Date.now());
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
    const rows = d.db.prepare('select title, format from note order by id').all() as {
      title: string;
      format: string;
    }[];
    assert.equal(rows.length, 2, d.name);
    for (const r of rows) assert.equal(r.format, 'md', `${d.name} ${r.title}`);
  }
});

test('본문을 덧붙여 합치는 길(mergeNoteText)은 형식과 상관없이 그대로 돈다', async () => {
  const server = new FakeSyncServer();
  const { a, b } = await pair(server);
  const n = a.notes.add({ title: '목록', body: '- 하나', format: 'md' }, Date.now());
  await settle([a, b]);
  const bid = (b.db.prepare('select id from note where title = ?').get('목록') as { id: number }).id;
  spin();
  a.notes.update(n.id, { body: '- 하나\n- A 가 덧붙임' }, Date.now());
  spin();
  b.notes.update(bid, { body: '- 하나\n- B 가 덧붙임' }, Date.now());
  await a.engine.run(true);
  await b.engine.run(true);
  await settle([a, b]);
  for (const d of [a, b]) {
    const rows = d.db.prepare('select body, format from note').all() as { body: string; format: string }[];
    assert.equal(rows.length, 1, d.name);
    assert.equal(rows[0]?.format, 'md');
    assert.match(rows[0]?.body ?? '', /A 가 덧붙임/);
    assert.match(rows[0]?.body ?? '', /B 가 덧붙임/);
  }
});
