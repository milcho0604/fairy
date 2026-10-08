import type { AiStatus } from '../../../shared/ai/types.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ProviderView } from '../../../shared/ipc.ts';

export type Dot = 'unknown' | 'off' | 'warn' | 'ok' | 'maybe';

export function dotOf(s?: AiStatus): Dot {
  if (!s) return 'unknown';
  if (!s.installed) return 'off';
  // 로그인이 필요하거나, 무료 AI 모델을 받기 전이면 노란 점 (쓸 수는 있지만 한 단계가 남았다)
  if (s.loggedIn === false || s.needsModel) return 'warn';
  // 무료 AI 는 모델을 받았으면 바로 답할 수 있다 (needsModel 은 무료 AI 에만 온다)
  if (s.needsModel === false) return 'ok';
  return s.loggedIn ? 'ok' : 'maybe';
}

export function isReady(s?: AiStatus): boolean {
  return !!s?.installed && s.loggedIn !== false;
}

export function statusText(p: ProviderView, s?: AiStatus): string {
  if (!s) return t('chat.checking');
  if (!s.installed) return t('chat.status.notFound', { label: p.label, hint: p.installHint });
  if (s.loggedIn === false)
    return t('chat.status.needLogin', { label: p.label, hint: p.loginHint ?? '' }).trim();
  if (s.needsModel) return t('chat.status.needsModel', { label: p.label });
  const version = s.version ? ` (${s.version})` : '';
  // 무료 AI 는 앱 안에 있어 로그인이 없다
  if (s.loggedIn === undefined && p.id !== 'local')
    return t('chat.status.found', { label: p.label, version });
  return t('chat.status.ready', { label: p.label, version });
}
