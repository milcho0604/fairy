import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t } from '../../../shared/i18n/index.ts';
import { calendarFlash, exportFlash, importFlash, storageFlash } from './flash-of.ts';

test('내보내기: 실패는 빨간 글씨(까닭이 있으면 그 글), 만든 파일은 초록 글씨, 그만두면 안내 없음', () => {
  assert.deepEqual(exportFlash(undefined), { text: t('settings.exportFailed'), error: true });
  assert.deepEqual(exportFlash({ ok: true, path: '/tmp/a.fairybackup', message: '' }), {
    text: t('settings.exported'),
    error: false,
  });
  assert.deepEqual(exportFlash({ ok: false, path: '', message: t('main.file.diskFull') }), {
    text: t('main.file.diskFull'),
    error: true,
  });
  assert.deepEqual(exportFlash({ ok: false, path: '', message: '' }), {
    text: t('settings.exportFailed'),
    error: true,
  });
  assert.equal(exportFlash({ ok: true, path: '', message: '' }), undefined);
});

test('가져오기: 던졌거나 백업이 아니면 빨간 글씨, 다시 켠다는 말은 초록 글씨', () => {
  assert.deepEqual(importFlash(undefined), { text: t('settings.importFailed'), error: true });
  assert.deepEqual(importFlash({ ok: false, message: t('main.backup.notBackup') }), {
    text: t('main.backup.notBackup'),
    error: true,
  });
  assert.deepEqual(importFlash({ ok: true, message: t('main.backup.restarting') }), {
    text: t('main.backup.restarting'),
    error: false,
  });
  assert.equal(importFlash({ ok: true, message: '' }), undefined);
});

test('모델 지우기: 바빠서 못 지웠으면 빨간 글씨', () => {
  assert.deepEqual(storageFlash(false, false), { text: t('settings.storage.busy'), error: true });
  assert.deepEqual(storageFlash(undefined, true), { text: t('settings.storage.busy'), error: true });
  assert.equal(storageFlash(true, false).error, false);
  assert.equal(storageFlash(true, true).text, t('settings.storage.copyDeleted'));
});

test('캘린더 지금 가져오기: 못 가져왔으면 빨간 글씨', () => {
  assert.deepEqual(calendarFlash({ text: t('panel.calendar.offline'), ok: false }), {
    text: t('panel.calendar.offline'),
    error: true,
  });
  assert.equal(calendarFlash({ text: 'ok', ok: true }).error, false);
});
