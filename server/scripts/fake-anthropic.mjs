// 시험용 가짜 Anthropic Messages API (POST /v1/messages, 스트리밍만). 진짜 Anthropic 을 부르지 않으려고 쓴다.
// 서버 통합 시험(server/test/ai.test.ts)과 앱 통합 시험(scripts/dev/server-account.mjs)이 같이 쓴다.
// 마지막 사용자 말에 표시를 넣어 흉내를 고른다:
//   [[fail]]       바로 500 (재시도해도 500)
//   [[cut]]        글 두 조각을 보내고 연결을 끊는다
//   [[sse-error]]  글 한 조각 뒤 SSE error 사건 (overloaded_error)
//   [[slow]]       아무것도 보내지 않고 기다린다 (시간 넘김)
//   [[refusal]]    글 한 조각 뒤 stop_reason refusal (안전 분류기 거절, Haiku 5.5 는 서버 폴백 없음)
//   그 밖          "안녕! 나는 AI 야." 를 세 조각으로, 사용량 input 120 / output 30
import { createServer } from 'node:http';

export async function startFakeAnthropic() {
  /** 받은 요청 (머리의 키 확인, 시스템 프롬프트와 모델 확인). 글은 시험 안에서만 본다 */
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
      calls.push({ apiKey: req.headers['x-api-key'], body });
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
      send('message_start', {
        type: 'message_start',
        message: {
          id: `msg_fake_${calls.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 120, output_tokens: 1 },
        },
      });
      send('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });
      const delta = (t) =>
        send('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
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
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
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
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
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
