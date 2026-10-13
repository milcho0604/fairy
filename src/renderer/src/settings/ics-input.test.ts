import assert from 'node:assert/strict';
import { test } from 'node:test';
import { icsInput } from './ics-input.ts';

const saved = 'https://calendar.google.com/calendar/ical/a/basic.ics';

test('https 주소는 다듬어 저장한다', () => {
  assert.deepEqual(icsInput('  https://example.com/a.ics ', undefined), {
    kind: 'save',
    url: 'https://example.com/a.ics',
  });
});

test('webcal 주소는 https 로 바꾼 값을 저장하고, 칸에도 그 값을 보인다', () => {
  assert.deepEqual(icsInput('webcal://example.com/a.ics', undefined), {
    kind: 'save',
    url: 'https://example.com/a.ics',
  });
});

test('저장된 주소와 같으면 다시 저장하지 않는다 (webcal 로 넣어 https 로 저장된 것도)', () => {
  assert.deepEqual(icsInput(saved, saved), { kind: 'same' });
  assert.deepEqual(icsInput(saved.replace('https://', 'webcal://'), saved), { kind: 'same' });
});

test('비우면 지운다. 원래 없었으면 할 일 없음', () => {
  assert.deepEqual(icsInput('   ', saved), { kind: 'clear' });
  assert.deepEqual(icsInput('', undefined), { kind: 'same' });
});

test('https 가 아닌 주소는 저장하지 않고 틀렸다고 알린다 (예전에는 버려지는데 "저장했어"가 떴다)', () => {
  assert.deepEqual(icsInput('calendar.google.com/abc', saved), { kind: 'bad' });
  assert.deepEqual(icsInput('http://example.com/a.ics', saved), { kind: 'bad' });
  assert.deepEqual(icsInput('not a url', undefined), { kind: 'bad' });
});

test('너무 긴 주소도 설정 검사처럼 받지 않는다', () => {
  assert.deepEqual(icsInput(`https://example.com/${'a'.repeat(2000)}`, undefined), { kind: 'bad' });
});
