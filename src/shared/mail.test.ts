import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countsOf,
  firstLine,
  groupMail,
  inFilter,
  type MailItem,
  searchMail,
  sortMail,
  unreadCount,
} from './mail.ts';

const mk = (id: string, over: Partial<MailItem> = {}): MailItem => ({
  id,
  source: 'local',
  kind: 'daily',
  title: `쪽지 ${id}`,
  preview: '',
  lines: ['안녕'],
  look: 'note',
  read: false,
  archived: false,
  pinned: false,
  deleted: false,
  at: 1,
  day: '2026-10-28',
  removable: true,
  canUnread: true,
  ...over,
});

test('필터: 전체와 안 읽음은 보관, 지운 것을 뺀다. 보관함과 휴지통은 따로', () => {
  const live = mk('a');
  const read = mk('b', { read: true });
  const arch = mk('c', { archived: true });
  const del = mk('d', { deleted: true });
  const delArch = mk('e', { deleted: true, archived: true });
  assert.deepEqual(
    [live, read, arch, del, delArch].filter((m) => inFilter(m, 'all')).map((m) => m.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    [live, read, arch, del].filter((m) => inFilter(m, 'unread')).map((m) => m.id),
    ['a'],
  );
  assert.deepEqual(
    [live, arch, del, delArch].filter((m) => inFilter(m, 'archived')).map((m) => m.id),
    ['c'],
  );
  assert.deepEqual(
    [live, arch, del, delArch].filter((m) => inFilter(m, 'trash')).map((m) => m.id),
    ['d', 'e'],
  );
});

test('종류 묶음: 펫 편지, 운영자, 친구, 공지', () => {
  const by = (kind: MailItem['kind']) => mk('x', { kind, source: kind === 'daily' ? 'local' : 'server' });
  for (const k of ['daily', 'letter', 'week', 'evening'] as const) assert.ok(inFilter(by(k), 'letter'), k);
  for (const k of ['grant', 'notice', 'subscription'] as const) assert.ok(inFilter(by(k), 'operator'), k);
  for (const k of ['gift', 'friend', 'gift_back'] as const) assert.ok(inFilter(by(k), 'friend'), k);
  assert.ok(inFilter(by('announce'), 'notice'));
  assert.ok(!inFilter(by('grant'), 'letter'));
  assert.ok(!inFilter(mk('x', { kind: 'announce', archived: true }), 'notice'));
});

test('안 읽음 수(배지)는 전체 목록에서 보이는 안 읽은 쪽지와 같다: 보관, 지움은 안 센다', () => {
  const items = [
    mk('a'),
    mk('b'),
    mk('c'),
    mk('d', { archived: true }),
    mk('e', { deleted: true }),
    mk('f', { read: true }),
  ];
  assert.equal(unreadCount(items), 3);
  assert.equal(items.filter((m) => inFilter(m, 'unread')).length, unreadCount(items));
  const c = countsOf(items);
  assert.equal(c.all, 4);
  assert.equal(c.unread, 3);
  assert.equal(c.archived, 1);
  assert.equal(c.trash, 1);
  assert.equal(c.letter, 4);
});

test('찾기: 제목과 본문에서, 대소문자와 풀린 한글을 가리지 않는다', () => {
  const items = [
    mk('a', { title: 'Weekly 회의', lines: ['안건'] }),
    mk('b', { title: '쪽지', lines: ['오늘 첫 일정은 점심 약속'] }),
    mk('c', { title: '다른 글', lines: ['없음'] }),
  ];
  assert.deepEqual(
    searchMail(items, 'weekly').map((m) => m.id),
    ['a'],
  );
  assert.deepEqual(
    searchMail(items, '점심').map((m) => m.id),
    ['b'],
  );
  assert.deepEqual(
    searchMail(items, '점심'.normalize('NFD')).map((m) => m.id),
    ['b'],
  );
  assert.deepEqual(
    searchMail(items, '  ').map((m) => m.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(searchMail(items, '없는말'), []);
});

test('정렬: 고정이 먼저, 그다음 받은 시각 최근 것이 앞', () => {
  const items = [mk('a', { at: 1 }), mk('b', { at: 3 }), mk('c', { at: 2, pinned: true })];
  assert.deepEqual(
    sortMail(items).map((m) => m.id),
    ['c', 'b', 'a'],
  );
});

test('날짜 묶음: 고정, 오늘, 이번 주(월요일부터), 이번 달, 이전. 빈 묶음은 없다', () => {
  // 2026-10-28 은 수요일, 그 주 월요일은 10-26
  const today = '2026-10-28';
  const items = [
    mk('p', { pinned: true, day: '2026-01-01', at: 9 }),
    mk('t', { day: '2026-10-28', at: 8 }),
    mk('w', { day: '2026-10-26', at: 7 }),
    mk('m', { day: '2026-10-20', at: 6 }),
    mk('o', { day: '2026-09-30', at: 5 }),
    mk('o2', { day: '2025-10-28', at: 4 }),
  ];
  const g = groupMail(items, today);
  assert.deepEqual(
    g.map((x) => x.id),
    ['pinned', 'today', 'week', 'month', 'older'],
  );
  assert.deepEqual(
    g.find((x) => x.id === 'older')?.items.map((m) => m.id),
    ['o', 'o2'],
  );
  assert.deepEqual(
    groupMail([mk('t', { day: today })], today).map((x) => x.id),
    ['today'],
  );
  assert.deepEqual(groupMail([], today), []);
  // 월요일이 지난 달이어도 이번 주가 먼저다 (2026-11-02 월 기준 10-30 은 지난주)
  assert.deepEqual(
    groupMail([mk('x', { day: '2026-10-30' })], '2026-11-02').map((x) => x.id),
    ['older'],
  );
});

test('첫 줄: 빈 줄을 건너뛰고 한 줄로, 길면 말줄임', () => {
  assert.equal(firstLine(['', '  첫   줄  ', '둘째']), '첫 줄');
  assert.equal(firstLine([]), '');
  const long = firstLine(['가'.repeat(100)], 10);
  assert.equal([...long].length, 10);
  assert.ok(long.endsWith('…'));
});
