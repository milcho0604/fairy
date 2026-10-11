// AI 도구 프로세스(claude, codex, cursor-agent, 사용자 AI)에 넘기는 환경 변수 (2026-10-11 보안 점검).
// 짝꿍의 환경 변수를 통째로 넘기지 않고 고른 것만 넘긴다: 다른 앱의 토큰이나 Electron, Node 설정
// (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, JJ_*)이 AI 도구로 새지 않게. AI 도구가 로그인, 프록시, 인증서,
// 언어, 임시 폴더를 찾는 데 쓰는 것과 각 도구가 읽는 변수(ANTHROPIC_*, CLAUDE_*, OPENAI_*, CODEX_* 등)만.
// 사용자 AI 가 다른 변수를 꼭 써야 하면 로그인 셸 설정이 아니라 그 명령 안에서 정한다 (docs/guide.md).

/** 이름 그대로 넘기는 것 (대소문자 무시: 윈도우는 환경 변수 이름의 대소문자를 가리지 않는다) */
const EXACT = new Set(
  [
    'PATH',
    'HOME',
    'USER',
    'USERNAME',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LANGUAGE',
    'TERM',
    'TZ',
    'TMPDIR',
    'TMP',
    'TEMP',
    // 프록시와 회사 인증서 (내려받기, 로그인이 이 뒤에서만 되는 사람)
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'REQUESTS_CA_BUNDLE',
    // 리눅스 로그인 정보 보관(키링)과 브라우저 로그인
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'DBUS_SESSION_BUS_ADDRESS',
    // 맥 기본 글자 인코딩
    '__CF_USER_TEXT_ENCODING',
    // 윈도우가 프로그램을 돌리는 데 필요한 것
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'APPDATA',
    'LOCALAPPDATA',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'COMMONPROGRAMFILES',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',
    // AI 도구가 읽는 것 (Bedrock, Vertex 로 claude 를 쓰는 사람, gemini 키)
    'GOOGLE_API_KEY',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'CLOUD_ML_REGION',
    'NO_COLOR',
  ].map((k) => k.toUpperCase()),
);

/** 앞부분이 이것이면 넘긴다 */
const PREFIXES = ['LC_', 'XDG_', 'ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'CODEX_', 'CURSOR_', 'GEMINI_', 'AWS_'];

export function allowedEnvName(name: string): boolean {
  const up = name.toUpperCase();
  return EXACT.has(up) || PREFIXES.some((p) => up.startsWith(p));
}

/** 고른 것만 담은 환경. extra 는 그 위에 덮는다 (PATH, CODEX_HOME, NO_COLOR 등) */
export function aiChildEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && allowedEnvName(k)) out[k] = v;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    // 윈도우에서 Path 와 PATH 가 같이 있으면 어느 쪽을 쓸지 모호하다. 같은 이름(대소문자 무시)은 지우고 넣는다
    for (const old of Object.keys(out))
      if (old !== k && old.toUpperCase() === k.toUpperCase()) delete out[old];
    out[k] = v;
  }
  return out;
}
