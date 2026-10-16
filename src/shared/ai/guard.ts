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
]);

/** 읽기만 하는 동사 (쓰는 동사가 없을 때 하나라도 있으면 통과) */
const READ_WORDS = new Set([
  ...['get', 'list', 'search', 'find', 'read', 'query', 'fetch', 'describe', 'show', 'view', 'count'],
  ...['lookup', 'check', 'status', 'info', 'browse', 'analyze', 'explain', 'diff', 'history', 'blame'],
  ...['outline', 'retrieve', 'preview', 'inspect', 'snapshot', 'screenshot', 'whoami', 'schema'],
  ...['schemas', 'tree', 'dependencies', 'references', 'symbol', 'endpoints', 'logs', 'metrics'],
  ...['price', 'availability'],
]);

export type ToolVerdict = { allow: true } | { allow: false; reason: string };

/**
 * MCP 도구 이름(mcp__서버__도구)을 읽기 전용인지 가른다.
 * 페어리 자신의 서버(mcp__fairy__)는 통과: 지우기, 고치기는 이미 앱이 사용자 확인을 거친다 (shared/pet-actions.ts).
 * 그 밖의 서버는 쓰는 동사가 하나라도 있으면 막고, 읽는 동사가 하나도 없으면(모르는 이름) 그것도 막는다 (모르면 닫는다).
 */
export function mcpToolVerdict(toolName: string): ToolVerdict {
  if (toolName.startsWith(`mcp__${JJ_MCP_NAME}__`)) return { allow: true };
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (!m) {
    // mcp__ 로 시작하지 않는 이름(내장 도구)은 쓰기 도구 목록만 본다. 훅은 MCP 만 받지만 다른 곳에서 불러도 안전하게
    return CLAUDE_WRITE_TOOLS.includes(toolName)
      ? { allow: false, reason: `${toolName} 는 펫 대화에서 쓸 수 없어` }
      : { allow: true };
  }
  const words = toolWords(m[2] as string);
  const write = words.find((w) => WRITE_WORDS.has(w));
  if (write) return { allow: false, reason: `쓰기 도구라 막았어 (${write})` };
  if (!words.some((w) => READ_WORDS.has(w)))
    return { allow: false, reason: '읽기 전용인지 알 수 없어 막았어' };
  return { allow: true };
}

/**
 * 훅이 표준 출력으로 내는 PreToolUse 결정. 막을 때만 글을 낸다: 통과를 뜻하는 allow 는 내지 않는다
 * (훅의 allow 는 권한 확인을 건너뛰게 해서, 허락한 적 없는 도구까지 열어 줄 수 있다). toolName 이 없으면 막는다
 */
export function hookDecision(toolName: string | undefined): string {
  const v: ToolVerdict =
    toolName === undefined
      ? { allow: false, reason: '도구 이름을 읽지 못해 막았어' }
      : mcpToolVerdict(toolName);
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

/**
 * claude 훅 명령 한 줄: 페어리 실행 파일을 Node 로 돌려 ai-guard.js 를 띄운다.
 * 윈도우의 claude 는 Git Bash 로 훅을 돌리니 역슬래시를 슬래시로 바꾼다.
 */
export function guardHookCommand(launch: McpLaunch, platform: NodeJS.Platform = process.platform): string {
  const p = (s: string) => (platform === 'win32' ? s.replace(/\\/g, '/') : s);
  const env = Object.entries(launch.env).map(([k, v]) => `${k}=${shq(v)}`);
  return [...env, shq(p(launch.command)), ...launch.args.map((a) => shq(p(a)))].join(' ');
}

/** claude --settings 에 넘길 JSON: 모든 MCP 도구 호출 앞에 읽기 전용 훅 */
export function guardSettings(launch: McpLaunch, platform?: NodeJS.Platform): string {
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: 'mcp__.*',
          hooks: [{ type: 'command', command: guardHookCommand(launch, platform), timeout: 10 }],
        },
      ],
    },
  });
}

/** codex 설정 파일의 [mcp_servers.이름] 머리에서 서버 이름들. 이름에 점이 있으면 따옴표로 묶여 온다 */
export function codexMcpNames(toml: string): string[] {
  const names = new Set<string>();
  for (const m of toml.matchAll(/^\s*\[mcp_servers\.("[^"]+"|[A-Za-z0-9_-]+)(?:\.[^\]]*)?\]\s*$/gm)) {
    const raw = m[1] as string;
    names.add(raw.startsWith('"') ? raw.slice(1, -1) : raw);
  }
  return [...names];
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
