import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addQuestion,
  applyEvent,
  type ChatState,
  historyFor,
  initialChat,
  LONG_CHAT_TURNS,
  parseChat,
  resetChat,
  SAVED_MESSAGES,
  SAVED_TEXT_MAX,
  serializeChat,
  switchProvider,
  undoReset,
} from './chat-state.ts';

function ask(s: ChatState, n: number) {
  return addQuestion(s, { user: `u${n}`, pet: `p${n}` }, `질문${n}`, []);
}

test('질문하면 답 자리가 생기고 조각이 쌓인 뒤 끝난다', () => {
  let s = ask(initialChat('claude'), 1);
  assert.equal(s.pendingId, 'p1');
  s = applyEvent(s, 'p1', { type: 'session', id: 'S' }, 'n');
  s = applyEvent(s, 'p1', { type: 'delta', text: '안녕, ' }, 'n');
  assert.equal(s.messages[1]?.status, 'streaming');
  s = applyEvent(s, 'p1', { type: 'delta', text: '반가워' }, 'n');
  s = applyEvent(s, 'p1', { type: 'done', text: '안녕, 반가워!' }, 'n');
  assert.equal(s.messages[1]?.text, '안녕, 반가워!');
  assert.equal(s.pendingId, undefined);
  assert.deepEqual(s.sessions.claude, { id: 'S', turns: 1 });
});

test('같은 세션이면 턴이 쌓이고, 끝난 뒤 늦게 온 사건은 무시한다', () => {
  let s = initialChat('codex');
  for (let i = 1; i <= 2; i++) {
    s = ask(s, i);
    s = applyEvent(s, `p${i}`, { type: 'session', id: 'T' }, 'n');
    s = applyEvent(s, `p${i}`, { type: 'done', text: `답${i}` }, 'n');
  }
  assert.deepEqual(s.sessions.codex, { id: 'T', turns: 2 });
  const after = applyEvent(s, 'p2', { type: 'delta', text: '늦은 조각' }, 'n');
  assert.equal(after, s);
});

test('서버 폴백 reset: 말풍선의 앞 글을 비우고 이어 받은 글만 답으로 남는다', () => {
  let s = ask(initialChat('claude'), 1);
  s = applyEvent(s, 'p1', { type: 'delta', text: '[거절된 앞부분] ' }, 'n');
  s = applyEvent(s, 'p1', { type: 'reset' }, 'n');
  assert.equal(s.messages[1]?.text, '');
  assert.equal(s.messages[1]?.status, 'streaming');
  s = applyEvent(s, 'p1', { type: 'delta', text: '새 답' }, 'n');
  s = applyEvent(s, 'p1', { type: 'done', text: '새 답' }, 'n');
  assert.equal(s.messages[1]?.text, '새 답');
});

test('오류는 메시지에 남고 다시 보낼 수 있다', () => {
  let s = ask(initialChat(), 1);
  s = applyEvent(
    s,
    'p1',
    { type: 'error', error: { kind: 'rate-limit', message: '한도', retryAt: '7:48 PM' } },
    'n',
  );
  assert.equal(s.messages[1]?.status, 'error');
  assert.equal(s.messages[1]?.error?.retryAt, '7:48 PM');
  assert.equal(s.pendingId, undefined);
});

test(`대화가 ${LONG_CHAT_TURNS}턴이 되면 새 대화를 한 번 권한다 (L8)`, () => {
  let s = initialChat();
  for (let i = 1; i <= LONG_CHAT_TURNS + 1; i++) {
    s = ask(s, i);
    s = applyEvent(s, `p${i}`, { type: 'session', id: 'S' }, `n${i}`);
    s = applyEvent(s, `p${i}`, { type: 'done', text: 'ok' }, `n${i}`);
  }
  const notices = s.messages.filter((m) => m.role === 'notice');
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.id, `n${LONG_CHAT_TURNS}`);
});

test('답을 기다리는 동안에는 AI 를 바꾸거나 새 대화를 못 한다', () => {
  const waiting = ask(initialChat('claude'), 1);
  assert.equal(switchProvider(waiting, 'codex').provider, 'claude');
  assert.equal(resetChat(waiting).messages.length, 2);
  const idle = applyEvent(waiting, 'p1', { type: 'done', text: 'x' }, 'n');
  assert.equal(switchProvider(idle, 'codex').provider, 'codex');
  assert.equal(resetChat(idle).messages.length, 0);
  assert.equal(resetChat(switchProvider(idle, 'codex')).provider, 'codex');
});

test('AI 를 바꾸면 각자 세션을 따로 이어간다', () => {
  let s = ask(initialChat('claude'), 1);
  s = applyEvent(s, 'p1', { type: 'session', id: 'C' }, 'n');
  s = applyEvent(s, 'p1', { type: 'done', text: 'a' }, 'n');
  s = switchProvider(s, 'codex');
  s = ask(s, 2);
  assert.equal(s.messages[3]?.provider, 'codex');
  s = applyEvent(s, 'p2', { type: 'session', id: 'X' }, 'n');
  s = applyEvent(s, 'p2', { type: 'done', text: 'b' }, 'n');
  assert.deepEqual(s.sessions, { claude: { id: 'C', turns: 1 }, codex: { id: 'X', turns: 1 } });
});

test('새 대화는 "기록 남기지 않기"와 할 일 같이 보내기, 받는 중인 모델 진행을 끄지 않는다 (버그잡이 6차)', () => {
  let s: ChatState = {
    ...initialChat('claude'),
    ephemeral: true,
    knowsTodos: true,
    modelDownload: { pct: 40 },
  };
  s = ask(s, 1);
  s = applyEvent(s, 'p1', { type: 'done', text: '답' }, 'n');
  const fresh = resetChat(s);
  assert.equal(fresh.messages.length, 0);
  assert.deepEqual(fresh.sessions, {});
  assert.equal(fresh.ephemeral, true);
  assert.equal(fresh.knowsTodos, true);
  assert.deepEqual(fresh.modelDownload, { pct: 40 });
  // 끈 상태도 그대로
  assert.equal(resetChat(initialChat('claude')).ephemeral, undefined);
});

test('새 대화 되돌리기는 지운 대화와 세션을 다시 놓고, 그 뒤 고른 AI 는 지금 것을 둔다', () => {
  let s = ask(initialChat('claude'), 1);
  s = applyEvent(s, 'p1', { type: 'session', id: 'S' }, 'n');
  s = applyEvent(s, 'p1', { type: 'done', text: '답' }, 'n');
  const before = s;
  const cleared = switchProvider(resetChat(s), 'codex');
  const back = undoReset(cleared, before);
  assert.equal(back?.messages.length, 2);
  assert.deepEqual(back?.sessions.claude, { id: 'S', turns: 1 });
  assert.equal(back?.provider, 'codex');
});

test('새 대화에서 이미 새로 물었거나 지운 것이 없으면 되돌리지 않는다', () => {
  const before = ask(initialChat('claude'), 1);
  const done = applyEvent(before, 'p1', { type: 'done', text: '답' }, 'n');
  // 새 대화에서 새로 묻고 답까지 받았다 (기다리는 중이 아니어도 되돌리면 새 대화가 지워진다)
  const asked = applyEvent(ask(resetChat(done), 2), 'p2', { type: 'done', text: '새 답' }, 'n');
  assert.equal(undoReset(asked, done), undefined);
  assert.equal(undoReset(resetChat(done), resetChat(done)), undefined);
  // 답을 기다리는 중 (다시 물은 직후)
  assert.equal(undoReset({ ...resetChat(done), pendingId: 'x' }, done), undefined);
});

test('다시 켜도 남는 대화: 끝난 질문과 답, 세션만 남기고 그림, 오류, 기다리는 답은 뺀다', () => {
  let s = addQuestion(initialChat('claude'), { user: 'u1', pet: 'p1' }, '안녕', [
    { thumb: 'data:image/png;base64,AA' },
  ]);
  s = applyEvent(s, 'p1', { type: 'session', id: 'S' }, 'n');
  s = applyEvent(s, 'p1', { type: 'done', text: '반가워' }, 'n');
  // 그림만 보낸 질문: 그림을 빼면 빈 말풍선이라 질문은 빼고 답만 남긴다
  s = addQuestion(s, { user: 'u2', pet: 'p2' }, '', [{ thumb: 'data:x' }]);
  s = applyEvent(s, 'p2', { type: 'done', text: '그림 봤어' }, 'n');
  // 오류 난 질문과 답은 통째로 뺀다
  s = ask(s, 3);
  s = applyEvent(s, 'p3', { type: 'error', error: { kind: 'failed', message: 'x' } }, 'n');
  // 기다리는 중인 질문도 뺀다
  s = ask(s, 4);
  s = applyEvent(s, 'p4', { type: 'delta', text: '쓰는 중' }, 'n');
  const saved = serializeChat(s);
  assert.deepEqual(
    saved.messages.map((m) => [m.id, m.role, m.text, m.status]),
    [
      ['u1', 'user', '안녕', undefined],
      ['p1', 'pet', '반가워', 'done'],
      ['p2', 'pet', '그림 봤어', 'done'],
    ],
  );
  assert.ok(saved.messages.every((m) => !m.images));
  assert.deepEqual(saved.sessions, { claude: { id: 'S', turns: 2 } });
  // 파일을 거쳐도 그대로 (JSON)
  assert.deepEqual(parseChat(JSON.parse(JSON.stringify(saved))), saved);
});

test('다시 켜도 남는 대화: 기록 안 남김으로 비운 세션 자리는 옮기지 않는다', () => {
  const s: ChatState = {
    ...initialChat('codex'),
    sessions: { codex: undefined, claude: { id: 'C', turns: 1 } },
  };
  assert.deepEqual(serializeChat(s).sessions, { claude: { id: 'C', turns: 1 } });
});

test('다시 켜도 남는 대화: 최근 것만, 긴 글은 자른다', () => {
  let s = initialChat('claude');
  for (let i = 1; i <= SAVED_MESSAGES; i++) {
    s = ask(s, i);
    s = applyEvent(s, `p${i}`, { type: 'done', text: `답${i}` }, `n${i}`);
  }
  const saved = serializeChat(s);
  assert.equal(saved.messages.length, SAVED_MESSAGES);
  assert.equal(saved.messages.at(-1)?.text, `답${SAVED_MESSAGES}`);
  const many = {
    messages: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: 'user', text: 'x' })),
  };
  assert.equal(parseChat(many).messages.length, SAVED_MESSAGES);
  assert.equal(parseChat(many).messages[0]?.id, `m${100 - SAVED_MESSAGES}`);
  const long = parseChat({ messages: [{ id: 'a', role: 'user', text: 'x'.repeat(SAVED_TEXT_MAX + 5) }] });
  assert.equal(long.messages[0]?.text.length, SAVED_TEXT_MAX);
});

test('다시 켜도 남는 대화: 깨진 파일은 빈 대화, 틀린 줄만 버린다', () => {
  for (const raw of [undefined, null, 'x', 3, [], { messages: 'no', sessions: [] }])
    assert.deepEqual(parseChat(raw), { messages: [], sessions: {} });
  const parsed = parseChat({
    messages: [
      { id: 'a', role: 'user', text: '질문' },
      { id: 'b', role: 'pet', text: '답', status: 'done', provider: 'claude', images: [{ thumb: 'x' }] },
      { id: 'c', role: 'pet', text: '쓰는 중', status: 'streaming' },
      { id: 'd', role: 'pet', text: '오류', status: 'error' },
      { id: 'e', role: 'robot', text: 'x' },
      { id: 7, role: 'user', text: 'x' },
      { id: 'f', role: 'user' },
      null,
      { id: 'g', role: 'notice', text: '알림' },
    ],
    sessions: {
      claude: { id: 'S', turns: 2 },
      codex: { id: '', turns: 1 },
      x: { id: 'X', turns: -1 },
      y: 'z',
    },
  });
  assert.deepEqual(
    parsed.messages.map((m) => m.id),
    ['a', 'b', 'g'],
  );
  assert.deepEqual(parsed.messages[1], {
    id: 'b',
    role: 'pet',
    text: '답',
    status: 'done',
    provider: 'claude',
  });
  assert.deepEqual(parsed.sessions, { claude: { id: 'S', turns: 2 } });
  // 읽은 대화로 바로 이어 물을 수 있다 (기다리는 답이 없다)
  const state = { ...initialChat('claude'), ...parsed };
  assert.equal(state.pendingId, undefined);
  assert.equal(ask(state, 9).pendingId, 'p9');
});

test('기록 안 남김을 켜고 끈 사이에는 되돌리지 않는다 (안 남긴 대화가 기록 파일로 가지 않게)', () => {
  const off = { ...resetChat(initialChat('claude')), ephemeral: true };
  const secret = applyEvent(ask(off, 1), 'p1', { type: 'done', text: '비밀' }, 'n');
  // 안 남긴 대화를 지우고, 기록 안 남김을 끈 뒤 되돌리기
  const recorded = { ...resetChat(secret), ephemeral: false };
  assert.equal(undoReset(recorded, secret), undefined);
  // 반대로 남긴 대화를 안 남김 상태로 되돌리지도 않는다
  const kept = applyEvent(ask(initialChat('claude'), 2), 'p2', { type: 'done', text: '답' }, 'n');
  assert.equal(undoReset({ ...resetChat(kept), ephemeral: true }, kept), undefined);
  // 같은 상태 안에서는 되돌린다
  assert.equal(undoReset(resetChat(secret), secret)?.messages.length, 2);
});

test('말놀이 답(끝말잇기)은 다시 켜도 놀이 꼬리표를 지키고, AI 대화 기록에 섞이지 않는다', () => {
  const s: ChatState = {
    ...initialChat('claude'),
    messages: [
      { id: 'p0', role: 'pet', text: '끝말잇기 하자! 가방!', status: 'done', game: true },
      { id: 'u1', role: 'user', text: '방울' },
      { id: 'p1', role: 'pet', text: '울타리!', status: 'done', game: true },
    ],
  };
  const back = parseChat(JSON.parse(JSON.stringify(serializeChat(s))));
  assert.deepEqual(
    back.messages.map((m) => [m.id, m.game ?? false]),
    [
      ['p0', true],
      ['u1', false],
      ['p1', true],
    ],
  );
  assert.deepEqual(historyFor(s, 'claude'), []);
  // 꼬리표 값이 틀리면 버린다
  const odd = parseChat({ messages: [{ id: 'x', role: 'pet', text: 'a', status: 'done', game: 'yes' }] });
  assert.equal(odd.messages[0]?.game, undefined);
});
