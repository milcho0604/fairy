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

test('설정 탭: 넷, 겹치지 않는다 (페어리와 비서는 큰 창 구역)', () => {
  assert.deepEqual([...SETTINGS_TABS], ['data', 'ease', 'ai', 'about']);
  assert.equal(isSettingsTab('ai'), true);
  assert.equal(isSettingsTab('stats'), false);
  assert.equal(isSettingsTab('pet'), false);
  assert.equal(isSettingsTab('assist'), false);
  assert.equal(isSettingsTab(undefined), false);
  assert.equal(isSettingsTab('toString'), false);
});

test('바로 보여 줄 칸: 베타 기록(의견 보내기)은 정보 탭, 두 번 눌러 연 백업의 확인 칸은 데이터 탭', () => {
  assert.equal(tabOfSection('stats'), 'about');
  assert.equal(tabOfSection('restore'), 'data');
  assert.equal(tabFromHash('#restore'), 'data');
});

test('창 주소 #: 칸 이름이면 그 칸의 탭, 탭 이름이면 그 탭, 모르면 첫 탭', () => {
  assert.equal(tabFromHash('#stats'), 'about');
  assert.equal(tabFromHash('#ai'), 'ai');
  assert.equal(tabFromHash('data'), 'data');
  assert.equal(tabFromHash(''), 'data');
  assert.equal(tabFromHash('#'), 'data');
  assert.equal(tabFromHash('#nope'), 'data');
  assert.equal(tabFromHash('#constructor'), 'data');
  assert.equal(tabFromHash('#pet'), 'data');
});

test('탭 옮기기: 끝에서 돌아 들어온다', () => {
  assert.equal(stepTab('data', 1), 'ease');
  assert.equal(stepTab('data', -1), 'about');
  assert.equal(stepTab('about', 1), 'data');
  assert.equal(stepTab('ai', 'first'), 'data');
  assert.equal(stepTab('data', 'last'), 'about');
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

test('창 어디서나: Cmd/Ctrl+[ ] 와 1~4, 다른 수식키가 섞이면 넘긴다', () => {
  const k = (code: string, extra: Partial<{ mod: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    key: '',
    code,
    mod: true,
    altKey: false,
    shiftKey: false,
    ...extra,
  });
  assert.equal(globalTabKey(k('BracketRight'), 'data'), 'ease');
  assert.equal(globalTabKey(k('BracketLeft'), 'data'), 'about');
  assert.equal(globalTabKey(k('Digit3'), 'data'), 'ai');
  assert.equal(globalTabKey(k('Digit4'), 'data'), 'about');
  assert.equal(globalTabKey(k('Digit5'), 'data'), undefined);
  assert.equal(globalTabKey(k('Digit0'), 'data'), undefined);
  assert.equal(globalTabKey(k('BracketRight', { mod: false }), 'data'), undefined);
  assert.equal(globalTabKey(k('BracketRight', { shiftKey: true }), 'data'), undefined);
  assert.equal(globalTabKey(k('Digit1', { altKey: true }), 'ai'), undefined);
  assert.equal(globalTabKey(k('KeyF'), 'ai'), undefined);
});
