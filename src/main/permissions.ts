// 웹 권한은 기본으로 모두 거절한다 (2026-10-11 보안 점검). 짝꿍 창은 짝꿍 파일만 열지만, 혹시 남의 글이 창에서
// 돌더라도 카메라, 마이크, 위치, 화면 공유, 알림 같은 권한을 얻지 못하게 한다.
// - 화면 캡처(같이 보기)는 메인의 desktopCapturer 로 해서 웹 권한(getDisplayMedia)이 필요 없다.
// - 알림은 메인의 Electron Notification 이라 웹 알림 권한이 필요 없다.
// - 허락하는 것: 복사 단추(navigator.clipboard.writeText)가 쓰는 clipboard-sanitized-write 하나.
import type { Session } from 'electron';

const ALLOWED = new Set<string>(['clipboard-sanitized-write']);

export const allowedPermission = (permission: string) => ALLOWED.has(permission);

export function denyPermissionsByDefault(s: Session, log: (tag: string, ...rest: unknown[]) => void): void {
  s.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = allowedPermission(permission);
    if (!ok) log('permission', '거절', permission);
    callback(ok);
  });
  s.setPermissionCheckHandler((_wc, permission) => allowedPermission(permission));
  // 화면 공유 요청도 거절한다 (짝꿍은 쓰지 않는다)
  s.setDisplayMediaRequestHandler((_req, callback) => callback({}));
}
