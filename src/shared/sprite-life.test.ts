// 2D 그림 세트(petSprites)의 설정 수명: 사진 펫에만 있고, 보관함과 친구로 옮겨 가도 같이 간다
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { friendSwap } from './friend-swap.ts';
import { applyPatch, DEFAULT_SETTINGS, type Friend, parseSettings, type Settings } from './settings.ts';

const base = (o: Partial<Settings>): Settings => parseSettings({ ...DEFAULT_SETTINGS, ...o });
const SET = { idle: 'sprite-1-a.png', sit: 'sprite-1-b.png', 'walk-0': 'sprite-1-c.png' };

test('설정: 그림 세트는 사진 펫에만, 틀린 이름과 파일은 빠지고, null 이면 지운다', () => {
  const s = base({ petImage: 'pet-1.png', petSprites: SET });
  assert.deepEqual(s.petSprites, SET);
  // 사진이 없으면(기본 페어리) 남지 않는다
  assert.equal(base({ petSprites: SET }).petSprites, undefined);
  assert.equal(applyPatch(s, { petImage: null }).petSprites, undefined);
  assert.equal(applyPatch(s, { petSprites: null }).petSprites, undefined);
  // 다른 칸만 바꾸면 그대로
  assert.deepEqual(applyPatch(s, { petName: '우사기' }).petSprites, SET);
  // 경로를 넣은 값, 모르는 이름은 버린다
  const odd = base({
    petImage: 'pet-1.png',
    petSprites: { idle: 'sprite-1-a.png', sit: '../../x.png', dragon: 'sprite-2.png' } as never,
  });
  assert.deepEqual(odd.petSprites, { idle: 'sprite-1-a.png' });
  // 저장 파일을 다시 읽어도 같다
  assert.deepEqual(parseSettings(JSON.parse(JSON.stringify(s))).petSprites, SET);
});

test('보관함과 친구도 그림 세트를 들고 있다 (다시 고를 때 쓴다)', () => {
  const s = base({
    petLibrary: [{ id: 'p-1', name: '우사기', image: 'pet-1.png', poses: {}, sprites: SET }],
    friends: [{ id: 'f-1', name: '하치', kind: 'kong', image: 'pet-2.png', sprites: SET }],
  });
  assert.deepEqual(s.petLibrary[0]?.sprites, SET);
  assert.deepEqual(s.friends[0]?.sprites, SET);
  // 사진 없는 친구에는 남지 않는다
  const plain = base({ friends: [{ id: 'f-2', name: '콩', kind: 'kong', sprites: SET }] });
  assert.equal(plain.friends[0]?.sprites, undefined);
});

test('친구를 기본으로 바꾸면 그림 세트가 서로 자리를 바꾼다 (두 번 바꾸면 처음 그대로)', () => {
  const usagi: Friend = { id: 'f-u', name: '우사기', kind: 'bunny', image: 'pet-u.png', sprites: SET };
  const s = base({ petName: '치이', petImage: 'pet-c.png', friends: [usagi] });
  const swap = (x: Settings) => {
    const patch = friendSwap(x, 'f-u');
    assert.ok(patch);
    return applyPatch(x, patch);
  };
  const once = swap(s);
  assert.deepEqual(once.petSprites, SET);
  assert.equal(once.friends[0]?.sprites, undefined);
  const twice = swap(once);
  assert.equal(twice.petSprites, undefined);
  assert.deepEqual(twice.friends[0]?.sprites, SET);
  // 지금 펫에 세트가 있으면 친구 자리로 간다
  const both = base({ petImage: 'pet-c.png', petSprites: SET, friends: [{ ...usagi, sprites: undefined }] });
  const after = swap(both);
  assert.equal(after.petSprites, undefined);
  assert.deepEqual(after.friends[0]?.sprites, SET);
});
