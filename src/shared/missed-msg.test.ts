import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HeldBubbles, MissedLog, missedEntries } from './bubble-queue.ts';
import { setLang } from './i18n/index.ts';
import { type MissedMsg, parseMissedMsg, renderMissed } from './missed-msg.ts';

const T0 = new Date(2026, 9, 8, 10, 0).getTime();

test('놓친 알림은 언어를 바꾸면 보일 때 새 언어로 (만들 때 언어로 굳지 않는다)', () => {
  try {
    setLang('ko');
    const log = new MissedLog();
    // 값이 말 열쇠인 것(업적 이름)은 놓친 알림 목록에는 안 보이지만 글은 지금 언어로 다시 만든다
    const nested: MissedMsg = {
      key: 'pet.achieved',
      vars: { name: { key: 'achieve.todo1.name' }, hint: { key: 'achieve.todo1.hint' } },
    };
    assert.match(renderMissed(nested), /첫 걸음/);
    const msgs: MissedMsg[] = [
      nested,
      { key: 'briefing.review.missed', vars: { done: 2, left: 1 } },
      { remind: { kind: 'event', title: 'Design sync', anchor: { kind: 'time', at: T0 + 3_600_000 } } },
    ];
    for (const [i, msg] of msgs.entries()) log.add({ text: renderMissed(msg), at: T0 + i, msg });
    const ko = log.list(T0 + 10).map((m) => m.text);
    assert.equal(ko.length, 2, '업적 달성은 목록에서 빠진다');
    // 저장했다 다시 읽어도 (missed.json)
    const back = MissedLog.from(JSON.parse(JSON.stringify(log.items)), T0 + 10);
    setLang('en');
    const en = back.list(T0 + 10).map((m) => m.text);
    assert.match(renderMissed(nested), /First step/);
    assert.equal(en.length, 2);
    assert.notEqual(en[1], ko[1]);
    assert.match(en[0] ?? '', /^Design sync \(/);
    assert.notEqual(en[0], ko[0], '날짜 글도 새 언어로');
  } finally {
    setLang('ko');
  }
});

test('말 열쇠가 없는 예전 기록과 열쇠가 깨진 기록은 저장한 글 그대로', () => {
  const log = MissedLog.from(
    [
      { text: '예전 글', at: T0 },
      { text: '없는 열쇠', at: T0 + 1, msg: { key: 'no.such.key' } },
      { text: '값이 이상함', at: T0 + 2, msg: { key: 'pet.achieved', vars: { name: [1] } } },
      {
        text: '때가 없음',
        at: T0 + 3,
        msg: { remind: { kind: 'todo', title: 'x', anchor: { kind: 'day' } } },
      },
    ],
    T0 + 10,
  );
  assert.deepEqual(
    log.list(T0 + 10).map((m) => m.text),
    ['때가 없음', '값이 이상함', '없는 열쇠', '예전 글'],
  );
  assert.equal(parseMissedMsg({ key: 'pet.achieved', vars: { a: { b: { key: 'x' } } } }), undefined);
  assert.equal(parseMissedMsg('pet.achieved'), undefined);
});

test('말 열쇠는 놓친 알림 줄과 짝을 맞춘다 (missedLines, lines, text 순)', () => {
  const at = T0;
  const msg: MissedMsg = { key: 'briefing.review.missed', vars: { done: 1, left: 0 } };
  assert.deepEqual(missedEntries({ text: '말', at, missedMsgs: [msg] }), [{ text: '말', msg }]);
  assert.deepEqual(missedEntries({ text: '말', at, lines: ['가', '나'], missedMsgs: [msg] }), [
    { text: '가', msg },
    { text: '나' },
  ]);
  assert.deepEqual(missedEntries({ text: '말', at, missedLines: [] }), []);
  // 모아 두는 동안에도 말 열쇠는 그대로 따라간다
  const held = new HeldBubbles();
  held.hold({ text: '말', at, missedMsgs: [msg] });
  assert.deepEqual(held.flush(at).fresh[0]?.missedMsgs, [msg]);
});

test('여러 날 종일 일정은 기간도 지금 언어로 다시 만든다', () => {
  try {
    const start = new Date(2026, 9, 7).getTime();
    const end = new Date(2026, 9, 10).getTime();
    const msg = parseMissedMsg(
      JSON.parse(
        JSON.stringify({
          remind: {
            kind: 'event',
            title: '워크숍',
            anchor: { kind: 'day', day: '2026-10-07' },
            range: '굳은 글',
          },
          span: { startAt: start, endAt: end },
        }),
      ),
    );
    assert.ok(msg);
    setLang('ko');
    const ko = renderMissed(msg);
    setLang('en');
    const en = renderMissed(msg);
    assert.doesNotMatch(ko, /굳은 글/);
    assert.notEqual(ko, en);
  } finally {
    setLang('ko');
  }
});
