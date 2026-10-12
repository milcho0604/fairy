// 기본 펫에 지은 이름을 모습마다 기억한다 (2026-10-12). "모찌"로 지은 콩이가 초코를 거쳐 오면 "콩이"가 되던 것
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from './i18n/index.ts';
import { applyPatch, DEFAULT_SETTINGS, followKindName, parseSettings, type Settings } from './settings.ts';

const follow = (prev: Settings, patch: Record<string, unknown>) =>
  followKindName(prev, applyPatch(prev, patch), patch);
/** 초코(사진 펫)로: 보관함 꺼내기처럼 이름을 같이 준다 */
const toChoco = (s: Settings) => follow(s, { petImage: 'pet-choco-1.png', petName: '초코' });

test('기본 펫 이름 "모찌" → 초코 → 기본 펫이면 다시 모찌', () => {
  const named = follow(DEFAULT_SETTINGS, { petName: '모찌', petNameEdited: true });
  assert.deepEqual(named.petKindNames, { 'kind:kong': '모찌' });
  const choco = toChoco(named);
  assert.equal(choco.petName, '초코');
  const back = follow(choco, { petImage: null, petKind: 'kong' });
  assert.equal(back.petName, '모찌');
  assert.equal(back.petNameEdited, true);
});

test('이 칸이 생기기 전에 지은 이름도 (바뀌기 전 펫을 적는다)', () => {
  const old: Settings = { ...DEFAULT_SETTINGS, petName: '모찌', petNameEdited: true, petKindNames: {} };
  const choco = toChoco(old);
  assert.deepEqual(choco.petKindNames, { 'kind:kong': '모찌' });
  assert.equal(follow(choco, { petImage: null }).petName, '모찌');
});

test('손대지 않은 모습은 기본 이름 그대로', () => {
  const named = follow(DEFAULT_SETTINGS, { petName: '모찌', petNameEdited: true });
  const choco = toChoco(named);
  // 이름 짓지 않은 냥이로 오면 냥이
  const cat = follow(choco, { petImage: null, petKind: 'cat' });
  assert.equal(cat.petName, '냥이');
  assert.equal(cat.petNameEdited, false);
  // 냥이에서 콩이로 오면 콩이에 지은 모찌
  assert.equal(follow(cat, { petKind: 'kong' }).petName, '모찌');
  // 아무것도 짓지 않았으면 예전처럼
  const fresh = toChoco(DEFAULT_SETTINGS);
  assert.deepEqual(fresh.petKindNames, {});
  assert.equal(follow(fresh, { petImage: null }).petName, '콩이');
});

test('모습마다 다른 이름을 지으면 모습을 바꿀 때 그 이름', () => {
  let s = follow(DEFAULT_SETTINGS, { petName: '모찌', petNameEdited: true });
  // 이름을 지은 채 모습을 바꾸면 이름은 따라간다 (예전 그대로)
  s = follow(s, { petKind: 'dog' });
  assert.equal(s.petName, '모찌');
  s = follow(s, { petName: '바둑이', petNameEdited: true });
  assert.deepEqual(s.petKindNames, { 'kind:kong': '모찌', 'kind:dog': '바둑이' });
  assert.equal(follow(s, { petKind: 'kong' }).petName, '모찌');
  assert.equal(follow(follow(s, { petKind: 'kong' }), { petKind: 'dog' }).petName, '바둑이');
});

test('다른 설정만 바뀌면 이름과 기억은 그대로', () => {
  const s = follow(DEFAULT_SETTINGS, { petName: '모찌', petNameEdited: true });
  const t = follow(s, { wander: false });
  assert.equal(t.petName, '모찌');
  assert.deepEqual(t.petKindNames, { 'kind:kong': '모찌' });
});

test('지은 이름은 말을 바꿔도 그대로, 기본 이름만 말을 따른다', () => {
  const s = toChoco(follow(DEFAULT_SETTINGS, { petName: '모찌', petNameEdited: true }));
  setLang('en');
  try {
    assert.equal(follow(s, { petImage: null }).petName, '모찌');
    assert.equal(follow(s, { petImage: null, petKind: 'cat' }).petName, 'Kitty');
  } finally {
    setLang('ko');
  }
});

test('저장 파일 읽기: 없으면 빈 값, 모르는 열쇠와 빈 이름은 뺀다, 이름은 다듬는다', () => {
  assert.deepEqual(DEFAULT_SETTINGS.petKindNames, {});
  assert.deepEqual(parseSettings({}).petKindNames, {});
  assert.deepEqual(parseSettings({ petKindNames: 'x' }).petKindNames, {});
  assert.deepEqual(
    parseSettings({
      petKindNames: {
        'kind:kong': '  모찌\n ',
        'kind:dragon': '용',
        'model-1.json': '찰칵',
        'kind:cat': '',
        'kind:dog': 3,
        'kind:bunny': '가나다라마바사아자차카타파하',
      },
    }).petKindNames,
    { 'kind:kong': '모찌', 'kind:bunny': '가나다라마바사아자차카타' },
  );
});
