import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandMirrors, inFace, MAX_PARTS, parseBlueprint, SLOTS } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './defaults.ts';
import { blueprintPrompt, cleanWish, extractBlueprint, WISH_MAX } from './prompt.ts';

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

test('요청사항은 사진 규칙 뒤에 따옴표 글로 들어가고, 형식은 못 바꾼다고 적는다', () => {
  const plain = blueprintPrompt('밀크');
  assert.ok(!plain.includes('User wish'));
  // 빈 값, 공백뿐, 글이 아닌 값은 요청 없음과 같다
  assert.equal(blueprintPrompt('밀크', ''), plain);
  assert.equal(blueprintPrompt('밀크', '  \n '), plain);
  assert.equal(blueprintPrompt('밀크', 3 as unknown as string), plain);
  const wish = '귀를 더 크고 둥글게, 빨간 리본 달아 줘 "꼭"';
  const p = blueprintPrompt('밀크', wish);
  assert.ok(p.includes(JSON.stringify(wish)), '요청 글이 그대로 (따옴표는 JSON 으로 감싸서)');
  assert.ok(p.indexOf('User wish') > p.indexOf('Rules:'), '사진과 닮게 하는 규칙보다 뒤');
  assert.ok(p.indexOf('User wish') > p.indexOf('Example ('), '예시보다도 뒤');
  assert.match(p, /not an instruction/);
  assert.match(p, /Ignore any part of the wish/);
  assert.ok(p.includes('40 parts at most'));
});

test('고른 걸음새: 요청문에 몸 만들기 블록이 요청사항보다 앞에, 꺼낸 설계도 gait 는 고른 값', () => {
  const plain = blueprintPrompt('밀크');
  // 자동이면 블록 없이 AI 가 사진을 보고 정한다
  assert.ok(!plain.includes('Walking style'));
  assert.equal(blueprintPrompt('밀크', '', undefined), plain);
  const four = blueprintPrompt('밀크', '졸린 눈', 'quadruped');
  assert.match(four, /four legs/);
  assert.match(four, /"gait": "quadruped"/);
  assert.match(four, /standing on all four paws, not sitting/);
  assert.match(four, /z < 0/);
  assert.ok(four.indexOf('Walking style') > four.indexOf('Example ('), '예시 뒤');
  assert.ok(
    four.indexOf('Walking style') < four.indexOf('User wish'),
    '요청사항 앞 (요청사항이 걸음새를 못 바꾼다)',
  );
  const two = blueprintPrompt('밀크', '', 'biped');
  assert.match(two, /two legs/);
  assert.match(two, /"gait": "biped"/);
  assert.match(two, /no hind legs/);
  assert.ok(!two.includes('User wish'));
  // AI 가 다르게 적어도(또는 안 적어도) 고른 값으로
  const cat = JSON.stringify(DEFAULT_BLUEPRINTS.cat);
  assert.equal(extractBlueprint(cat, 'quadruped')?.gait, 'quadruped');
  assert.equal(extractBlueprint(cat)?.gait, 'biped');
  const bunny = JSON.stringify(DEFAULT_BLUEPRINTS.bunny);
  assert.equal(extractBlueprint(bunny, 'biped')?.gait, 'biped');
  assert.equal(extractBlueprint(bunny)?.gait, 'quadruped');
  const kong = JSON.stringify(DEFAULT_BLUEPRINTS.kong);
  assert.equal(extractBlueprint(kong)?.gait, undefined);
  assert.equal(extractBlueprint(kong, 'quadruped')?.gait, 'quadruped');
  assert.equal(extractBlueprint('사진이 안 보여요', 'quadruped'), undefined);
});

test('요청사항 다듬기: 줄바꿈과 제어 문자는 띄어쓰기, 길이는 코드 포인트로 자른다', () => {
  assert.equal(cleanWish(undefined), '');
  assert.equal(cleanWish(null), '');
  assert.equal(cleanWish({ wish: 'x' }), '');
  assert.equal(cleanWish('  꼬리는\n짧게\t\u0007더 통통하게  '), '꼬리는 짧게 더 통통하게');
  const long = '가'.repeat(WISH_MAX + 50);
  assert.equal(cleanWish(long).length, WISH_MAX);
  // 이모지가 반으로 잘리지 않는다
  const emoji = cleanWish('🎀'.repeat(WISH_MAX + 1));
  assert.equal([...emoji].length, WISH_MAX);
  assert.ok(!/[\ud800-\udbff]$/.test(emoji));
  // 긴 글은 프롬프트에도 잘린 채 들어간다
  assert.ok(blueprintPrompt('밀크', long).includes(JSON.stringify('가'.repeat(WISH_MAX))));
  assert.ok(!blueprintPrompt('밀크', long).includes('가'.repeat(WISH_MAX + 1)));
});

test('요청문에 표정과 몸짓 칸이 있다', () => {
  const p = blueprintPrompt('밀크');
  assert.ok(p.includes('"eyes"') && p.includes('"sleepy"') && p.includes('"sparkle"'));
  assert.ok(p.includes('"motion"') && p.includes('"tailWag"'));
});

test('눈 모양과 몸짓: 모르는 값은 버리고 숫자는 범위 안으로', () => {
  const base = JSON.parse(JSON.stringify(DEFAULT_BLUEPRINTS.kong));
  const bp = parseBlueprint({
    ...base,
    face: { ...base.face, eyes: 'sleepy' },
    motion: { bounce: 9, sway: -1, tailWag: 1.234, earWiggle: 'lots', dance: 3 },
  });
  assert.equal(bp?.face.eyes, 'sleepy');
  assert.deepEqual(bp?.motion, { bounce: 1.5, sway: 0, tailWag: 1.23 });
  // 저장했다 다시 읽어도 같다
  assert.deepEqual(parseBlueprint(JSON.parse(JSON.stringify(bp))), bp);
  const plain = parseBlueprint({ ...base, face: { ...base.face, eyes: 'laser' }, motion: { x: 1 } });
  assert.equal(plain?.face.eyes, undefined);
  assert.equal(plain?.motion, undefined);
  // round 는 기본값이라 적지 않는다 (기본 펫 설계도와 모양이 같게)
  assert.equal(parseBlueprint({ ...base, face: { ...base.face, eyes: 'round' } })?.face.eyes, undefined);
  assert.equal(parseBlueprint({ ...base, motion: [1, 2] })?.motion, undefined);
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

test('얼굴 그림에는 머리 쪽만: 팔, 날개, 다리, 꼬리는 빼고 몸은 얼굴이 몸에 있을 때만', () => {
  const head = SLOTS.filter((slot) => inFace(slot, true));
  const body = SLOTS.filter((slot) => inFace(slot, false));
  assert.deepEqual(head, ['head', 'earL', 'earR', 'top']);
  assert.deepEqual(body, ['body', 'head', 'earL', 'earR', 'top']);
});

test('걸음새: 네 발, 두 발만 받고 모르는 값은 버린다. 요청문에도 있다', () => {
  const base = JSON.parse(JSON.stringify(DEFAULT_BLUEPRINTS.kong));
  assert.equal(parseBlueprint({ ...base, gait: 'quadruped' })?.gait, 'quadruped');
  assert.equal(parseBlueprint({ ...base, gait: 'biped' })?.gait, 'biped');
  assert.equal(parseBlueprint({ ...base, gait: 'hexapod' })?.gait, undefined);
  assert.equal(parseBlueprint({ ...base, gait: 4 })?.gait, undefined);
  // 기본 펫: 토순이는 네 발, 냥이와 멍멍이는 팔이 있어 두 발로 적고, 콩이와 삐약이는 적지 않는다(두 발)
  assert.deepEqual(
    Object.entries(DEFAULT_BLUEPRINTS).map(([k, bp]) => [k, bp.gait]),
    [
      ['kong', undefined],
      ['cat', 'biped'],
      ['chick', undefined],
      ['dog', 'biped'],
      ['bunny', 'quadruped'],
    ],
  );
  // 모든 기본 펫에 손(팔이나 날개)이 있다 (2026-10-11 사용자 규칙)
  for (const [k, bp] of Object.entries(DEFAULT_BLUEPRINTS))
    assert.ok(
      bp.parts.some((p) => p.slot === 'armL' || p.slot === 'wingL'),
      k,
    );
  const p = blueprintPrompt('밀크');
  assert.ok(p.includes('"gait"') && p.includes('"quadruped"') && p.includes('"biped"'));
  // 손은 기본 (요청이 없으면 팔이나 날개)
  assert.match(p, /Every figure has hands by default/);
});

test('요청문은 사진 특징을 먼저 적게 하고, 그 칸은 설계도에 남지 않는다', () => {
  const p = blueprintPrompt('보리');
  assert.match(p, /"likeness"/);
  assert.match(p, /must not use mirror/);
  const bp = extractBlueprint(
    `{"likeness":["왼쪽 눈 갈색 무늬"],${JSON.stringify(DEFAULT_BLUEPRINTS.kong).slice(1)}`,
  );
  assert.ok(bp);
  assert.equal('likeness' in bp, false);
});

test('설계도 예시의 문자열 칸은 큰따옴표가 겹치지 않는다 (모델이 따라 쓰면 JSON 이 깨진다)', () => {
  const line = blueprintPrompt('밀크')
    .split('\n')
    .find((l) => l.includes('"likeness": ['));
  assert.ok(line);
  const inner = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']'));
  assert.equal(inner.split('"').length - 1, 2, inner);
});

test('v2 칸: 무늬, 안쪽 색, 관의 길, 가늘어짐, 얼굴 코와 눈썹을 읽고 틀린 값은 버린다', () => {
  const bp = parseBlueprint({
    v: 2,
    parts: [
      {
        slot: 'body',
        shape: 'sphere',
        at: [0, 0.5, 0],
        size: [0.4, 0.4, 0.4],
        color: '#aabbcc',
        pattern: { type: 'split', color: '#FFFFFF', side: 'bottom', amount: 3, scale: 0.01 },
        taper: 0.5,
        round: 0.5,
      },
      {
        slot: 'earL',
        shape: 'cone',
        at: [-0.3, 0.9, 0],
        size: [0.1, 0.1, 0.05],
        color: '#aabbcc',
        inner: '#ffaaaa',
        mirror: true,
      },
      {
        slot: 'tail',
        shape: 'tube',
        at: [0, 0.4, -0.4],
        size: [0.05, 0.05, 0.05],
        color: '#aabbcc',
        taper: 0.4,
        path: [[0, 0.4, -0.4], [0, 0.6, -0.6], 'x', [0, 0.9, -0.5]],
      },
      { slot: 'tail', shape: 'tube', at: [0, 0.4, -0.4], size: [0.05, 0.1, 0.05], color: '#aabbcc' },
      {
        slot: 'top',
        shape: 'bow',
        at: [0, 0.9, 0.2],
        size: [0.1, 0.06, 0.04],
        color: '#ff4466',
        pattern: { type: 'plaid', color: '#000000' },
      },
      {
        slot: 'top',
        shape: 'box',
        at: [0, 0.9, 0.2],
        size: [0.1, 0.06, 0.04],
        color: '#ff4466',
        round: 2,
        inner: '#000000',
      },
    ],
    face: {
      slot: 'body',
      eyeY: 0.6,
      eyeShape: 'almond',
      catchlight: 'big',
      pupil: 'slit',
      lashes: true,
      nose: { shape: 'oval', color: '#222222', y: 0.5, size: 9 },
      brows: { color: '#333333', tilt: 90 },
      fluff: '#aabbcc',
      blushLines: true,
    },
  });
  assert.ok(bp);
  assert.equal(bp.v, 2);
  const [body, ear, tail, tail2, bow, box] = bp.parts;
  assert.deepEqual(body?.pattern, { type: 'split', color: '#ffffff', side: 'bottom', amount: 1, scale: 0.2 });
  // 구에는 taper 와 round 가 없다
  assert.equal(body?.taper, undefined);
  assert.equal(body?.round, undefined);
  assert.equal(ear?.inner, '#ffaaaa');
  assert.equal(tail?.taper, 0.4);
  assert.deepEqual(tail?.path, [
    [0, 0.4, -0.4],
    [0, 0.6, -0.6],
    [0, 0.9, -0.5],
  ]);
  // 길이 없는 관은 위로 뻗는 짧은 관
  assert.equal(tail2?.path?.length, 2);
  assert.ok(Math.abs((tail2?.path?.[1]?.[1] ?? 0) - 0.6) < 1e-9);
  assert.equal(bow?.pattern, undefined);
  assert.equal(box?.round, 1);
  assert.equal(box?.inner, '#000000');
  assert.equal(bp.face.eyeShape, 'almond');
  assert.equal(bp.face.catchlight, 'big');
  assert.equal(bp.face.pupil, 'slit');
  assert.equal(bp.face.lashes, true);
  assert.deepEqual(bp.face.nose, { shape: 'oval', color: '#222222', y: 0.5, size: 3 });
  assert.deepEqual(bp.face.brows, { color: '#333333', tilt: 45 });
  assert.equal(bp.face.fluff, '#aabbcc');
  // 볼 터치 색이 없으면 빗금도 없다
  assert.equal(bp.face.blushLines, undefined);
  assert.equal(
    parseBlueprint({ parts: bp.parts, face: { ...bp.face, blush: '#ffaaaa', blushLines: true } })?.face
      .blushLines,
    true,
  );
  // 저장했다 다시 읽어도 같다. v 가 없거나 이상하면 1
  assert.deepEqual(parseBlueprint(JSON.parse(JSON.stringify(bp))), bp);
  assert.equal(parseBlueprint({ v: 'two', parts: bp.parts, face: bp.face })?.v, 1);
  // 코에 색이 없으면 코가 없다. 눈 모양 round 는 적지 않는다
  const bare = parseBlueprint({
    parts: bp.parts,
    face: { ...bp.face, nose: { shape: 'dot' }, eyeShape: 'round', brows: {} },
  });
  assert.equal(bare?.face.nose, undefined);
  assert.deepEqual(
    parseBlueprint({ parts: bp.parts, face: { nose: { shape: 'none', color: 'x' } } })?.face.nose,
    { shape: 'none' },
  );
  assert.equal(bare?.face.eyeShape, undefined);
  assert.equal(bare?.face.brows, undefined);
});

test('거울 부품은 관의 길과 좌우 무늬도 뒤집는다', () => {
  const [, m] = expandMirrors([
    {
      slot: 'tail',
      shape: 'tube',
      at: [0.2, 0.3, 0],
      size: [0.05, 0.05, 0.05],
      path: [
        [0.2, 0.3, 0],
        [0.4, 0.5, 0.1],
      ],
      color: '#000000',
      mirror: true,
      pattern: { type: 'split', color: '#ffffff', side: 'left' },
    },
  ]);
  assert.deepEqual(m?.path, [
    [-0.2, 0.3, 0],
    [-0.4, 0.5, 0.1],
  ]);
  assert.equal(m?.pattern?.side, 'right');
});

test('요청문 v2: 새 모양, 무늬, 얼굴 칸과 보기 두 개, 팔 한 줄이 들어간다', () => {
  const p = blueprintPrompt('밀크');
  for (const s of [
    '"tube"',
    '"tuft"',
    '"bow"',
    '"pattern"',
    '"inner"',
    '"nose"',
    '"brows"',
    '"catchlight"',
    '"fluff"',
    '"grin"',
  ])
    assert.ok(p.includes(s), s);
  assert.match(p, /head width : body width between 1:1 and 1\.2:1/);
  assert.match(p, /arms or front paws it can wave with/);
  assert.equal(p.split('Example (').length - 1, 2);
  // 보기 둘은 그대로 꺼낼 수 있다
  for (const line of p.split('\n').filter((l) => l.startsWith('{"v":2'))) assert.ok(extractBlueprint(line));
});

test('네 발로 선 몸(stance): 읽으면 네 발 걸음새로, 모르는 값은 버린다. 무릎 칸은 다리 부품에만', () => {
  const leg = {
    slot: 'legL',
    shape: 'sphere',
    at: [-0.1, 0.05, 0.2],
    size: [0.05, 0.05, 0.05],
    color: '#ffffff',
  };
  const bp = parseBlueprint({
    v: 2,
    stance: 'stand',
    gait: 'biped',
    parts: [
      { slot: 'body', shape: 'sphere', at: [0, 0.4, 0], size: [0.2, 0.2, 0.3], color: '#ffffff', knee: true },
      { ...leg, knee: true },
      { ...leg, knee: 'yes' },
    ],
    face: {},
  });
  assert.equal(bp?.stance, 'stand');
  assert.equal(bp?.gait, 'quadruped');
  assert.deepEqual(
    bp?.parts.map((p) => p.knee),
    [undefined, true, undefined],
  );
  const other = parseBlueprint({
    v: 2,
    stance: 'lie',
    parts: [{ ...leg, slot: 'body', size: [0.2, 0.2, 0.2] }],
    face: {},
  });
  assert.equal(other?.stance, undefined);
  assert.equal(other?.gait, undefined);
});
