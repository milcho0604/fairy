import assert from 'node:assert/strict';
import { test } from 'node:test';
import { impactOf } from './admin-home';
import {
  formDefaults,
  noticeFields,
  noticeRow,
  type PostRow,
  postFilterOf,
  sortPosts,
  stateOf,
  versionRow,
} from './admin-posts';
import { type DocNotice, keepOmitted } from './notice-doc';

const row = (o: Partial<PostRow>): PostRow => ({
  kind: 'event',
  id: 'x',
  title: 't',
  sub: '',
  state: 'live',
  note: '',
  from: null,
  until: null,
  load: 'event:x',
  closable: true,
  ...o,
});

test('stateOf: 시작 전은 예정, 끝난 뒤는 끝남, 끝이 없으면 계속 진행 (#154)', () => {
  assert.equal(stateOf(100, 200, 300), 'soon');
  assert.equal(stateOf(200, 200, 300), 'live');
  assert.equal(stateOf(299, 200, 300), 'live');
  assert.equal(stateOf(300, 200, 300), 'ended');
  assert.equal(stateOf(10 ** 12, null, null), 'live');
  assert.equal(stateOf(5, null, 10), 'live');
});

test('sortPosts: 진행 중(곧 끝나는 것 먼저), 예정(곧 시작하는 것 먼저), 끝남(최근에 끝난 것 먼저)', () => {
  const sorted = sortPosts([
    row({ id: 'e-old', state: 'ended', until: 10 }),
    row({ id: 'e-new', state: 'ended', until: 90 }),
    row({ id: 's-late', state: 'soon', from: 500 }),
    row({ id: 's-early', state: 'soon', from: 200 }),
    row({ id: 'l-late', state: 'live', until: 800 }),
    row({ id: 'l-none', state: 'live', until: null }),
    row({ id: 'l-soon', state: 'live', until: 300 }),
  ]).map((r) => r.id);
  assert.deepEqual(sorted, ['l-soon', 'l-late', 'l-none', 's-early', 's-late', 'e-new', 'e-old']);
});

test('postFilterOf: 모르는 값은 모두로, 찾는 말은 60자까지 (#154)', () => {
  assert.deepEqual(postFilterOf({ pk: 'event', ps: 'ended', pq: '  신년 ' }), {
    kind: 'event',
    state: 'ended',
    q: '신년',
  });
  assert.deepEqual(postFilterOf({ pk: 'grant', ps: ['live'], pq: 3 }), { kind: 'all', state: 'all', q: '' });
  assert.equal(postFilterOf({ pq: 'a'.repeat(100) }).q.length, 60);
});

test('versionRow: 기준이 있으면 진행 중, 없으면 끝남(기준 없음)', () => {
  assert.equal(versionRow(undefined).state, 'ended');
  assert.equal(versionRow(undefined).note, '기준 없음');
  const live = versionRow({ version: 1, minVersion: '0.4.0', recommendVersion: '0.5.0', notices: [] });
  assert.equal(live.state, 'live');
  assert.equal(live.sub, '강제 0.4.0, 권장 0.5.0');
});

test('noticeRow: 기간으로 상태를 정한다', () => {
  const n: DocNotice = {
    id: 'n',
    kind: 'info',
    title: { ko: '가', en: 'a' },
    body: { ko: '나', en: 'b' },
    from: '2026-10-01T00:00:00+09:00',
    until: '2026-10-02T00:00:00+09:00',
  };
  assert.equal(noticeRow(n, Date.parse('2026-09-30T00:00:00+09:00')).state, 'soon');
  assert.equal(noticeRow(n, Date.parse('2026-10-01T12:00:00+09:00')).state, 'live');
  assert.equal(noticeRow(n, Date.parse('2026-10-03T00:00:00+09:00')).state, 'ended');
});

test('formDefaults: 시작은 다음 정시, 끝은 일주일과 30일 뒤 (한국 시간)', () => {
  const d = formDefaults(Date.parse('2026-10-23T05:20:00Z'));
  assert.equal(d.day, '20261023');
  assert.equal(d.start, '2026-10-23T15:00');
  assert.equal(d.weekLater, '2026-10-30T15:00');
  assert.equal(d.monthLater, '2026-11-22T15:00');
});

test('keepOmitted: 보내지 않은 칸만 기존 공지의 값을 지킨다, 비운 칸은 지운다 (#154)', () => {
  const old: DocNotice = {
    id: 'n',
    kind: 'info',
    title: { ko: '가', en: 'a' },
    body: { ko: '나', en: 'b' },
    link: 'https://fairy.moilga.com/x',
    from: '2026-10-01T00:00:00+09:00',
    until: '2026-10-02T00:00:00+09:00',
    versions: '<0.9.0',
    platforms: ['darwin', 'win32'],
  };
  const sent = { id: 'n', kind: 'info', title_ko: 'x' };
  const kept = keepOmitted(sent, old);
  assert.equal(kept.versions, '<0.9.0');
  assert.equal(kept.platforms, 'darwin,win32');
  assert.equal(kept.from, old.from);
  assert.equal(kept.until, old.until);
  assert.equal(kept.link, old.link);
  assert.equal(kept.title_ko, 'x');
  const cleared = keepOmitted({ ...sent, versions: '', platforms: '', from: '', until: '', link: '' }, old);
  for (const k of ['versions', 'platforms', 'from', 'until', 'link']) assert.equal(cleared[k], '', k);
  assert.deepEqual(keepOmitted(sent, undefined), sent);
});

test('noticeFields: 불러온 공지가 폼 칸으로 되돌아간다', () => {
  const f = noticeFields({
    id: 'n',
    kind: 'update',
    title: { ko: '가', en: 'a' },
    body: { ko: '나', en: 'b' },
    from: '2026-10-01T09:00:00+09:00',
    platforms: ['linux'],
  });
  assert.equal(f.from, '2026-10-01T09:00');
  assert.equal(f.until, '');
  assert.equal(f.platforms, 'linux');
});

test('impactOf: 잠기는 인원, 기능만 막히는 인원, 권장 알림 대상을 세고 판을 모르면 0.0.0 (#154)', () => {
  const rows = [
    { v: '0.3.0', n: 3 },
    { v: '0.4.0', n: 2 },
    { v: '0.5.0', n: 5 },
    { v: null, n: 1 },
    { v: 'abc', n: 1 },
  ];
  const x = impactOf(rows, { min: '0.4.0', restrict: '0.4.5', recommend: '0.5.0' });
  assert.equal(x.active, 12);
  assert.equal(x.locked, 3 + 1 + 1);
  assert.equal(x.restricted, 2);
  assert.equal(x.recommended, 3 + 2 + 1 + 1);
  assert.equal(x.unknown, 2);
  assert.deepEqual([impactOf(rows, {}).locked, impactOf(rows, {}).recommended], [0, 0]);
});
