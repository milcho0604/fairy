import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, MIGRATIONS, migrate, SCHEMA_VERSION } from './db-schema.ts';
import { EventStore, parseEventInput, parseQuickEvent, takeKoDue, timeLabel } from './event-store.ts';
import { NoteStore, notePreview, noteTitle } from './note-store.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 6, 9, 0); // 기준 시각
// 2026-10-06 화요일, 지금 오전 9시
const today = '2026-10-06';
const nine = 9 * 60;

function fresh() {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  return { events: new EventStore(db), notes: new NoteStore(db) };
}

test('"내일모레"는 모레: 시각 일정, 붙여 쓴 시각, 종일 일정, 기간, 할 일 마감', () => {
  const ev = parseQuickEvent('내일모레 3시 회의', today, nine);
  assert.deepEqual(ev && { title: ev.title, day: ev.day }, { title: '회의', day: '2026-10-08' });
  const glued = parseQuickEvent('내일모레3시 회의', today, nine);
  assert.deepEqual(glued && { title: glued.title, day: glued.day }, { title: '회의', day: '2026-10-08' });
  assert.deepEqual(parseEventInput('내일모레 이사', today, nine), {
    title: '이사',
    day: '2026-10-08',
    lastDay: null,
    allDay: true,
  });
  assert.deepEqual(parseEventInput('내일모레부터 3일 출장', today, nine), {
    title: '출장',
    day: '2026-10-08',
    lastDay: '2026-10-10',
    allDay: true,
  });
  assert.deepEqual(takeKoDue('내일모레까지 보고서', today), ['2026-10-08', '보고서']);
  assert.deepEqual(takeKoDue('보고서 내일모레', today), ['2026-10-08', '보고서']);
  // "내일"과 "모레"는 그대로
  assert.equal(parseQuickEvent('내일 3시 회의', today, nine)?.day, '2026-10-07');
  assert.equal(parseQuickEvent('모레 3시 회의', today, nine)?.day, '2026-10-08');
});

test('일정 한 줄: 날짜 낱말, 오전/오후, 반, 24시간 표기', () => {
  assert.deepEqual(parseQuickEvent('내일 3시 회의', today, nine), {
    title: '회의',
    day: '2026-10-07',
    minute: 15 * 60,
    durationMin: null,
  });
  assert.deepEqual(parseQuickEvent('오전 10시 반 스탠드업', today, nine), {
    title: '스탠드업',
    day: today,
    minute: 10 * 60 + 30,
    durationMin: null,
  });
  assert.deepEqual(parseQuickEvent('10/7 14:00 면접 1시간', today, nine), {
    title: '면접',
    day: '2026-10-07',
    minute: 14 * 60,
    durationMin: 60,
  });
  assert.equal(parseQuickEvent('밤 11시 30분 운동', today, nine)?.minute, 23 * 60 + 30);
  assert.equal(parseQuickEvent('오전 12시 점검', today, nine)?.minute, 0);
});

test('날짜가 없으면 오늘, 이미 지난 시각이면 내일', () => {
  assert.equal(parseQuickEvent('오후 2시 치과', today, nine)?.day, today);
  assert.equal(parseQuickEvent('오전 8시 운동', today, nine)?.day, '2026-10-07');
});

test('요일: 이번 주 그 요일, 다음 주 그 요일, 오늘 요일인데 지났으면 다음 주', () => {
  assert.equal(parseQuickEvent('금요일 4시 회고', today, nine)?.day, '2026-10-09');
  assert.equal(parseQuickEvent('다음주 월요일 10시 주간회의', today, nine)?.day, '2026-10-12');
  assert.equal(parseQuickEvent('다음 주 화요일 10시 1on1', today, nine)?.day, '2026-10-13');
  assert.equal(parseQuickEvent('화요일 7시 회식', today, nine)?.day, '2026-10-06'); // 7시 → 오후 7시
  assert.equal(parseQuickEvent('화요일 오전 8시 조깅', today, nine)?.day, '2026-10-13');
});

test('시각이 없거나 제목이 없으면 일정이 아니다. "1시간"을 시각으로 읽지 않는다', () => {
  assert.equal(parseQuickEvent('내일 보고서', today, nine), null);
  assert.equal(parseQuickEvent('내일 3시', today, nine), null);
  assert.deepEqual(parseQuickEvent('4시 회의 1시간 30분', today, nine), {
    title: '회의',
    day: today,
    minute: 16 * 60,
    durationMin: 90,
  });
  assert.equal(parseQuickEvent('25시 파티', today, nine), null);
});

test('지난 날짜(월/일)는 내년으로', () => {
  assert.equal(parseQuickEvent('1월 3일 10시 신년회', today, nine)?.day, '2027-01-03');
});

test('시각 표시', () => {
  assert.equal(timeLabel(0), '오전 12:00');
  assert.equal(timeLabel(14 * 60 + 5), '오후 2:05');
  assert.equal(timeLabel(12 * 60), '오후 12:00');
});

test('알림: 알림 시점이 되면 한 번만, 시작한 지 5분 넘은 것은 건너뛴다, 시각을 바꾸면 다시 알린다', () => {
  const { events } = fresh();
  const a = events.add({ title: '회의', startAt: T0 + 30 * MIN, remindMin: 10 }, T0);
  events.add({ title: '지난 일', startAt: T0 - 10 * MIN }, T0);
  assert.deepEqual(events.dueReminders(T0), []);
  assert.deepEqual(
    events.dueReminders(T0 + 20 * MIN).map((e) => e.title),
    ['회의'],
  );
  events.markNotified(a.id, T0 + 20 * MIN);
  assert.deepEqual(events.dueReminders(T0 + 21 * MIN), []);
  events.update(a.id, { startAt: T0 + 60 * MIN });
  assert.deepEqual(events.dueReminders(T0 + 21 * MIN), []);
  assert.equal(events.dueReminders(T0 + 50 * MIN).length, 1);
  events.update(a.id, { title: '이름만 바꿈' });
  assert.equal(events.dueReminders(T0 + 50 * MIN).length, 1);
});

test('일정 범위 조회와 지우기, 되살리기', () => {
  const { events } = fresh();
  const b = events.add({ title: '둘째', startAt: T0 + 120 * MIN }, T0);
  events.add({ title: '첫째', startAt: T0 + 60 * MIN }, T0);
  events.add({ title: '범위 밖', startAt: T0 + 24 * 60 * MIN }, T0);
  assert.deepEqual(
    events.between(T0, T0 + 12 * 60 * MIN).map((e) => e.title),
    ['첫째', '둘째'],
  );
  events.remove(b.id, T0);
  assert.equal(events.between(T0, T0 + 12 * 60 * MIN).length, 1);
  events.restore(b.id);
  assert.equal(events.between(T0, T0 + 12 * 60 * MIN).length, 2);
  assert.throws(() => events.add({ title: '  ', startAt: T0 }, T0));
});

test('메모: 최근에 고친 것부터, 그대로면 시각을 안 바꾼다, 제목은 첫 줄에서', () => {
  const { notes } = fresh();
  const a = notes.add({ body: '# 회의 메모\n- 결정 1' }, T0);
  const b = notes.add({ title: '장보기', body: '우유' }, T0 + 1);
  assert.deepEqual(
    notes.list().map((n) => n.id),
    [b.id, a.id],
  );
  notes.update(a.id, { body: '# 회의 메모\n- 결정 2' }, T0 + 2);
  assert.equal(notes.list()[0]?.id, a.id);
  notes.update(b.id, { body: '우유' }, T0 + 3);
  assert.equal(notes.get(b.id)?.updatedAt, T0 + 1);
  assert.equal(noteTitle(notes.get(a.id) as never), '회의 메모');
  assert.equal(noteTitle({ title: '', body: '\n\n' }), '빈 메모');
  assert.equal(notePreview({ title: '', body: '# 회의 메모\n- 결정 1\n- 결정 2' }), '결정 1 결정 2');
  assert.equal(notePreview({ title: '장보기', body: '- 우유\n- 귤' }), '우유 귤');
  assert.equal(
    notePreview({ title: '메모', body: '**굵게** 와 `코드`, [링크](https://x.y) 그리고 *기울임*' }),
    '굵게 와 코드, 링크 그리고 기울임',
  );
  assert.equal(
    notePreview({ title: '식', body: '2*3*4 = 24, snake_case_name' }),
    '2*3*4 = 24, snake_case_name',
  );
  notes.remove(a.id, T0 + 4);
  assert.equal(notes.list().length, 1);
  notes.restore(a.id);
  assert.equal(notes.list().length, 2);
  assert.equal(notes.add({ body: 'x', source: 'ai' }, T0).source, 'ai');
});

test('캘린더 가져오기: 새것 넣고, 바뀐 것 고치고, 없어진 것 지운다. 종일은 알리지 않는다', () => {
  const { events } = fresh();
  const a = { uid: 'a', title: '회의', startAt: T0 + 60 * MIN, endAt: null, allDay: false };
  const b = { uid: 'b', title: '휴가', startAt: T0 + 24 * 60 * MIN, endAt: null, allDay: true };
  assert.deepEqual(events.syncExternal('ics', [a, b], T0, T0 + 30 * 24 * 60 * MIN, T0), {
    added: 2,
    updated: 0,
    removed: 0,
  });
  assert.deepEqual(events.syncExternal('ics', [a, b], T0, T0 + 30 * 24 * 60 * MIN, T0), {
    added: 0,
    updated: 0,
    removed: 0,
  });
  assert.deepEqual(
    events.syncExternal('ics', [{ ...a, title: '회의 (장소 바뀜)' }], T0, T0 + 30 * 24 * 60 * MIN, T0),
    { added: 0, updated: 1, removed: 1 },
  );
  const list = events.between(T0, T0 + 30 * 24 * 60 * MIN);
  assert.deepEqual(
    list.map((e) => [e.title, e.source]),
    [['회의 (장소 바뀜)', 'ics']],
  );
  // 직접 넣은 일정은 건드리지 않는다
  events.add({ title: '내 일정', startAt: T0 + 120 * MIN }, T0);
  events.syncExternal('ics', [], T0, T0 + 30 * 24 * 60 * MIN, T0);
  assert.deepEqual(
    events.between(T0, T0 + 30 * 24 * 60 * MIN).map((e) => e.title),
    ['내 일정'],
  );
  // 종일 일정은 알림이 없다
  events.syncExternal('ics', [b], T0, T0 + 30 * 24 * 60 * MIN, T0);
  assert.deepEqual(events.dueReminders(b.startAt + 1000), []);
});

test('없는 날짜와 시각은 일정으로 받지 않는다 (버그잡이 점검 2026-10-07)', () => {
  for (const bad of ['13/45 3시 회의', '2/30 오후 2시 치과', '3시 75분 미팅', '3:99 콜', '2/29 3시 회의']) {
    assert.equal(parseQuickEvent(bad, today, nine), null, bad);
  }
  assert.equal(parseQuickEvent('2/28 3시 회의', today, nine)?.day, '2027-02-28');
});

// ---- 버그잡이 6차: 가져온 일정 ----

const RANGE = [T0, T0 + 30 * 24 * 60 * MIN] as const;
const occ = (rid: string, startAt: number, title = '스탠드업') => ({
  uid: 'series',
  recurrenceId: rid,
  title,
  startAt,
  endAt: null,
  allDay: false,
});

test('반복 일정의 회차는 UID 가 같아도 회차마다 한 행. 다시 맞춰도 고침이 없고 알림 표시가 남는다', () => {
  const { events } = fresh();
  const list = [occ('A', T0 + 30 * MIN), occ('B', T0 + 24 * 60 * MIN), occ('C', T0 + 48 * 60 * MIN)];
  assert.deepEqual(events.syncExternal('ics', list, ...RANGE, T0), { added: 3, updated: 0, removed: 0 });
  const first = events.dueReminders(T0 + 25 * MIN);
  assert.equal(first.length, 1);
  events.markNotified(first[0]?.id ?? 0, T0 + 25 * MIN);
  for (let i = 0; i < 3; i++)
    assert.deepEqual(events.syncExternal('ics', list, ...RANGE, T0 + 26 * MIN), {
      added: 0,
      updated: 0,
      removed: 0,
    });
  // 알림이 다시 울리지 않는다
  assert.deepEqual(events.dueReminders(T0 + 27 * MIN), []);
  assert.equal(events.between(...RANGE).length, 3);
  // 같은 키가 목록에 두 번 와도 서로 덮지 않는다
  assert.deepEqual(events.syncExternal('ics', [...list, occ('A', T0 + 90 * MIN, '다른 값')], ...RANGE, T0), {
    added: 0,
    updated: 0,
    removed: 0,
  });
});

test('사용자가 지운 가져온 일정은 다시 가져와도 되살리지 않는다. 캘린더에서 없어졌다 돌아온 것은 되살린다', () => {
  const { events } = fresh();
  const a = occ('A', T0 + 60 * MIN);
  const b = occ('B', T0 + 120 * MIN);
  events.syncExternal('ics', [a, b], ...RANGE, T0);
  const [ea] = events.between(...RANGE);
  events.remove(ea?.id ?? 0, T0);
  assert.deepEqual(events.syncExternal('ics', [a, b], ...RANGE, T0), { added: 0, updated: 0, removed: 0 });
  assert.deepEqual(
    events.between(...RANGE).map((e) => e.startAt),
    [b.startAt],
  );
  // 되돌리기(restore)는 묘비를 지운다
  events.restore(ea?.id ?? 0);
  assert.equal(events.between(...RANGE).length, 2);
  // 캘린더에서 빠졌다가(지움) 다시 생기면 되살린다
  assert.deepEqual(events.syncExternal('ics', [a], ...RANGE, T0).removed, 1);
  assert.deepEqual(events.syncExternal('ics', [a, b], ...RANGE, T0), { added: 0, updated: 1, removed: 0 });
  assert.equal(events.between(...RANGE).length, 2);
});

test('사용자가 고친 가져온 일정은 다음 가져오기가 덮지 않는다. 알림 시점만 바꾼 것은 고친 것이 아니다', () => {
  const { events } = fresh();
  const a = occ('A', T0 + 60 * MIN, '원래 제목');
  const b = occ('B', T0 + 120 * MIN, '원래 제목');
  events.syncExternal('ics', [a, b], ...RANGE, T0);
  const [ea, eb] = events.between(...RANGE);
  events.update(ea?.id ?? 0, { title: '내가 고친 제목', startAt: T0 + 90 * MIN });
  events.update(eb?.id ?? 0, { remindMin: 30 });
  const r = events.syncExternal(
    'ics',
    [
      { ...a, title: '캘린더에서 바뀜' },
      { ...b, title: '캘린더에서 바뀜' },
    ],
    ...RANGE,
    T0,
  );
  assert.deepEqual(r, { added: 0, updated: 1, removed: 0 });
  assert.deepEqual(
    events.between(...RANGE).map((e) => [e.title, e.startAt]),
    [
      ['내가 고친 제목', T0 + 90 * MIN],
      ['캘린더에서 바뀜', T0 + 120 * MIN],
    ],
  );
});

test('6판 올리기: 5판에서 지워져 있던 가져온 일정은 사용자가 지운 것으로 본다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  db.exec('begin');
  for (const sql of MIGRATIONS.slice(0, 5)) db.exec(sql);
  db.exec('pragma user_version = 5; commit');
  db.exec(`insert into event (title, start_at, remind_min, created_at, source, external_id, deleted_at)
           values ('지운 것', ${T0 + 60 * MIN}, 10, ${T0}, 'ics', 'gone', ${T0})`);
  assert.deepEqual(migrate(db), { from: 5, to: SCHEMA_VERSION });
  const events = new EventStore(db);
  events.syncExternal(
    'ics',
    [{ uid: 'gone', title: '지운 것', startAt: T0 + 60 * MIN, endAt: null, allDay: false }],
    ...RANGE,
    T0,
  );
  assert.deepEqual(events.between(...RANGE), []);
});

// ---- 영어 일정 한 줄 (F). 2026-10-06 화요일, 지금 오전 9시 ----

const ev = (s: string) => parseQuickEvent(s, today, nine);
const at = (h: number, m = 0) => h * 60 + m;

test('영어 시각: 3pm, 2:30 PM, 3 p.m., noon, midnight, 15:30, at 3 은 오후', () => {
  assert.deepEqual(ev('meeting tomorrow at 3pm'), {
    title: 'meeting',
    day: '2026-10-07',
    minute: at(15),
    durationMin: null,
  });
  assert.equal(ev('Dentist 2:30 PM')?.minute, at(14, 30));
  assert.equal(ev('call 3 p.m.')?.minute, at(15));
  assert.equal(ev('Standup at 9:30am')?.minute, at(9, 30));
  assert.equal(ev('lunch at noon')?.minute, at(12));
  assert.equal(ev('lunch at noon')?.title, 'lunch');
  assert.equal(ev('deploy at midnight')?.minute, 0);
  assert.equal(ev('deploy at midnight')?.day, '2026-10-07'); // 이미 지난 시각이라 내일
  assert.equal(ev('sync at 15:30')?.minute, at(15, 30));
  assert.equal(ev('sync at 15:30')?.title, 'sync');
  assert.equal(ev('gym at 6')?.minute, at(18)); // 오전, 오후 없이 1~7시는 오후
  assert.equal(ev("meeting at 3 o'clock")?.minute, at(15));
  assert.equal(ev('12am check')?.minute, 0);
  assert.equal(ev('12pm check')?.minute, at(12));
  assert.equal(ev('sync @2pm')?.title, 'sync');
});

test('영어 날짜: today, tonight, tomorrow, 요일, next, this, 달 이름', () => {
  assert.equal(ev('dinner tonight at 8')?.minute, at(20)); // tonight 이면 저녁
  assert.equal(ev('dinner tonight at 8')?.day, today);
  assert.equal(ev('call tomorrow 10am')?.day, '2026-10-07');
  assert.equal(ev('dentist the day after tomorrow 2pm')?.day, '2026-10-08');
  assert.equal(ev('retro friday 4pm')?.day, '2026-10-09');
  assert.equal(ev('Dentist fri 2:30 PM')?.day, '2026-10-09');
  assert.equal(ev('weekly sync next monday 10am')?.day, '2026-10-12');
  assert.equal(ev('1on1 next tuesday 10am')?.day, '2026-10-13'); // 한국어 "다음 주 화요일" 과 같은 날
  assert.equal(ev('retro this tuesday 5pm')?.day, today);
  assert.equal(ev('jog tuesday 8am')?.day, '2026-10-13'); // 오늘 요일인데 지났으면 다음 주
  assert.equal(ev('review on Wednesday at 4pm')?.title, 'review');
  assert.equal(ev('interview oct 7 14:00')?.day, '2026-10-07');
  assert.equal(ev('party December 25th, 7pm')?.day, '2026-12-25');
  assert.equal(ev('review on the 3rd of november at 4pm')?.day, '2026-11-03');
  assert.equal(ev('kickoff jan 3 10am')?.day, '2027-01-03'); // 지난 날짜는 내년
});

test('영어 길이: for 1 hour, 1h, 1.5 hours, 1h 30m, 45 min, half an hour', () => {
  assert.deepEqual(ev('call next monday 10am for 30 min'), {
    title: 'call',
    day: '2026-10-12',
    minute: at(10),
    durationMin: 30,
  });
  assert.equal(ev('interview oct 7 14:00 1h')?.durationMin, 60);
  assert.equal(ev('workshop 3pm for 1.5 hours')?.durationMin, 90);
  assert.equal(ev('workshop 3pm for 1.5 hours')?.day, today); // 1.5 를 1월 5일로 읽지 않는다
  assert.equal(ev('focus 2h 30m tomorrow 1pm')?.durationMin, 150);
  assert.equal(ev('sync @2pm 45m')?.durationMin, 45);
  assert.equal(ev('plan half an hour 4pm')?.durationMin, 30);
  assert.equal(ev('lunch for an hour at noon')?.durationMin, 60);
});

test('영어: 제목 속 낱말을 날짜로 읽지 않고, 시각이 없거나 틀리면 일정이 아니다', () => {
  assert.equal(ev('sundays brunch 3pm')?.day, today);
  assert.equal(ev('sundays brunch 3pm')?.title, 'sundays brunch');
  assert.equal(ev('Monica 3pm')?.title, 'Monica');
  assert.equal(ev('marathon 10 3pm')?.title, 'marathon 10'); // mar 10 이 아니다
  assert.equal(ev('tomorrow buy milk'), null);
  assert.equal(ev('3pm'), null);
  assert.equal(ev('13pm sync'), null);
  assert.equal(ev('3:75pm sync'), null);
  assert.equal(ev('feb 30 3pm party'), null);
  assert.equal(ev('1:1 thursday 3pm')?.title, '1:1');
});
