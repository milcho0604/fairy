import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanCalendarId,
  dayIn,
  GCAL_PRIMARY,
  GcalBackoff,
  gcalAiOn,
  gcalHash,
  isGoogleId,
  newGoogleId,
  toGoogle,
} from './gcal.ts';

const SEOUL = 'Asia/Seoul';
const NY = 'America/New_York';
/** 서울 현지 시각 → ms */
const kst = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi);

test('캘린더 id: 비면 primary, 메일 모양만, 경로를 깨는 글자는 받지 않는다', () => {
  assert.equal(cleanCalendarId(''), GCAL_PRIMARY);
  assert.equal(cleanCalendarId('  PRIMARY '), GCAL_PRIMARY);
  assert.equal(cleanCalendarId('me@gmail.com'), 'me@gmail.com');
  assert.equal(cleanCalendarId(' abc123@group.calendar.google.com '), 'abc123@group.calendar.google.com');
  assert.equal(cleanCalendarId('../../users/me'), undefined);
  assert.equal(cleanCalendarId('a@b.com/events'), undefined);
  assert.equal(cleanCalendarId('a b@c.com'), undefined);
  assert.equal(cleanCalendarId(42), undefined);
  assert.equal(cleanCalendarId(`${'a'.repeat(250)}@b.com`), undefined);
});

test('dayIn: 그 시간대의 날짜 (UTC 로는 전날이어도)', () => {
  // 서울 10월 9일 0시 = UTC 10월 8일 15시
  assert.equal(dayIn(kst(2026, 10, 9), SEOUL), '2026-10-09');
  assert.equal(dayIn(kst(2026, 10, 9), 'UTC'), '2026-10-08');
});

test('시각 일정: UTC 시각 + 시간대, 끝이 없으면 30분', () => {
  const b = toGoogle(
    {
      title: '회의',
      startAt: kst(2026, 10, 9, 15),
      endAt: kst(2026, 10, 9, 16, 30),
      allDay: false,
      reminds: [10],
    },
    SEOUL,
  );
  assert.deepEqual(b.start, { dateTime: '2026-10-09T06:00:00.000Z', timeZone: SEOUL });
  assert.deepEqual(b.end, { dateTime: '2026-10-09T07:30:00.000Z', timeZone: SEOUL });
  assert.equal(b.summary, '회의');
  assert.deepEqual(b.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
  assert.equal(b.status, 'confirmed');
  assert.deepEqual(b.extendedProperties, { private: { jjakkung: '1' } });

  const open = toGoogle(
    { title: '전화', startAt: kst(2026, 10, 9, 9), endAt: null, allDay: false, reminds: [] },
    SEOUL,
  );
  assert.deepEqual(open.end, { dateTime: '2026-10-09T00:30:00.000Z', timeZone: SEOUL });
  assert.deepEqual(open.reminders.overrides, []);
  // 끝이 시작보다 이르면 30분짜리로
  const odd = toGoogle(
    { title: 'x', startAt: kst(2026, 10, 9, 9), endAt: kst(2026, 10, 9, 8), allDay: false, reminds: [] },
    SEOUL,
  );
  assert.deepEqual(odd.end, { dateTime: '2026-10-09T00:30:00.000Z', timeZone: SEOUL });
});

test('종일 일정: 현지 날짜, 끝 날은 들지 않는다. 하루짜리는 다음 날까지', () => {
  const one = toGoogle(
    { title: '한글날', startAt: kst(2026, 10, 9), endAt: null, allDay: true, reminds: [] },
    SEOUL,
  );
  assert.deepEqual(one.start, { date: '2026-10-09' });
  assert.deepEqual(one.end, { date: '2026-10-10' });
  // 3박 4일: 9일 0시부터 13일 0시(끝 날 다음 날)까지
  const trip = toGoogle(
    { title: '제주도', startAt: kst(2026, 10, 9), endAt: kst(2026, 10, 13), allDay: true, reminds: [240] },
    SEOUL,
  );
  assert.deepEqual(trip.start, { date: '2026-10-09' });
  assert.deepEqual(trip.end, { date: '2026-10-13' });
  assert.deepEqual(trip.reminders.overrides, [{ method: 'popup', minutes: 240 }]);
  // 월말, 연말 넘김
  const ny = toGoogle(
    { title: '새해', startAt: kst(2026, 12, 31), endAt: null, allDay: true, reminds: [] },
    SEOUL,
  );
  assert.deepEqual([ny.start, ny.end], [{ date: '2026-12-31' }, { date: '2027-01-01' }]);
});

test('종일 일정: 서머타임이 바뀌는 날도 날짜가 밀리지 않는다 (뉴욕 2026-11-01)', () => {
  // 뉴욕 10월 31일 0시(EDT, -4) ~ 11월 2일 0시(EST, -5)
  const start = Date.UTC(2026, 9, 31, 4);
  const end = Date.UTC(2026, 10, 2, 5);
  const b = toGoogle({ title: 'x', startAt: start, endAt: end, allDay: true, reminds: [] }, NY);
  assert.deepEqual([b.start, b.end], [{ date: '2026-10-31' }, { date: '2026-11-02' }]);
});

test('알림: 구글이 못 받는 값(음수, 4주 넘게)은 빼고 가까운 5개만', () => {
  const b = toGoogle(
    {
      title: 'x',
      startAt: kst(2026, 10, 20),
      endAt: null,
      allDay: true,
      reminds: [-540, 240, 1680, 10080, 40320, 50000, 0, 60, 60],
    },
    SEOUL,
  );
  assert.deepEqual(
    b.reminders.overrides.map((r) => r.minutes),
    [0, 60, 240, 1680, 10080],
  );
});

test('지문: 같은 내용이면 같고, 무엇이든 바뀌면 다르다', () => {
  const base = { title: '회의', startAt: kst(2026, 10, 9, 15), endAt: null, allDay: false, reminds: [10] };
  const h = gcalHash(toGoogle(base, SEOUL));
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(gcalHash(toGoogle({ ...base }, SEOUL)), h);
  assert.notEqual(gcalHash(toGoogle({ ...base, title: '회의!' }, SEOUL)), h);
  assert.notEqual(gcalHash(toGoogle({ ...base, startAt: base.startAt + 60_000 }, SEOUL)), h);
  assert.notEqual(gcalHash(toGoogle({ ...base, reminds: [5] }, SEOUL)), h);
  assert.notEqual(gcalHash(toGoogle(base, 'UTC')), h);
});

test('구글 id: jjk + base32hex 26자', () => {
  let i = 0;
  const id = newGoogleId((n) => Uint8Array.from({ length: n }, () => i++ * 7));
  assert.match(id, /^jjk[0-9a-v]{26}$/);
  assert.ok(isGoogleId(id));
  assert.ok(!isGoogleId('JJK123'));
  assert.ok(!isGoogleId('jjk_x1'));
  assert.ok(!isGoogleId('abc'));
});

test('다시 하기 간격: 30초부터 두 배씩 30분까지, 받지 않는 것은 6시간, 고치면 바로', () => {
  const b = new GcalBackoff(() => 0);
  const t0 = 1_000_000;
  assert.ok(b.ready('1', t0));
  assert.equal(b.fail('1', t0), t0 + 30_000);
  assert.ok(!b.ready('1', t0 + 29_999));
  assert.ok(b.ready('1', t0 + 30_000));
  assert.equal(b.fail('1', t0), t0 + 60_000);
  assert.equal(b.fail('1', t0), t0 + 120_000);
  for (let i = 0; i < 10; i++) b.fail('1', t0);
  assert.equal(b.fail('1', t0), t0 + 30 * 60_000);
  b.ok('1');
  assert.ok(b.ready('1', t0));
  assert.equal(b.nextAt(), undefined);

  assert.equal(b.fail('2', t0, { bad: true, hash: 'a' }), t0 + 6 * 3_600_000);
  assert.ok(!b.ready('2', t0 + 1000, 'a'));
  // 내용을 고치면(지문이 바뀌면) 기다리지 않는다
  assert.ok(b.ready('2', t0 + 1000, 'b'));
  b.fail('3', t0);
  assert.equal(b.nextAt(), t0 + 30_000);
  b.clear();
  assert.equal(b.nextAt(), undefined);

  // 흔들기: 0~20% 더한다
  const j = new GcalBackoff(() => 0.999);
  const at = j.fail('x', 0);
  assert.ok(at > 30_000 && at <= 36_000);
});

test('AI 가 구글 일정도 보기: 설정 파일에 ai 가 true 일 때만 켬 (없거나 깨졌거나 다른 값이면 꺼짐)', () => {
  assert.equal(gcalAiOn({ ai: true }), true);
  for (const v of [undefined, null, '{', 1, [], {}, { ai: false }, { ai: 'true' }, { ai: 1 }])
    assert.equal(gcalAiOn(v), false);
});
