// 시험 실행은 운영체제 열쇠고리(맥 키체인, 리눅스 libsecret)를 건드리지 않는다 (2026-10-15 사용자 요청: 시험 앱이 safeStorage 를
// 쓰면서 사용자 화면에 키체인 접근 창이 계속 떴다). 설치판에서는 절대 켜지지 않는다.

/** 시험 실행인가: 설치판이 아니고 시험 환경 변수(JJ_NO_FOCUS=1, JJ_USER_DATA, JJ_TEST_SECRETS)가 있다 */
export function isTestRun(packaged: boolean, env: Record<string, string | undefined>): boolean {
  if (packaged) return false;
  return env.JJ_NO_FOCUS === '1' || !!env.JJ_USER_DATA || env.JJ_TEST_SECRETS === 'memory';
}

/**
 * 시험 실행이면 Chromium 이 진짜 열쇠고리 대신 가짜를 쓰게 하는 스위치 (맥 use-mock-keychain, 리눅스 password-store=basic).
 * 메인 프로세스 시작 직후, ready 전에 붙인다
 */
export function testKeychainSwitches(
  packaged: boolean,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): [string, string?][] {
  if (!isTestRun(packaged, env)) return [];
  if (platform === 'darwin') return [['use-mock-keychain']];
  if (platform === 'linux') return [['password-store', 'basic']];
  return [];
}

/** 서버 토큰을 파일 대신 메모리에만 둔다 (시험 실행에서 JJ_TEST_SECRETS=memory). 설치판에서는 늘 false */
export const memorySecrets = (packaged: boolean, env: Record<string, string | undefined>): boolean =>
  !packaged && env.JJ_TEST_SECRETS === 'memory';
