import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEventInput } from './event-store.ts';

// 일정 탭 문장 해석 표 (#146): "종일" 은 제목에 남지 않고, 시각 없는 점심, 저녁은 그 시간으로 읽는다.
// 2026-10-23(금) 오전 10시 기준
const TODAY = '2026-10-23';
const NOW = 10 * 60;

type Want =
  | { allDay: true; title: string; day: string }
  | { title: string; day: string; minute: number; durationMin: number | null }
  | null;

const table: [string, Want][] = [
  // 종일 말은 제목에서 빠진다
  ['내일 종일 휴가', { allDay: true, title: '휴가', day: '2026-10-24' }],
  ['내일 하루 종일 휴가', { allDay: true, title: '휴가', day: '2026-10-24' }],
  ['내일 하루종일 휴가', { allDay: true, title: '휴가', day: '2026-10-24' }],
  ['내일 휴가 종일', { allDay: true, title: '휴가', day: '2026-10-24' }],
  ['종일 내일 휴가', { allDay: true, title: '휴가', day: '2026-10-24' }],
  ['tomorrow all day offsite', { allDay: true, title: 'offsite', day: '2026-10-24' }],
  ['tomorrow all-day offsite', { allDay: true, title: 'offsite', day: '2026-10-24' }],
  // 종일 말이 없으면 예전 그대로 (종일 일정)
  ['내일 휴가', { allDay: true, title: '휴가', day: '2026-10-24' }],
  // 낱말 속의 종일은 건드리지 않는다
  ['내일 종일반 등록', { allDay: true, title: '종일반 등록', day: '2026-10-24' }],
  // 시각 없는 점심, 저녁은 그 시간 (낮 12시, 저녁 7시, 한 시간)
  ['내일 점심', { title: '점심', day: '2026-10-24', minute: 12 * 60, durationMin: 60 }],
  ['내일 점심 약속', { title: '점심 약속', day: '2026-10-24', minute: 12 * 60, durationMin: 60 }],
  ['내일 저녁 약속', { title: '저녁 약속', day: '2026-10-24', minute: 19 * 60, durationMin: 60 }],
  ['tomorrow lunch', { title: 'lunch', day: '2026-10-24', minute: 12 * 60, durationMin: 60 }],
  [
    'tomorrow dinner with Sam',
    { title: 'dinner with Sam', day: '2026-10-24', minute: 19 * 60, durationMin: 60 },
  ],
  // 날짜 없이 점심: 오늘 낮 12시 (10시라 아직 앞), 이미 지났으면 내일
  ['점심 약속', { title: '점심 약속', day: TODAY, minute: 12 * 60, durationMin: 60 }],
  // 시각이 있으면 그 시각이 먼저 (점심 낱말은 제목에 남는다)
  ['내일 점심 1시 약속', { title: '점심 약속', day: '2026-10-24', minute: 13 * 60, durationMin: null }],
  ['내일 3시 회의', { title: '회의', day: '2026-10-24', minute: 15 * 60, durationMin: null }],
  // 종일 말이 점심보다 먼저
  ['내일 종일 점심', { allDay: true, title: '점심', day: '2026-10-24' }],
  // 낱말 속의 점심은 건드리지 않는다
  ['내일 점심시간 단축', { allDay: true, title: '점심시간 단축', day: '2026-10-24' }],
  // 날짜도 시각도 없으면 일정이 아니다
  ['종일 휴가', null],
  ['장보기', null],
];

test('일정 문장 해석 표: 종일 말 떼기, 점심과 저녁은 시각으로', () => {
  for (const [text, want] of table) {
    const got = parseEventInput(text, TODAY, NOW);
    if (want === null) {
      assert.equal(got, null, text);
      continue;
    }
    assert.ok(got, `${text} 를 읽지 못했다`);
    if ('allDay' in want) {
      assert.ok('allDay' in got, `${text}: 종일이어야 한다`);
      assert.equal(got.title, want.title, text);
      assert.equal(got.day, want.day, text);
    } else {
      assert.ok(!('allDay' in got), `${text}: 시각 일정이어야 한다`);
      assert.deepEqual(
        {
          title: got.title,
          day: got.day,
          minute: (got as { minute: number }).minute,
          durationMin: (got as { durationMin: number | null }).durationMin,
        },
        want,
        text,
      );
    }
  }
});

test('점심이 이미 지난 낮이면 날짜 없는 점심은 내일', () => {
  const got = parseEventInput('점심 약속', TODAY, 13 * 60);
  assert.ok(got && !('allDay' in got));
  assert.equal(got.day, '2026-10-24');
});
