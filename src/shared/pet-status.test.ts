import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { IDLE, startFocus } from './focus.ts';
import { setLang } from './i18n/index.ts';
import { DOING_KEEP, DoingSet, statusText } from './pet-status.ts';

afterEach(() => setLang('ko'));

const NOW = 1_800_000_000_000;

function set(saved: unknown = []) {
  const writes: number[][] = [];
  return { doing: new DoingSet(saved, (ids) => writes.push(ids)), writes };
}

test('진행 중 표시는 켜고 끄고, 같은 값이면 저장하지 않는다', () => {
  const { doing, writes } = set();
  assert.ok(doing.set(3, true));
  assert.ok(doing.set(5, true));
  assert.ok(!doing.set(3, true));
  assert.deepEqual(doing.ids(), [3, 5]);
  assert.ok(doing.set(3, false));
  assert.ok(!doing.set(3, false));
  assert.deepEqual(doing.ids(), [5]);
  assert.deepEqual(writes, [[3], [3, 5], [5]]);
});

test('저장된 값이 깨졌으면 걸러 읽는다 (다시 켜도 유지)', () => {
  assert.deepEqual(set([2, 2, 'a', -1, 1.5, null, 7]).doing.ids(), [2, 7]);
  assert.deepEqual(set('x').doing.ids(), []);
  assert.deepEqual(set(undefined).doing.ids(), []);
  const again = set(set([4, 9]).doing.ids());
  assert.deepEqual(again.doing.ids(), [4, 9]);
});

test('표시는 오래된 것부터 DOING_KEEP 개까지만 기억한다', () => {
  const { doing } = set();
  for (let id = 1; id <= DOING_KEEP + 5; id++) doing.set(id, true);
  assert.equal(doing.ids().length, DOING_KEEP);
  assert.ok(!doing.has(1) && doing.has(DOING_KEEP + 5));
});

test('말풍선 글: 하나, 여럿, 없음', () => {
  const s = { now: NOW, focus: IDLE, doingOn: true };
  assert.equal(statusText({ ...s, doing: [] }), null);
  assert.equal(statusText({ ...s, doing: ['보고서'] }), '▶ 진행 중: 보고서');
  assert.equal(statusText({ ...s, doing: ['보고서', '메일', '청소'] }), '▶ 진행 중: 보고서 외 2개');
  setLang('en');
  assert.equal(statusText({ ...s, doing: ['Report', 'Mail'] }), '▶ Working on: Report and 1 more');
});

test('겹침: 집중 중이면 집중 글이 진행 중보다 먼저', () => {
  const focus = startFocus(NOW, 25);
  const text = statusText({ now: NOW + 60_000, focus, doing: ['보고서'], doingOn: true });
  assert.equal(text, '집중 중, 24분 남았어');
  // 끝나기 직전
  assert.equal(
    statusText({ now: NOW + 24.5 * 60_000, focus, doing: [], doingOn: true }),
    '집중 중, 1분 안에 끝나',
  );
  // 쉬는 시간은 집중이 아니라 진행 중으로 돌아간다
  const rest = { ...focus, phase: 'break' as const };
  assert.equal(statusText({ now: NOW, focus: rest, doing: ['보고서'], doingOn: true }), '▶ 진행 중: 보고서');
  // 집중 중인데 진행 중이 없어도 집중 글
  assert.ok(statusText({ now: NOW, focus, doing: [], doingOn: true }));
});

test('설정이 꺼져 있으면 아무것도 안 띄운다', () => {
  assert.equal(statusText({ now: NOW, focus: startFocus(NOW), doing: ['a'], doingOn: false }), null);
});
