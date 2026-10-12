import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asksScreen, type ChatLookView, lookPhase, shouldShoot } from './chat-look.ts';
import { dicts } from './i18n/index.ts';

const view = (v: Partial<ChatLookView>): ChatLookView => ({
  on: false,
  agreed: false,
  access: 'granted',
  ...v,
});
const claude = { images: true, ready: true };

test('꺼짐, 처음 켜는 안내, 켬', () => {
  assert.equal(lookPhase(view({}), claude, false), 'off');
  assert.equal(lookPhase(view({}), claude, true), 'confirm');
  assert.equal(lookPhase(view({ on: true, agreed: true }), claude, false), 'on');
  // 켜진 뒤에는 안내가 남아 있어도 켬
  assert.equal(lookPhase(view({ on: true, agreed: true }), claude, true), 'on');
});

test('권한 없음은 AI 보다 먼저 알린다', () => {
  for (const access of ['denied', 'restricted'] as const) {
    assert.equal(lookPhase(view({ on: true, access }), claude, false), 'no-permission');
    assert.equal(
      lookPhase(view({ on: true, access }), { images: false, ready: true }, false),
      'no-permission',
    );
  }
  // 아직 묻지 않음은 권한 없음이 아니다 (맥이 처음 찍을 때 묻는다)
  assert.equal(lookPhase(view({ on: true, access: 'not-determined' }), claude, false), 'on');
});

test('AI 없음: 그림을 못 받거나, 준비 안 됨, 아직 모름', () => {
  assert.equal(lookPhase(view({ on: true }), { images: false, ready: true }, false), 'no-ai');
  assert.equal(lookPhase(view({ on: true }), { images: true, ready: false }, false), 'no-ai');
  assert.equal(lookPhase(view({ on: true }), undefined, false), 'no-ai');
});

test('켬일 때만 찍는다', () => {
  const phases = ['off', 'confirm', 'on', 'no-permission', 'no-ai'] as const;
  assert.deepEqual(
    phases.filter((p) => shouldShoot(p)),
    ['on'],
  );
});

test('"지금 화면 봐 줘" 같은 말을 알아듣는다', () => {
  for (const q of [
    '지금 화면 봐 줘',
    '화면 좀 봐줘',
    '이 화면 보여?',
    '스크린 확인해 줄래',
    'Can you look at my screen?',
    "what's on my screen",
    'check the screen please',
  ])
    assert.equal(asksScreen(q), true, q);
  for (const q of [
    '화면 밝기 줄이는 법',
    '화면 보호기 끄는 법',
    '오늘 뭐부터 할까?',
    'screen time tips',
    'look at this',
  ])
    assert.equal(asksScreen(q), false, q);
});

test('같이 보기 글은 한국어와 영어 둘 다 있고 긴 줄표와 가운뎃점이 없다', () => {
  const keys = Object.keys(dicts.ko).filter((k) => k.startsWith('chatLook.'));
  assert.ok(keys.length >= 15);
  const vars = { name: '밀크', label: 'Claude' };
  for (const k of keys) {
    for (const d of [dicts.ko, dicts.en] as Record<string, unknown>[]) {
      const v = d[k];
      const s = typeof v === 'function' ? (v as (x: typeof vars) => string)(vars) : v;
      assert.equal(typeof s, 'string', k);
      assert.doesNotMatch(s as string, /[\u2014\u00b7]/, k);
    }
  }
});
