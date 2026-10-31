import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HUB_METHODS, HUB_SETTING_KEYS, hubPatchOk } from './hub-policy.ts';
import { SETTINGS } from './ipc.ts';

test('큰 창 허용 채널에는 위험한 것이 없다', () => {
  const danger = [
    'relaunch',
    'importData',
    'exportData',
    'restoreConfirm',
    'restoreUndo',
    'resetCoins',
    'clearAiHistory',
    'deleteModel',
    'checkUpdate',
    'saveDiagnostics',
    'reset',
    'importPet',
    'exportPet',
    'reveal',
    'openOnboarding',
    'refreshMcp',
  ];
  for (const m of danger) assert.ok(!(HUB_METHODS as readonly string[]).includes(m), m);
  for (const m of HUB_METHODS) assert.ok(m in SETTINGS, `SETTINGS.${m} 가 없다`);
});

test('큰 창 설정 조각: 구역 키만, 빈 조각과 모르는 키는 거절', () => {
  assert.equal(hubPatchOk({ persona: 'cat' }), true);
  assert.equal(hubPatchOk({ wander: false, chatter: 'quiet' }), true);
  assert.equal(hubPatchOk({ lang: 'en' }), false);
  assert.equal(hubPatchOk({ persona: 'cat', lang: 'en' }), false);
  assert.equal(hubPatchOk({ launchAtLogin: true }), false);
  assert.equal(hubPatchOk({ aiIsolation: false }), false);
  assert.equal(hubPatchOk({}), false);
  assert.equal(hubPatchOk(null), false);
  assert.equal(hubPatchOk([]), false);
  assert.equal(new Set(HUB_SETTING_KEYS).size, HUB_SETTING_KEYS.length);
});
