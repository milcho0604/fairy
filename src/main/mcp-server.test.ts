import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { type Db, migrate } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { TodoStore } from '../shared/todo-store.ts';

// 서버는 JJ_USER_DATA 의 jjakkung.db 를 연다. 시험용 빈 폴더에 짝꿍이 하듯 최신 판으로 만들어 둔다.
const dir = mkdtempSync(join(tmpdir(), 'jj-mcp-'));
process.env.JJ_USER_DATA = dir;
const seed = new DatabaseSync(join(dir, 'jjakkung.db'));
migrate(seed as unknown as Db);
seed.close();
const { handle } = await import('./mcp-server.ts');
after(() => rmSync(dir, { recursive: true, force: true }));

let id = 0;
const call = (method: string, params?: Record<string, unknown>) =>
  handle({ jsonrpc: '2.0', id: ++id, method, params }) as {
    result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } & Record<
      string,
      unknown
    >;
    error?: { code: number };
  };
const tool = (name: string, args: Record<string, unknown>) => call('tools/call', { name, arguments: args });
const text = (r: ReturnType<typeof call>) => r.result?.content?.[0]?.text ?? '';

test('시작 인사: 요청한 판을 맞추고, 모르는 판이면 최신, 알림에는 답하지 않는다', () => {
  assert.equal(call('initialize', { protocolVersion: '2025-03-26' }).result?.protocolVersion, '2025-03-26');
  assert.equal(call('initialize', { protocolVersion: '1999-01-01' }).result?.protocolVersion, '2025-06-18');
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal(call('nope').error?.code, -32601);
});

test('객체가 아닌 요청(null, 배열)은 죽지 않고 -32600 으로 답한다', () => {
  for (const bad of [null, [], 3]) {
    const r = handle(bad as unknown as Record<string, unknown>) as { error?: { code: number } };
    assert.equal(r.error?.code, -32600);
  }
});

test('도구 목록', () => {
  assert.deepEqual(
    call('tools/list').result?.tools?.map((t) => t.name),
    [
      'add_todo',
      'list_todos',
      'complete_todo',
      'update_todo',
      'delete_todo',
      'add_note',
      'search_notes',
      'add_event',
      'list_events',
      'remember',
    ],
  );
});

test('할 일 넣고 보고 끝내기', () => {
  const added = text(tool('add_todo', { title: '보고서', due: '2099-01-02', important: true }));
  assert.match(added, /넣었어 \(id 1\): 보고서, 마감 2099-01-02/);
  assert.match(text(tool('list_todos', {})), /\[1\] \(중요\) 보고서 \(마감 2099-01-02\)/);
  assert.match(text(tool('complete_todo', { id: 1 })), /끝냈어: 보고서 \(코인 15개\)/);
  assert.match(text(tool('complete_todo', { id: 1 })), /이미 끝낸/);
});

test('잘못된 입력은 도구 오류로 (요청 자체는 성공)', () => {
  const bad = tool('add_todo', { title: '  ' });
  assert.equal(bad.result?.isError, true);
  assert.equal(tool('add_todo', { title: 'x', due: '내일' }).result?.isError, true);
  assert.equal(tool('add_event', { title: 'x', start: '3시' }).result?.isError, true);
  assert.equal(call('tools/call', { name: 'rm_rf', arguments: {} }).error?.code, -32602);
});

test('메모와 일정', () => {
  assert.match(text(tool('add_note', { body: '# 회의\n- 결정' })), /메모를 남겼어/);
  const now = new Date(Date.now() + 2 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const start = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T15:30`;
  assert.match(text(tool('add_event', { title: '면접', start, duration_min: 60 })), /일정을 넣었어/);
  assert.match(text(tool('list_events', { days: 7 })), new RegExp(`${start.replace('T', ' ')} 면접`));
});

test('종일 일정: start 가 날짜만이면 종일, end_date 로 여러 날, 목록에 종일로', () => {
  const d = new Date(Date.now() + 3 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2);
  const last = `${e.getFullYear()}-${p(e.getMonth() + 1)}-${p(e.getDate())}`;
  assert.match(text(tool('add_event', { title: '휴가', start: day })), /종일 일정을 넣었어/);
  assert.match(
    text(tool('add_event', { title: '제주도', start: day, end_date: last })),
    new RegExp(`${day}~${last} 제주도`),
  );
  const list = text(tool('list_events', { days: 7 }));
  assert.match(list, new RegExp(`${day} 종일 휴가`));
  assert.match(list, new RegExp(`${day}~${last} 종일 제주도`));
  assert.equal(tool('add_event', { title: 'x', start: '2026-02-30' }).result?.isError, true);
  assert.equal(tool('add_event', { title: 'x', start: day, end_date: '2000-01-01' }).result?.isError, true);
  assert.equal(tool('add_event', { title: 'x', start: day, end_date: '내일' }).result?.isError, true);
});

// 서버가 쓴 것을 따로 열어 본다 (짝꿍 앱이 같은 파일을 읽듯이)
const peek = () => {
  const db = new DatabaseSync(join(dir, 'jjakkung.db')) as unknown as Db;
  return { events: new EventStore(db), todos: new TodoStore(db) };
};
const p2 = (n: number) => String(n).padStart(2, '0');
const dayAfter = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

test('일정 알림 분: 숫자만 받고 null, 빈 글, 글 숫자는 기본(10분)', () => {
  const day = dayAfter(10);
  const idOf = (r: ReturnType<typeof call>) => Number(/id (\d+)/.exec(text(r))?.[1]);
  const at = (title: string, hm: string, remind: unknown) =>
    idOf(tool('add_event', { title, start: `${day}T${hm}`, remind_min: remind }));
  const { events } = peek();
  assert.equal(events.get(at('널', '09:00', null))?.remindMin, 10);
  assert.equal(events.get(at('빈 글', '09:10', ''))?.remindMin, 10);
  assert.equal(events.get(at('글 숫자', '09:20', '30'))?.remindMin, 10);
  assert.equal(events.get(at('30분', '09:30', 30))?.remindMin, 30);
});

test('시각 일정: 없는 날짜나 시각은 거른다 (다음 날로 넘기지 않는다)', () => {
  for (const start of ['2027-02-30T10:00', '2027-01-05T24:00', '2027-01-05T10:60', '2027-13-01T10:00'])
    assert.equal(tool('add_event', { title: 'x', start }).result?.isError, true, start);
});

test('할 일 마감: 없는 날은 거른다', () => {
  assert.equal(tool('add_todo', { title: 'x', due: '2027-02-30' }).result?.isError, true);
  assert.equal(tool('add_todo', { title: 'x', due: '2027-13-01' }).result?.isError, true);
});

test('같은 일정을 또 넣으면 "이미 있어" (제목 대소문자, 띄어쓰기 무시)', () => {
  const day = dayAfter(12);
  const first = text(tool('add_event', { title: 'Team  Sync', start: `${day}T11:00` }));
  assert.match(first, /일정을 넣었어/);
  const again = tool('add_event', { title: 'team sync', start: `${day}T11:00` });
  assert.equal(again.result?.isError, undefined);
  assert.match(text(again), /^이미 있어 \(id \d+\)/);
  // 시각이 다르면 다른 일정
  assert.match(text(tool('add_event', { title: 'team sync', start: `${day}T12:00` })), /일정을 넣었어/);
  assert.match(text(tool('add_event', { title: '워크숍', start: day })), /종일 일정을 넣었어/);
  assert.match(text(tool('add_event', { title: '워크숍', start: day })), /^이미 있어/);
});

test('할 일 고치기와 지우기', () => {
  const id = Number(/id (\d+)/.exec(text(tool('add_todo', { title: '초안', due: '2099-03-01' })))?.[1]);
  assert.match(
    text(tool('update_todo', { id, title: '최종안', important: true })),
    /고쳤어 .*\(중요\) 최종안, 마감 2099-03-01/,
  );
  assert.match(text(tool('update_todo', { id, due: '' })), /고쳤어 .*최종안$/);
  assert.equal(peek().todos.get(id)?.due, null);
  assert.match(text(tool('update_todo', { id, due: '2099-04-01' })), /마감 2099-04-01/);
  assert.equal(tool('update_todo', { id, due: '2099-02-30' }).result?.isError, true);
  assert.equal(tool('update_todo', { id, title: '  ' }).result?.isError, true);
  assert.equal(tool('update_todo', { id }).result?.isError, true);
  assert.equal(tool('update_todo', { id: 99999, title: 'x' }).result?.isError, true);
  assert.match(text(tool('delete_todo', { id })), /지웠어: 최종안/);
  assert.doesNotMatch(text(tool('list_todos', {})), /최종안/);
  assert.equal(tool('delete_todo', { id }).result?.isError, true);
  // 지운 표시만 해서 짝꿍에서 되살릴 수 있다
  const { todos } = peek();
  todos.restore(id);
  assert.equal(todos.get(id)?.title, '최종안');
});

test('메모 찾기: 제목과 본문, 개수 상한, 없으면 없다고', () => {
  tool('add_note', { title: '장보기', body: '우유, 계란' });
  tool('add_note', { title: '회의록', body: '다음 주에 예산안을 다시 본다' });
  const hit = text(tool('search_notes', { query: '예산' }));
  assert.match(hit, /회의록: .*예산안/);
  assert.doesNotMatch(hit, /장보기/);
  assert.match(text(tool('search_notes', { query: '장보기' })), /\] 장보기: 우유, 계란/);
  assert.match(text(tool('search_notes', { query: '없는말' })), /메모가 없어/);
  assert.equal(tool('search_notes', { query: ' ' }).result?.isError, true);
  for (let i = 0; i < 4; i++) tool('add_note', { title: `묶음 ${i}`, body: 'x' });
  assert.equal(text(tool('search_notes', { query: '묶음', limit: 2 })).split('\n').length, 2);
});

test('기억하기: 받은 편지함에 쌓고 같은 것은 한 번 (짝꿍이 기다리는 기억으로 옮기고 사용자가 허락한다)', () => {
  const inbox = () => JSON.parse(readFileSync(join(dir, 'memory-inbox.json'), 'utf8'));
  assert.match(
    text(tool('remember', { text: '  아침엔 회의가 많아 ' })),
    /허락하면 기억할게: 아침엔 회의가 많아/,
  );
  assert.match(text(tool('remember', { text: '아침엔  회의가 많아' })), /이미 기억해 달라고 했어/);
  assert.match(text(tool('remember', { text: '가'.repeat(150) })), /허락하면 기억할게/);
  assert.equal(tool('remember', { text: '' }).result?.isError, true);
  assert.equal(tool('remember', { text: 3 }).result?.isError, true);
  assert.deepEqual(inbox(), ['아침엔 회의가 많아', '가'.repeat(100)]);
});

test('할 일 id 는 1 이상의 정수만 (글, 참거짓, 소수, 0, 음수는 거절)', () => {
  const r = text(tool('add_todo', { title: 'id 시험' }));
  const id = Number(/id (\d+)/.exec(r)?.[1]);
  assert.ok(id > 0);
  for (const name of ['complete_todo', 'update_todo', 'delete_todo'])
    for (const bad of [String(id), true, id + 0.5, 0, -id, null, [id]])
      assert.equal(
        tool(name, { id: bad, title: '바꿈' }).result?.isError,
        true,
        `${name} ${JSON.stringify(bad)}`,
      );
  assert.match(text(tool('update_todo', { id, title: '바꿈' })), /고쳤어/);
});
