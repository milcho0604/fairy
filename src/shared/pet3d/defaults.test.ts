import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../i18n/index.ts';
import { defaultPetName, PET_KIND_IDS, PET_KINDS, PET_STYLES } from '../settings.ts';
import { type Blueprint, expandMirrors, type Part, parseBlueprint } from './blueprint.ts';
import { DEFAULT_BLUEPRINTS, defaultBlueprint, REAL_BLUEPRINTS } from './defaults.ts';

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

// 이슈 #53 (2026-10-12 사용자 결정): 피규어, 게임은 콩이, 삐약이처럼 동그란 몸 하나(찹쌀떡)가 더 귀엽다. 다만 걸을 때
// 다리가 보이게 몸 아래에 짧은 다리와 발을 붙인다. 실사(그리고 털을 덮는 복슬복슬)는 실제 동물 비율로:
// 고양이, 강아지, 햄스터, 곰은 밀크, 초코처럼 네 발로 서서 걷고, 펭귄은 서서 뒤뚱 걷는다
const FIVE = ['cat', 'dog', 'hamster', 'penguin', 'bear'] as const;
const FOUR_LEGGED = ['cat', 'dog', 'hamster', 'bear'] as const;

/** 부품이 차지하는 높이 범위 (돌림은 무시한 어림) */
function spanY(parts: readonly Part[]): [number, number] {
  return [
    Math.min(...parts.map((p) => p.at[1] - p.size[1])),
    Math.max(...parts.map((p) => p.at[1] + p.size[1])),
  ];
}

/** 타원체 부품의 (x, z) 자리 아래쪽 겉 높이. 그 자리가 부품 밖이면 undefined */
function underside(p: Part, x: number, z: number): number | undefined {
  const k = 1 - ((x - p.at[0]) / p.size[0]) ** 2 - ((z - p.at[2]) / p.size[2]) ** 2;
  return k > 0 ? p.at[1] - p.size[1] * Math.sqrt(k) : undefined;
}

/** 얼굴이 붙는 관절의 부품과 그 가운데 가장 큰 것(바탕) */
function faceOf(bp: Blueprint) {
  const parts = expandMirrors(bp.parts).filter((p) => p.slot === bp.face.slot);
  const base = parts.reduce((a, b) =>
    b.size[0] * b.size[1] * b.size[2] > a.size[0] * a.size[1] * a.size[2] ? b : a,
  );
  return { parts, base };
}

test('모습마다 설계도: 피규어, 게임은 동그란 몸, 실사와 복슬복슬은 실제 동물 몸. 콩이, 삐약이, 토순이는 어느 모습이든 같다', () => {
  for (const kind of PET_KIND_IDS) {
    assert.equal(defaultBlueprint(kind, 'figure'), DEFAULT_BLUEPRINTS[kind], kind);
    assert.equal(defaultBlueprint(kind, 'game'), DEFAULT_BLUEPRINTS[kind], kind);
    // 복슬복슬은 실사 위에 털을 덮는 모습이라 실사를 따른다
    assert.equal(defaultBlueprint(kind, 'fluffy'), defaultBlueprint(kind, 'real'), kind);
    const five = (FIVE as readonly string[]).includes(kind);
    assert.equal(defaultBlueprint(kind, 'real') !== DEFAULT_BLUEPRINTS[kind], five, kind);
  }
  assert.deepEqual([...PET_STYLES], ['figure', 'game', 'real', 'fluffy']);
  for (const kind of FIVE) assert.ok(parseBlueprint(JSON.parse(JSON.stringify(REAL_BLUEPRINTS[kind]))), kind);
});

test('피규어, 게임: 콩이, 삐약이처럼 동그란 몸 하나가 곧 얼굴 (토순이만 피규어): 머리 따로 없이 몸이 캔버스를 채운다', () => {
  const kong = DEFAULT_BLUEPRINTS.kong.parts.find((p) => p.slot === 'body');
  assert.ok(kong);
  for (const kind of PET_KIND_IDS) {
    if (kind === 'bunny') continue;
    const bp = DEFAULT_BLUEPRINTS[kind];
    assert.equal(bp.face.slot, 'body', `${kind} 얼굴은 몸에`);
    assert.ok(!bp.parts.some((p) => p.slot === 'head'), `${kind} 머리 따로 없음`);
    const body = bp.parts.find((p) => p.slot === 'body');
    assert.ok(body, kind);
    assert.ok(body.size[0] >= kong.size[0] * 0.85, `${kind} 몸 폭 ${body.size[0]}`);
    assert.ok(body.size[1] >= kong.size[1] * 0.85, `${kind} 몸 키 ${body.size[1]}`);
    assert.ok(bp.face.eyeGap >= 0.16, `${kind} 눈 사이`);
  }
});

test('피규어, 게임: 동그란 몸 아래로 짧은 다리와 발이 보여 걸을 때 번갈아 딛는다', () => {
  for (const kind of FIVE) {
    const bp = DEFAULT_BLUEPRINTS[kind];
    const body = bp.parts.find((p) => p.slot === 'body');
    const legs = expandMirrors(bp.parts).filter((p) => p.slot === 'legL');
    assert.ok(body && legs.length > 0, kind);
    const [low, top] = spanY(legs);
    // 발바닥은 바닥에
    assert.ok(low <= 0.01, `${kind} 발바닥 ${low}`);
    // 다리 자리에서 몸 아랫면이 발바닥보다 0.13 넘게 높다 (그 사이로 다리가 보인다. 예전엔 0.09 쯤이라 납작한 발끝만 보였다)
    const x = legs.reduce((a, p) => a + p.at[0], 0) / legs.length;
    const z = legs.reduce((a, p) => a + p.at[2], 0) / legs.length;
    const under = underside(body, x, z);
    assert.ok(
      under !== undefined && under - low >= 0.13,
      `${kind} 보이는 다리 ${under === undefined ? '-' : under - low}`,
    );
    // 다리 관절(다리 위)에서 발바닥까지 길어 관절에서 돌려 딛는다 (pet3d-gait.ts swingShare)
    assert.ok(top - low >= 0.15, `${kind} 다리 길이 ${top - low}`);
  }
});

test('실사: 고양이, 강아지, 햄스터, 곰은 밀크, 초코처럼 네 발로 선 몸 (앞다리, 뒷다리 모두 무릎과 발이 바닥에)', () => {
  for (const kind of FOUR_LEGGED) {
    const bp = REAL_BLUEPRINTS[kind];
    assert.equal(bp.stance, 'stand', kind);
    assert.equal(bp.gait, 'quadruped', kind);
    assert.equal(bp.face.slot, 'head', kind);
    const legs = bp.parts.filter((p) => p.slot === 'legL');
    assert.ok(
      legs.every((p) => p.mirror),
      `${kind} 다리는 양쪽`,
    );
    for (const front of [true, false]) {
      const one = legs.filter((p) => p.at[2] > 0 === front);
      const knees = one.filter((p) => p.knee);
      assert.ok(knees.length >= 2, `${kind} ${front ? '앞' : '뒷'}다리 무릎과 발`);
      assert.ok(spanY(knees)[0] <= 0.01, `${kind} ${front ? '앞' : '뒷'}발이 바닥에`);
    }
    // 머리는 몸 앞에 (네 발 동물)
    const head = bp.parts.find((p) => p.slot === 'head');
    const body = bp.parts.find((p) => p.slot === 'body');
    assert.ok(head && body && head.at[2] > body.at[2] + 0.15, `${kind} 머리가 앞에`);
    // 몸 아래로 다리가 보인다
    assert.ok(spanY(bp.parts.filter((p) => p.slot === 'body'))[0] >= 0.07, `${kind} 몸이 다리 위에`);
  }
});

test('실사: 펭귄은 서서 뒤뚱 걷는다 (네 발 아님), 날개와 몸 아래로 보이는 발', () => {
  const bp = REAL_BLUEPRINTS.penguin;
  assert.equal(bp.stance, undefined);
  assert.notEqual(bp.gait, 'quadruped');
  assert.ok(bp.parts.some((p) => p.slot === 'wingL'));
  const legs = bp.parts.filter((p) => p.slot === 'legL');
  assert.ok(spanY(legs)[0] <= 0.01, '발바닥');
  assert.ok(
    spanY(bp.parts.filter((p) => p.slot === 'body'))[0] - spanY(legs)[0] >= 0.05,
    '몸 아래로 보이는 발',
  );
});

test('종류마다 특징이 모든 입체 모습에 있다: 냥이 이마 줄무늬, 멍멍이 늘어진 귀와 눈 얼룩, 햄찌 앞니와 볼, 뒤뚱이 흰 얼굴과 날개, 곰돌이 둥근 귀와 주둥이', () => {
  for (const [look, set] of [
    ['동그란 몸', DEFAULT_BLUEPRINTS],
    ['실사', REAL_BLUEPRINTS],
  ] as const) {
    const at = (kind: (typeof FIVE)[number]) => {
      const bp = set[kind];
      return { bp, ...faceOf(bp), unit: faceOf(bp).base.size[1] };
    };
    // 냥이: 눈 위 이마에 바탕과 다른 색 줄 셋, 세모 귀
    {
      const { bp, parts, base, unit } = at('cat');
      const stripes = parts.filter(
        (p) => p.at[1] > bp.face.eyeY + unit * 0.15 && p.color !== base.color && p.shape === 'capsule',
      );
      assert.equal(stripes.length, 3, `${look} 냥이 이마 줄무늬`);
      assert.ok(
        bp.parts.some((p) => p.slot === 'earL' && p.shape === 'cone'),
        `${look} 냥이 세모 귀`,
      );
    }
    // 멍멍이: 귀가 얼굴 가운데 높이 언저리로 늘어지고, 한쪽 눈에만 얼룩
    {
      const { bp, parts, base, unit } = at('dog');
      const ear = bp.parts.find((p) => p.slot === 'earL');
      assert.ok(
        ear && ear.at[1] < base.at[1] + base.size[1] * 0.6 && ear.shape !== 'cone',
        `${look} 멍멍이 늘어진 귀`,
      );
      const patch = parts.filter(
        (p) =>
          p !== base &&
          p.color !== base.color &&
          Math.abs(p.at[1] - bp.face.eyeY) < unit * 0.25 &&
          p.at[0] < 0,
      );
      assert.equal(patch.length, 1, `${look} 멍멍이 한쪽 눈 얼룩`);
      assert.ok(!parts.some((p) => p.color === patch[0]?.color && p.at[0] > 0), `${look} 얼룩은 한쪽만`);
    }
    // 햄찌: 입 아래 앞니 둘과 양 볼
    {
      const { bp, parts, base } = at('hamster');
      assert.equal(
        parts.filter((p) => p.shape === 'box' && p.at[1] < bp.face.mouthY).length,
        2,
        `${look} 햄찌 앞니`,
      );
      const cheeks = parts.filter(
        (p) => p !== base && p.shape === 'sphere' && Math.abs(p.at[0]) > base.size[0] * 0.35,
      );
      assert.equal(cheeks.length, 2, `${look} 햄찌 볼`);
    }
    // 뒤뚱이: 바탕과 다른 색 얼굴(눈 높이를 덮는다), 날개, 부리
    {
      const { bp, parts, base } = at('penguin');
      const mask = parts.find(
        (p) => p !== base && p.color !== base.color && Math.abs(p.at[1] - bp.face.eyeY) < p.size[1],
      );
      assert.ok(mask, `${look} 뒤뚱이 흰 얼굴`);
      assert.ok(
        bp.parts.some((p) => p.slot === 'wingL'),
        `${look} 뒤뚱이 날개`,
      );
      assert.equal(bp.face.mouth, 'beak', `${look} 뒤뚱이 부리`);
    }
    // 곰돌이: 동그란 귀(안쪽 색), 입이 붙는 주둥이
    {
      const { bp, parts, base } = at('bear');
      assert.ok(
        bp.parts.some((p) => p.slot === 'earL' && p.shape === 'sphere' && p.inner),
        `${look} 곰돌이 둥근 귀`,
      );
      const muzzle = parts.find(
        (p) => p !== base && p.color !== base.color && Math.abs(p.at[1] - bp.face.mouthY) < p.size[1],
      );
      assert.ok(muzzle, `${look} 곰돌이 주둥이`);
    }
  }
});

test('종류마다 몸 색이 다르고, 실사도 같은 색이다 (고르기 칸에서 한눈에 갈린다)', () => {
  const colors = PET_KIND_IDS.map((k) => DEFAULT_BLUEPRINTS[k].parts.find((p) => p.slot === 'body')?.color);
  assert.equal(new Set(colors).size, colors.length, colors.join(','));
  for (const kind of FIVE)
    assert.equal(
      REAL_BLUEPRINTS[kind].parts.find((p) => p.slot === 'body')?.color,
      DEFAULT_BLUEPRINTS[kind].parts.find((p) => p.slot === 'body')?.color,
      kind,
    );
});
