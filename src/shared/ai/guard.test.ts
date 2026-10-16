// 읽기 전용 강제 (이슈 #126). 외부 AI 를 부르는 경로마다 막는 인자가 실제로 실리는지 본다.
// 진짜 AI 는 부르지 않는다: 인자를 만드는 함수(claudeArgs, codexArgs, cursorArgs, gemini 인자)와 훅 스크립트를 그대로 돌린다.
// 인자가 실제 프로세스에 전달되는지는 scripts/dev/ai-safety.mjs 가 가짜 CLI 로 본다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { claudeArgs } from './claude.ts';
import { codexArgs } from './codex.ts';
import { codexMcpNames } from './codex-config.ts';
import { cursorArgs } from './cursor.ts';
import {
  CLAUDE_WRITE_TOOLS,
  CODEX_OFF_FEATURES,
  codexGuardArgs,
  guardHookCommand,
  guardSettings,
  hookDecision,
  hookToolName,
  mcpToolVerdict,
  toolWords,
} from './guard.ts';
import { BUILTIN_PROVIDERS, customProvider, fillArgs } from './providers.ts';
import type { McpLaunch } from './types.ts';

const base = { text: 'q', images: [], sessionId: 'abc', persona: 'p' };
const guard: McpLaunch = {
  command: '/Applications/Fairy.app/Contents/MacOS/Fairy',
  args: ['/x/out/main/ai-guard.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
};
const jj: McpLaunch = { command: 'node', args: ['mcp-server.js'], env: { JJ_USER_DATA: '/d' } };

/** 인자 목록에서 플래그 뒤 값 */
const after = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];
/** codex 의 -c key=value 들 */
const codexConfigs = (args: readonly string[]) => args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []));

// ---- claude ----

test('claude: 격리해도, 안 해도 쓰기 도구를 명시 거부하고 묻지 않고 거절한다', () => {
  for (const isolate of [true, false, undefined]) {
    for (const resume of [false, true]) {
      const a = claudeArgs({ ...base, resume, isolate, guard });
      assert.equal(after(a, '--tools'), '', `isolate=${isolate}`);
      assert.deepEqual(after(a, '--disallowedTools')?.split(','), [...CLAUDE_WRITE_TOOLS]);
      assert.equal(after(a, '--permission-mode'), 'dontAsk');
    }
  }
  // 말로 만들기: 웹 검색 하나만 열려도 쓰기는 그대로 막힌다
  const web = claudeArgs({ ...base, resume: false, webSearch: true });
  assert.equal(after(web, '--tools'), 'WebSearch');
  assert.equal(after(web, '--allowedTools'), 'WebSearch');
  assert.ok(after(web, '--disallowedTools')?.split(',').includes('Bash'));
});

test('claude: 허용 목록에 쓰기 도구가 들어가지 않는다', () => {
  const a = claudeArgs({
    ...base,
    resume: false,
    isolate: false,
    mcpServers: ['claude.ai Gmail', 'local'],
    jjServer: jj,
    webSearch: true,
    guard,
  });
  const allowed = after(a, '--allowedTools')?.split(',') ?? [];
  for (const w of CLAUDE_WRITE_TOOLS) assert.ok(!allowed.includes(w), w);
  assert.ok(allowed.includes('mcp__fairy'));
});

test('claude: 내 MCP 는 읽기 전용 훅이 실릴 때만 허락한다 (훅이 없으면 닫는다)', () => {
  const withGuard = claudeArgs({
    ...base,
    resume: false,
    isolate: false,
    mcpServers: ['notion'],
    guard,
  });
  assert.ok(after(withGuard, '--allowedTools')?.split(',').includes('mcp__notion'));
  const settings = JSON.parse(after(withGuard, '--settings') ?? '{}');
  const hook = settings.hooks.PreToolUse[0];
  assert.equal(hook.matcher, 'mcp__.*');
  assert.equal(hook.hooks[0].type, 'command');
  assert.ok(hook.hooks[0].command.includes('ai-guard.js'));

  const noGuard = claudeArgs({ ...base, resume: false, isolate: false, mcpServers: ['notion'] });
  assert.equal(noGuard.includes('--allowedTools'), false);
  assert.equal(noGuard.includes('--settings'), false);
  // 격리하면 내 MCP 는 원래 없다: 훅이 필요 없다
  const isolated = claudeArgs({ ...base, resume: false, isolate: true, mcpServers: ['notion'], guard });
  assert.equal(isolated.includes('--settings'), false);
  assert.equal(after(isolated, '--mcp-config'), '{"mcpServers":{}}');
});

test('claude: 허용 안 한 도구를 우회 모드로 여는 값은 어느 경로에도 없다', () => {
  const a = claudeArgs({ ...base, resume: false, isolate: false, mcpServers: ['x'], jjServer: jj, guard });
  for (const bad of [
    '--dangerously-skip-permissions',
    '--allow-dangerously-skip-permissions',
    'bypassPermissions',
  ]) {
    assert.equal(a.includes(bad), false, bad);
  }
});

// ---- codex ----

test('codex: 새 질문, 이어가기, 기록 안 남김 모두 읽기 전용 설정이 실린다', () => {
  const cases = [
    codexArgs({ text: 'q', imagePaths: [], persona: 'p' }),
    codexArgs({ text: 'q', imagePaths: [], persona: 'p', threadId: 't1' }),
    codexArgs({ text: 'q', imagePaths: [], persona: 'p', ephemeral: true, jjServer: jj }),
    codexArgs({ text: 'q', imagePaths: ['/tmp/a.png'], persona: 'p', model: 'm' }),
  ];
  for (const a of cases) {
    const cfg = codexConfigs(a);
    assert.ok(cfg.includes('sandbox_mode="read-only"'));
    assert.ok(cfg.includes('approval_policy="never"'));
    for (const f of CODEX_OFF_FEATURES) assert.ok(cfg.includes(`features.${f}=false`), f);
    // 쓰기를 여는 값은 어디에도 없다
    for (const bad of [
      'workspace-write',
      'danger-full-access',
      '--full-auto',
      '--dangerously-bypass-approvals-and-sandbox',
    ])
      assert.equal(a.join(' ').includes(bad), false, bad);
  }
});

test('codex: 격리를 껐을 때 사용자 설정의 MCP 서버를 끈다 (페어리 도구를 싣는 때만 fairy 는 둔다)', () => {
  const user = ['notion', 'fairy', 'my.server'];
  const off = codexConfigs(codexArgs({ text: 'q', imagePaths: [], persona: 'p', userMcpNames: user }));
  assert.ok(off.includes('mcp_servers.notion.enabled=false'));
  assert.ok(off.includes('mcp_servers."my.server".enabled=false'));
  // 페어리 도구를 안 싣는데 사용자가 직접 등록해 둔 fairy 는 확인 없이 지우기가 되니 끈다
  assert.ok(off.includes('mcp_servers.fairy.enabled=false'));
  const keep = codexConfigs(
    codexArgs({ text: 'q', imagePaths: [], persona: 'p', userMcpNames: user, jjServer: jj }),
  );
  assert.ok(keep.includes('mcp_servers.notion.enabled=false'));
  assert.equal(keep.includes('mcp_servers.fairy.enabled=false'), false);
  assert.ok(keep.some((c) => c.startsWith('mcp_servers.fairy.command=')));
  // 격리하면 사용자 서버가 없다
  assert.equal(
    codexConfigs(codexArgs({ text: 'q', imagePaths: [], persona: 'p' })).some((c) => c.includes('.enabled=')),
    false,
  );
  assert.deepEqual(codexGuardArgs([]).slice(0, 4), [
    '-c',
    'sandbox_mode="read-only"',
    '-c',
    'approval_policy="never"',
  ]);
});

test('codex 설정 파일에서 MCP 서버 이름 읽기', () => {
  const toml = [
    'model = "gpt-5"',
    '[mcp_servers.notion]',
    'command = "npx"',
    '[mcp_servers.notion.env]',
    'A = "1"',
    '[mcp_servers."my.server"]',
    'url = "https://x"',
    '  [mcp_servers.fairy]',
    '# [mcp_servers.commented]',
    '[projects."/a/b"]',
  ].join('\n');
  assert.deepEqual(codexMcpNames(toml).sort(), ['fairy', 'my.server', 'notion']);
  // 점 키 모양은 표 머리와 섞어 쓸 수 없어(TOML 규칙) 따로
  assert.deepEqual(codexMcpNames('mcp_servers.github.command = "npx"\nmcp_servers.x.url = "u"').sort(), [
    'github',
    'x',
  ]);
  assert.deepEqual(codexMcpNames(''), []);
});

// ---- cursor, gemini, 직접 추가한 AI ----

test('cursor: 읽기 전용 ask 모드이고 쓰기, MCP 자동 승인 플래그는 없다', () => {
  for (const sessionId of [undefined, 's1']) {
    const a = cursorArgs({ text: 'q', persona: 'p', sessionId });
    assert.equal(after(a, '--mode'), 'ask');
    for (const bad of ['--force', '--yolo', '-f', '--approve-mcps', '--trust', '--mode=agent'])
      assert.equal(a.includes(bad), false, bad);
  }
});

test('gemini: 승인 방식을 default 로 박고 yolo 계열은 없다', () => {
  const spec = BUILTIN_PROVIDERS.find((p) => p.id === 'gemini');
  assert.ok(spec?.args);
  const a = fillArgs(spec.args, '질문');
  assert.equal(after(a, '--approval-mode'), 'default');
  assert.equal(after(a, '-p'), '질문');
  for (const bad of ['--yolo', '-y', 'yolo', 'auto_edit']) assert.equal(a.includes(bad), false, bad);
});

test('직접 추가한 AI 는 막을 방법이 없어 사용자가 적은 인자 그대로다 (표에 막아 둠으로 올리지 않는다)', () => {
  const spec = customProvider({ label: 'x', bin: 'ollama', args: 'run m {prompt}' }, 'custom-1');
  assert.ok(typeof spec !== 'string');
  assert.deepEqual(fillArgs(spec.args ?? [], 'q'), ['run', 'm', 'q']);
});

// ---- 읽기 전용 훅 ----

test('MCP 도구 이름으로 읽기와 쓰기를 가른다', () => {
  const allow = [
    'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Gmail__get_message',
    'mcp__claude_ai_Notion__notion-fetch',
    'mcp__claude_ai_Notion__notion-search',
    'mcp__local__list_files',
    'mcp__local__read_file',
    'mcp__claude_ai_flow__flow_get_my_worklist',
    'mcp__claude_ai_flow__flow_find_events',
    'mcp__claude_ai_Supabase__list_tables',
    'mcp__github__getFileContents',
    'mcp__playwright__browser_snapshot',
  ];
  const deny = [
    'mcp__claude_ai_Gmail__send_message',
    'mcp__claude_ai_Gmail__create_draft',
    'mcp__claude_ai_Gmail__trash_thread',
    'mcp__claude_ai_Gmail__reply',
    'mcp__claude_ai_Notion__notion-create-pages',
    'mcp__claude_ai_Notion__notion-update-page',
    'mcp__claude_ai_Notion__notion-delete-pages',
    'mcp__claude_ai_flow__flow_create_post',
    'mcp__claude_ai_flow__flow_update_task',
    'mcp__claude_ai_Supabase__execute_sql',
    'mcp__claude_ai_Supabase__apply_migration',
    'mcp__claude_ai_Vercel__create_deployment',
    'mcp__github__createIssueComment',
    'mcp__github__get_or_create_branch', // 읽는 말이 섞여도 쓰는 말이 있으면 막는다
    'mcp__playwright__browser_click',
    'mcp__playwright__browser_navigate',
    'mcp__filesystem__write_file',
    'mcp__shell__run', // 읽는 말이 없다
    'mcp__x__frobnicate', // 모르는 이름은 닫는다
    'mcp__x__setup_qa', // setup 은 set 이 아니어도 읽는 말이 없어 막힌다
  ];
  // 페어리 서버는 이번 실행이 직접 실을 때만 통과 (사용자가 직접 등록한 fairy 는 확인 단계가 없다)
  for (const n of ['mcp__fairy__add_todo', 'mcp__fairy__delete_todo']) {
    assert.deepEqual(mcpToolVerdict(n, true), { allow: true }, n);
    assert.equal(mcpToolVerdict(n).allow, false, n);
  }
  for (const n of allow) assert.deepEqual(mcpToolVerdict(n), { allow: true }, n);
  for (const n of deny) assert.equal(mcpToolVerdict(n).allow, false, n);
  // 내장 쓰기 도구 이름도 막는다
  for (const n of CLAUDE_WRITE_TOOLS) assert.equal(mcpToolVerdict(n).allow, false, n);
  assert.deepEqual(toolWords('getAuthenticatedUser'), ['get', 'authenticated', 'user']);
  assert.deepEqual(toolWords('notion-create-pages'), ['notion', 'create', 'pages']);
});

test('훅은 막을 때만 글을 내고, 허락을 뜻하는 allow 는 내지 않는다', () => {
  assert.equal(hookDecision('mcp__x__get_thing'), '');
  const out = JSON.parse(hookDecision('mcp__claude_ai_Gmail__send_message'));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /읽기 전용/);
  // 입력을 못 읽으면 막는다
  assert.equal(JSON.parse(hookDecision(undefined)).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hookToolName('{"tool_name":"mcp__a__b","tool_input":{}}'), 'mcp__a__b');
  assert.equal(hookToolName('깨진'), undefined);
  assert.equal(hookToolName('{"tool_name":3}'), undefined);
});

test('훅 스크립트(out/main/ai-guard 의 원본)를 실제 프로세스로 돌려 막는다', () => {
  const script = fileURLToPath(new URL('../../main/ai-guard.ts', import.meta.url));
  const run = (input: string) =>
    spawnSync(process.execPath, [script], { input, encoding: 'utf8', timeout: 15_000 });
  const denied = run(
    '{"hook_event_name":"PreToolUse","tool_name":"mcp__claude_ai_Gmail__send_message","tool_input":{"to":"a@b.c"}}',
  );
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const ok = run('{"tool_name":"mcp__claude_ai_Gmail__get_message"}');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, '');
  // 페어리 서버는 이번 실행이 직접 실을 때(--allow-fairy)만 통과
  const own = spawnSync(process.execPath, [script, '--allow-fairy'], {
    input: '{"tool_name":"mcp__fairy__add_todo"}',
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(own.stdout, '');
  assert.equal(
    JSON.parse(run('{"tool_name":"mcp__fairy__delete_todo"}').stdout).hookSpecificOutput.permissionDecision,
    'deny',
  );
  const broken = run('not json');
  assert.equal(JSON.parse(broken.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('훅 명령은 셸에서 띄어쓰기와 따옴표가 있는 경로도 한 단어로 읽힌다', () => {
  const cmd = guardHookCommand(
    {
      command: "/Applications/My App/It's.app/Fairy",
      args: ['/a b/ai-guard.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
    'darwin',
  );
  assert.ok(
    cmd.startsWith(
      `ELECTRON_RUN_AS_NODE='1' '/Applications/My App/It'\\''s.app/Fairy' '/a b/ai-guard.js' || {`,
    ),
    cmd,
  );
  // 윈도우는 Git Bash 가 읽으니 역슬래시를 슬래시로
  const win = guardHookCommand(
    {
      command: 'C:\\Program Files\\Fairy\\Fairy.exe',
      args: ['C:\\Program Files\\Fairy\\resources\\ai-guard.js'],
      env: {},
    },
    'win32',
  );
  assert.ok(
    win.startsWith(`'C:/Program Files/Fairy/Fairy.exe' 'C:/Program Files/Fairy/resources/ai-guard.js' || {`),
    win,
  );
  assert.ok(
    JSON.parse(guardSettings(guard, 'darwin')).hooks.PreToolUse[0].hooks[0].command.includes('ai-guard.js'),
  );
});

// ---- 버그잡이 PR #131 ----

test('사용자가 직접 등록한 fairy 는 페어리 도구를 싣지 않는 실행에서 통째로 열리지 않는다 (B1)', () => {
  const turn = { ...base, resume: false, isolate: false, mcpServers: ['fairy', 'notion'], guard };
  const none = claudeArgs(turn);
  const allowed = after(none, '--allowedTools')?.split(',') ?? [];
  assert.deepEqual(allowed, ['mcp__notion']);
  const hook = JSON.parse(after(none, '--settings') ?? '{}').hooks.PreToolUse[0].hooks[0].command as string;
  assert.equal(hook.includes('--allow-fairy'), false);
  assert.equal(mcpToolVerdict('mcp__fairy__delete_todo').allow, false);
  // 이번 실행이 페어리 서버를 싣는 경우는 훅도 fairy 를 통과시킨다
  const own = claudeArgs({ ...turn, jjServer: jj });
  assert.ok(after(own, '--allowedTools')?.split(',').includes('mcp__fairy'));
  assert.ok(
    (JSON.parse(after(own, '--settings') ?? '{}').hooks.PreToolUse[0].hooks[0].command as string).includes(
      '--allow-fairy',
    ),
  );
});

test('서버 이름이 fairy_ 로 시작해도 접두사로 통과하지 않는다 (B2)', () => {
  for (const allowFairy of [false, true]) {
    assert.equal(mcpToolVerdict('mcp__fairy___send_email', allowFairy).allow, false);
    assert.equal(mcpToolVerdict('mcp__fairy_x__add_todo', allowFairy).allow, false);
  }
});

test('목록에 없는 쓰기 동사도 읽는 낱말이 섞여 통과하지 못한다 (B3, 허용 목록)', () => {
  for (const n of [
    'mcp__serena__replace_symbol_body',
    'mcp__x__clear_history',
    'mcp__x__purge_logs',
    'mcp__jira__change_status',
    'mcp__x__modify_schema',
    'mcp__x__schedule_from_availability',
    'mcp__x__wipe_cache',
    'mcp__x__subscribe_events',
    'mcp__x__select_option',
    'mcp__x__transition_issue',
    'mcp__x__history_rewrite', // 읽는 동사가 없다
  ])
    assert.equal(mcpToolVerdict(n).allow, false, n);
  // 읽는 동사가 앞에 있으면 통과
  for (const n of [
    'mcp__serena__find_symbol',
    'mcp__x__get_status',
    'mcp__x__list_logs',
    'mcp__x__browser_snapshot',
  ])
    assert.equal(mcpToolVerdict(n).allow, true, n);
});

test('훅 스크립트가 없거나 죽으면 막는 줄이 2 로 끝낸다 (B4, 실패하면 막기)', () => {
  const cmd = guardHookCommand(
    {
      command: process.execPath,
      args: ['/nonexistent/out/main/ai-guard.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
    'darwin',
  );
  const r = spawnSync('/bin/sh', ['-c', cmd], {
    input: JSON.stringify({ tool_name: 'mcp__gmail__send_email' }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, `exit=${r.status} stdout=${JSON.stringify(r.stdout)}`);
  assert.match(r.stderr, /막았어/);
  // 실행 파일이 아예 없어도(127) 마찬가지
  const gone = guardHookCommand({ command: '/nonexistent/Fairy', args: ['x.js'], env: {} }, 'darwin');
  assert.equal(spawnSync('/bin/sh', ['-c', gone], { input: '{}', encoding: 'utf8' }).status, 2);
  // 스크립트가 잘 돌면 그 결과 그대로 (읽기 도구는 0, 출력 없음)
  const script = fileURLToPath(new URL('../../main/ai-guard.ts', import.meta.url));
  const ok = guardHookCommand({ command: process.execPath, args: [script], env: {} }, 'darwin');
  const good = spawnSync('/bin/sh', ['-c', ok], {
    input: '{"tool_name":"mcp__x__get_thing"}',
    encoding: 'utf8',
  });
  assert.equal(good.status, 0);
  assert.equal(good.stdout, '');
  // 설정에 훅 끄기 해제 표시
  assert.equal(JSON.parse(guardSettings(guard, 'darwin')).disableAllHooks, false);
});

test('codex 설정의 MCP 서버를 TOML 의 모든 모양에서 읽는다 (B5)', () => {
  const toml = [
    '[mcp_servers.gmail] # 메일',
    "[mcp_servers.'slack.bot']",
    '[ mcp_servers.notion ]',
    'command = "npx"',
    '[mcp_servers]',
    'linear = { command = "npx" }',
    '[mcp_servers."esc\\"aped"]',
    '[mcp_servers.fairy.env]',
    'A = "1"',
    '# [mcp_servers.commented]',
    '[projects."/a/b"]',
  ].join('\n');
  assert.deepEqual(codexMcpNames(toml).sort(), [
    'esc"aped',
    'fairy',
    'gmail',
    'linear',
    'notion',
    'slack.bot',
  ]);
  // 점 키 모양은 표 머리와 섞어 쓸 수 없어(TOML 규칙) 따로
  assert.deepEqual(codexMcpNames('mcp_servers.hub.command = "npx"\nmcp_servers.x.url = "u"').sort(), [
    'hub',
    'x',
  ]);
  assert.deepEqual(codexMcpNames(''), []);
  assert.deepEqual(codexMcpNames('깨진 [[['), []);
  assert.deepEqual(codexMcpNames('mcp_servers = 3'), []);
});

test('gemini 는 내 MCP 서버를 허용 목록 밖으로 둔다', () => {
  const spec = BUILTIN_PROVIDERS.find((p) => p.id === 'gemini');
  const a = fillArgs(spec?.args ?? [], 'q');
  assert.ok(a.includes('--allowed-mcp-server-names=fairy-none'));
});
