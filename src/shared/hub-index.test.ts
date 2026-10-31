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
