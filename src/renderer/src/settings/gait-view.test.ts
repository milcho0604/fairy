import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BLUEPRINTS } from '../../../shared/pet3d/defaults.ts';
import { starterFigureOf } from '../../../shared/pet3d/starters.ts';
import { applyPatch, gaitPatch, lookKey, parseSettings, standPatch } from '../../../shared/settings.ts';
import { gaitView } from './gait-view.ts';

// 사진 펫이 입체로 보이면 설계도가 있다. 시험에는 기본 냥이 설계도(두 발 몸, 네 발로 설 수 있다)를 쓴다
const CAT = DEFAULT_BLUEPRINTS.cat;
const MILK = 'pet-milk-1700000000000.png';

test('걸음새 칸 (#28): 기본 펫은 누른 단추가 켜지고 저장된다 (자동, 두 발, 네 발)', () => {
  let s = parseSettings({ petKind: 'kong' });
  assert.deepEqual(gaitView(s, undefined), { shape: 'biped', stands: false, picked: undefined, on: 'auto' });
  for (const pick of ['quadruped', 'biped', 'auto'] as const) {
    s = applyPatch(s, gaitPatch(s, pick));
    assert.equal(gaitView(s, undefined).on, pick);
  }
  assert.deepEqual(s.petGaits, {});
  // 입체로 보기를 꺼도 2D 기본 펫은 고를 수 있다
  const flat = applyPatch(parseSettings({ petKind: 'bunny', pet3d: false }), {});
  assert.equal(gaitView(flat, undefined).shape, 'quadruped');
  assert.equal(gaitView(applyPatch(flat, gaitPatch(flat, 'biped')), undefined).on, 'biped');
});

test('걸음새 칸 (#28): 입체 사진 펫은 설계도 열쇠로 저장되고 다시 읽어도 같은 단추가 켜진다', () => {
  let s = parseSettings({ petImage: 'pet-1.png', petModel: 'model-1.json' });
  assert.deepEqual(gaitView(s, CAT), { shape: 'biped', stands: false, picked: undefined, on: 'auto' });
  s = applyPatch(s, gaitPatch(s, 'quadruped'));
  assert.deepEqual(s.petGaits, { 'model-1.json': 'quadruped' });
  // 저장 파일을 다시 읽어도 (메인의 설정 검사를 거쳐도) 그대로
  const again = parseSettings(JSON.parse(JSON.stringify(s)));
  assert.equal(gaitView(again, CAT).on, 'quadruped');
  // 입체로 보기를 끄면 다리가 없어 흐리고 아무 단추도 켜지 않는다
  assert.deepEqual(gaitView({ ...s, pet3d: false }, CAT), {
    shape: undefined,
    stands: false,
    picked: undefined,
    on: undefined,
  });
});

test('걸음새 칸 (#28): 네 발로 선 몸은 고를 수 없지만 실제 걸음새인 네 발이 켜져 보인다', () => {
  // 사진 펫에 네 발로 서기를 켜면
  const photo = parseSettings({ petImage: 'pet-1.png', petModel: 'model-1.json' });
  const stood = applyPatch(photo, standPatch(photo, true));
  assert.deepEqual(gaitView(stood, CAT), {
    shape: undefined,
    stands: true,
    picked: undefined,
    on: 'quadruped',
  });
  // 예전에 두 발을 골라 뒀어도 네 발로 선 몸은 네 발로 걷는다 (pet.ts pickedBlueprint)
  const two = applyPatch(photo, gaitPatch(photo, 'biped'));
  assert.equal(gaitView(applyPatch(two, standPatch(two, true)), CAT).on, 'quadruped');
  // 네 발로 설 수 없는 몸(콩이)은 켜 둔 값이 있어도 고를 수 있다
  assert.equal(gaitView(stood, DEFAULT_BLUEPRINTS.kong).shape, 'biped');
  // 입체로 보기를 끄면 사진 그대로라 서지 않는다
  assert.equal(gaitView({ ...stood, pet3d: false }, CAT).stands, false);
});

test('걸음새 칸 (#28): 밀크, 초코는 사진이면 흐리고, 네 발 피규어를 켜면 네 발이 켜진다', () => {
  const milk = parseSettings({ petImage: MILK });
  // 사진 그대로 (기본): 피규어가 없다
  assert.equal(starterFigureOf(milk.petImage, milk.petStands), null);
  assert.equal(gaitView(milk, undefined).on, undefined);
  // 피규어를 켜면 앱에 든 네 발 피규어
  const on = applyPatch(milk, standPatch(milk, true));
  const figure = starterFigureOf(on.petImage, on.petStands) ?? undefined;
  assert.ok(figure?.stance);
  assert.deepEqual(gaitView(on, figure), {
    shape: undefined,
    stands: true,
    picked: undefined,
    on: 'quadruped',
  });
});

test('지금 펫 모습 열쇠 (#28): 밀크, 초코의 네 발 피규어를 켜고 끄면 바뀌어 설정 창이 모습을 다시 받는다', () => {
  const milk = parseSettings({ petImage: MILK });
  const on = applyPatch(milk, standPatch(milk, true));
  assert.notEqual(lookKey(on), lookKey(milk));
  assert.equal(lookKey(applyPatch(on, standPatch(on, false))), lookKey(milk));
  // 걸음새만 바꾸면 모습은 그대로 (다시 받지 않는다)
  const kong = parseSettings({ petKind: 'kong' });
  assert.equal(lookKey(applyPatch(kong, gaitPatch(kong, 'quadruped'))), lookKey(kong));
});

test('걸음새 칸 (#53): 기본 펫도 실사, 복슬복슬에서 네 발로 선 몸(냥이, 멍멍이, 햄찌, 곰돌이)은 고를 수 없이 네 발이 켜진다', () => {
  for (const petStyle of ['real', 'fluffy'] as const) {
    for (const petKind of ['cat', 'dog', 'hamster', 'bear'] as const) {
      const s = parseSettings({ petKind, petStyle });
      assert.deepEqual(gaitView(s, undefined), {
        shape: undefined,
        stands: true,
        picked: undefined,
        on: 'quadruped',
      });
      // 2D 로 보면 다시 고를 수 있다 (동그란 몸 기준)
      assert.equal(gaitView({ ...s, pet3d: false }, undefined).stands, false);
    }
    // 펭귄은 서서 걷는다
    assert.equal(gaitView(parseSettings({ petKind: 'penguin', petStyle }), undefined).shape, 'biped');
  }
  // 피규어, 게임은 동그란 몸이라 고를 수 있다
  for (const petStyle of ['figure', 'game'] as const)
    assert.equal(gaitView(parseSettings({ petKind: 'cat', petStyle }), undefined).on, 'auto');
});
