import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CARD_TITLE_LEN,
  CARD_TITLES,
  cardDiary,
  cardFileName,
  cardRange,
  cardTitles,
  clip,
  hoursMinutes,
  isPngDataUrl,
} from './week-card.ts';

test('주 범위: 월요일부터 일요일까지', () => {
  assert.deepEqual(cardRange('2026-10-11'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(cardRange('2026-10-12'), { from: '2026-10-12', to: '2026-10-18' });
});

test('집중 분을 시간과 분으로', () => {
  assert.deepEqual(hoursMinutes(0), { h: 0, m: 0 });
  assert.deepEqual(hoursMinutes(59.6), { h: 1, m: 0 });
  assert.deepEqual(hoursMinutes(205), { h: 3, m: 25 });
  assert.deepEqual(hoursMinutes(-5), { h: 0, m: 0 });
});

test('할 일 제목은 고른 때만, 같은 것과 빈 것은 빼고 다섯까지, 길면 말줄임', () => {
  assert.deepEqual(cardTitles(['보고서'], false), []);
  const long = '가'.repeat(40);
  const got = cardTitles(['보고서', '  ', '보고서', long, 'a', 'b', 'c', 'd'], true);
  assert.equal(got.length, CARD_TITLES);
  assert.equal(got[0], '보고서');
  assert.equal([...(got[1] ?? '')].length, CARD_TITLE_LEN);
  assert.ok(got[1]?.endsWith('…'));
});

test('한 줄 일기: 첫 문장만, 길면 자른다', () => {
  assert.equal(cardDiary(undefined), '');
  assert.equal(cardDiary('오늘은 세 개 끝냈다. 산책도 했다.'), '오늘은 세 개 끝냈다.');
  assert.equal(cardDiary('  줄바꿈\n 있는 글 '), '줄바꿈 있는 글');
  assert.ok([...cardDiary('가'.repeat(200))].length <= 70);
});

test('자르기는 사람이 보는 글자로 센다 (이모지 하나는 한 글자)', () => {
  assert.equal(clip('👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧', 3), '👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧');
  assert.equal(clip('abcdef', 4), 'abc…');
});

test('파일 이름과 받을 그림 검사', () => {
  assert.equal(cardFileName('짝꿍-이번주', '2026-10-11'), '짝꿍-이번주-2026-10-05.png');
  assert.equal(cardFileName('a/b:c', '2026-10-11'), 'abc-2026-10-05.png');
  assert.equal(cardFileName('  ', '2026-10-11'), 'jjakkung-2026-10-05.png');
  assert.equal(isPngDataUrl('data:image/png;base64,AAAA'), true);
  assert.equal(isPngDataUrl('data:image/jpeg;base64,AAAA'), false);
  assert.equal(isPngDataUrl(42), false);
});
