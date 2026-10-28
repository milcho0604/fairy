import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkNickname } from './account-profile.ts';
import { CARD_KINDS, CARD_SPECIES, CARD_STARTERS, parseCard } from './pet-card.ts';
import { PET_KIND_IDS } from './settings.ts';
import { STARTER_IDS } from './starter-pets.ts';

test('허용 목록은 settings.ts, starter-pets.ts 와 같다', () => {
  assert.deepEqual([...CARD_KINDS], [...PET_KIND_IDS]);
  assert.deepEqual([...CARD_STARTERS], [...STARTER_IDS]);
  assert.equal(CARD_SPECIES.length, PET_KIND_IDS.length + STARTER_IDS.length);
});

test('parseCard: 맞는 카드', () => {
  assert.deepEqual(parseCard({ species: 'kind:cat', name: ' 나비 ', stand: true }, checkNickname), {
    species: 'kind:cat',
    name: '나비',
    stand: true,
  });
  assert.deepEqual(parseCard({ species: 'starter:milk' }, checkNickname), {
    species: 'starter:milk',
    name: null,
    stand: false,
  });
  assert.deepEqual(parseCard({ species: 'kind:dog', name: null }, checkNickname), {
    species: 'kind:dog',
    name: null,
    stand: false,
  });
});

test('parseCard: 거절', () => {
  for (const bad of [
    null,
    [],
    'kind:cat',
    {},
    { species: 'kind:dragon' },
    { species: 'starter:other' },
    { species: 'kind:cat', image: 'data:image/png;base64,AAAA' },
    { species: 'kind:cat', photo: 'x' },
    { species: 'kind:cat', stand: 'yes' },
    { species: 'kind:cat', name: 1 },
    { species: 'kind:cat', name: '가' },
    { species: 'kind:cat', name: '가나다라마바사아자차카타파' },
    { species: 'kind:cat', name: 'a@b' },
    { species: 'kind:cat', name: 'www.x.com' },
    { species: 'kind:cat', name: '나\u0000비' },
    { species: ['kind:cat'] },
  ])
    assert.equal(parseCard(bad, checkNickname), undefined, JSON.stringify(bad));
});
