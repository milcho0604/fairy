// 페어리 서버 주소 (docs/server-plan.md 16, 17절). 빌드할 때 JJ_SERVER_URL 로 넣는다 (운영은 https://fairy-api.moilga.com).
// 비어 있으면 서버 기능이 모두 꺼진 채로 앱이 지금처럼 돈다. 그 상태로도 앱을 낼 수 있다 (만 14세 미만의 앱 안 모드와 같다).

const LOCAL_HTTP = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;

/** https 주소의 처음 부분(origin)만 받는다. 경로, 계정 정보, 쿼리가 있거나 https 가 아니면 빈 글 */
export function cleanServerUrl(raw: string | undefined): string {
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
  if (url.pathname !== '/' && url.pathname !== '') return '';
  return url.origin;
}

/**
 * 앱이 쓸 서버 주소. 시험용 주소(JJ_SERVER_URL_OVERRIDE)는 설치판이 아닌 개발 실행에서, 이 컴퓨터 http 주소일 때만 받는다
 * (공지 JJ_NOTICES_URL, 업데이트 JJ_RELEASES_API 와 같은 규칙). 빈 글이면 서버 기능을 끈다.
 */
export function serverUrl(
  built: string | undefined,
  override: string | undefined,
  packaged: boolean,
): string {
  if (override && !packaged) {
    const o = override.trim().replace(/\/$/, '');
    if (LOCAL_HTTP.test(o)) return o;
  }
  return cleanServerUrl(built);
}

/** 서버 기능을 쓸 수 있나. 주소가 없으면 화면에서도 서버 기능을 숨긴다 */
export function serverEnabled(url: string): boolean {
  return url !== '';
}
