import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBlueprint } from './pet3d/blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './pet3d/defaults.ts';
import { PET_KIND_IDS } from './settings.ts';
import {
  dressBlueprint,
  GROW_LOOK,
  growBlueprint,
  grownStage,
  nextGrow,
  OUTFITS,
  outfitFor,
  outfitParts,
  stageFor,
} from './wear.ts';

test('성장: 함께한 날과 친밀도로 아기, 어린이, 어른', () => {
  assert.equal(stageFor(1, 0), 'baby');
  assert.equal(stageFor(7, 0), 'kid');
  assert.equal(stageFor(2, 100), 'kid');
  assert.equal(stageFor(30, 299), 'kid');
  assert.equal(stageFor(30, 300), 'adult');
  assert.equal(stageFor(60, 0), 'adult');
});

test('성장은 되돌아가지 않는다', () => {
  assert.equal(grownStage(undefined, 'baby'), 'baby');
  assert.equal(grownStage('kid', 'baby'), 'kid');
  assert.equal(grownStage('kid', 'adult'), 'adult');
  assert.equal(grownStage('adult', 'kid'), 'adult');
});

test('다음 단계까지 남은 것', () => {
  assert.deepEqual(nextGrow('baby', 3, 40), { stage: 'kid', days: 4, affection: 60 });
  assert.deepEqual(nextGrow('kid', 40, 100), { stage: 'adult', days: 0, affection: 200 });
  assert.equal(nextGrow('adult', 1, 0), undefined);
});

test('철마다 옷: 철과 명절, 크리스마스', () => {
  assert.equal(outfitFor('2026-04-10'), 'flower');
  assert.equal(outfitFor('2026-07-01'), 'straw');
  assert.equal(outfitFor('2026-10-11'), 'scarf');
  assert.equal(outfitFor('2026-01-05'), 'beanie');
  assert.equal(outfitFor('2026-12-24'), 'santa');
  assert.equal(outfitFor('2026-12-28'), 'beanie');
  // 설날, 추석은 앞뒤 이틀까지
  assert.equal(outfitFor('2026-02-17'), 'ribbon');
  assert.equal(outfitFor('2026-02-15'), 'ribbon');
  assert.equal(outfitFor('2026-02-20'), 'beanie');
  assert.equal(outfitFor('2026-09-26'), 'ribbon');
  assert.equal(outfitFor('2028-10-04'), 'ribbon');
});

test('옷 부품: 모든 기본 펫, 모든 옷에 부품이 있고 모두 입는 옷 표시가 붙는다. 모자는 머리 위, 목도리는 몸', () => {
  for (const kind of PET_KIND_IDS)
    for (const outfit of OUTFITS) {
      const parts = outfitParts(DEFAULT_BLUEPRINTS[kind], outfit);
      assert.ok(parts.length > 0, `${kind} ${outfit}`);
      assert.ok(
        parts.every((p) => p.wear === true),
        `${kind} ${outfit}`,
      );
      for (const p of parts) {
        assert.equal(p.slot, outfit === 'scarf' ? 'body' : 'top', `${kind} ${outfit}`);
        assert.ok(p.at.every(Number.isFinite) && p.size.every((x) => Number.isFinite(x) && x > 0));
      }
    }
});

test('모자는 머리 꼭대기 근처에, 목도리는 입보다 아래에', () => {
  for (const kind of PET_KIND_IDS) {
    const bp = DEFAULT_BLUEPRINTS[kind];
    const head = bp.parts.find((p) => p.slot === (bp.face.slot === 'head' ? 'head' : 'body'));
    const top = (head?.at[1] ?? 0) + (head?.size[1] ?? 0);
    const hat = outfitParts(bp, 'beanie')[0];
    assert.ok(hat && Math.abs(hat.at[1] + hat.size[1] - top) < 0.15, kind);
    for (const p of outfitParts(bp, 'scarf')) assert.ok(p.at[1] < bp.face.mouthY, `${kind} 목도리`);
  }
});

test('옷 입히기: 원래 부품은 그대로 두고 옷만 더한다 (목도리를 두르면 개 목줄만 뺀다). 설계도 파일에는 표시가 남지 않는다', () => {
  const cat = DEFAULT_BLUEPRINTS.cat;
  const dressed = dressBlueprint(cat, { stage: 'adult', outfit: 'straw' });
  assert.equal(dressed.parts.length, cat.parts.length + outfitParts(cat, 'straw').length);
  assert.equal(dressBlueprint(cat, undefined), cat);
  assert.deepEqual(dressBlueprint(cat, { stage: 'adult' }), cat);
  const dog = dressBlueprint(DEFAULT_BLUEPRINTS.dog, { stage: 'adult', outfit: 'scarf' });
  assert.ok(!dog.parts.some((p) => !p.wear && p.color === '#e2504c'));
  // 손(팔)은 그대로 남는다
  assert.equal(
    dog.parts.filter((p) => p.slot === 'armL').length,
    DEFAULT_BLUEPRINTS.dog.parts.filter((p) => p.slot === 'armL').length,
  );
  // 밖에서 온 설계도의 wear 칸은 읽지 않는다
  const parsed = parseBlueprint({ ...dressed, v: 1 });
  assert.ok(parsed?.parts.every((p) => p.wear === undefined));
});

test('아기는 머리가 조금 크고 얼굴도 같이 커진다. 발과 몸은 그대로', () => {
  const cat = DEFAULT_BLUEPRINTS.cat;
  const baby = growBlueprint(cat, 'baby');
  const h = GROW_LOOK.baby.head;
  const head0 = cat.parts.find((p) => p.slot === 'head');
  const head1 = baby.parts.find((p) => p.slot === 'head');
  assert.ok(head0 && head1);
  assert.ok(Math.abs(head1.size[0] - head0.size[0] * h) < 1e-9);
  assert.ok(head1.at[1] > head0.at[1]);
  assert.ok(Math.abs(baby.face.eyeSize - cat.face.eyeSize * h) < 1e-9);
  assert.deepEqual(
    baby.parts.filter((p) => p.slot === 'legL'),
    cat.parts.filter((p) => p.slot === 'legL'),
  );
  // 얼굴이 몸에 있는 콩이는 눈만 조금 크게
  const kong = growBlueprint(DEFAULT_BLUEPRINTS.kong, 'baby');
  assert.deepEqual(kong.parts, DEFAULT_BLUEPRINTS.kong.parts);
  assert.ok(kong.face.eyeSize > DEFAULT_BLUEPRINTS.kong.face.eyeSize);
  assert.equal(growBlueprint(cat, 'adult'), cat);
  // 아기가 어른보다 작다
  assert.ok(GROW_LOOK.baby.scale < GROW_LOOK.kid.scale && GROW_LOOK.kid.scale < GROW_LOOK.adult.scale);
});

test('털이 긴 모습은 옷을 털 밖으로 낸다', () => {
  const a = outfitParts(DEFAULT_BLUEPRINTS.bunny, 'beanie', 0)[0];
  const b = outfitParts(DEFAULT_BLUEPRINTS.bunny, 'beanie', 0.05)[0];
  assert.ok(a && b && b.size[0] > a.size[0]);
});
