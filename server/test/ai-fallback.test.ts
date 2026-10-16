// 버그잡이 PR #123 재현 (커밋하지 않음): 서버 폴백 때 비용 장부, 중간 폴백 글 이어 붙임
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { after, before, test } from 'node:test';
import { client, type Harness, startHarness } from './helpers';

let h: Harness;
let fake: Server;
const { api, newDevice, session } = client(() => h);

function sse(res: ServerResponse, marker: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (event: string, data: unknown) =>
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  send('message_start', {
    type: 'message_start',
    message: {
      id: 'm',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 120, output_tokens: 1 },
    },
  });
  let i = 0;
  const text = (t: string) => {
    send('content_block_start', {
      type: 'content_block_start',
      index: i,
      content_block: { type: 'text', text: '' },
    });
    send('content_block_delta', {
      type: 'content_block_delta',
      index: i,
      delta: { type: 'text_delta', text: t },
    });
    send('content_block_stop', { type: 'content_block_stop', index: i });
    i++;
  };
  const fb = () => {
    send('content_block_start', {
      type: 'content_block_start',
      index: i,
      content_block: {
        type: 'fallback',
        from: { model: 'claude-sonnet-5-5' },
        to: { model: 'claude-opus-5' },
        trigger: { type: 'refusal', category: null },
      },
    });
    send('content_block_stop', { type: 'content_block_stop', index: i });
    i++;
  };
  if (marker === 'mid') text('[A의 앞부분] ');
  fb();
  text('[B의 답]');
  // 맨 위 usage 는 답을 낸 홉(B) 것, 거절한 홉(A)은 iterations 에만
  send('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: {
      input_tokens: 120,
      output_tokens: 30,
      iterations: [
        {
          type: 'message',
          model: 'claude-sonnet-5-5',
          input_tokens: 120,
          output_tokens: 40,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: null,
        },
        {
          type: 'fallback_message',
          model: 'claude-opus-5',
          input_tokens: 120,
          output_tokens: 30,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation: null,
        },
      ],
    },
  });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

before(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => sse(res, raw.includes('[[mid]]') ? 'mid' : 'start'));
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  const port = (fake.address() as { port: number }).port;
  h = await startHarness({
    ai: {
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:' + port,
      model: 'claude-sonnet-5-5',
      monthlyBudgetMicros: 1_000_000,
      dailyLimit: 50,
      maxInputChars: 8000,
      giftKey: '',
    },
  });
  await h.pool.query('UPDATE feature_flag SET mode = $1 WHERE key = $2', ['everyone', 'ai_chat']);
});
after(async () => {
  await h?.stop();
  fake?.close();
});

async function adult() {
  const d = await newDevice('18+');
  const s = await session(d.id);
  assert.equal((await api('GET', '/v1/ai', { token: s })).status, 200);
  await h.pool.query('UPDATE ai_ticket SET remaining = 5 WHERE account_id = $1', [d.id]);
  return { id: d.id, s };
}
const ask = (t: string) => ({ messages: [{ role: 'user', content: t }], lang: 'ko' });

test('폴백 비용: 거절한 홉과 폴백 모델 요금을 장부에 합친다', async () => {
  const a = await adult();
  const r = await api('POST', '/v1/ai/chat', { token: a.s, body: ask('질문') });
  assert.equal(r.status, 200, r.text);
  const u = await h.pool.query(
    'SELECT model, input_tokens, output_tokens, cost_micros FROM ai_usage WHERE account_id = $1',
    [a.id],
  );
  // A(sonnet 5.5) 120x2+40x10 = 640, B(opus 5) 120x5+30x25 = 1350 -> 1990
  assert.equal(Number(u.rows[0].cost_micros), 1990, JSON.stringify(u.rows));
});

test('중간 폴백: 거절한 모델의 앞부분이 폴백 답 앞에 그대로 붙어 앱에 간다', async () => {
  const a = await adult();
  const r = await api('POST', '/v1/ai/chat', { token: a.s, body: ask('[[mid]] 질문') });
  // 앱이 받는 순서대로: reset 이 오면 그때까지 받은 글을 지우고, 이어 오는 글이 답이다
  let shown = '';
  let resets = 0;
  for (const block of r.text.split('\n\n')) {
    if (block.startsWith('event: reset')) {
      resets++;
      shown = '';
    } else if (block.startsWith('event: text')) shown += JSON.parse(block.split('data: ')[1] as string).text;
  }
  assert.equal(resets, 1, '중간 폴백은 reset 한 번');
  assert.equal(shown, '[B의 답]', 'reset 뒤 앱이 받은 글: ' + shown);
});
