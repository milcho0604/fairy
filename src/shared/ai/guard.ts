// 펫이 부르는 외부 AI 를 읽기 전용으로 묶는 규칙 (이슈 #126).
// 펫 대화의 AI 는 파일을 고치거나 명령을 실행하거나 메일, 메시지를 보내지 않는다. 막는 곳은 AI 마다 다르다:
//   claude: 내장 도구 끔(--tools), 쓰기 도구 명시 거부(--disallowedTools), 허락 안 한 것은 거절(--permission-mode dontAsk),
//           내 MCP 도구는 PreToolUse 훅이 이름으로 읽기만 통과시킨다 (이 파일의 mcpToolVerdict, main/ai-guard.ts)
//   codex: 읽기 전용 샌드박스 + 승인 안 묻고 거절(approval_policy never) + 앱 연결, 브라우저, 컴퓨터 조작, 플러그인 끔 + 내 MCP 서버 끔
//   cursor: --mode ask (읽기 전용). --force, --approve-mcps 는 절대 넣지 않는다
//   gemini: --approval-mode default (확인이 필요한 도구는 헤드리스에서 거절). yolo, auto_edit 는 쓰지 않는다
// 사용자의 기존 허용 설정(~/.claude, ~/.codex)과 상관없이 명령줄에서 정한다. 이 파일은 Electron 없이 돌아 시험에서 그대로 부른다.
import { JJ_MCP_NAME, type McpLaunch } from './types.ts';

/** claude 의 쓰기 도구. --tools 로 이미 빼지만 사용자 설정이 어떻든 거부 규칙(허용보다 먼저, 우회 모드에서도 통한다)으로 한 번 더 */
export const CLAUDE_WRITE_TOOLS: readonly string[] = [
  'Bash',
  'PowerShell',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Agent',
  'Task',
];

/** codex 에서 끄는 기능 (codex features list 로 확인한 이름). 모르는 이름은 codex 가 무시한다 (-c features.이름=false) */
export const CODEX_OFF_FEATURES: readonly string[] = [
  'apps', // 연결된 앱(메일, 메시지 등) 도구
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'plugins',
  'multi_agent',
  'multi_agent_v2',
];

/** 이름을 낱말로 쪼갠다: get_message, notion-fetch, getAuthenticatedUser → ['get','message'] */
export function toolWords(tool: string): string[] {
  return tool
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** 바깥에 영향을 주는 동사 (하나라도 있으면 막는다) */
const WRITE_WORDS = new Set([
  ...['create', 'add', 'update', 'edit', 'delete', 'remove', 'write', 'send', 'post', 'put', 'patch', 'set'],
  ...[
    'move',
    'rename',
    'copy',
    'duplicate',
    'insert',
    'upsert',
    'drop',
    'truncate',
    'execute',
    'exec',
    'run',
  ],
  ...['apply', 'deploy', 'publish', 'merge', 'push', 'commit', 'reset', 'restore', 'rollback', 'revert'],
  ...['cancel', 'kill', 'stop', 'start', 'restart', 'pause', 'unpause', 'approve', 'reject', 'reply'],
  ...['forward', 'label', 'unlabel', 'mark', 'unmark', 'trash', 'untrash', 'archive', 'spam', 'assign'],
  ...['invite', 'share', 'grant', 'revoke', 'upload', 'import', 'sync', 'reindex', 'index', 'backup'],
  ...['buy', 'pay', 'transfer', 'issue', 'activate', 'install', 'uninstall', 'click', 'type', 'press'],
  ...['drag', 'fill', 'navigate', 'evaluate', 'submit', 'generate', 'authenticate', 'complete'],
  ...['download', 'save', 'sign', 'toggle', 'enable', 'disable', 'rotate', 'extend', 'resolve', 'react'],
  ...['comment', 'convert', 'spawn', 'unpin', 'pin', 'hover', 'resize', 'close', 'open', 'upgrade'],
  ...['stage', 'unstage', 'invalidate', 'record', 'verify', 'test', 'rebase', 'unlock', 'lock', 'attach'],
  ...[
    'replace',
    'clear',
    'purge',
    'change',
    'modify',
    'schedule',
    'draft',
    'wipe',
    'erase',
    'flush',
    'order',
  ],
  ...['book', 'subscribe', 'follow', 'accept', 'decline', 'transition', 'select', 'swap', 'fix', 'refactor'],
]);

/**
 * 읽기만 하는 동사. 명사(status, history, schema, symbol 같은 것)는 넣지 않는다: replace_symbol_body, change_status 처럼
 * 쓰는 동사 옆에 붙어 통과시키는 틈이 된다
 */
const READ_WORDS = new Set([
  ...['get', 'list', 'search', 'find', 'read', 'query', 'fetch', 'describe', 'show', 'view', 'count'],
  ...['lookup', 'check', 'browse', 'analyze', 'explain', 'diff', 'retrieve', 'preview', 'inspect'],
  ...['snapshot', 'screenshot', 'whoami'],
]);

export type ToolVerdict = { allow: true } | { allow: false; reason: string };

/**
 * MCP 도구 이름(mcp__서버__도구)을 읽기 전용인지 가른다 (허용 목록 방식: 읽는 동사가 확실할 때만 통과).
 * - 서버 이름이 정확히 fairy 이고 이번 실행이 페어리 서버를 직접 싣는 경우(allowFairy)만 통과: 지우기, 고치기는 앱이 사용자 확인을 거친다
 *   (shared/pet-actions.ts, JJ_MCP_CONFIRM). 사용자가 직접 등록한 fairy 는 그 확인이 없어서 allowFairy 가 아니면 다른 서버와 같이 본다
 * - 그 밖은 낱말로 쪼개 쓰는 동사가 하나라도 있으면 막고, 읽는 동사가 이름 앞쪽(첫 낱말이나 서버 머리 하나 뒤)에 없으면 막는다
 */
export function mcpToolVerdict(toolName: string, allowFairy = false): ToolVerdict {
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (!m) {
    // mcp__ 로 시작하지 않는 이름(내장 도구)은 쓰기 도구 목록만 본다. 훅은 MCP 만 받지만 다른 곳에서 불러도 안전하게
    return CLAUDE_WRITE_TOOLS.includes(toolName)
      ? { allow: false, reason: `${toolName} 는 펫 대화에서 쓸 수 없어` }
      : { allow: true };
  }
  const server = m[1] as string;
  const tool = m[2] as string;
  if (allowFairy && server === JJ_MCP_NAME && !tool.startsWith('_')) return { allow: true };
  const words = toolWords(tool);
  const write = words.find((w) => WRITE_WORDS.has(w));
  if (write) return { allow: false, reason: `쓰기 도구라 막았어 (${write})` };
  if (!words.slice(0, 2).some((w) => READ_WORDS.has(w)))
    return { allow: false, reason: '읽기 전용인지 알 수 없어 막았어' };
  return { allow: true };
}

/**
 * 훅이 표준 출력으로 내는 PreToolUse 결정. 막을 때만 글을 낸다: 통과를 뜻하는 allow 는 내지 않는다
 * (훅의 allow 는 권한 확인을 건너뛰게 해서, 허락한 적 없는 도구까지 열어 줄 수 있다). toolName 이 없으면 막는다
 */
export function hookDecision(toolName: string | undefined, allowFairy = false): string {
  const v: ToolVerdict =
    toolName === undefined
      ? { allow: false, reason: '도구 이름을 읽지 못해 막았어' }
      : mcpToolVerdict(toolName, allowFairy);
  if (v.allow) return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `페어리는 읽기 전용이야: ${v.reason}`,
    },
  });
}

/** 훅 입력(표준 입력 JSON)에서 도구 이름. 읽을 수 없으면 undefined */
export function hookToolName(stdin: string): string | undefined {
  try {
    const v = JSON.parse(stdin) as { tool_name?: unknown };
    return typeof v.tool_name === 'string' ? v.tool_name : undefined;
  } catch {
    return undefined;
  }
}

/** 셸 한 단어로 감싼다 (작은따옴표). 훅 명령은 셸이 읽는다 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 훅 스크립트에 넘기는 표시: 이번 실행이 페어리 서버를 직접 싣는다 (mcp__fairy__ 를 통과시킨다) */
export const ALLOW_FAIRY_FLAG = '--allow-fairy';

/**
 * claude 훅 명령 한 줄: 페어리 실행 파일을 Node 로 돌려 ai-guard.js 를 띄운다.
 * 훅은 0 과 2 말고는 "실패했지만 계속 진행"이라(스크립트 경로가 없거나 죽으면 도구가 그대로 돈다) 열린 채로 실패한다.
 * 그래서 스크립트가 0 으로 끝나지 않으면 이 줄이 2 와 이유로 끝내 도구를 막는다 (실패하면 막기).
 * 변수=값 앞붙임과 || 는 POSIX 셸 문법이다. 윈도우에서 claude 가 PowerShell 로 훅을 읽으면 안 먹으니
 * 부르는 쪽이 윈도우에서는 훅 없이 내 MCP 를 열지 않는다 (main/ai/runner.ts)
 */
export function guardHookCommand(
  launch: McpLaunch,
  platform: NodeJS.Platform = process.platform,
  allowFairy = false,
): string {
  const p = (s: string) => (platform === 'win32' ? s.replace(/\\/g, '/') : s);
  const env = Object.entries(launch.env).map(([k, v]) => `${k}=${shq(v)}`);
  const run = [
    ...env,
    shq(p(launch.command)),
    ...launch.args.map((a) => shq(p(a))),
    ...(allowFairy ? [ALLOW_FAIRY_FLAG] : []),
  ].join(' ');
  return `${run} || { echo ${shq('페어리 읽기 전용 훅이 실행되지 않아 막았어')} >&2; exit 2; }`;
}

/**
 * claude --settings 에 넘길 JSON: 모든 MCP 도구 호출 앞에 읽기 전용 훅.
 * disableAllHooks 를 명시적으로 false 로: 다른 설정 층이 훅을 끄지 못하게 (관리 설정이 끄는 것은 못 막는다)
 */
export function guardSettings(launch: McpLaunch, platform?: NodeJS.Platform, allowFairy = false): string {
  return JSON.stringify({
    disableAllHooks: false,
    hooks: {
      PreToolUse: [
        {
          matcher: 'mcp__.*',
          hooks: [{ type: 'command', command: guardHookCommand(launch, platform, allowFairy), timeout: 10 }],
        },
      ],
    },
  });
}

/** codex -c 키 한 조각. 영문, 숫자, _, - 말고는 따옴표로 묶는다 */
export function tomlKey(name: string): string {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name);
}

/**
 * codex 에서 읽기 전용을 강제하는 -c 묶음.
 * userMcpNames: 격리를 껐을 때 사용자 설정에 있는 MCP 서버. 모두 끈다. 다만 이번에 페어리 도구를 싣는 경우(keepFairy)
 * 페어리 서버는 이 질문이 새로 정해 넘기는 것이라 끄지 않는다. 싣지 않는데 사용자가 직접 등록해 둔 fairy 는 확인 없이 지우기가 되니 끈다
 */
export function codexGuardArgs(userMcpNames: readonly string[] = [], keepFairy = false): string[] {
  return [
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"',
    ...CODEX_OFF_FEATURES.flatMap((f) => ['-c', `features.${f}=false`]),
    ...userMcpNames
      .filter((n) => !(keepFairy && n === JJ_MCP_NAME))
      .flatMap((n) => ['-c', `mcp_servers.${tomlKey(n)}.enabled=false`]),
  ];
}
