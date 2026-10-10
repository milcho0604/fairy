import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  globalTabKey,
  isSettingsTab,
  SETTINGS_TABS,
  stepTab,
  tabFromHash,
  tabKeyStep,
  tabOfSection,
} from './settings-tabs.ts';

test('설정 탭: 여섯, 겹치지 않는다', () => {
  assert.deepEqual([...SETTINGS_TABS], ['pet', 'assist', 'ai', 'ease', 'data', 'about']);
  assert.equal(isSettingsTab('ai'), true);
  assert.equal(isSettingsTab('stats'), false);
  assert.equal(isSettingsTab(undefined), false);
  assert.equal(isSettingsTab('toString'), false);
});

test('바로 보여 줄 칸: 베타 기록(의견 보내기)은 정보 탭', () => {
  assert.equal(tabOfSection('stats'), 'about');
});

test('창 주소 #: 칸 이름이면 그 칸의 탭, 탭 이름이면 그 탭, 모르면 첫 탭', () => {
  assert.equal(tabFromHash('#stats'), 'about');
  assert.equal(tabFromHash('#ai'), 'ai');
  assert.equal(tabFromHash('data'), 'data');
  assert.equal(tabFromHash(''), 'pet');
  assert.equal(tabFromHash('#'), 'pet');
  assert.equal(tabFromHash('#nope'), 'pet');
  assert.equal(tabFromHash('#constructor'), 'pet');
});

test('탭 옮기기: 끝에서 돌아 들어온다', () => {
  assert.equal(stepTab('pet', 1), 'assist');
  assert.equal(stepTab('pet', -1), 'about');
  assert.equal(stepTab('about', 1), 'pet');
  assert.equal(stepTab('data', 'first'), 'pet');
  assert.equal(stepTab('pet', 'last'), 'about');
});

test('탭 목록 키: ← → Home End, 세로일 때만 ↑ ↓', () => {
  assert.equal(tabKeyStep('ArrowLeft', false), -1);
  assert.equal(tabKeyStep('ArrowRight', false), 1);
  assert.equal(tabKeyStep('ArrowDown', false), undefined);
  assert.equal(tabKeyStep('ArrowDown', true), 1);
  assert.equal(tabKeyStep('ArrowUp', true), -1);
  assert.equal(tabKeyStep('Home', false), 'first');
  assert.equal(tabKeyStep('End', true), 'last');
  assert.equal(tabKeyStep('a', false), undefined);
});

test('창 어디서나: Cmd/Ctrl+[ ] 와 1~6, 다른 수식키가 섞이면 넘긴다', () => {
  const k = (code: string, extra: Partial<{ mod: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    key: '',
    code,
    mod: true,
    altKey: false,
    shiftKey: false,
    ...extra,
  });
  assert.equal(globalTabKey(k('BracketRight'), 'pet'), 'assist');
  assert.equal(globalTabKey(k('BracketLeft'), 'pet'), 'about');
  assert.equal(globalTabKey(k('Digit3'), 'pet'), 'ai');
  assert.equal(globalTabKey(k('Digit6'), 'pet'), 'about');
  assert.equal(globalTabKey(k('Digit7'), 'pet'), undefined);
  assert.equal(globalTabKey(k('Digit0'), 'pet'), undefined);
  assert.equal(globalTabKey(k('BracketRight', { mod: false }), 'pet'), undefined);
  assert.equal(globalTabKey(k('BracketRight', { shiftKey: true }), 'pet'), undefined);
  assert.equal(globalTabKey(k('Digit1', { altKey: true }), 'ai'), undefined);
  assert.equal(globalTabKey(k('KeyF'), 'ai'), undefined);
});
