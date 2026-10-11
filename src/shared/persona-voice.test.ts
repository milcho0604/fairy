import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts, setLang } from './i18n/index.ts';
import { setVoiceSource, VOICE_PERSONAS, VOICED, voiced } from './persona-voice.ts';

test('성격마다 바꾸는 말은 세 성격 모두 사전(한국어, 영어)에 있다', () => {
  for (const key of VOICED)
    for (const p of VOICE_PERSONAS) {
      const k = `voice.${p}.${key}`;
      assert.ok(k in dicts.ko, k);
      assert.ok(k in dicts.en, k);
    }
});

test('다정한 친구는 원래 말, 다른 성격은 그 말투 (말마다 서로 다르다)', () => {
  setLang('ko');
  const vars = { name: '콩이', n: 3, food: '붕어빵' };
  for (const key of VOICED) {
    const all = (['friend', ...VOICE_PERSONAS] as const).map((p) => voiced(key, vars, p));
    assert.equal(new Set(all).size, 4, `${key}: ${all.join(' / ')}`);
    for (const line of all) assert.ok(!/undefined|NaN/.test(line), line);
  }
  assert.equal(voiced('pet.fed', undefined, 'friend'), '냠냠, 고마워!');
  assert.match(voiced('pet.fed', undefined, 'polite'), /요/);
});

test('지금 성격은 setVoiceSource 로 읽는다. 영어도 성격 말투', () => {
  setVoiceSource(() => 'tsundere');
  try {
    setLang('en');
    assert.notEqual(voiced('briefing.hi.morning'), 'Good morning!');
    setLang('ko');
    assert.notEqual(voiced('briefing.hi.morning'), '좋은 아침!');
  } finally {
    setVoiceSource(() => 'friend');
    setLang('ko');
  }
  assert.equal(voiced('briefing.hi.morning'), '좋은 아침!');
});
