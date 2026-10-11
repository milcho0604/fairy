import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RestPhase } from './house-rest.ts';
import {
  type HouseHideReason,
  houseMenuKey,
  houseNewsKey,
  houseVisible,
  stowSayKey,
  stowStep,
} from './house-stow.ts';
import { dicts } from './i18n/index.ts';
import { applyPatch, DEFAULT_SETTINGS, parseSettings } from './settings.ts';

test('집은 감출 까닭이 하나도 없을 때만 보인다 (숨김과 펫 숨김이 서로를 풀지 않는다)', () => {
  const set = (...r: HouseHideReason[]) => new Set<HouseHideReason>(r);
  assert.equal(houseVisible(set()), true);
  assert.equal(houseVisible(set('stowed')), false);
  assert.equal(houseVisible(set('pet')), false);
  // 집을 숨긴 채 펫을 숨겼다 다시 보여도 집은 숨은 그대로
  const both = set('stowed', 'pet');
  both.delete('pet');
  assert.equal(houseVisible(both), false);
  // 집을 다시 보여도 펫이 숨어 있으면 집도 숨은 그대로
  const petOnly = set('stowed', 'pet');
  petOnly.delete('stowed');
  assert.equal(houseVisible(petOnly), false);
});

test('숨기기 전에: 집 안이나 가는 중이면 먼저 부르고, 나오는 중이나 문을 드나드는 중이면 기다린다', () => {
  const want: Record<RestPhase, 'now' | 'call' | 'wait'> = {
    out: 'now',
    going: 'call',
    inside: 'call',
    leaving: 'wait',
  };
  for (const [phase, step] of Object.entries(want) as [RestPhase, string][])
    assert.equal(stowStep(phase, false), step, phase);
  // 가는 중에 불러 밖이 되었어도 문간에서 펫을 주고받는 중이면 끝날 때까지 집이 있어야 한다
  assert.equal(stowStep('out', true), 'wait');
  // 집 안이면 문 드나들기와 상관없이 먼저 부른다 (안에 갇히지 않게)
  assert.equal(stowStep('inside', true), 'call');
});

test('펫 메뉴의 집 항목: 집을 안 샀으면 없고, 숨기면 다시 보이기로 바뀐다', () => {
  assert.equal(houseMenuKey(0, false), undefined);
  assert.equal(houseMenuKey(0, true), undefined);
  assert.equal(houseMenuKey(1, false), 'pet.menu.houseHide');
  assert.equal(houseMenuKey(5, true), 'pet.menu.houseShow');
});

test('숨겨 둔 동안 집을 늘리거나 모양을 바꾸면 "끌어서 옮길 수 있어" 대신 다시 보이면 보인다고 한다', () => {
  assert.equal(houseNewsKey('level', false), 'pet.newHouse');
  assert.equal(houseNewsKey('style', false), 'pet.houseStyle');
  assert.equal(houseNewsKey('level', true), 'pet.home.newStowed');
  assert.equal(houseNewsKey('style', true), 'pet.home.styleStowed');
  assert.equal(stowSayKey(true), 'pet.home.stowed');
  assert.equal(stowSayKey(false), 'pet.home.unstowed');
});

test('집 숨기기 글은 한국어와 영어가 다 있고, 숨긴 동안의 말은 다시 보이는 길을 알려 준다', () => {
  const keys = [
    'pet.menu.houseHide',
    'pet.menu.houseShow',
    'pet.home.stowed',
    'pet.home.unstowed',
    'pet.home.newStowed',
    'pet.home.styleStowed',
    'shop.houseHidden',
    'shop.houseShow',
  ] as const;
  for (const k of keys) {
    for (const lang of ['ko', 'en'] as const) {
      const v = (dicts[lang] as Record<string, unknown>)[k];
      assert.equal(typeof v, 'string', `${lang} ${k}`);
      assert.doesNotMatch(v as string, /[\u2014\u00b7]/, `${lang} ${k}: 긴 줄표, 가운뎃점`);
    }
  }
  for (const k of ['pet.home.stowed', 'pet.home.newStowed', 'pet.home.styleStowed'] as const) {
    assert.match(dicts.ko[k] as string, /다시 보이/, k);
    assert.match(dicts.en[k] as string, /show/i, k);
  }
});

test('설정 houseHidden: 기본은 보임, 저장한 값은 다시 켜도 그대로, 이상한 값은 보임으로', () => {
  assert.equal(DEFAULT_SETTINGS.houseHidden, false);
  const hidden = applyPatch(DEFAULT_SETTINGS, { houseHidden: true });
  assert.equal(hidden.houseHidden, true);
  // 파일로 쓰고 다시 읽은 것 (재시작)
  assert.equal(parseSettings(JSON.parse(JSON.stringify(hidden))).houseHidden, true);
  assert.equal(parseSettings({ houseHidden: 'yes' }).houseHidden, false);
  assert.equal(parseSettings({}).houseHidden, false);
  // 다른 설정을 바꿔도 숨김은 그대로
  assert.equal(applyPatch(hidden, { typeAlong: false }).houseHidden, true);
});
