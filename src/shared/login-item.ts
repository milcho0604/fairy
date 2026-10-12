// 로그인할 때 자동 실행(운영체제 로그인 항목)을 읽고 쓰는지 정한다. 실제 호출은 main/index.ts.

/**
 * 설치판만 운영체제 로그인 항목을 읽고 쓴다. 시험 실행(JJ_USER_DATA)은 하지 않는다.
 * 맥은 로그인 항목을 앱 ID 로 본다: 시험용으로 복사한 설치판이 사용자가 쓰는 페어리의 "켜짐"을 읽어 제 설정에 넣고,
 * 그 바뀜이 다시 setLoginItemSettings 를 불러 시험용 복사본을 로그인 항목으로 올렸다 (2026-10-13 설치 파일 점검).
 * 주소 등록(open-handler.ts registerScheme)과 같은 규칙이다
 */
export function ownsLoginItem(packaged: boolean, testDataDir: string | undefined): boolean {
  return packaged && !testDataDir;
}
