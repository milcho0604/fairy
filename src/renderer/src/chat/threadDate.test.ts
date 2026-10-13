import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../../../shared/i18n/index.ts';
import { threadDate } from './threadDate.ts';

test('지난 대화 날짜: 오늘은 시각, 어제, 올해는 월일, 그 전은 연도까지', () => {
  const now = new Date(2026, 9, 13, 15, 0).getTime();
  setLang('ko');
  assert.equal(threadDate(new Date(2026, 9, 13, 9, 5).getTime(), now), '오늘 09:05');
  assert.equal(threadDate(new Date(2026, 9, 12, 23, 59).getTime(), now), '어제');
  assert.equal(threadDate(new Date(2026, 2, 3).getTime(), now), '3월 3일');
  assert.match(threadDate(new Date(2025, 9, 3).getTime(), now), /2025/);
  setLang('en');
  assert.equal(threadDate(new Date(2026, 9, 13, 9, 5).getTime(), now), 'Today 09:05');
  assert.equal(threadDate(new Date(2026, 9, 12, 8).getTime(), now), 'Yesterday');
  assert.equal(threadDate(new Date(2026, 2, 3).getTime(), now), 'Mar 3');
  setLang('ko');
});
