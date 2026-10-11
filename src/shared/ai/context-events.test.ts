// AI 에 보낼 오늘 일정 고르기. 2026-10-06 화요일 오후 3시 기준 (현지 시각)
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from '../db-schema.ts';
import { allDayTimes, EventStore } from '../event-store.ts';
import { setLang } from '../i18n/index.ts';
import { contextEvents, todayRange } from './context-events.ts';
import { todoContext } from './persona.ts';

const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y ?? 2000, (mo ?? 1) - 1, d ?? 1, h, m).getTime();
};
const now = at('2026-10-06', 15);

function store() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return new EventStore(db);
}

test('오늘 하루 종일, 여러 날 종일, 진행 중, 막 시작한 일정은 보내고 끝난 일정, 내일 일정은 뺀다', () => {
  setLang('ko');
  const events = store();
  const add = (title: string, startAt: number, endAt: number | null = null) =>
    events.add({ title, startAt, endAt }, now - 86_400_000);
  events.add({ title: '휴가', ...allDayTimes('2026-10-06', null), allDay: true }, 0);
  events.add({ title: '출장', ...allDayTimes('2026-10-05', '2026-10-07'), allDay: true }, 0);
  events.add({ title: '지난 여행', ...allDayTimes('2026-10-01', '2026-10-05'), allDay: true }, 0);
  add('아침 회의', at('2026-10-06', 9), at('2026-10-06', 10)); // 끝남
  add('긴 회의', at('2026-10-06', 14), at('2026-10-06', 16)); // 진행 중
  add('방금 통화', at('2026-10-06', 14, 55)); // 5분 전 시작, 끝 시각 없음
  add('점심', at('2026-10-06', 12)); // 3시간 전, 끝 시각 없음
  add('저녁 약속', at('2026-10-06', 19));
  add('내일 회의', at('2026-10-07', 0));
  const { from, to } = todayRange(now);
  const picked = contextEvents(events.between(from, to), now);
  assert.deepEqual(
    picked.map((e) => e.title),
    ['출장', '휴가', '긴 회의', '방금 통화', '저녁 약속'],
  );
  assert.deepEqual(picked[0], { time: '', title: '출장', allDay: true });
  assert.equal(picked[2]?.time, '오후 2:00');
  // 종일은 시각("오전 12:00") 대신 "종일"
  const text = todoContext({ today: '2026-10-06', todos: [], events: picked });
  assert.match(text, /- 종일 출장\n- 종일 휴가\n- 오후 2:00 긴 회의/);
  assert.doesNotMatch(text, /오전 12:00/);
  setLang('en');
  assert.match(todoContext({ today: '2026-10-06', todos: [], events: picked }), /- All day 출장/);
  setLang('ko');
});

test('서머타임이 바뀌는 날도 하루는 그날 0시부터 다음 날 0시까지', () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    // 2026-11-01 은 25시간, 2026-03-08 은 23시간
    for (const [day, hours] of [
      ['2026-11-01', 25],
      ['2026-03-08', 23],
    ] as const) {
      const r = todayRange(at(day, 12));
      assert.equal(r.from, at(day, 0));
      assert.equal((r.to - r.from) / 3_600_000, hours);
      // 그날 밤 11시 30분 일정도 든다 (24시간을 더하면 23시간인 날은 넘치고 25시간인 날은 빠진다)
      const late = { title: '밤', startAt: at(day, 23, 30), endAt: null, allDay: false };
      assert.equal(contextEvents([late], at(day, 12)).length, 1);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
