import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandMirrors, MAX_PARTS, parseBlueprint } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './defaults.ts';
import { blueprintPrompt, extractBlueprint } from './prompt.ts';

test('기본 펫 설계도는 고르기를 거쳐도 그대로다', () => {
  for (const bp of Object.values(DEFAULT_BLUEPRINTS)) {
    assert.deepEqual(parseBlueprint(JSON.parse(JSON.stringify(bp))), bp);
  }
});

test('AI 답이 틀리면 그 부품만 버리고 숫자는 범위 안으로', () => {
  const bp = parseBlueprint({
    parts: [
      { slot: 'body', shape: 'sphere', at: [0, 0.5, 0], size: [9, 0.5, 0.5], color: '#ABCDEF' },
      { slot: 'wheel', shape: 'sphere', at: [0, 0, 0], size: [1, 1, 1], color: '#000000' },
      { slot: 'head', shape: 'blob', at: [0, 1, 0], size: [1, 1, 1], color: '#000000' },
      { slot: 'tail', shape: 'cone', at: [0, 'x', 0], size: [1, 1, 1], color: '#000000' },
      { slot: 'tail', shape: 'cone', at: [0, 0, 0], size: [1, 1, 1], color: 'red' },
      {
        slot: 'top',
        shape: 'torus',
        at: [0, 1, 0],
        size: [0.1, 0.1, 0.1],
        rot: [0, 999, 0],
        color: '#112233',
      },
    ],
    face: { slot: 'head', eyeY: 7, mouth: 'fangs' },
  });
  assert.ok(bp);
  assert.equal(bp.parts.length, 2);
  assert.deepEqual(bp.parts[0]?.size, [1.2, 0.5, 0.5]);
  assert.equal(bp.parts[0]?.color, '#abcdef');
  assert.deepEqual(bp.parts[1]?.rot, [0, 180, 0]);
  // 머리 부품이 없으니 얼굴은 몸에, 모르는 입은 웃는 입
  assert.equal(bp.face.slot, 'body');
  assert.equal(bp.face.eyeY, 2.5);
  assert.equal(bp.face.mouth, 'smile');
});

test('부품이 없거나 모양이 아니면 undefined, 부품은 상한까지만', () => {
  assert.equal(parseBlueprint(null), undefined);
  assert.equal(parseBlueprint({ parts: [] }), undefined);
  assert.equal(parseBlueprint('{"parts":1}'), undefined);
  const many = Array.from({ length: 100 }, () => ({
    slot: 'body',
    shape: 'sphere',
    at: [0, 0.5, 0],
    size: [0.1, 0.1, 0.1],
    color: '#ffffff',
  }));
  assert.equal(parseBlueprint({ parts: many })?.parts.length, MAX_PARTS);
});

test('거울 부품은 x 와 회전을 뒤집고 왼쪽, 오른쪽 슬롯을 바꾼다', () => {
  const out = expandMirrors([
    {
      slot: 'armL',
      shape: 'sphere',
      at: [-0.5, 0.4, 0.1],
      size: [0.1, 0.1, 0.1],
      rot: [10, 20, 30],
      color: '#000000',
      mirror: true,
    },
    {
      slot: 'armR',
      shape: 'sphere',
      at: [0.5, 0.4, 0],
      size: [0.1, 0.1, 0.1],
      color: '#000000',
      mirror: true,
    },
    { slot: 'top', shape: 'sphere', at: [-0.1, 1, 0], size: [0.1, 0.1, 0.1], color: '#000000', mirror: true },
  ]);
  assert.deepEqual(
    out.map((p) => [p.slot, p.at[0], p.rot]),
    [
      ['armL', -0.5, [10, 20, 30]],
      ['armR', 0.5, [10, -20, -30]],
      ['armR', 0.5, undefined],
      ['armL', -0.5, undefined],
      ['top', -0.1, undefined],
      ['top', 0.1, undefined],
    ],
  );
  assert.ok(out.every((p) => !('mirror' in p)));
});

test('AI 답에서 설계도 꺼내기: 코드 블록, 앞뒤 말, 깨진 답', () => {
  const bp = JSON.stringify(DEFAULT_BLUEPRINTS.chick);
  assert.deepEqual(extractBlueprint(`\`\`\`json\n${bp}\n\`\`\``), DEFAULT_BLUEPRINTS.chick);
  assert.deepEqual(extractBlueprint(`여기 있어:\n${bp}\n마음에 들면 좋겠어`), DEFAULT_BLUEPRINTS.chick);
  assert.equal(extractBlueprint('```json\n{"parts": [\n```'), undefined);
  assert.equal(extractBlueprint('사진이 안 보여요'), undefined);
});

test('요청문에 펫 이름과 형식이 들어간다', () => {
  const p = blueprintPrompt('보리 "강아지"');
  assert.ok(p.includes(JSON.stringify('보리 "강아지"')));
  assert.ok(p.includes('"wingL"') && p.includes('"beak"'));
});

test('몸도 머리도 없으면 쓸 수 없다, 얼굴은 부품이 있는 쪽에', () => {
  const tailOnly = {
    parts: [{ slot: 'tail', shape: 'sphere', at: [0, 0.5, 0], size: [0.1, 0.1, 0.1], color: '#ffffff' }],
  };
  assert.equal(parseBlueprint(tailOnly), undefined);
  const headOnly = parseBlueprint({
    parts: [{ slot: 'head', shape: 'sphere', at: [0, 0.5, 0], size: [0.3, 0.3, 0.3], color: '#ffffff' }],
    face: { slot: 'body' },
  });
  assert.equal(headOnly?.face.slot, 'head');
});

test('몸이 아주 작으면 쓸 수 없다', () => {
  const tiny = {
    parts: [
      { slot: 'body', shape: 'sphere', at: [0, 0.5, 0], size: [0.005, 0.005, 0.005], color: '#ffffff' },
    ],
  };
  assert.equal(parseBlueprint(tiny), undefined);
});
