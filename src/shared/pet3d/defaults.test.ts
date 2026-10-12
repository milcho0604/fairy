import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../i18n/index.ts';
import { defaultPetName, PET_KIND_IDS, PET_KINDS } from '../settings.ts';
import { expandMirrors, parseBlueprint } from './blueprint.ts';
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

test('콩이, 삐약이처럼 동그란 몸 하나가 곧 얼굴 (토순이만 피규어): 머리 따로 없이 몸이 캔버스를 채운다', () => {
  const kong = DEFAULT_BLUEPRINTS.kong.parts.find((p) => p.slot === 'body');
  assert.ok(kong);
  for (const kind of PET_KIND_IDS) {
    if (kind === 'bunny') continue;
    const bp = DEFAULT_BLUEPRINTS[kind];
    assert.equal(bp.face.slot, 'body', `${kind} 얼굴은 몸에`);
    assert.ok(!bp.parts.some((p) => p.slot === 'head'), `${kind} 머리 따로 없음`);
    const body = bp.parts.find((p) => p.slot === 'body');
    assert.ok(body, kind);
    // 몸 폭과 키가 콩이의 85% 이상 (예전 냥이, 멍멍이 피규어는 몸이 콩이의 60% 쯤이라 화면에서 작았다)
    assert.ok(body.size[0] >= kong.size[0] * 0.85, `${kind} 몸 폭 ${body.size[0]}`);
    assert.ok(body.size[1] >= kong.size[1] * 0.85, `${kind} 몸 키 ${body.size[1]}`);
    // 눈은 몸 가운데 언저리에서 멀찍이 (얼굴이 큰 아기 비율)
    assert.ok(bp.face.eyeGap >= 0.16, `${kind} 눈 사이`);
  }
});

test('종류마다 몸 색이 다르다 (고르기 칸에서 한눈에 갈린다)', () => {
  const colors = PET_KIND_IDS.map((k) => DEFAULT_BLUEPRINTS[k].parts.find((p) => p.slot === 'body')?.color);
  assert.equal(new Set(colors).size, colors.length, colors.join(','));
});
