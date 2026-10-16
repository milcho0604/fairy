// 시험용 가짜 Anthropic Messages API (POST /v1/messages, 스트리밍만). 진짜 Anthropic 을 부르지 않으려고 쓴다.
// 서버 통합 시험(server/test/ai.test.ts)과 앱 통합 시험(scripts/dev/server-account.mjs)이 같이 쓴다.
// 마지막 사용자 말에 표시를 넣어 흉내를 고른다:
//   [[fail]]       바로 500 (재시도해도 500)
//   [[cut]]        글 두 조각을 보내고 연결을 끊는다
//   [[sse-error]]  글 한 조각 뒤 SSE error 사건 (overloaded_error)
//   [[slow]]       아무것도 보내지 않고 기다린다 (시간 넘김)
//   [[refusal]]    글 한 조각 뒤 stop_reason refusal (안전 분류기 거절, 폴백도 못 넘은 것)
//   [[fallback]]   서버 폴백: 맨 앞 fallback 블록(from 요청 모델, to 다른 모델) 뒤에 글 (실제 응답 모양)
//   그 밖          "안녕! 나는 AI 야." 를 세 조각으로, 사용량 input 120 / output 30
//
// 요청 모양 검사: 서버가 보낸 본문이 모델별 규칙(server/src/ai-rules.ts requestShape)과 맞지 않으면
// 진짜 API 처럼 400 invalid_request_error 를 준다 (calls 에도 violations 로 남는다).
//   claude-sonnet-5-5: thinking {type:"between_tools"} 만, output_config {effort:"low"} 만, fallbacks "default",
//                      베타 머리 server-side-fallback-2026-07-01
//   claude-haiku-5-5:  thinking {type:"disabled"}, output_config {effort:"low"}, fallbacks 와 폴백 베타 없음
//   모든 모델: 날짜 접미사 없는 모델 이름, 샘플링 값 없음(temperature, top_p, top_k), budget_tokens 없음,
//              강제 tool_choice(any, tool) 없음, 마지막 차례는 사용자 (미리 채우기 없음)
import { createServer } from 'node:http';

const SAMPLING = ['temperature', 'top_p', 'top_k'];
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DATED = /-\d{8}$/;

/** 모델별 요청 모양 위반 목록 (빈 배열이면 맞다) */
export function shapeViolations(body, betaHeader) {
  const v = [];
  const model = String(body.model ?? '');
  const betas = String(betaHeader ?? '')
    .split(',')
    .map((x) => x.trim());
  if (!/^claude-[a-z]+-[0-9][0-9.-]*$/.test(model) || DATED.test(model)) v.push(`model: ${model}`);
  for (const k of SAMPLING) if (k in body) v.push(`${k} 는 보내지 않는다`);
  if (body.thinking && 'budget_tokens' in body.thinking) v.push('budget_tokens 는 보내지 않는다');
  const tc = body.tool_choice?.type;
  if (tc === 'any' || tc === 'tool') v.push(`tool_choice ${tc} 는 이 모델에서 400`);
  const last = Array.isArray(body.messages) ? body.messages.at(-1) : undefined;
  if (last?.role !== 'user') v.push('마지막 차례는 사용자여야 한다 (미리 채우기 금지)');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (model.startsWith('claude-haiku-5-5')) {
    if (!same(body.thinking, { type: 'disabled' })) v.push('haiku 5.5: thinking 은 disabled');
    if (!same(body.output_config, { effort: 'low' })) v.push('haiku 5.5: output_config 은 effort low');
    if ('fallbacks' in body) v.push('haiku 5.5: fallbacks 를 보내면 400');
    if (betas.includes(FALLBACK_BETA)) v.push('haiku 5.5: 폴백 베타 머리 없음');
  }
  if (model.startsWith('claude-sonnet-5-5')) {
    if (!same(body.thinking, { type: 'between_tools' })) v.push('sonnet 5.5: thinking 은 between_tools 만');
    if (!same(body.output_config, { effort: 'low' })) v.push('sonnet 5.5: output_config 은 effort low');
    if (body.fallbacks !== 'default') v.push('sonnet 5.5: fallbacks 는 "default"');
    if (!betas.includes(FALLBACK_BETA)) v.push(`sonnet 5.5: 베타 머리 ${FALLBACK_BETA} 필요`);
  }
  return v;
}

export async function startFakeAnthropic() {
  /** 받은 요청 (머리의 키, 베타 머리, 본문, 모양 위반). 글은 시험 안에서만 본다 */
  /** @type {Array<{ apiKey: unknown, beta: string | null, body: any, violations: string[] }>} */
  const calls = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'nope' } }));
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {}
      const violations = shapeViolations(body, req.headers['anthropic-beta']);
      calls.push({
        apiKey: req.headers['x-api-key'],
        beta: req.headers['anthropic-beta'] ?? null,
        body,
        violations,
      });
      if (violations.length > 0) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: violations.join('; ') },
          }),
        );
        return;
      }
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      const last = msgs[msgs.length - 1];
      const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
      if (text.includes('[[fail]]')) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'fake failure' } }));
        return;
      }
      if (text.includes('[[slow]]')) return; // 끊길 때까지 답하지 않는다
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const fallen = text.includes('[[fallback]]');
      send('message_start', {
        type: 'message_start',
        message: {
          id: `msg_fake_${calls.length}`,
          type: 'message',
          role: 'assistant',
          // 서버 폴백이 일어나면 응답의 model 은 폴백 모델 이름이다
          model: fallen ? 'claude-sonnet-5' : body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 120, output_tokens: 1 },
        },
      });
      let index = 0;
      if (fallen) {
        // 실제 모양: 맨 앞 fallback 블록은 ordinary content_block_start 로 온다 (전용 사건 종류 없음)
        send('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'fallback',
            from: { model: body.model },
            to: { model: 'claude-sonnet-5' },
          },
        });
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        index = 1;
      }
      send('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      const delta = (t) =>
        send('content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: t },
        });
      if (text.includes('[[cut]]')) {
        delta('안녕! ');
        delta('나는 ');
        setTimeout(() => req.socket.destroy(), 50);
        return;
      }
      if (text.includes('[[refusal]]')) {
        delta('음... ');
        send('content_block_stop', { type: 'content_block_stop', index });
        send('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: 'refusal',
            stop_sequence: null,
            stop_details: { type: 'refusal', category: null },
          },
          usage: { output_tokens: 3 },
        });
        send('message_stop', { type: 'message_stop' });
        res.end();
        return;
      }
      if (text.includes('[[sse-error]]')) {
        delta('안녕! ');
        send('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
        res.end();
        return;
      }
      const parts = ['안녕! ', '나는 AI ', '야.'];
      let i = 0;
      const tick = () => {
        if (i < parts.length) {
          delta(parts[i++]);
          setTimeout(tick, 10);
          return;
        }
        send('content_block_stop', { type: 'content_block_stop', index });
        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 30 },
        });
        send('message_stop', { type: 'message_stop' });
        res.end();
      };
      tick();
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    calls,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

// 혼자 띄우기 (앱 시험): node server/scripts/fake-anthropic.mjs → 주소 한 줄
if (import.meta.url === `file://${process.argv[1]}`) {
  // 맨 위 await 는 쓰지 않는다 (시험이 require 로 가져온다)
  startFakeAnthropic().then((f) => console.log(f.url));
}
