import assert from 'node:assert/strict';
import { test } from 'node:test';
import { friendSwap } from './friend-swap.ts';
import { applyPatch, DEFAULT_SETTINGS, type Friend, parseSettings, type Settings } from './settings.ts';
import { parsePetChoice } from './starter-pets.ts';

/** 저장 파일을 거친 설정처럼 (main/settings.ts set 과 같은 길) */
const base = (o: Partial<Settings>): Settings => parseSettings({ ...DEFAULT_SETTINGS, ...o });
const swap = (s: Settings, id: string): Settings => {
  const patch = friendSwap(s, id);
  assert.ok(patch, '바꿀 친구가 있다');
  return applyPatch(s, patch);
};

const nabi: Friend = { id: 'f-nabi', name: '나비', kind: 'cat', gait: 'quadruped' };
const choco: Friend = {
  id: 'f-choco',
  name: '초코송이',
  kind: 'dog',
  image: 'pet-choco.png',
  model: 'model-choco.json',
  depth: 'depth-choco.png',
  gait: 'biped',
  age: 'baby',
};
const bori: Friend = { id: 'f-bori', name: '보리', kind: 'chick' };

test('친구를 기본으로: 이름, 모양, 걸음새가 기본 자리로, 지금 기본 페어리는 그 친구 자리로', () => {
  const s = base({ petName: '모찌', petNameEdited: true, petKind: 'kong', friends: [nabi] });
  const next = swap(s, 'f-nabi');
  assert.equal(next.petName, '나비');
  assert.equal(next.petNameEdited, true);
  assert.equal(next.petKind, 'cat');
  assert.equal(next.petImage, undefined);
  assert.equal(next.petGaits['kind:cat'], 'quadruped');
  assert.deepEqual(next.friends, [{ id: 'f-nabi', name: '모찌', kind: 'kong' }]);
});

test('친구 줄 순서와 id 는 그대로 (설정 창 줄과 친구 창이 제자리에서 모습만 바뀐다)', () => {
  const s = base({ friends: [bori, nabi, choco] });
  const next = swap(s, 'f-nabi');
  assert.deepEqual(
    next.friends.map((f) => f.id),
    ['f-bori', 'f-nabi', 'f-choco'],
  );
  assert.deepEqual(next.friends[0], bori);
  assert.deepEqual(next.friends[2], choco);
});

test('사진과 입체 친구를 기본으로: 그림, 설계도, 깊이 그림, 나이, 걸음새가 따라온다', () => {
  const s = base({
    petName: '콩이',
    petKind: 'kong',
    petGaits: { 'kind:kong': 'quadruped' },
    friends: [choco],
  });
  const next = swap(s, 'f-choco');
  assert.equal(next.petImage, 'pet-choco.png');
  assert.equal(next.petModel, 'model-choco.json');
  assert.equal(next.petDepth, 'depth-choco.png');
  assert.equal(next.petAge, 'baby');
  assert.equal(next.petGaits['model-choco.json'], 'biped');
  // 기본 펫 콩이는 걸음새를 들고 친구로
  assert.deepEqual(next.friends[0], { id: 'f-choco', name: '콩이', kind: 'kong', gait: 'quadruped' });
});

test('사진 기본 페어리가 친구로 갈 때 포즈, 이름표까지 들고 가고, 다시 바꾸면 그대로 돌아온다', () => {
  const s = base({
    petName: '찰칵이',
    petNameEdited: true,
    petKind: 'kong',
    petImage: 'pet-me.png',
    petModel: 'model-me.json',
    petAge: 'adult',
    petPoses: { happy: 'pose-happy.png' },
    petMeta: { license: 'CC-BY-4.0', created: '2026-10-01T00:00:00.000Z', appVersion: '0.4.1' },
    petGaits: { 'model-me.json': 'quadruped' },
    petStands: { 'model-me.json': true },
    petWishes: { 'model-me.json': '꼬리를 길게' },
    petPersonal: { 'model-me.json': true },
    friends: [bori, nabi],
  });
  const once = swap(s, 'f-nabi');
  const moved = once.friends[1];
  assert.equal(moved?.image, 'pet-me.png');
  assert.deepEqual(moved?.poses, { happy: 'pose-happy.png' });
  assert.deepEqual(moved?.meta, s.petMeta);
  assert.equal(moved?.gait, 'quadruped');
  assert.equal(once.petMeta, undefined, '기본 펫 나비에는 옛 이름표가 남지 않는다');
  assert.deepEqual(once.petPoses, {});
  // 친구 자리에 있는 동안에도 몸 열쇠 칸(네 발로 서기, 요청사항, 개인 용도)이 지워지지 않는다
  assert.deepEqual(once.petStands, s.petStands);
  assert.deepEqual(once.petWishes, s.petWishes);
  assert.deepEqual(once.petPersonal, s.petPersonal);
  const twice = swap(once, 'f-nabi');
  for (const k of ['petName', 'petKind', 'petImage', 'petModel', 'petAge', 'petPoses', 'petMeta'] as const)
    assert.deepEqual(twice[k], s[k], k);
  assert.deepEqual(twice.friends, s.friends);
  assert.equal(twice.petGaits['model-me.json'], 'quadruped');
  // 네 발로 서기는 몸 열쇠로 적혀 있어 손대지 않는다
  assert.deepEqual(twice.petStands, s.petStands);
});

test('같은 모양끼리(둘 다 고양이) 바꾸면 이름과 걸음새만 바뀐다. 자동 걸음새면 옛 값을 지운다', () => {
  const cat: Friend = { id: 'f-cat', name: '치즈', kind: 'cat' };
  const s = base({
    petName: '나비',
    petNameEdited: true,
    petKind: 'cat',
    petGaits: { 'kind:cat': 'biped' },
    friends: [cat],
  });
  const next = swap(s, 'f-cat');
  assert.equal(next.petName, '치즈');
  assert.equal(next.petKind, 'cat');
  assert.equal(next.petGaits['kind:cat'], undefined);
  assert.deepEqual(next.friends, [{ id: 'f-cat', name: '나비', kind: 'cat', gait: 'biped' }]);
});

test('없는 친구면 아무것도 바꾸지 않는다', () => {
  assert.equal(friendSwap(base({ friends: [nabi] }), 'f-none'), undefined);
  assert.equal(friendSwap(base({}), 'f-nabi'), undefined);
});

test('다시 켜도(저장 파일을 다시 읽어도) 친구가 들고 간 포즈와 이름표가 남는다', () => {
  const s = base({
    petImage: 'pet-me.png',
    petPoses: { sleepy: 'pose-sleepy.png' },
    petMeta: { license: 'CC0-1.0', created: '2026-09-01T00:00:00.000Z', appVersion: '0.4.1' },
    friends: [nabi],
  });
  const once = swap(s, 'f-nabi');
  const reread = parseSettings(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(reread.friends, once.friends);
  assert.deepEqual(reread.friends[0]?.poses, { sleepy: 'pose-sleepy.png' });
});

test('설정 창이 보내는 친구 고르기는 친구 id 규칙만 받는다', () => {
  assert.deepEqual(parsePetChoice({ friend: 'f-nabi' }), { friend: 'f-nabi' });
  assert.equal(parsePetChoice({ friend: '../x' }), undefined);
  assert.equal(parsePetChoice({ friend: 3 }), undefined);
});
