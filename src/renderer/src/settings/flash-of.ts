// 설정 창 상태줄 안내 (SettingsApp flash). 실패는 빨간 글씨, 잘 된 것만 초록 글씨로 (이슈 #65: 못 가져왔다는 말도 초록이었다)
import { t } from '../../../shared/i18n/index.ts';
import type { CalSync } from '../../../shared/ipc.ts';

export interface Flash {
  text: string;
  error: boolean;
}

/**
 * 백업 파일 만들기: undefined 는 던짐, ok 가 거짓이면 메인이 고른 까닭(디스크 가득, 권한, 너무 큼),
 * 빈 path 는 그만둠(안내 없음), 그 밖은 만든 파일
 */
export function exportFlash(
  r: { ok: boolean; path: string; message: string } | undefined,
): Flash | undefined {
  if (r === undefined) return { text: t('settings.exportFailed'), error: true };
  if (!r.ok) return { text: r.message || t('settings.exportFailed'), error: true };
  return r.path ? { text: t('settings.exported'), error: false } : undefined;
}

/** 백업 가져오기: undefined 는 던짐, 빈 message 는 그만둠 */
export function importFlash(r: { ok: boolean; message: string } | undefined): Flash | undefined {
  if (r === undefined) return { text: t('settings.importFailed'), error: true };
  return r.message ? { text: r.message, error: !r.ok } : undefined;
}

/** 받은 모델 지우기: ok 가 거짓이거나 던졌으면(undefined) 받는 중, 답하는 중이라 못 지웠다 */
export function storageFlash(ok: boolean | undefined, copy: boolean): Flash {
  if (!ok) return { text: t('settings.storage.busy'), error: true };
  return { text: t(copy ? 'settings.storage.copyDeleted' : 'settings.storage.deleted'), error: false };
}

/** 캘린더 지금 가져오기 */
export const calendarFlash = (r: CalSync): Flash => ({ text: r.text, error: !r.ok });
