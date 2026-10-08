import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventLink, isMeetingUrl, safeExternalUrl, shortLinks, splitLinks } from './links.ts';

const urls = (text: string) => splitLinks(text).flatMap((p) => ('url' in p ? [p.url] : []));

test('글 속 주소를 나누고 앞뒤 글은 그대로 둔다', () => {
  assert.deepEqual(splitLinks('여기 https://example.com/a 봐'), [
    { text: '여기 ' },
    { url: 'https://example.com/a', text: 'https://example.com/a' },
    { text: ' 봐' },
  ]);
  assert.deepEqual(splitLinks('주소 없음'), [{ text: '주소 없음' }]);
  assert.deepEqual(splitLinks(''), [{ text: '' }]);
});

test('문장 끝 부호와 짝 없는 괄호, 붙은 한글은 주소에서 뗀다', () => {
  assert.deepEqual(urls('봐: https://example.com/x.'), ['https://example.com/x']);
  assert.deepEqual(urls('(https://example.com/x)'), ['https://example.com/x']);
  assert.deepEqual(urls('https://zoom.us/j/123에서 보자'), ['https://zoom.us/j/123']);
  assert.deepEqual(urls('https://en.wikipedia.org/wiki/Foo_(bar)'), [
    'https://en.wikipedia.org/wiki/Foo_(bar)',
  ]);
  // 뗀 부호는 글로 남는다
  const parts = splitLinks('https://a.com/b!');
  assert.equal(parts.map((p) => p.text).join(''), 'https://a.com/b!');
});

test('http, https 가 아니거나 속이는 주소는 열지 않는다', () => {
  assert.equal(safeExternalUrl('https://example.com'), 'https://example.com/');
  assert.equal(safeExternalUrl('http://example.com/a?b=1'), 'http://example.com/a?b=1');
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined);
  assert.equal(safeExternalUrl('file:///etc/passwd'), undefined);
  assert.equal(safeExternalUrl('https://good.com@evil.com/'), undefined);
  assert.equal(safeExternalUrl('https://'), undefined);
  assert.equal(safeExternalUrl(42), undefined);
  assert.equal(safeExternalUrl(`https://a.com/${'x'.repeat(3000)}`), undefined);
  assert.deepEqual(urls('javascript:alert(1) https://good.com@evil.com'), []);
});

test('일정 제목 속 회의 주소는 회의, 다른 주소는 링크', () => {
  assert.deepEqual(eventLink('주간 회의 https://us02web.zoom.us/j/8123?pwd=abc'), {
    url: 'https://us02web.zoom.us/j/8123?pwd=abc',
    meeting: true,
  });
  assert.deepEqual(eventLink('자료 https://docs.example.com/x 회의 https://meet.google.com/abc-defg-hij'), {
    url: 'https://meet.google.com/abc-defg-hij',
    meeting: true,
  });
  assert.deepEqual(eventLink('자료 https://docs.example.com/x'), {
    url: 'https://docs.example.com/x',
    meeting: false,
  });
  assert.equal(eventLink('점심 약속'), undefined);
  assert.equal(isMeetingUrl('https://teams.microsoft.com/l/meetup-join/1'), true);
  assert.equal(isMeetingUrl('https://notzoom.us/j/1'), false);
});

test('말풍선 제목은 긴 주소 대신 호스트만', () => {
  assert.equal(shortLinks('주간 회의 https://www.zoom.us/j/8123?pwd=abc'), '주간 회의 zoom.us');
  assert.equal(shortLinks('주간 회의 https://us02web.zoom.us/j/8123?pwd=abc'), '주간 회의 zoom.us');
  assert.equal(shortLinks('자료 https://www.example.com/a/b?c=1 보기'), '자료 example.com 보기');
  assert.equal(shortLinks('점심'), '점심');
});
