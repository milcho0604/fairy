// Gemini CLI 를 읽기 전용으로 묶는 정책 파일 (이슈 #126). --admin-policy 로 넘기면 관리자 층(기본 4)이라
// 사용자 설정의 허용 도구(tools.allowed)나 저장해 둔 "항상 허용"(정책 규칙으로 바뀌어 사용자 층 3)보다 우선한다
// (Gemini CLI 문서 docs/reference/policy-engine.md: 층은 기본 1, 작업 공간 2, 사용자 3, 관리자 4, 같은 층은 priority 0~999 높은 것).
// 시스템 폴더에 관리자 정책 파일이 이미 있으면 보충 관리자 정책은 무시된다(문서의 Security Guard). 그 컴퓨터는 관리자가 정한 정책이 이미 지배한다.
// 막는 것: 명령 실행, 파일 쓰기와 고치기, 기억 저장, 그리고 모든 MCP 서버의 모든 도구 (내 MCP 서버의 쓰기 도구 포함)

/** 읽기 전용 정책 파일 내용. 도구 이름은 Gemini CLI 문서의 도구 참고(docs/reference/tools.md) 기준 */
export const GEMINI_POLICY_TOML = `# 페어리가 Gemini CLI 를 부를 때 쓰는 읽기 전용 정책 (자동으로 만든 파일, 고치면 다음 실행에 덮어쓴다)

[[rule]]
toolName = ["run_shell_command", "write_file", "replace", "save_memory"]
decision = "deny"
priority = 999
denyMessage = "페어리는 읽기 전용이야"

[[rule]]
toolName = "*"
mcpName = "*"
decision = "deny"
priority = 999
denyMessage = "페어리는 읽기 전용이야"
`;

/** 정책 파일 이름 (데이터 폴더 안 ai-policy/) */
export const GEMINI_POLICY_FILE = 'gemini-readonly.toml';

/** providers.ts 의 gemini 인자 속 자리 표시. 실행 직전에 정책 파일 경로로 바뀐다 */
export const GEMINI_POLICY_SLOT = '{policy}';
