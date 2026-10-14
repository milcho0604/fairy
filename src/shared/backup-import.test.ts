import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACKUP_FILE_ITEMS,
  BACKUP_READ_TOP,
  customAiCount,
  IMPORT_FILES,
  importedChatSettings,
  PET_STATE_FILES,
} from './backup-import.ts';

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

test('백업 가져오기: 펫과 같이 지낸 기록(자람, 여정, 쪽지함, 기념일, 일기, 생일 인사)도 옮긴다', () => {
  for (const f of [
    'grow.json',
    'journey.json',
    'daily-note.json',
    'pet-memory.json',
    'diary.json',
    'knows.json',
  ])
    assert.ok((IMPORT_FILES as readonly string[]).includes(f), f);
  assert.ok(PET_STATE_FILES.every((f) => (IMPORT_FILES as readonly string[]).includes(f)));
});

test('새 백업 파일에는 사용자 AI 를 담지 않고, 예전 파일에 든 것은 읽기만 받는다 (이슈 #90)', () => {
  assert.equal(BACKUP_FILE_ITEMS.includes('ai-custom.json'), false);
  assert.ok(BACKUP_FILE_ITEMS.includes('settings.json'));
  assert.ok(PET_STATE_FILES.every((f) => BACKUP_FILE_ITEMS.includes(f)));
  assert.ok(BACKUP_READ_TOP.includes('ai-custom.json'));
  assert.ok(BACKUP_READ_TOP.includes('jjakkung.db'));
  // 받는 것은 담는 것을 모두 포함한다 (만든 파일을 다시 읽을 수 있게)
  assert.ok(BACKUP_FILE_ITEMS.every((f) => BACKUP_READ_TOP.includes(f)));
});
