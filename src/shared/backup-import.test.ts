import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customAiCount, IMPORT_FILES, importedChatSettings } from './backup-import.ts';

test('백업 가져오기: 사용자 AI 파일은 옮기지 않는다 (버그잡이 7차)', () => {
  assert.equal((IMPORT_FILES as readonly string[]).includes('ai-custom.json'), false);
  assert.equal((IMPORT_FILES as readonly string[]).includes('settings.json'), true);
});

test('가져온 채팅 설정: 사용자 AI 를 고른 것이면 기본으로, 기본 AI 는 그대로', () => {
  assert.deepEqual(importedChatSettings({ provider: 'custom-1' }), {});
  assert.deepEqual(importedChatSettings({ provider: 'custom-evil', extra: 1 }), {});
  assert.deepEqual(importedChatSettings({ provider: 'codex' }), { provider: 'codex' });
  assert.deepEqual(importedChatSettings({ provider: '../../x' }), {});
  assert.deepEqual(importedChatSettings('깨짐'), {});
});

test('백업에 든 사용자 AI 수', () => {
  assert.equal(
    customAiCount([
      { id: 'custom-1', input: {} },
      { id: 'custom-2', input: {} },
    ]),
    2,
  );
  assert.equal(customAiCount(undefined), 0);
  assert.equal(customAiCount({}), 0);
});
