import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.TZ = 'Asia/Seoul';
const { endFromInput, lengthLabel, timeInputValue } = await import('./event-end.ts');
const { setLang } = await import('../../../shared/i18n/index.ts');

const at = (h: number, m = 0) => new Date(2026, 9, 24, h, m).getTime();

test('끝 시각 칸: 시작과 같은 날, 시작보다 늦어야 한다, 비우면 끝 없애기', () => {
  const start = at(14);
  assert.equal(endFromInput(start, '15:30'), at(15, 30));
  assert.equal(endFromInput(start, '14:01'), at(14, 1));
  assert.equal(endFromInput(start, '14:00'), undefined, '같으면 바꾸지 않는다');
  assert.equal(endFromInput(start, '13:00'), undefined, '시작보다 이르면 바꾸지 않는다');
  assert.equal(endFromInput(start, ''), null);
  assert.equal(endFromInput(start, '25:00'), undefined);
  assert.equal(endFromInput(start, '9:5'), undefined);
});

test('time 칸 값과 길이 글 (ko, en)', () => {
  assert.equal(timeInputValue(at(9, 5)), '09:05');
  setLang('ko');
  assert.equal(lengthLabel(at(14), at(14, 45)), '45분');
  assert.equal(lengthLabel(at(14), at(15)), '1시간');
  assert.equal(lengthLabel(at(14), at(15, 30)), '1시간 30분');
  setLang('en');
  assert.equal(lengthLabel(at(14), at(14, 45)), '45 min');
  assert.equal(lengthLabel(at(14), at(15)), '1 h');
  assert.equal(lengthLabel(at(14), at(15, 30)), '1 h 30 min');
  setLang('ko');
});
