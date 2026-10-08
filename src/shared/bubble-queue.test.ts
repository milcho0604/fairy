import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bundleText,
  canSnooze,
  fateOf,
  HELD_MAX,
  HeldBubbles,
  heldButtons,
  MAX_SHOWS,
  MISSED_MAX,
  MissedLog,
} from './bubble-queue.ts';
import { ChatterGate } from './chatter.ts';
import { setLang } from './i18n/index.ts';

const T0 = new Date(2026, 9, 7, 14, 0).getTime();
const MIN = 60_000;

test('숨은 동안 모은 것: 시작이 한참 지난 일정은 놓친 알림으로, 나머지는 말풍선으로', () => {
  const held = new HeldBubbles();
  held.hold({ text: '5분 뒤 회의', at: T0, staleAt: T0 + 15 * MIN });
  held.hold({ text: '업적 달성', at: T0 + MIN });
  held.hold({ text: '지금 치과', at: T0 + 2 * MIN, staleAt: T0 + 40 * MIN });
  const { fresh, stale } = held.flush(T0 + 20 * MIN);
  assert.deepEqual(
    fresh.map((h) => h.text),
    ['업적 달성', '지금 치과'],
  );
  assert.deepEqual(
    stale.map((h) => h.text),
    ['5분 뒤 회의'],
  );
  // 꺼낸 뒤에는 비어 있다
  assert.equal(held.size, 0);
  assert.deepEqual(held.flush(T0 + 21 * MIN), { fresh: [], stale: [] });
});

test('같은 글은 한 번만 모으고, 넘치면 오래된 것부터 밀려난다', () => {
  const held = new HeldBubbles();
  held.hold({ text: 'a', at: T0 });
  assert.deepEqual(held.hold({ text: 'a', at: T0 + 1 }), []);
  assert.equal(held.size, 1);
  for (let i = 1; i < HELD_MAX; i++) held.hold({ text: `n${i}`, at: T0 + i });
  assert.equal(held.size, HELD_MAX);
  const out = held.hold({ text: 'last', at: T0 + 99 });
  assert.deepEqual(
    out.map((h) => h.text),
    ['a'],
  );
  assert.equal(held.size, HELD_MAX);
});

test('묶은 말풍선: 하나면 그대로, 여럿이면 머리말과 줄마다 하나', () => {
  setLang('ko');
  assert.equal(bundleText([{ text: '지금 회의', at: T0 }]), '지금 회의');
  const text = bundleText([
    { text: '지금 회의', at: T0 },
    { text: '업적 달성', at: T0 },
  ]);
  assert.equal(text, '숨어 있는 동안 알림이 2개 왔어\n- 지금 회의\n- 업적 달성');
  setLang('en');
  assert.match(
    bundleText([
      { text: 'a', at: T0 },
      { text: 'b', at: T0 },
    ]),
    /^2 things came up/,
  );
  setLang('ko');
});

test('놓친 알림은 오늘 것만, 최근 것이 위로, 같은 글은 한 번', () => {
  const log = new MissedLog();
  log.add({ text: '어제 일', at: T0 - 24 * 60 * MIN });
  log.add({ text: '회의', at: T0 });
  log.add({ text: '회의', at: T0 + MIN });
  log.add({ text: '치과', at: T0 + 2 * MIN });
  assert.deepEqual(
    log.list(T0 + 3 * MIN).map((m) => m.text),
    ['치과', '회의'],
  );
  for (let i = 0; i < MISSED_MAX + 5; i++) log.add({ text: `n${i}`, at: T0 + i });
  assert.equal(log.list(T0 + 3 * MIN).length, MISSED_MAX);
  log.clear();
  assert.deepEqual(log.list(T0), []);
});

test('수다 빈도가 말하지 않는 종류는 모으지도 않는다 (allows 는 세지 않는다)', () => {
  const gate = new ChatterGate('quiet');
  assert.equal(gate.allows('schedule'), true);
  assert.equal(gate.allows('system'), false);
  gate.level = 'normal';
  for (let i = 0; i < 10; i++) assert.equal(gate.allows('system'), true);
  // allows 를 여러 번 불러도 한 시간 상한(3)을 쓰지 않는다
  assert.equal(gate.take('system', T0), true);
});

test('미루기 단추: 5분 뒤에도 시작이 10분 넘게 지나지 않을 때만', () => {
  const start = T0 + 30 * MIN;
  assert.equal(canSnooze(T0, start), true);
  assert.equal(canSnooze(start, start), true);
  assert.equal(canSnooze(start + 5 * MIN, start), true);
  assert.equal(canSnooze(start + 5 * MIN + 1, start), false);
});

test('닫힌 뒤: 눌렀으면 봤다, 숨거나 잠기면 다시, 자리 비운 사이 끝나면 한 번 더, 그래도 못 보면 놓친 알림', () => {
  const here = { blocked: false, away: false, shown: 1 };
  assert.equal(fateOf('ok', here), 'seen');
  assert.equal(fateOf('dismiss', here), 'seen');
  assert.equal(fateOf('snooze', here), 'seen');
  // 숨기, 화면 잠금으로 치움
  assert.equal(fateOf('cleared', { ...here, blocked: true }), 'hold');
  // 펫을 집어 들어 치움: 본 것
  assert.equal(fateOf('cleared', here), 'seen');
  // 못 띄움: 숨어 있으면 모으고, 수다 상한이면 놓친 알림
  assert.equal(fateOf(undefined, { ...here, blocked: true }), 'hold');
  assert.equal(fateOf(undefined, here), 'missed');
  // 다른 말에 밀림
  assert.equal(fateOf('replaced', here), 'hold');
  assert.equal(fateOf('replaced', { ...here, shown: MAX_SHOWS }), 'missed');
  // 시간 끝: 자리에 있었으면 놓친 알림, 비웠으면 한 번 더
  assert.equal(fateOf('timeout', here), 'missed');
  assert.equal(fateOf('timeout', { ...here, away: true }), 'hold');
  assert.equal(fateOf('timeout', { ...here, away: true, shown: MAX_SHOWS }), 'missed');
});

test('놓친 알림은 앱을 다시 켜도 오늘 것은 남고, 깨진 값은 버린다', () => {
  const log = new MissedLog();
  log.add({ text: '회의', at: T0 });
  const back = MissedLog.from(JSON.parse(JSON.stringify(log.items)), T0 + MIN);
  assert.deepEqual(back.list(T0 + MIN), [{ text: '회의', at: T0 }]);
  const broken = MissedLog.from(
    [null, { text: 3 }, { text: 'x', at: 'y' }, { text: '어제', at: T0 - 86_400_000 }],
    T0,
  );
  assert.deepEqual(broken.list(T0), []);
  assert.deepEqual(MissedLog.from('nope', T0).list(T0), []);
});

test('이미 묶인 알림을 다시 묶어도 머리말이 겹치지 않는다', () => {
  setLang('ko');
  const text = bundleText([
    { text: '', lines: ['5분 뒤 회의', '6분 뒤 치과'], at: T0 },
    { text: '업적 달성', at: T0 },
  ]);
  assert.equal(text, '숨어 있는 동안 알림이 3개 왔어\n- 5분 뒤 회의\n- 6분 뒤 치과\n- 업적 달성');
});

test('혼자 다시 꺼내는 말은 제 단추를 그대로 단다 (저장 파일 알림의 "파일 보기"), 여럿을 묶으면 기본 단추', () => {
  const ok = [{ id: 'ok', label: '알았어' }];
  const own = [
    { id: 'show', label: '파일 보기' },
    { id: 'ok', label: '확인' },
  ];
  assert.deepEqual(heldButtons([{ text: '저장 파일', at: 0, buttons: own }], ok), own);
  assert.deepEqual(heldButtons([{ text: '일정', at: 0 }], ok), ok);
  assert.deepEqual(
    heldButtons(
      [
        { text: '저장 파일', at: 0, buttons: own },
        { text: '일정', at: 0 },
      ],
      ok,
    ),
    ok,
  );
});
