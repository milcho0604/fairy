import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setLang } from '../i18n/index.ts';
import { claudeArgs, claudeInput, parseClaudeLine, parseMcpList } from './claude.ts';
import { codexArgs, parseCodexLine } from './codex.ts';
import { cursorArgs } from './cursor.ts';
import { classifyError } from './errors.ts';
import { textPrompt, withHistory } from './text.ts';
import type { AiEvent } from './types.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .trim()
    .split('\n');

test('claude 실제 출력(2026-10-02, 2.1.287): 세션, 조각, 완료', () => {
  const events = fixture('claude-hello.jsonl').flatMap(parseClaudeLine);
  assert.deepEqual(events[0], { type: 'session', id: 'd57445f3-1e01-4bcf-88ce-3ddf4254b96f' });
  const text = events
    .filter((e): e is Extract<AiEvent, { type: 'delta' }> => e.type === 'delta')
    .map((e) => e.text);
  assert.deepEqual(text, ['안녕, 반', '가', '워!']);
  assert.deepEqual(events.at(-1), { type: 'done', text: '안녕, 반가워!' });
});

test('claude: JSON 이 아닌 줄과 생각 조각은 버린다', () => {
  assert.deepEqual(parseClaudeLine('Warning: something'), []);
  assert.deepEqual(
    parseClaudeLine(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta' } },
      }),
    ),
    [],
  );
});

test('claude: 오류 결과는 오류 사건', () => {
  const [e] = parseClaudeLine(
    JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' }),
  );
  assert.equal(e?.type, 'error');
  assert.equal(e?.type === 'error' && e.error.kind, 'not-logged-in');
});

test('claude 명령: 격리(L5, L13)와 새 세션, 이어가기', () => {
  const base = { text: 'q', images: [], sessionId: 'abc', persona: 'p' };
  const first = claudeArgs({ ...base, resume: false });
  for (const flag of [
    '--setting-sources',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--include-partial-messages',
  ]) {
    assert.ok(first.includes(flag), flag);
  }
  assert.equal(first[first.indexOf('--tools') + 1], '');
  assert.equal(first[first.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.deepEqual(first.slice(-2), ['--session-id', 'abc']);
  assert.deepEqual(claudeArgs({ ...base, resume: true }).slice(-2), ['--resume', 'abc']);
});

test('claude 입력: 이미지 다음 글, 한 줄', () => {
  const line = claudeInput({ text: '이거 뭐야', images: [{ mediaType: 'image/png', data: 'AAA' }] });
  assert.ok(line.endsWith('\n'));
  const msg = JSON.parse(line);
  assert.equal(msg.message.content[0].source.data, 'AAA');
  assert.equal(msg.message.content[1].text, '이거 뭐야');
});

test('codex 실제 출력(0.155.1): thread_id, 답 한 번에, 완료', () => {
  const events = fixture('codex-hello.jsonl').flatMap(parseCodexLine);
  assert.deepEqual(events, [
    { type: 'session', id: '01a0f9e7-fac9-7b63-a305-d0d5fb56a404' },
    { type: 'delta', text: '알겠어, 친구. 기억할게.' },
    { type: 'done', text: '' },
  ]);
});

test('codex: 경고 항목과 로그 줄은 무시, turn.failed 는 오류', () => {
  assert.deepEqual(
    parseCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'error', message: '스킬 경고' } })),
    [],
  );
  assert.deepEqual(parseCodexLine('2026-10-02 ERROR mcp: connection refused'), []);
  const [e] = parseCodexLine(
    JSON.stringify({
      type: 'turn.failed',
      error: { message: "You've hit your usage limit. Try again at 7:48 PM." },
    }),
  );
  assert.deepEqual(e?.type === 'error' && [e.error.kind, e.error.retryAt], ['rate-limit', '7:48 PM']);
});

test('codex 명령: 질문은 -i 앞, 이어가기는 resume, 샌드박스는 -c', () => {
  const first = codexArgs({ text: '질문', imagePaths: ['/a.png', '/b.png'], persona: '반말' });
  assert.deepEqual(first.slice(0, 2), ['exec', '질문']);
  assert.ok(first.indexOf('질문') < first.indexOf('-i'));
  assert.deepEqual(first.slice(-4), ['-i', '/a.png', '-i', '/b.png']);
  assert.ok(first.includes('sandbox_mode="read-only"'));
  assert.ok(first.includes('developer_instructions="반말"'));
  const next = codexArgs({ text: '또', imagePaths: [], persona: 'p', threadId: 't1' });
  assert.deepEqual(next.slice(0, 4), ['exec', 'resume', 't1', '또']);
  const quiet = codexArgs({ text: '비밀', imagePaths: [], persona: 'p', threadId: 't1', ephemeral: true });
  assert.deepEqual(quiet.slice(0, 3), ['exec', '비밀', '--ephemeral']);
  assert.ok(!quiet.includes('resume'));
});

test('codex, cursor 명령: "-" 로 시작하는 질문은 옵션으로 읽히지 않게 빈칸을 붙인다', () => {
  assert.equal(codexArgs({ text: '- 목록 정리', imagePaths: [], persona: 'p' })[1], ' - 목록 정리');
  assert.equal(codexArgs({ text: '-v', imagePaths: [], persona: 'p', threadId: 't' })[3], ' -v');
  assert.equal(codexArgs({ text: 'a-b', imagePaths: [], persona: 'p' })[1], 'a-b');
  assert.equal(cursorArgs({ text: '--help', persona: 'p', sessionId: 's' }).at(-1), ' --help');
});

test('기록 안 남김: 최근 대화를 질문 앞에 붙인다', () => {
  assert.equal(withHistory([], '안녕'), '안녕');
  const h = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
  const text = withHistory(h, '다음');
  assert.ok(!text.includes('q1') && text.includes('q2') && text.includes('q5'));
  assert.ok(text.endsWith('사용자 질문: 다음'));
});

test('기록 안 남김: 영어 화면이면 대화 틀도 영어', () => {
  setLang('en');
  try {
    const text = withHistory([{ question: 'hi', answer: 'hello' }], 'next');
    assert.equal(text, 'Conversation so far:\n\nUser: hi\nYou: hello\n\nUser question: next');
    assert.equal(textPrompt('persona', [], 'q'), 'persona\n\nUser question: q');
  } finally {
    setLang('ko');
  }
});

test('오류 문구 분류', () => {
  const claude = { label: 'Claude' };
  const codex = { label: 'Codex', loginHint: '터미널에서 codex login 으로 로그인해 줘.' };
  assert.equal(classifyError(claude, 'Claude AI usage limit reached|1790900400').kind, 'rate-limit');
  const login = classifyError(codex, 'Not logged in. Please run codex login');
  assert.equal(login.kind, 'not-logged-in');
  assert.ok(login.message.includes('codex login'));
  const other = classifyError(codex, 'stream disconnected\nmore');
  assert.equal(other.kind, 'failed');
  assert.ok(other.message.includes('stream disconnected'));
  assert.ok(!other.message.includes('more'));
});

test('claude 명령: "내 AI 설정 그대로"면 격리 옵션은 빼되 도구는 계속 끈다', () => {
  const args = claudeArgs({
    text: 'q',
    images: [],
    sessionId: 's',
    persona: 'p',
    resume: false,
    isolate: false,
  });
  for (const flag of [
    '--setting-sources',
    '--strict-mcp-config',
    '--mcp-config',
    '--disable-slash-commands',
  ]) {
    assert.ok(!args.includes(flag), flag);
  }
  assert.equal(args[args.indexOf('--tools') + 1], '');
  const quiet = claudeArgs({
    text: 'q',
    images: [],
    sessionId: 's',
    persona: 'p',
    resume: true,
    ephemeral: true,
  });
  assert.ok(quiet.includes('--no-session-persistence'));
  assert.ok(!quiet.includes('--resume') && !quiet.includes('--session-id'));
  const isolated = claudeArgs({ text: 'q', images: [], sessionId: 's', persona: 'p', resume: false });
  assert.ok(isolated.includes('--strict-mcp-config'));
});

test('내 MCP 도구: 격리를 껐을 때만 서버를 허락하고, 기본 도구는 여전히 끈다', () => {
  const base = { text: 'q', images: [], sessionId: 's', persona: 'p', resume: false };
  const on = claudeArgs({ ...base, isolate: false, mcpServers: ['claude.ai Notion', 'my-server'] });
  const i = on.indexOf('--allowedTools');
  assert.equal(on[i + 1], 'mcp__claude_ai_Notion,mcp__my-server');
  assert.equal(on[on.indexOf('--tools') + 1], '');
  assert.equal(claudeArgs({ ...base, isolate: true, mcpServers: ['x'] }).includes('--allowedTools'), false);
  assert.deepEqual(
    parseMcpList(
      'Checking MCP server health…\n\nclaude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected\nbroken: npx x - ✗ Failed to connect\nlocal: node a.js - ✓ Connected',
    ),
    ['claude.ai Notion', 'local'],
  );
});

test('고른 모델은 --model, -m 으로 넘기고, 없으면 붙이지 않는다', () => {
  const turn = { text: '질문', images: [], sessionId: 'abc', resume: false, persona: '반말' };
  const withModel = claudeArgs({ ...turn, model: 'sonnet' });
  assert.equal(withModel[withModel.indexOf('--model') + 1], 'sonnet');
  assert.ok(!claudeArgs(turn).includes('--model'));
  const codex = codexArgs({ text: '질문', imagePaths: [], persona: '반말', model: 'gpt-x' });
  assert.equal(codex[codex.indexOf('-m') + 1], 'gpt-x');
  assert.ok(!codexArgs({ text: '질문', imagePaths: [], persona: '반말' }).includes('-m'));
});

const jj = {
  command: '/Apps/짝꿍.app/Contents/MacOS/Jjakkung',
  args: ['C:\\app\\out\\main\\mcp-server.js'],
  env: { ELECTRON_RUN_AS_NODE: '1', JJ_USER_DATA: '/tmp/jj "data"' },
};

test('짝꿍 도구: 격리해도 펫 MCP 서버 하나만 싣고 그 도구만 허락한다. 기본 도구는 여전히 끈다', () => {
  const base = { text: 'q', images: [], sessionId: 's', persona: 'p', resume: false };
  const on = claudeArgs({ ...base, jjServer: jj });
  assert.ok(on.includes('--strict-mcp-config'));
  const config = JSON.parse(on[on.indexOf('--mcp-config') + 1] ?? '');
  assert.deepEqual(Object.keys(config.mcpServers), ['fairy']);
  assert.equal(config.mcpServers.fairy.command, jj.command);
  assert.deepEqual(config.mcpServers.fairy.args, jj.args);
  assert.deepEqual(config.mcpServers.fairy.env, jj.env);
  assert.equal(on[on.indexOf('--allowedTools') + 1], 'mcp__fairy');
  assert.equal(on[on.indexOf('--tools') + 1], '');
  // 끄면 예전처럼 빈 MCP 설정, 허락하는 도구 없음
  const off = claudeArgs(base);
  assert.equal(off[off.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.ok(!off.includes('--allowedTools'));
});

test('짝꿍 도구: 격리를 끄면 내 MCP 위에 짝꿍 서버를 더하고 둘 다 허락한다', () => {
  const base = { text: 'q', images: [], sessionId: 's', persona: 'p', resume: false, isolate: false };
  const on = claudeArgs({ ...base, mcpServers: ['claude.ai Notion'], jjServer: jj });
  assert.ok(!on.includes('--strict-mcp-config'));
  assert.equal(on.filter((a) => a === '--mcp-config').length, 1);
  assert.equal(on[on.indexOf('--allowedTools') + 1], 'mcp__claude_ai_Notion,mcp__fairy');
  assert.equal(on[on.indexOf('--tools') + 1], '');
});

test('짝꿍 도구: codex 는 -c mcp_servers.fairy 설정으로, 샌드박스는 읽기만 그대로', () => {
  const args = codexArgs({ text: '질문', imagePaths: ['/a.png'], persona: 'p', jjServer: jj });
  assert.ok(args.includes(`mcp_servers.fairy.command=${JSON.stringify(jj.command)}`));
  assert.ok(args.includes('mcp_servers.fairy.args=["C:\\\\app\\\\out\\\\main\\\\mcp-server.js"]'));
  assert.ok(
    args.includes(
      'mcp_servers.fairy.env={ "ELECTRON_RUN_AS_NODE" = "1", "JJ_USER_DATA" = "/tmp/jj \\"data\\"" }',
    ),
  );
  assert.ok(args.includes('sandbox_mode="read-only"'));
  // 질문은 그대로 맨 앞, 그림은 맨 뒤 (-i 가 뒤의 값을 파일로 먹지 않게)
  assert.deepEqual(args.slice(0, 2), ['exec', '질문']);
  assert.deepEqual(args.slice(-2), ['-i', '/a.png']);
  assert.ok(
    !codexArgs({ text: '질문', imagePaths: [], persona: 'p' }).some((a) => a.includes('mcp_servers')),
  );
});
