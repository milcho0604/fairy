import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MissedLog } from './bubble-queue.ts';

const T0 = new Date(2026, 9, 28, 11, 20).getTime();

test('놓친 알림 목록에서 업적 달성 알림은 뺀다 (다른 알림은 그대로)', () => {
  const log = new MissedLog();
  log.add({ text: '회의', at: T0 });
  log.add({
    text: '업적 달성: 첫 걸음',
    at: T0 + 1,
    msg: { key: 'pet.achieved', vars: { name: { key: 'a.first.name' }, hint: { key: 'a.first.hint' } } },
  });
  log.add({ text: '치과', at: T0 + 2 });
  assert.deepEqual(
    log.list(T0 + 10).map((m) => m.text),
    ['치과', '회의'],
  );
  // 저장 파일에는 남아 있다 (지우지 않고 목록에서만 뺀다)
  assert.equal(log.items.length, 3);
});

test('저장해 둔 놓친 알림을 다시 읽어도 업적은 빠진다', () => {
  const log = MissedLog.from(
    [{ text: '업적 달성: 첫 걸음', at: T0, msg: { key: 'pet.achieved', vars: { name: 'x', hint: 'y' } } }],
    T0 + 5,
  );
  assert.deepEqual(log.list(T0 + 5), []);
});
