import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUB_ITEMS, movedHits } from './hub-index.ts';
import { dicts } from './i18n/index.ts';

test('옮긴 항목 찾기: 말투는 페어리 구역, 캘린더는 비서 구역', () => {
  assert.deepEqual(
    movedHits('말투').map((h) => `${h.where}/${h.group}`),
    ['pet/voice'],
  );
  assert.deepEqual(
    movedHits('calendar').map((h) => h.where),
    ['assist'],
  );
  assert.ok(movedHits('걷기').some((h) => h.group === 'move'));
});

test('설정에 남은 말(언어, 로그아웃)과 빈 말은 옮긴 항목이 아니다', () => {
  assert.deepEqual(movedHits(''), []);
  assert.deepEqual(movedHits('로그아웃'), []);
  assert.deepEqual(movedHits('language'), []);
});

test('모든 묶음 이름이 사전에 있다', () => {
  for (const it of HUB_ITEMS) {
    for (const d of [dicts.ko, dicts.en])
      assert.ok(`hub.${it.where}.${it.group}` in d, `${it.where}.${it.group}`);
  }
});

test('낱말 앞부분만 맞는다: ai 는 gait, daily 에 걸리지 않고 AI 도우미에만', () => {
  assert.deepEqual(
    movedHits('ai').map((h) => `${h.where}/${h.group}`),
    ['assist/ai'],
  );
  assert.deepEqual(movedHits('ail'), []);
});

test('동의어와 앞부분: 휴식은 삐짐, 이름은 이름과 모습, 말은 말투와 말풍선', () => {
  assert.ok(movedHits('휴식').some((h) => h.group === 'mood'));
  assert.ok(movedHits('이름').some((h) => h.group === 'look'));
  const talk = movedHits('말').map((h) => h.group);
  assert.ok(talk.includes('voice') && talk.includes('talk'));
});

test('조합 중인 마지막 글자도 맞는다 (한글 입력 중 "말ㅌ")', () => {
  assert.ok(movedHits('말ㅌ', true).some((h) => h.group === 'voice'));
});
