import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCalendarId, GCAL_PRIMARY } from './gcal.ts';
import {
  CALLIST_FIELDS,
  calendarListPath,
  calendarRows,
  calKind,
  canPush,
  cleanChoice,
  DEFAULT_CHOICE,
  type GcalCalendar,
  listState,
  parseCalendarList,
} from './gcal-cals.ts';

// 가짜 구글 캘린더 목록 (calendarList.list 의 items)
const LIST = [
  {
    id: 'me@gmail.com',
    summary: 'me@gmail.com',
    summaryOverride: '내 캘린더',
    backgroundColor: '#9fe1e7',
    accessRole: 'owner',
    primary: true,
  },
  {
    id: 'family123@group.calendar.google.com',
    summary: '가족',
    backgroundColor: '#f691b2',
    accessRole: 'writer',
  },
  { id: 'friend@gmail.com', summary: '친구', backgroundColor: '#cca6ac', accessRole: 'reader' },
  {
    id: 'notice@group.calendar.google.com',
    summary: '회사 공지',
    backgroundColor: '#ac725e',
    accessRole: 'reader',
    hidden: true,
  },
  {
    id: 'ko.south_korea#holiday@group.v.calendar.google.com',
    summary: '대한민국 공휴일',
    backgroundColor: '#16a765',
    accessRole: 'reader',
  },
  { id: 'busy@gmail.com', summary: '바쁨만', accessRole: 'freeBusyReader' },
  { id: '../../x', summary: '이상한 id', accessRole: 'owner' },
  { summary: 'id 없음', accessRole: 'owner' },
  null,
];

test('캘린더 목록 경로: 내 목록, 읽을 수 있는 것만, 받을 칸만', () => {
  const u = new URL(`https://x${calendarListPath()}`);
  assert.equal(u.pathname, '/users/me/calendarList');
  assert.equal(u.searchParams.get('minAccessRole'), 'reader');
  assert.equal(u.searchParams.get('fields'), CALLIST_FIELDS);
  for (const f of [
    'id',
    'summary',
    'summaryOverride',
    'backgroundColor',
    'accessRole',
    'primary',
    'selected',
    'hidden',
  ])
    assert.match(CALLIST_FIELDS, new RegExp(`\\b${f}\\b`));
  assert.equal(new URL(`https://x${calendarListPath('p2')}`).searchParams.get('pageToken'), 'p2');
});

test('캘린더 목록 읽기: 기본 캘린더는 primary 로, 이름은 바꾼 이름 먼저, 이상한 것은 뺀다', () => {
  const cals = parseCalendarList(LIST);
  assert.deepEqual(
    cals.map((c) => [c.id, c.name, c.role, c.color]),
    [
      [GCAL_PRIMARY, '내 캘린더', 'owner', '#9fe1e7'],
      ['family123@group.calendar.google.com', '가족', 'writer', '#f691b2'],
      ['friend@gmail.com', '친구', 'reader', '#cca6ac'],
      ['notice@group.calendar.google.com', '회사 공지', 'reader', '#ac725e'],
      ['ko.south_korea#holiday@group.v.calendar.google.com', '대한민국 공휴일', 'reader', '#16a765'],
    ],
  );
  assert.equal(cals[0]?.primary, true);
  assert.equal(cals[3]?.hidden, true);
  // 공휴일 캘린더 id 에는 # 가 든다
  assert.equal(
    cleanCalendarId('ko.south_korea#holiday@group.v.calendar.google.com'),
    'ko.south_korea#holiday@group.v.calendar.google.com',
  );
  assert.equal(cleanCalendarId('a@b.com/events'), undefined);
});

test('캘린더 종류와 보내기: 내 것, 공유(쓰기 가능), 읽기만. 읽기만은 보낼 수 없다', () => {
  const [mine, family, friend] = parseCalendarList(LIST) as [GcalCalendar, GcalCalendar, GcalCalendar];
  assert.equal(calKind(mine), 'mine');
  assert.equal(calKind(family), 'shared');
  assert.equal(calKind(friend), 'readOnly');
  assert.equal(canPush(mine), true);
  assert.equal(canPush(family), true);
  assert.equal(canPush(friend), false);
  // 목록에 없는 직접 넣은 캘린더는 모른다: 막지 않는다 (구글이 거절하면 캘린더 문제로 알린다)
  assert.equal(canPush(undefined), true);
});

test('고른 것 다듬기: 기본은 기본 캘린더 가져오기와 보내기, 읽기만 캘린더로 보내기는 거절', () => {
  const cals = parseCalendarList(LIST);
  assert.deepEqual(DEFAULT_CHOICE, { pull: [GCAL_PRIMARY], push: GCAL_PRIMARY });
  assert.deepEqual(
    cleanChoice(
      {
        pull: ['primary', 'friend@gmail.com', 'friend@gmail.com', 'bad id'],
        push: 'family123@group.calendar.google.com',
      },
      cals,
    ),
    { pull: [GCAL_PRIMARY, 'friend@gmail.com'], push: 'family123@group.calendar.google.com' },
  );
  assert.deepEqual(cleanChoice({ pull: [], push: null }, cals), { pull: [], push: null });
  assert.equal(cleanChoice({ pull: ['primary'], push: 'friend@gmail.com' }, cals), undefined);
  assert.equal(cleanChoice({ pull: ['primary'], push: 'not an id' }, cals), undefined);
  assert.equal(cleanChoice('x', cals), undefined);
  assert.equal(
    cleanChoice({ pull: Array.from({ length: 40 }, (_, i) => `c${i}@x.com`), push: null }, cals)?.pull.length,
    25,
  );
});

test('옵션 창 줄: 목록 + 목록에 없는 직접 넣은 캘린더. 목록이 없으면(예전 연결) 기본 캘린더와 직접 넣은 것만', () => {
  const cals = parseCalendarList(LIST);
  const rows = calendarRows({ calendars: cals, pull: ['primary', 'extra@x.com'], push: 'primary' });
  assert.deepEqual(
    rows.map((r) => [r.id, r.pull, r.push, r.canPush]),
    [
      ['primary', true, true, true],
      ['family123@group.calendar.google.com', false, false, true],
      ['friend@gmail.com', false, false, false],
      ['notice@group.calendar.google.com', false, false, false],
      ['ko.south_korea#holiday@group.v.calendar.google.com', false, false, false],
      ['extra@x.com', true, false, true],
    ],
  );
  const legacy = calendarRows({ calendars: null, pull: ['work@x.com'], push: 'work@x.com' });
  assert.deepEqual(
    legacy.map((r) => [r.id, r.pull, r.push]),
    [
      ['primary', false, false],
      ['work@x.com', true, true],
    ],
  );
});

test('예전 연결(캘린더 목록 권한 없음)이면 목록 대신 다시 연결 안내', () => {
  assert.equal(listState({ connected: false, listScope: null, calendars: null }), 'off');
  assert.equal(listState({ connected: true, listScope: false, calendars: null }), 'relink');
  assert.equal(
    listState({ connected: true, listScope: false, calendars: parseCalendarList(LIST) }),
    'relink',
  );
  assert.equal(listState({ connected: true, listScope: true, calendars: null }), 'loading');
  assert.equal(listState({ connected: true, listScope: null, calendars: null }), 'loading');
  assert.equal(listState({ connected: true, listScope: true, calendars: [] }), 'ready');
});
