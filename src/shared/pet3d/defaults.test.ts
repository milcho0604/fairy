import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../i18n/index.ts';
import { defaultPetName, PET_KIND_IDS, PET_KINDS } from '../settings.ts';
import { expandMirrors, type Part, parseBlueprint } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS } from './defaults.ts';

test('기본 페어리는 여덟 종류: 햄찌, 뒤뚱이, 곰돌이가 고르기에 있고 이름이 ko, en 둘 다 있다', () => {
  assert.deepEqual([...PET_KIND_IDS], ['kong', 'cat', 'chick', 'dog', 'bunny', 'hamster', 'penguin', 'bear']);
  const want = {
    ko: { hamster: '햄찌', penguin: '뒤뚱이', bear: '곰돌이' },
    en: { hamster: 'Hamster', penguin: 'Penguin', bear: 'Bear cub' },
  } as const;
  const names = { ko: ['햄찌', '뒤뚱이', '곰돌이'], en: ['Nibbles', 'Waddles', 'Teddy'] } as const;
  try {
    for (const lang of ['ko', 'en'] as const) {
      setLang(lang);
      for (const [i, kind] of (['hamster', 'penguin', 'bear'] as const).entries()) {
        assert.equal(PET_KINDS.find((k) => k.id === kind)?.label, want[lang][kind], `${lang} ${kind}`);
        assert.equal(defaultPetName(kind), names[lang][i], `${lang} ${kind} 이름`);
      }
      // 종류 이름이 겹치지 않는다 (고르기 칸에서 헷갈리지 않게)
      const labels = PET_KINDS.map((k) => k.label);
      assert.equal(new Set(labels).size, labels.length, lang);
    }
  } finally {
    setLang('ko');
  }
});

test('모든 기본 설계도가 읽히고, 손(팔이나 날개)과 발이 있다', () => {
  for (const kind of PET_KIND_IDS) {
    const bp = DEFAULT_BLUEPRINTS[kind];
    assert.ok(parseBlueprint(JSON.parse(JSON.stringify(bp))), kind);
    const slots = new Set(expandMirrors(bp.parts).map((p) => p.slot));
    assert.ok(slots.has('armL') || slots.has('wingL'), `${kind} 손`);
    assert.ok(slots.has('legL') && slots.has('legR'), `${kind} 발`);
  }
});

/** 부품이 차지하는 높이 범위 (돌림은 무시한 어림) */
function spanY(parts: readonly Part[]): [number, number] {
  return [
    Math.min(...parts.map((p) => p.at[1] - p.size[1])),
    Math.max(...parts.map((p) => p.at[1] + p.size[1])),
  ];
}

// 2026-10-12 이슈 #53: 동그란 몸 하나로 바꿨더니 입체(피규어, 게임, 실사, 복슬복슬)에서 팔다리 없는 떡이 되어
// 걸을 때 다리가 안 보이고 특징이 사라졌다. 머리와 몸이 따로인 인형 몸으로 되돌렸다
const DOLLS = ['cat', 'dog', 'hamster', 'penguin', 'bear'] as const;

test('냥이, 멍멍이, 햄찌, 뒤뚱이, 곰돌이는 머리와 몸이 따로인 인형 몸: 몸 아래로 다리가 보이고 옆으로 손이 나온다', () => {
  for (const kind of DOLLS) {
    const parts = expandMirrors(DEFAULT_BLUEPRINTS[kind].parts);
    const of = (...slots: string[]) => parts.filter((p) => slots.includes(p.slot));
    const [body, head, legs, hands] = [of('body'), of('head'), of('legL', 'legR'), of('armR', 'wingR')];
    assert.equal(DEFAULT_BLUEPRINTS[kind].face.slot, 'head', `${kind} 얼굴은 머리에`);
    assert.ok(head.length > 0, `${kind} 머리`);
    const [bodyLow, bodyTop] = spanY(body);
    const [headLow] = spanY(head);
    const [legLow, legTop] = spanY(legs);
    // 발은 바닥에 닿고, 몸 아래가 바닥에서 떠 그 사이로 다리가 보인다 (걸을 때 발이 번갈아 나간다)
    assert.ok(legLow <= 0.01, `${kind} 발바닥 ${legLow}`);
    assert.ok(bodyLow - legLow >= 0.08, `${kind} 몸 아래로 보이는 다리 ${bodyLow - legLow}`);
    // 다리 관절에서 발바닥까지 길어 관절에서 돌려 딛는다 (pet3d-gait.ts swingShare 의 0.12 넘게)
    assert.ok(legTop - legLow >= 0.15, `${kind} 다리 길이 ${legTop - legLow}`);
    // 머리는 몸 위에 얹히고(겹쳐 목이 안 보인다) 몸보다 넓다 (아기 비율)
    assert.ok(headLow < bodyTop, `${kind} 머리와 몸이 붙는다`);
    const width = (ps: Part[]) => Math.max(...ps.map((p) => Math.abs(p.at[0]) + p.size[0]));
    assert.ok(width(head) > width(body), `${kind} 머리가 몸보다 넓다`);
    // 손(팔이나 날개)이 몸 옆으로 나온다 (흔들 때 보이게)
    assert.ok(width(hands) >= width(body), `${kind} 손이 몸 옆으로`);
  }
});

test('인형 몸도 콩이만큼 크다 (캔버스를 채운다): 키가 콩이의 95% 넘고, 폭은 콩이의 60% 넘게', () => {
  const size = (kind: (typeof PET_KIND_IDS)[number]) => {
    const parts = expandMirrors(DEFAULT_BLUEPRINTS[kind].parts).filter((p) => p.slot !== 'tail');
    const [low, top] = spanY(parts);
    return { h: top - low, w: Math.max(...parts.map((p) => p.at[0] + p.size[0])) * 2 };
  };
  const kong = size('kong');
  for (const kind of DOLLS) {
    const s = size(kind);
    assert.ok(s.h >= kong.h * 0.95, `${kind} 키 ${s.h} (콩이 ${kong.h})`);
    assert.ok(s.w >= kong.w * 0.6, `${kind} 폭 ${s.w} (콩이 ${kong.w})`);
  }
});

test('종류마다 특징이 입체에도 있다: 냥이 이마 줄무늬, 멍멍이 늘어진 귀와 눈 얼룩, 햄찌 앞니와 볼, 뒤뚱이 흰 얼굴과 날개, 곰돌이 둥근 귀와 주둥이', () => {
  const bp = DEFAULT_BLUEPRINTS;
  const headOf = (kind: keyof typeof bp) => expandMirrors(bp[kind].parts).filter((p) => p.slot === 'head');
  const headTop = (kind: keyof typeof bp) => spanY(headOf(kind))[1];
  const headColor = (kind: keyof typeof bp) => headOf(kind)[0]?.color;
  // 냥이: 눈 위 이마에 머리와 다른 색 줄 셋, 세모 귀
  const stripes = headOf('cat').filter(
    (p) => p.at[1] > bp.cat.face.eyeY + 0.08 && p.color !== headColor('cat'),
  );
  assert.equal(stripes.length, 3, '냥이 이마 줄무늬');
  assert.ok(
    bp.cat.parts.some((p) => p.slot === 'earL' && p.shape === 'cone'),
    '냥이 세모 귀',
  );
  // 멍멍이: 귀가 머리 꼭대기보다 아래로 늘어지고, 한쪽 눈에만 얼룩
  const dogEar = bp.dog.parts.find((p) => p.slot === 'earL');
  assert.ok(dogEar && dogEar.at[1] < headTop('dog') - 0.15, '멍멍이 늘어진 귀');
  const patch = headOf('dog').filter(
    (p) => p.color !== headColor('dog') && Math.abs(p.at[1] - bp.dog.face.eyeY) < 0.05,
  );
  assert.equal(patch.length, 1, '멍멍이 한쪽 눈 얼룩');
  // 햄찌: 입 아래 앞니 둘과 양 볼
  const teeth = headOf('hamster').filter((p) => p.shape === 'box' && p.at[1] < bp.hamster.face.mouthY);
  assert.equal(teeth.length, 2, '햄찌 앞니');
  const cheeks = headOf('hamster').filter((p) => p.shape === 'sphere' && Math.abs(p.at[0]) > 0.15);
  assert.equal(cheeks.length, 2, '햄찌 볼');
  // 뒤뚱이: 남색 머리 앞 흰 얼굴(눈 높이를 덮는다), 날개 손, 부리
  const mask = headOf('penguin').find((p) => p.color !== headColor('penguin'));
  assert.ok(
    mask && mask.at[2] > 0.05 && Math.abs(mask.at[1] - bp.penguin.face.eyeY) < mask.size[1],
    '뒤뚱이 흰 얼굴',
  );
  assert.ok(
    bp.penguin.parts.some((p) => p.slot === 'wingL'),
    '뒤뚱이 날개',
  );
  assert.equal(bp.penguin.face.mouth, 'beak', '뒤뚱이 부리');
  // 곰돌이: 머리 위 동그란 귀, 입이 붙는 주둥이
  assert.ok(
    bp.bear.parts.some((p) => p.slot === 'earL' && p.shape === 'sphere' && p.at[1] > headTop('bear') - 0.12),
    '곰돌이 둥근 귀',
  );
  const muzzle = headOf('bear').find((p) => p.color !== headColor('bear'));
  assert.ok(muzzle && Math.abs(muzzle.at[1] - bp.bear.face.mouthY) < muzzle.size[1], '곰돌이 주둥이');
});

test('종류마다 몸 색이 다르다 (고르기 칸에서 한눈에 갈린다)', () => {
  const colors = PET_KIND_IDS.map((k) => DEFAULT_BLUEPRINTS[k].parts.find((p) => p.slot === 'body')?.color);
  assert.equal(new Set(colors).size, colors.length, colors.join(','));
});
