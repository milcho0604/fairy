import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Blueprint, expandInners, expandParts, parseBlueprint, rotateVec } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './defaults.ts';
import { EXAMPLE_CAT, EXAMPLE_PLUSH } from './examples.ts';
import { critiquePrompt, extractBlueprint, extractBlueprintWithFixes } from './prompt.ts';
import { headRatio, partBox, repairBlueprint, shiftY } from './repair.ts';

const body = (y = 0.5): Blueprint['parts'][number] => ({
  slot: 'body',
  shape: 'sphere',
  at: [0, y, 0],
  size: [0.4, 0.4, 0.4],
  color: '#aabbcc',
});
const face: Blueprint['face'] = {
  slot: 'body',
  eyeY: 0.6,
  eyeGap: 0.15,
  eyeSize: 0.05,
  mouth: 'smile',
  mouthY: 0.45,
};

test('기본 펫과 보기 설계도는 손볼 것이 없다', () => {
  for (const bp of [...Object.values(DEFAULT_BLUEPRINTS), EXAMPLE_PLUSH, EXAMPLE_CAT]) {
    const { bp: out, fixes } = repairBlueprint(bp);
    assert.deepEqual(fixes, []);
    assert.deepEqual(out, bp);
  }
});

test('보기 설계도는 고르기를 거쳐도 그대로다 (v2 칸이 다 살아 있다)', () => {
  for (const bp of [EXAMPLE_PLUSH, EXAMPLE_CAT]) {
    assert.deepEqual(parseBlueprint(JSON.parse(JSON.stringify(bp))), bp);
  }
  assert.equal(EXAMPLE_CAT.parts.find((p) => p.shape === 'tube')?.path?.length, 4);
  assert.equal(EXAMPLE_CAT.face.nose?.shape, 'triangle');
});

test('떠 있는 몸은 바닥으로 내리고, 묻힌 몸은 올린다 (얼굴 높이와 관의 길도 같이)', () => {
  const up: Blueprint = {
    v: 2,
    parts: [
      body(0.9),
      {
        slot: 'legL',
        shape: 'sphere',
        at: [-0.2, 0.55, 0.1],
        size: [0.1, 0.1, 0.1],
        color: '#aabbcc',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'tube',
        at: [0, 0.8, -0.4],
        size: [0.05, 0.05, 0.05],
        path: [
          [0, 0.8, -0.4],
          [0, 1.1, -0.5],
        ],
        color: '#aabbcc',
      },
    ],
    face: { ...face, eyeY: 1, mouthY: 0.85, nose: { shape: 'dot', color: '#000000', y: 0.9 } },
  };
  const { bp, fixes } = repairBlueprint(up);
  assert.deepEqual(fixes, ['ground -0.45']);
  const near = (a: number | undefined, b: number) =>
    assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} ~ ${b}`);
  near(bp.parts[0]?.at[1], 0.45);
  near(bp.parts[1]?.at[1], 0.1);
  near(bp.parts[2]?.path?.[1]?.[1], 0.65);
  near(bp.face.eyeY, 0.55);
  near(bp.face.nose?.y, 0.45);
  // 원본은 그대로
  assert.equal(up.parts[0]?.at[1], 0.9);
  const sunk = repairBlueprint({ v: 1, parts: [body(0.2)], face });
  assert.deepEqual(sunk.fixes, ['ground +0.20']);
  assert.equal(sunk.bp.parts[0]?.at[1], 0.4);
  // 3% 안이면 그대로
  assert.deepEqual(repairBlueprint({ v: 1, parts: [body(0.41)], face }).fixes, []);
});

test('한쪽만 있는 다리, 팔, 귀는 거울로 짝을 채운다', () => {
  const one: Blueprint = {
    v: 2,
    parts: [
      body(0.4),
      { slot: 'legR', shape: 'sphere', at: [0.2, 0.05, 0.1], size: [0.1, 0.05, 0.1], color: '#aabbcc' },
      { slot: 'earL', shape: 'cone', at: [-0.3, 0.75, 0], size: [0.1, 0.12, 0.05], color: '#aabbcc' },
      { slot: 'armL', shape: 'sphere', at: [-0.4, 0.4, 0], size: [0.08, 0.1, 0.08], color: '#aabbcc' },
      { slot: 'armR', shape: 'sphere', at: [0.4, 0.4, 0], size: [0.08, 0.1, 0.08], color: '#aabbcc' },
    ],
    face,
  };
  const { bp, fixes } = repairBlueprint(one);
  assert.deepEqual(fixes, ['mirror legR', 'mirror earL']);
  assert.equal(bp.parts[1]?.mirror, true);
  assert.equal(bp.parts[2]?.mirror, true);
  assert.equal(bp.parts[3]?.mirror, undefined);
  // 펼치면 네 다리 귀가 양쪽에
  const all = expandParts(bp.parts);
  assert.deepEqual(
    all
      .filter((p) => p.slot.startsWith('leg') || p.slot.startsWith('ear'))
      .map((p) => p.slot)
      .sort(),
    ['earL', 'earR', 'legL', 'legR'],
  );
});

test('허공에 뜬 부품은 가까운 몸 쪽으로 당겨 붙인다', () => {
  const far: Blueprint = {
    v: 2,
    parts: [
      body(0.4),
      { slot: 'top', shape: 'sphere', at: [0, 1.4, 0], size: [0.05, 0.05, 0.05], color: '#aabbcc' },
    ],
    face,
  };
  const { bp, fixes } = repairBlueprint(far);
  assert.deepEqual(fixes, ['attach top']);
  const top = bp.parts[1];
  assert.ok(top && top.at[1] < 1.4 && top.at[1] > 0.7, String(top?.at[1]));
  assert.equal(top?.at[0], 0);
});

test('부품 상자: 돌린 캡슐과 관', () => {
  const b = partBox({
    slot: 'tail',
    shape: 'capsule',
    at: [0, 0.5, 0],
    size: [0.05, 0.3, 0.05],
    rot: [0, 0, 90],
    color: '#000000',
  });
  assert.ok(Math.abs(b.max[0] - 0.3) < 1e-9 && Math.abs(b.max[1] - 0.55) < 1e-9);
  const t = partBox({
    slot: 'tail',
    shape: 'tube',
    at: [0, 0, 0],
    size: [0.1, 0.1, 0.1],
    path: [
      [0, 0, 0],
      [0.5, 0.2, 0],
    ],
    color: '#000000',
  });
  assert.ok(
    t.max.every((v, i) => Math.abs(v - ([0.6, 0.3, 0.1][i] ?? 0)) < 1e-9),
    String(t.max),
  );
  assert.ok(
    t.min.every((v, i) => Math.abs(v - ([-0.1, -0.1, -0.1][i] ?? 0)) < 1e-9),
    String(t.min),
  );
  // three.js Euler XYZ 와 같은 돌림: z 축 90도면 +y 가 -x 로
  const v = rotateVec([0, 1, 0], 0, 0, 90);
  assert.ok(Math.abs(v[0] + 1) < 1e-9 && Math.abs(v[1]) < 1e-9);
});

test('안쪽 색은 앞면에 작고 납작한 같은 모양으로 펼쳐진다 (거울 칸은 따라간다)', () => {
  const out = expandInners([
    {
      slot: 'earL',
      shape: 'cone',
      at: [-0.3, 1, 0],
      size: [0.1, 0.14, 0.06],
      color: '#aaaaaa',
      inner: '#ffbbcc',
      mirror: true,
      finish: 'fuzzy',
    },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.inner, undefined);
  const inner = out[1];
  assert.ok(inner);
  assert.equal(inner.color, '#ffbbcc');
  assert.equal(inner.mirror, true);
  assert.equal(inner.finish, 'soft');
  assert.ok(inner.at[2] > 0 && inner.size[0] < 0.1 && inner.size[2] < 0.06);
  // 원뿔은 밑면을 맞춘다 (가운데가 조금 내려간다)
  assert.ok(inner.at[1] < 1);
  assert.equal(expandParts(out).length, 4);
});

test('머리:몸 비율과 전체 옮기기', () => {
  assert.equal(headRatio(DEFAULT_BLUEPRINTS.kong), undefined);
  const r = headRatio(EXAMPLE_PLUSH);
  assert.ok(r && r > 1 && r < 1.25, String(r));
  const moved = shiftY(EXAMPLE_CAT, 0.1);
  assert.equal(moved.face.eyeY, EXAMPLE_CAT.face.eyeY + 0.1);
  assert.equal(moved.parts[0]?.at[1], (EXAMPLE_CAT.parts[0]?.at[1] ?? 0) + 0.1);
});

test('AI 답에서 꺼낼 때 손본 내용을 같이 돌려준다', () => {
  const raw = {
    v: 2,
    parts: [
      body(0.6),
      { slot: 'legL', shape: 'sphere', at: [-0.2, 0.25, 0.1], size: [0.1, 0.05, 0.1], color: '#aabbcc' },
    ],
    face,
  };
  const r = extractBlueprintWithFixes(`\`\`\`json\n${JSON.stringify(raw)}\n\`\`\``);
  assert.ok(r);
  assert.deepEqual(r.fixes, ['mirror legL', 'ground -0.20']);
  assert.equal(r.bp.parts[1]?.at[1], 0.05);
  assert.equal(extractBlueprint(JSON.stringify(raw))?.parts[0]?.at[1], 0.4);
});

test('두 번째 보기 요청문: 사진과 그림을 견주고 설계도를 한 번 고친다', () => {
  const p = critiquePrompt('밀크', EXAMPLE_PLUSH, '리본 달아 줘', 'biped');
  assert.match(p, /Image 1 is the owner's photo/);
  assert.match(p, /"critique"/);
  assert.ok(p.includes(JSON.stringify(EXAMPLE_PLUSH)));
  assert.ok(p.includes(JSON.stringify('리본 달아 줘')));
  assert.match(p, /"gait": "biped"; keep it/);
  const plain = critiquePrompt('밀크', EXAMPLE_PLUSH);
  assert.ok(!plain.includes('wish'));
  assert.ok(!plain.includes('keep it'));
  // 고친 답도 같은 길로 꺼낸다 (critique 칸은 남지 않는다)
  const bp = extractBlueprint(`{"critique":["ears bigger"],${JSON.stringify(EXAMPLE_PLUSH).slice(1)}`);
  assert.deepEqual(bp, EXAMPLE_PLUSH);
});

test('손본 설계도는 저장했다 다시 읽어도 그대로 (마구 만든 설계도 3000개)', () => {
  // 시드 고정 난수 (mulberry32): 실패하면 같은 설계도로 다시 볼 수 있게
  let seed = 0x5eed;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const r = (a: number, b: number) => a + rnd() * (b - a);
  const slots = ['body', 'head', 'legL', 'legR', 'armL', 'earL', 'tail', 'wingL'];
  const shapes = ['sphere', 'box', 'capsule', 'cone', 'cylinder', 'tube'];
  let checked = 0;
  for (let i = 0; i < 3000; i++) {
    const raw = {
      parts: Array.from({ length: 1 + Math.floor(rnd() * 8) }, (_, k) => ({
        slot: k === 0 ? 'body' : slots[Math.floor(rnd() * slots.length)],
        shape: shapes[Math.floor(rnd() * shapes.length)],
        at: [r(-1.5, 1.5), r(-1.5, 2.5), r(-1, 1)],
        size: [r(0.01, 1.2), r(0.01, 1.2), r(0.01, 1.2)],
        rot: rnd() < 0.3 ? [r(-90, 90), r(-90, 90), r(-90, 90)] : undefined,
        inner: rnd() < 0.2 ? '#ffccdd' : undefined,
        color: '#aabbcc',
        mirror: rnd() < 0.3,
        path: [
          [0, 0, 0],
          [r(-1, 1), r(-1.5, 2.5), 0],
        ],
      })),
      face: {
        eyeY: r(0, 2.5),
        mouthY: r(0, 2.5),
        nose: { shape: 'dot', color: '#000000', y: r(0, 2.5) },
        brows: { color: '#000000', y: r(0, 2.5) },
      },
    };
    const bp = parseBlueprint(raw);
    if (!bp) continue;
    const fixed = repairBlueprint(bp).bp;
    const back = parseBlueprint(JSON.parse(JSON.stringify(fixed)));
    assert.deepEqual(back, fixed, `설계도 ${i}`);
    checked++;
  }
  assert.ok(checked > 2500);
});
