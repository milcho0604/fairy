import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SavedChat } from './chat-state.ts';
import {
  isThreadId,
  listThreads,
  MAX_THREADS,
  overflow,
  parseIndex,
  removeMeta,
  renameMeta,
  staleSessions,
  startThread,
  type ThreadIndex,
  TITLE_MAX,
  titleFrom,
  upsertMeta,
} from './chat-threads.ts';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID2 = 'aaaaaaaa-0000-4000-8000-000000000002';

function chat(q: string, provider = 'claude', prefix = 'm'): SavedChat {
  return {
    messages: [
      { id: `${prefix}1`, role: 'user', text: q },
      { id: `${prefix}2`, role: 'pet', text: '답', status: 'done', provider },
    ],
    sessions: { [provider]: { id: 'S', turns: 1 } },
  };
}

test('제목은 첫 질문을 한 줄로 줄여 만든다. 질문이 없으면 빈 글', () => {
  assert.equal(titleFrom(chat('  오늘\n\n할 일   정리해 줘 ').messages), '오늘 할 일 정리해 줘');
  const long = '가'.repeat(100);
  const title = titleFrom(chat(long).messages);
  assert.equal([...title].length, TITLE_MAX);
  assert.ok(title.endsWith('…'));
  // 이모지가 반으로 갈리지 않는다
  assert.ok(!/�/.test(titleFrom(chat('😀'.repeat(60)).messages)));
  assert.equal(titleFrom([{ id: 'n', role: 'notice', text: '안내' }]), '');
});

test('저장할 때마다 목차 줄을 고치되 만든 날과 바꾼 이름은 그대로 둔다', () => {
  let idx: ThreadIndex = { threads: [] };
  idx = upsertMeta(idx, ID, chat('첫 질문'), 100, true);
  assert.deepEqual(idx.threads[0], {
    id: ID,
    title: '첫 질문',
    provider: 'claude',
    createdAt: 100,
    updatedAt: 100,
    count: 2,
    first: '첫 질문',
    isolated: true,
  });
  idx = renameMeta(idx, ID, '  내 이름  ');
  idx = upsertMeta(idx, ID, chat('첫 질문', 'codex'), 200, true);
  const m = idx.threads[0];
  assert.equal(m?.title, '내 이름');
  assert.equal(m?.renamed, true);
  assert.equal(m?.createdAt, 100);
  assert.equal(m?.updatedAt, 200);
  assert.equal(m?.provider, 'codex');
  // 비우면 첫 질문 제목으로 돌아간다
  idx = renameMeta(idx, ID, '   ');
  assert.equal(idx.threads[0]?.title, '첫 질문');
  assert.equal(idx.threads[0]?.renamed, undefined);
});

test('규칙 답만 있으면 AI 이름이 없다', () => {
  const s: SavedChat = {
    messages: [
      { id: 'a', role: 'user', text: '오늘 뭐부터' },
      { id: 'b', role: 'pet', text: '규칙', status: 'done', provider: 'claude', byRules: true },
    ],
    sessions: {},
  };
  assert.equal(upsertMeta({ threads: [] }, ID, s, 1).threads[0]?.provider, undefined);
});

test('목록은 최근 것부터, 찾기는 제목과 첫 질문에서 대소문자 없이', () => {
  let idx: ThreadIndex = { threads: [] };
  idx = upsertMeta(idx, ID, chat('Python 질문'), 100);
  idx = upsertMeta(idx, ID2, chat('저녁 메뉴'), 200);
  assert.deepEqual(
    listThreads(idx).map((m) => m.id),
    [ID2, ID],
  );
  assert.deepEqual(
    listThreads(idx, 'python').map((m) => m.id),
    [ID],
  );
  idx = renameMeta(idx, ID, '코딩');
  // 이름을 바꿔도 첫 질문으로 찾는다
  assert.deepEqual(
    listThreads(idx, 'PYTHON').map((m) => m.id),
    [ID],
  );
  assert.deepEqual(listThreads(idx, '없는 말'), []);
});

test('지우면 목차에서 빠지고 지금 대화였으면 current 도 비운다', () => {
  let idx: ThreadIndex = { current: ID, threads: [] };
  idx = upsertMeta(idx, ID, chat('a'), 1);
  idx = upsertMeta(idx, ID2, chat('b'), 2);
  assert.equal(removeMeta(idx, ID2).current, ID);
  const r = removeMeta(idx, ID);
  assert.equal(r.current, undefined);
  assert.deepEqual(
    r.threads.map((m) => m.id),
    [ID2],
  );
});

test('id 는 파일 이름이 되므로 경로 문자를 받지 않는다', () => {
  assert.ok(isThreadId(ID));
  for (const bad of ['../../settings', 'a/b/c/d/e', '..', '', 'short', 'x'.repeat(65), 3, null])
    assert.equal(isThreadId(bad), false, String(bad));
});

test('목차 파일이 깨졌거나 손으로 고쳤으면 틀린 줄만 버린다', () => {
  assert.deepEqual(parseIndex(null), { threads: [] });
  assert.deepEqual(parseIndex('글'), { threads: [] });
  const idx = parseIndex({
    current: '../x',
    threads: [
      { id: ID, title: 't', createdAt: 1, updatedAt: 2, count: 2, first: 'f', provider: 'claude' },
      { id: ID, title: '겹침', createdAt: 1, updatedAt: 2 },
      { id: '../../evil', title: 'x', createdAt: 1, updatedAt: 2 },
      { id: ID2, title: 5, createdAt: 'x', updatedAt: 2 },
      null,
    ],
  });
  assert.equal(idx.threads.length, 1);
  assert.equal(idx.current, undefined);
  assert.equal(parseIndex({ current: ID, threads: idx.threads }).current, ID);
  // current 가 목록에 없으면 버린다
  assert.equal(parseIndex({ current: ID2, threads: idx.threads }).current, undefined);
});

test('켤 때: 옛 판 대화는 목록에 넣고(adopt), 이어 하던 대화는 이어 가고, 빈 대화는 아무것도 아니다', () => {
  const empty: ThreadIndex = { threads: [] };
  const h = chat('옛 판 질문');
  assert.equal(startThread(empty, h, undefined), 'adopt');
  assert.equal(startThread(empty, { messages: [], sessions: {} }, undefined), 'none');
  const idx = { ...upsertMeta(empty, ID, h, 1), current: ID };
  assert.equal(startThread(idx, h, h), 'continue');
  // 옛 판으로 내려 새 대화를 했다가 다시 올라옴: current 파일과 메시지가 겹치지 않으면 새 항목
  assert.equal(startThread(idx, chat('다른 대화', 'claude', 'z'), h), 'adopt');
  // current 파일을 못 읽으면(깨짐) 새 항목
  assert.equal(startThread(idx, h, undefined), 'adopt');
});

test('상한을 넘으면 오래 안 연 것부터 빼고, 지금 대화는 남긴다', () => {
  const threads = Array.from({ length: MAX_THREADS + 2 }, (_, i) => ({
    id: `t${String(i).padStart(8, '0')}`,
    title: '',
    createdAt: i,
    updatedAt: i,
    count: 2,
    first: '',
  }));
  const idx: ThreadIndex = { current: 't00000000', threads };
  assert.deepEqual(overflow(idx), ['t00000001', 't00000002']);
  assert.deepEqual(overflow({ threads: threads.slice(0, 3) }), []);
});

test('열 때 못 이을 세션: 격리 설정이 바뀌었거나 30일 넘은 claude', () => {
  const now = 100 * 86_400_000;
  const adapter = (p: string) => (p === 'codex' ? 'codex' : p === 'claude' ? 'claude' : 'text');
  const sessions = { claude: { id: 'A', turns: 1 }, codex: { id: 'B', turns: 1 } };
  const meta = upsertMeta({ threads: [] }, ID, chat('q'), now - 1000, true).threads[0];
  assert.ok(meta);
  assert.deepEqual(staleSessions(meta, sessions, now, true, adapter), []);
  assert.deepEqual(staleSessions(meta, sessions, now, false, adapter), ['claude', 'codex']);
  const old = { ...meta, updatedAt: now - 31 * 86_400_000 };
  assert.deepEqual(staleSessions(old, sessions, now, true, adapter), ['claude']);
  // 예전 목차 줄(격리 여부 없음)은 격리로 가르지 않는다
  const { isolated: _i, ...noIso } = meta;
  assert.deepEqual(staleSessions(noIso, sessions, now, false, adapter), []);
});
