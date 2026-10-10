import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedbackText, issueUrl } from './feedback.ts';
import { setLang } from './i18n/index.ts';

test('의견 글: 베타 기록, 빈 줄, 머리말, 기록 줄', () => {
  assert.equal(
    feedbackText('짝꿍 0.1.0', ['a', 'b'], 3),
    '짝꿍 0.1.0\n\n진단 기록 (최근 2줄, 가린 곳 3군데)\na\nb',
  );
  assert.equal(feedbackText('s', [], 0), 's\n\n진단 기록 (아직 없음)');
});

test('문제 알리기 주소: 판과 운영체제만, 기록은 넣지 않는다', () => {
  const url = new URL(issueUrl({ owner: 'o', repo: 'r' }, { version: '0.1.0', os: '맥 15.1 arm64' }));
  assert.equal(url.origin + url.pathname, 'https://github.com/o/r/issues/new');
  const body = url.searchParams.get('body') ?? '';
  assert.ok(body.includes('0.1.0'));
  assert.ok(body.includes('맥 15.1 arm64'));
  assert.ok((url.searchParams.get('title') ?? '').length > 0);
  setLang('en');
  try {
    assert.ok(issueUrl({ owner: 'o', repo: 'r' }, { version: '1', os: 'macOS' }).includes('Version'));
  } finally {
    setLang('ko');
  }
});
