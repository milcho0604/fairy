import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CalEvent } from './event-store.ts';
import { IDLE, startBreak, startFocus } from './focus.ts';
import { clipTitle, joinTrayTitle, trayTitleText, trayTitleWait } from './tray-title.ts';

const at = (h: number, m = 0) => new Date(2026, 9, 11, h, m).getTime();
const ev = (title: string, startAt: number, allDay = false): CalEvent => ({
  id: 1,
  title,
  startAt,
  endAt: null,
  reminds: [],
  remindMin: 0,
  notifiedAt: null,
  source: 'local',
  allDay,
  pinnedAt: null,
});

test('집중 중이면 남은 분 (올림), 쉬는 중이면 쉬기', () => {
  const now = at(10);
  assert.equal(trayTitleText(now, startFocus(now - 60_000, 25), []), '집중 24분');
  assert.equal(trayTitleText(now, startFocus(now - 30_000, 25), []), '집중 25분');
  assert.equal(trayTitleText(now, startBreak(now, 5), []), '쉬기 5분');
});

test('다음 일정: 12시간 안, 종일과 지난 것은 빼고 가장 이른 것', () => {
  const now = at(10);
  const list = [
    ev('늦은 회의', at(15)),
    ev('점심 약속', at(12, 30)),
    ev('지난 것', at(9)),
    ev('휴가', at(11), true),
  ];
  assert.equal(trayTitleText(now, IDLE, list), '12:30 점심 약속');
  assert.equal(trayTitleText(now, IDLE, [ev('내일 아침', at(23) + 60 * 60_000)]), '');
  assert.equal(trayTitleText(now, IDLE, []), '');
});

test('긴 제목은 자른다 (이모지도 한 글자)', () => {
  assert.equal(clipTitle('아주 아주 긴 회의 제목이 여기에 있다'), '아주 아주 긴 회의 제목…');
  assert.equal([...clipTitle('👨‍👩‍👧'.repeat(20))].length > 0, true);
  assert.equal(clipTitle('짧다'), '짧다');
});

test('다시 볼 때와 CPU 글자 합치기', () => {
  const now = at(10);
  const wait = trayTitleWait(now, startFocus(now - 10_000, 25));
  assert.ok(wait >= 1000 && wait <= 60_050);
  assert.equal(trayTitleWait(now, IDLE), 60_000);
  assert.equal(joinTrayTitle('12:30 점심', '12%'), '12:30 점심  12%');
  assert.equal(joinTrayTitle('', '12%'), '12%');
  assert.equal(joinTrayTitle('12:30 점심', ''), '12:30 점심');
  assert.equal(joinTrayTitle('12:30 점심', '12%', '숨김 · K'), '숨김 · K  12:30 점심  12%');
});
