import type { AiStatus } from '../../../shared/ai/types.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { ProviderView } from '../../../shared/ipc.ts';

export type Dot = 'unknown' | 'off' | 'warn' | 'ok' | 'maybe';

export function dotOf(s?: AiStatus): Dot {
  if (!s) return 'unknown';
  if (!s.installed) return 'off';
  if (s.loggedIn === false) return 'warn';
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
  const version = s.version ? ` (${s.version})` : '';
  if (s.loggedIn === undefined) return t('chat.status.found', { label: p.label, version });
  return t('chat.status.ready', { label: p.label, version });
}
