import type { AiStatus } from '../../../shared/ai/types.ts';
import type { ProviderView } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';

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
  if (!s) return '확인 중';
  if (!s.installed) return `${withParticle(p.label, '을')} 이 컴퓨터에서 못 찾았어. ${p.installHint}`;
  if (s.loggedIn === false) return `${p.label} 로그인이 필요해. ${p.loginHint ?? ''}`.trim();
  if (s.loggedIn === undefined)
    return `${p.label} 찾음${s.version ? ` (${s.version})` : ''}. 로그인은 써 봐야 알 수 있어.`;
  return `${p.label} 준비됨${s.version ? ` (${s.version})` : ''}`;
}
