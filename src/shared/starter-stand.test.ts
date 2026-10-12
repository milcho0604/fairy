// 밀크, 초코의 기본 모습 (0.4.1 사용자 결정): 기본은 0.3.0 처럼 사진 그대로, 네 발 피규어는 설정에서 켤 때만
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STARTER_LOOKS, starterFigureOf } from './pet3d/starters.ts';
import {
  applyPatch,
  DEFAULT_SETTINGS,
  parseSettings,
  pickedStand,
  type Settings,
  standKey,
  standPatch,
  starterStand,
} from './settings.ts';
import { starterFileName } from './starter-pets.ts';

const milk = starterFileName('milk', 1760000000000);
const choco = starterFileName('choco', 5);
const milkPet: Settings = { ...DEFAULT_SETTINGS, petImage: milk };

test('밀크, 초코는 기본이 사진: 설계도를 넣지 않는다', () => {
  assert.equal(starterFigureOf(milk, DEFAULT_SETTINGS.petStands), null);
  assert.equal(starterFigureOf(choco, {}), null);
  assert.equal(pickedStand(milkPet), false);
  assert.equal(starterStand(milkPet), false);
});

test('네 발로 선 피규어를 켜면 앱에 든 피규어', () => {
  const on = applyPatch(milkPet, standPatch(milkPet, true) ?? {});
  assert.deepEqual(on.petStands, { 'starter:milk': true });
  assert.equal(pickedStand(on), true);
  assert.equal(starterStand(on), true);
  assert.equal(starterFigureOf(milk, on.petStands), STARTER_LOOKS.milk);
  // 캐릭터마다 따로 (밀크를 켜도 초코는 사진)
  assert.equal(starterFigureOf(choco, on.petStands), null);
  const off = applyPatch(on, standPatch(on, false) ?? {});
  assert.deepEqual(off.petStands, {});
  assert.equal(starterFigureOf(milk, off.petStands), null);
});

test('네 발로 서기 키: 설계도 파일, 밀크와 초코 그림, 나머지는 없음', () => {
  assert.equal(standKey(milk, null), 'starter:milk');
  assert.equal(standKey(choco, undefined), 'starter:choco');
  // 만들기로 설계도를 붙인 밀크는 그 설계도가 열쇠 (예전 사진 펫과 같다)
  assert.equal(standKey(milk, 'model-1.json'), 'model-1.json');
  assert.equal(standKey('pet-123.png', null), undefined);
  assert.equal(standKey(null, null), undefined);
  assert.equal(standKey('pet-milk-1.png.png', null), undefined);
  // 기본 펫과 일반 사진 펫은 밀크, 초코 칸이 아니다
  assert.equal(starterStand(DEFAULT_SETTINGS), undefined);
  assert.equal(
    starterStand({ ...DEFAULT_SETTINGS, petImage: 'pet-1.png', petModel: 'model-1.json' }),
    undefined,
  );
  assert.equal(starterStand({ ...milkPet, petModel: 'model-1.json' }), undefined);
});

test('0.4.0 에서 쓰던 설정은 꺼짐으로 읽혀 사진이 보인다', () => {
  // 0.4.0 저장 파일: 밀크를 쓰고 있고 petStands 에는 다른 사진 펫 키만 있었다 (밀크, 초코는 늘 피규어였다)
  const old = parseSettings({
    petImage: milk,
    petStands: { 'model-9.json': true },
    petLibrary: [{ id: 'p-a', name: 'x', image: 'pet-2.png', model: 'model-9.json' }],
  });
  assert.equal(pickedStand(old), false);
  assert.equal(starterFigureOf(old.petImage, old.petStands), null);
  assert.deepEqual(old.petStands, { 'model-9.json': true });
});

test('켠 값은 저장했다 다시 읽어도 남고, 모르는 캐릭터 키는 버린다', () => {
  const back = parseSettings({
    petImage: choco,
    petStands: { 'starter:choco': true, 'starter:milk': true, 'starter:bunny': true, 'model-x.json': true },
  });
  assert.deepEqual(back.petStands, { 'starter:choco': true, 'starter:milk': true });
  assert.equal(starterFigureOf(choco, back.petStands), STARTER_LOOKS.choco);
});
