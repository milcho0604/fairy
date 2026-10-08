import { shell } from 'electron';
import { safeExternalUrl } from '../shared/links.ts';

/**
 * 주소를 기본 브라우저로 연다 (채팅 답 속 주소, 일정 알림의 "회의 열기").
 * http, https 만 연다. 화면에서 온 값이라 여기서 다시 본다. 기록에는 호스트만 남긴다 (회의 주소에 비밀번호가 붙는다)
 */
export function openLink(raw: unknown, log: (tag: string, ...rest: unknown[]) => void): boolean {
  const url = safeExternalUrl(raw);
  if (!url) {
    log('link', 'blocked');
    return false;
  }
  log('link', 'open', new URL(url).host);
  void shell.openExternal(url).catch((err) => log('link', 'open failed', String(err)));
  return true;
}
