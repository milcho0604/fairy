import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyViewKeep, freshViewKeep, parseViewKeep, restoredEventDay, VIEW_KEEP_MS } from './view-keep.ts';

const NOW = 1_000_000_000_000;

test('틀린 값은 기본값으로 읽는다', () => {
  assert.deepEqual(parseViewKeep(undefined, NOW), emptyViewKeep());
  assert.deepEqual(parseViewKeep('x', NOW), emptyViewKeep());
  const v = parseViewKeep(
    {
      todo: { finding: 'yes', query: 7, tag: '', pages: -3 },
      event: { day: '내일' },
      scroll: { a: -5, b: 'x' },
    },
    NOW,
  );
  assert.equal(v.todo.finding, false);
  assert.equal(v.todo.query, '');
  assert.equal(v.todo.tag, null);
  assert.equal(v.todo.pages, 1);
  assert.equal(v.event.day, null);
  assert.deepEqual(v.scroll, {});
  assert.equal(v.at, NOW);
});

test('좋은 값은 그대로, 긴 값은 자른다', () => {
  const v = parseViewKeep(
    {
      todo: { finding: true, query: 'ㄱ'.repeat(500), tag: 'work', showDone: true, pageKey: 'k', pages: 3 },
      event: { day: '2026-10-22', today: '2026-10-21' },
      scroll: { todo: 240.4, eventCal: 80 },
    },
    NOW,
  );
  assert.equal(v.todo.query.length, 200);
  assert.deepEqual(
    { ...v.todo, query: '' },
    { finding: true, query: '', tag: 'work', showDone: true, pageKey: 'k', pages: 3 },
  );
  assert.deepEqual(v.event, { day: '2026-10-22', today: '2026-10-21' });
  assert.deepEqual(v.scroll, { todo: 240.4, eventCal: 80 });
});

test('스크롤 칸은 여덟 개까지만 받는다', () => {
  const scroll = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 10]));
  assert.equal(Object.keys(parseViewKeep({ scroll }, NOW).scroll).length, 8);
});

test('한 시간이 지나면 잊는다', () => {
  const kept = parseViewKeep({ todo: { query: '보고서' } }, NOW);
  assert.equal(freshViewKeep(kept, NOW + VIEW_KEEP_MS).todo.query, '보고서');
  assert.equal(freshViewKeep(kept, NOW + VIEW_KEEP_MS + 1).todo.query, '');
  assert.equal(freshViewKeep(emptyViewKeep(), NOW).todo.query, '');
});

test('일정에서 고른 날: 없으면 오늘, 자정을 넘기면 오늘을 고르던 사람은 새 오늘', () => {
  assert.equal(restoredEventDay({ day: null, today: null }, '2026-10-21'), '2026-10-21');
  assert.equal(restoredEventDay({ day: '2026-10-25', today: '2026-10-21' }, '2026-10-22'), '2026-10-25');
  assert.equal(restoredEventDay({ day: '2026-10-21', today: '2026-10-21' }, '2026-10-22'), '2026-10-22');
  assert.equal(restoredEventDay({ day: '2026-10-21', today: '2026-10-21' }, '2026-10-21'), '2026-10-21');
});
