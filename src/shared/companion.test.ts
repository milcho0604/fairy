import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANNIV_LATE_DAYS,
  anniversaryDue,
  completionCheer,
  dayNumber,
  FRIEND_TALKS,
  friendTalk,
  parseMemory,
  weekDays,
} from './companion.ts';
import { dicts, setLang, t } from './i18n/index.ts';

const none = new Set<string>();

test('끝낸 일 축하: 오늘 마감을 다 끝냄이 먼저, 그다음 연속 기록, 5/10/20개째', () => {
  const base = { doneToday: 2, doneDueToday: 1, openDueToday: 1, streak: 1 };
  assert.equal(completionCheer(base, none), undefined);
  assert.equal(completionCheer({ ...base, openDueToday: 0 }, none)?.kind, 'clear');
  // 마감 있는 일을 하나도 안 끝냈으면 (마감 없는 일만) 다 끝냄이 아니다
  assert.equal(completionCheer({ ...base, doneDueToday: 0, openDueToday: 0 }, none), undefined);
  assert.deepEqual(completionCheer({ ...base, doneToday: 1, streak: 4 }, none), {
    id: 'streak',
    kind: 'streak',
    key: 'companion.cheer.streak',
    n: 4,
  });
  // 연속 1일(오늘만)은 축하하지 않는다
  assert.equal(completionCheer({ ...base, doneToday: 1, streak: 1 }, none), undefined);
  assert.equal(completionCheer({ ...base, doneToday: 5 }, none)?.id, 'count-5');
  assert.equal(completionCheer({ ...base, doneToday: 10 }, none)?.n, 10);
  assert.equal(completionCheer({ ...base, doneToday: 6 }, none), undefined);
});

test('끝낸 일 축하는 그날 한 번씩: 이미 한 것은 건너뛰고 다음 것을', () => {
  const f = { doneToday: 5, doneDueToday: 3, openDueToday: 0, streak: 3 };
  assert.equal(completionCheer(f, none)?.id, 'clear');
  assert.equal(completionCheer(f, new Set(['clear']))?.id, 'count-5');
  assert.equal(completionCheer(f, new Set(['clear', 'count-5'])), undefined);
});

test('처음 만난 날이 1일째', () => {
  assert.equal(dayNumber('2026-10-10', '2026-10-10'), 1);
  assert.equal(dayNumber('2026-10-01', '2026-10-10'), 10);
  assert.equal(dayNumber('2025-12-31', '2026-01-01'), 2);
  // 서머타임과 상관없이 날로 센다
  assert.equal(dayNumber('2026-03-01', '2026-04-01'), 32);
});

test('만난 날 기념: 그날, 늦어도 3일 안, 한 번만, 오래 쓴 사람에게 지난 것을 몰아 말하지 않는다', () => {
  assert.equal(anniversaryDue(6, []), undefined);
  assert.deepEqual(anniversaryDue(7, []), { mark: 7, key: 'companion.anniv.day', n: 7 });
  assert.deepEqual(anniversaryDue(100, [7, 30, 50]), { mark: 100, key: 'companion.anniv.day', n: 100 });
  assert.deepEqual(anniversaryDue(102, []), { mark: 100, key: 'companion.anniv.late', n: 100 });
  assert.equal(anniversaryDue(100 + ANNIV_LATE_DAYS + 1, []), undefined);
  assert.equal(anniversaryDue(100, [100]), undefined);
  assert.equal(anniversaryDue(250, []), undefined);
  assert.deepEqual(anniversaryDue(365, []), { mark: 365, key: 'companion.anniv.year', n: 1 });
  assert.deepEqual(anniversaryDue(731, [365]), { mark: 730, key: 'companion.anniv.year', n: 2 });
  assert.equal(anniversaryDue(731, [730]), undefined);
  assert.equal(anniversaryDue(0, []), undefined);
  assert.equal(anniversaryDue(Number.NaN, []), undefined);
});

test('친구 수다: 쌍 열쇠가 사전에 있고 바로 앞 쌍은 다시 고르지 않는다', () => {
  for (let i = 1; i <= FRIEND_TALKS; i++) {
    assert.ok(`companion.friend.${i}.a` in dicts.ko);
    assert.ok(`companion.friend.${i}.b` in dicts.ko);
  }
  const seen = new Set<number>();
  for (let r = 0; r < 1; r += 0.05) {
    const p = friendTalk(() => r, 3);
    assert.notEqual(p.index, 3);
    assert.equal(p.a, `companion.friend.${p.index}.a`);
    seen.add(p.index);
  }
  assert.equal(seen.size, FRIEND_TALKS - 1);
  assert.equal(friendTalk(() => 0.9999).index, FRIEND_TALKS);
});

test('친구 수다 글: 이름에 맞는 부름말', () => {
  setLang('ko');
  assert.equal(t('companion.friend.1.a', { name: '콩이', friend: '밤' }), '밤아, 오늘 뭐 했어?');
  assert.equal(t('companion.friend.1.a', { name: '콩이', friend: '냥이' }), '냥이야, 오늘 뭐 했어?');
  assert.equal(t('companion.friend.6.b', { name: '콩이', friend: '밤' }), '나도! 콩이가 제일 좋아.');
  setLang('en');
  assert.equal(t('companion.friend.6.a', { name: 'Bean', friend: 'Max' }), 'Max, I missed you!');
  assert.equal(
    t('companion.anniv.year', { name: 'Bean', n: 1 }),
    '1 year together already! Bean loved every day of it.',
  );
  setLang('ko');
  assert.equal(
    t('companion.cheer.clear', { name: '콩이', n: 3 }),
    '오늘 할 일 다 끝! 콩이가 제일 먼저 축하할래!',
  );
});

test('기억 파일: 깨졌거나 모양이 틀린 칸은 빈 값으로', () => {
  assert.deepEqual(parseMemory(undefined), { cheers: { day: '', ids: [] }, anniv: [], recent: [] });
  assert.deepEqual(parseMemory('x'), { cheers: { day: '', ids: [] }, anniv: [], recent: [] });
  assert.deepEqual(
    parseMemory({
      cheers: { day: '2026-10-10', ids: ['clear', 3, 'count-5'] },
      anniv: [7, -1, 1.5, 'x', 30],
      recent: ['idle.any.1', null, 'idle.any.2'],
    }),
    {
      cheers: { day: '2026-10-10', ids: ['clear', 'count-5'] },
      anniv: [7, 30],
      recent: ['idle.any.1', 'idle.any.2'],
    },
  );
  assert.deepEqual(parseMemory({ cheers: { day: 'bad', ids: ['clear'] } }).cheers, { day: '', ids: [] });
});

test('이번 주: 월요일부터 오늘까지', () => {
  // 2026-10-05 월요일, 10-09 금요일, 10-11 일요일
  assert.deepEqual(weekDays('2026-10-05'), ['2026-10-05']);
  assert.deepEqual(weekDays('2026-10-07'), ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.equal(weekDays('2026-10-11').length, 7);
  assert.equal(weekDays('2026-10-11')[0], '2026-10-05');
});
