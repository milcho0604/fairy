import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canBlink,
  DOZE_AFTER_MS,
  INITIAL_INPUTS,
  isAnimated,
  moodOf,
  nextChangeAt,
  type PetInputs,
  type PetMood,
  SLEEP_AFTER_MS,
} from './pet-mood.ts';

const NOW = 1_000_000;
const at = (patch: Partial<PetInputs>) => moodOf({ ...INITIAL_INPUTS, ...patch }, NOW);

test('아무 일 없으면 기본', () => {
  assert.equal(at({}), 'idle');
});

test('우선순위: 표에서 위에 있는 상태가 이긴다', () => {
  const all: Partial<PetInputs> = {
    hidden: true,
    grabbed: true,
    thinking: true,
    talkingUntil: NOW + 1,
    systemBusy: true,
    excitedUntil: NOW + 1,
    userIdleMs: SLEEP_AFTER_MS,
    sulkLevel: 3,
  };
  const order: [keyof PetInputs, PetMood][] = [
    ['hidden', 'hidden'],
    ['grabbed', 'grabbed'],
    ['thinking', 'thinking'],
    ['talkingUntil', 'talking'],
    ['systemBusy', 'busy'],
    ['excitedUntil', 'excited'],
    ['userIdleMs', 'sleeping'],
    ['sulkLevel', 'sulky'],
  ];
  // 위에서부터 하나씩 끄면 바로 아래 상태가 나온다.
  const inputs: PetInputs = { ...INITIAL_INPUTS, ...all };
  for (const [key, mood] of order) {
    assert.equal(moodOf(inputs, NOW), mood);
    (inputs as unknown as Record<string, unknown>)[key] = INITIAL_INPUTS[key];
  }
  assert.equal(moodOf(inputs, NOW), 'idle');
});

test('신남과 말하기는 시간이 지나면 끝난다', () => {
  assert.equal(at({ excitedUntil: NOW }), 'idle');
  assert.equal(at({ talkingUntil: NOW - 1 }), 'idle');
  assert.equal(
    nextChangeAt({ ...INITIAL_INPUTS, excitedUntil: NOW + 3000, talkingUntil: NOW + 8000 }, NOW),
    NOW + 3000,
  );
  assert.equal(nextChangeAt(INITIAL_INPUTS, NOW), undefined);
});

test('5분 입력이 없으면 졸고, 10분이거나 집중 타이머면 잔다', () => {
  assert.equal(at({ userIdleMs: DOZE_AFTER_MS - 1 }), 'idle');
  assert.equal(at({ userIdleMs: DOZE_AFTER_MS }), 'dozing');
  assert.equal(at({ userIdleMs: SLEEP_AFTER_MS - 1 }), 'dozing');
  assert.equal(at({ userIdleMs: SLEEP_AFTER_MS }), 'sleeping');
  assert.equal(at({ focusTimer: true }), 'sleeping');
});

test('컴퓨터가 바쁘면 신남도 멈추고 바쁨', () => {
  assert.equal(at({ systemBusy: true, excitedUntil: NOW + 1000 }), 'busy');
  assert.equal(isAnimated('busy'), false);
  assert.equal(canBlink('busy'), false);
});

test('계속 그리는 상태는 신남과 생각 중뿐, 잠은 깜빡임도 없다 (L10)', () => {
  const moods: PetMood[] = [
    'hidden',
    'grabbed',
    'thinking',
    'talking',
    'busy',
    'excited',
    'sleeping',
    'dozing',
    'sulky',
    'idle',
  ];
  assert.deepEqual(
    moods.filter((m) => isAnimated(m)),
    ['thinking', 'excited'],
  );
  assert.deepEqual(
    moods.filter((m) => canBlink(m)),
    ['talking', 'sulky', 'idle'],
  );
});
