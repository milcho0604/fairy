import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addQuestion,
  applyEvent,
  type ChatState,
  initialChat,
  LONG_CHAT_TURNS,
  resetChat,
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
