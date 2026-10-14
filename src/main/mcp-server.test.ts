import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, mock, test } from 'node:test';
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
// 윈도우는 서버가 연 DB 를 아직 쥐고 있어 지우기가 EPERM 일 수 있다. 시험 뒷정리라 잠깐 기다려 다시 해 보고, 안 되면 둔다
after(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});

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
      'add_todo_steps',
      'check_todo_step',
      'add_note',
      'search_notes',
      'read_note',
      'append_note',
      'add_event',
      'list_events',
      'update_event',
      'delete_event',
      'today_overview',
      'remember',
    ],
  );
});

test('할 일 넣고 보고 끝내기', () => {
  const added = text(tool('add_todo', { title: '보고서', due: '2099-01-02', important: true }));
  assert.match(added, /넣었어 \(id 1\): 보고서, 마감 2099-01-02/);
  assert.match(text(tool('list_todos', {})), /\[1\] \(중요\) 보고서 \(마감 2099-01-02\)/);
  assert.match(text(tool('complete_todo', { id: 1 })), /끝냈어: 보고서 \(코인 20개\)/);
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

test('할 일 단계: 넣을 때 같이, 나중에 더하기, 번호로 체크, 다 하면 끝낼지 묻기', () => {
  const r = text(
    tool('add_todo', {
      title: '발표 준비 #회사',
      due: '2099-05-01',
      due_time: '14:30',
      steps: ['자료 찾기', ' ', '초안'],
    }),
  );
  assert.match(r, /마감 2099-05-01 14:30, 단계 2개/);
  const id = Number(/id (\d+)/.exec(r)?.[1]);
  assert.match(
    text(tool('add_todo_steps', { id, steps: ['리허설'] })),
    /단계 1개를 더했어[\s\S]*3\. \[ \] 리허설/,
  );
  assert.equal(tool('add_todo_steps', { id, steps: [] }).result?.isError, true);
  assert.match(text(tool('check_todo_step', { id, step: 1 })), /끝냈어: 자료 찾기 \(1\/3\)/);
  assert.equal(tool('check_todo_step', { id, step: 9 }).result?.isError, true);
  tool('check_todo_step', { id, step: 2 });
  assert.match(text(tool('check_todo_step', { id, step: 3 })), /단계를 다 했어/);
  assert.match(text(tool('check_todo_step', { id, step: 3, done: false })), /되돌렸어: 리허설 \(2\/3\)/);
  const list = text(tool('list_todos', { tag: '#회사' }));
  assert.match(list, /맞는 안 끝낸 할 일 1개/);
  assert.match(list, /\[단계 2\/3\]/);
  assert.match(list, /1\. \[x\] 자료 찾기/);
  assert.match(text(tool('list_todos', { query: '리허설' })), /발표 준비/);
  assert.match(text(tool('list_todos', { query: '없는말' })), /맞는 안 끝낸 할 일 0개/);
});

test('할 일 고치기: 마감 시각과 반복, 잘못된 시각은 거절', () => {
  const id = Number(/id (\d+)/.exec(text(tool('add_todo', { title: '운동', due: '2099-06-01' })))?.[1]);
  assert.match(
    text(tool('update_todo', { id, due_time: '07:00', repeat: 'daily' })),
    /마감 2099-06-01 07:00, 반복 daily/,
  );
  assert.equal(tool('update_todo', { id, due_time: '25:00' }).result?.isError, true);
  assert.doesNotMatch(text(tool('update_todo', { id, repeat: 'none', due_time: '' })), /반복|07:00/);
});

test('메모 읽기와 덧붙이기', () => {
  const nid = Number(
    /id (\d+)/.exec(text(tool('add_note', { title: '주간 회의', body: '- 예산 검토' })))?.[1],
  );
  assert.match(text(tool('append_note', { id: nid, text: '- 결정: 다음 주 발표' })), /덧붙였어: 주간 회의/);
  const body = text(tool('read_note', { id: nid }));
  assert.match(body, /^# 주간 회의/);
  assert.match(body, /- 예산 검토\n\n- 결정: 다음 주 발표$/);
  assert.equal(tool('append_note', { id: nid, text: ' ' }).result?.isError, true);
  assert.equal(tool('read_note', { id: 99999 }).result?.isError, true);
});

test('일정 겹침 알림, 고치기, 지우기', () => {
  tool('add_event', { title: '팀 회의', start: '2099-07-01T10:00', duration_min: 60 });
  const r = text(tool('add_event', { title: '치과', start: '2099-07-01T10:30' }));
  assert.match(r, /주의: 10:00 팀 회의 일정과 시간이 겹쳐/);
  const eid = Number(/id (\d+)/.exec(r)?.[1]);
  const moved = text(tool('update_event', { id: eid, start: '2099-07-01T15:00', title: '치과 검진' }));
  assert.match(moved, /2099-07-01 15:00 치과 검진/);
  assert.doesNotMatch(moved, /겹쳐/);
  assert.equal(tool('update_event', { id: eid }).result?.isError, true);
  assert.match(text(tool('delete_event', { id: eid })), /지웠어: 치과 검진/);
  assert.doesNotMatch(text(tool('list_events', { days: 60 })), /치과/);
});

test('오늘 한눈에: 오늘 날짜와 남은 할 일 수', () => {
  const r = text(tool('today_overview', {}));
  assert.match(r, /^오늘 \d{4}-\d{2}-\d{2}, 지금 \d{2}:\d{2}/);
  assert.match(r, /남은 할 일 모두 \d+개/);
});

test('list_events: 서머타임이 끝나는 날(25시간)도 그날 밤 일정까지 본다', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  // 2026-11-01 은 미국 동부 서머타임이 끝나 하루가 25시간이다
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 1, 8, 0).getTime() });
  try {
    const added = text(
      tool('add_event', { title: '늦은 통화', start: '2026-11-01T23:30', duration_min: 20 }),
    );
    const id = Number(/id (\d+)/.exec(added)?.[1]);
    assert.match(text(tool('list_events', { days: 1 })), /2026-11-01 23:30 늦은 통화/);
    tool('delete_event', { id });
  } finally {
    mock.timers.reset();
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

test('짝꿍 채팅이 띄운 서버(JJ_MCP_CONFIRM)는 지우기, 고치기를 바로 하지 않고 확인 편지함에 남긴다', async () => {
  const { parsePetActions, applyPetAction } = await import('../shared/pet-actions.ts');
  const { NoteStore } = await import('../shared/note-store.ts');
  const added = text(tool('add_todo', { title: '확인할 일' }));
  const tid = Number(/\[(\d+)\]|id (\d+)/.exec(added)?.slice(1).find(Boolean));
  assert.ok(tid > 0, added);
  process.env.JJ_MCP_CONFIRM = '1';
  try {
    assert.match(text(tool('delete_todo', { id: tid })), /아직 하지 않았어/);
    assert.match(
      text(tool('update_todo', { id: tid, title: '바뀐 제목', important: true })),
      /아직 하지 않았어/,
    );
    // 틀린 인자는 그대로 오류 (편지함에 남지 않는다)
    assert.equal(tool('update_todo', { id: tid }).result?.isError, true);
  } finally {
    delete process.env.JJ_MCP_CONFIRM;
  }
  const db = new DatabaseSync(join(dir, 'jjakkung.db'));
  try {
    const todos = new TodoStore(db as unknown as Db);
    assert.equal(todos.get(tid)?.title, '확인할 일');
    const list = parsePetActions(JSON.parse(readFileSync(join(dir, 'pet-actions-inbox.json'), 'utf8')));
    assert.deepEqual(
      list.map((a) => a.tool),
      ['delete_todo', 'update_todo'],
    );
    const stores = {
      todos,
      events: new EventStore(db as unknown as Db),
      notes: new NoteStore(db as unknown as Db),
    };
    const update = list.find((a) => a.tool === 'update_todo');
    assert.ok(update && applyPetAction(stores, update, Date.now()));
    assert.equal(todos.get(tid)?.title, '바뀐 제목');
  } finally {
    db.close();
  }
});

test('add_event, update_event: 너무 긴 duration_min 은 거절하고 일정 목록은 계속 읽힌다 (버그잡이 4)', () => {
  const r = tool('add_event', { title: '끝없는 회의', start: '2027-01-05T10:00', duration_min: 1e12 });
  assert.equal(r.result?.isError, true);
  assert.match(text(r), /duration_min/);
  const ok = tool('add_event', { title: '보통 회의', start: '2027-01-05T11:00', duration_min: 60 });
  assert.equal(ok.result?.isError, undefined);
  const id = Number(/id (\d+)/.exec(text(ok))?.[1]);
  const up = tool('update_event', { id, duration_min: 1e12 });
  assert.equal(up.result?.isError, true);
  const list = tool('list_events', { days: 60 });
  assert.equal(list.result?.isError, undefined);
});

test('serverInfo 판은 앱 판 (예전에는 0.1.0 으로 박혀 있었다)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  const info = call('initialize', { protocolVersion: '2025-06-18' }).result?.serverInfo as {
    version: string;
  };
  assert.equal(info.version, pkg.version);
});

test('구글에서 읽어 온 일정: "AI가 구글 일정도 볼 수 있게"를 꺼 두면(기본) 안 보이고, 켜면 목록, 한눈에, 고치기에 보인다', () => {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 50).getTime();
  const db = new DatabaseSync(join(dir, 'jjakkung.db'));
  new EventStore(db as unknown as Db).syncExternal(
    'google',
    [{ uid: 'g1', title: '구글 저녁 약속', startAt: at, endAt: null, allDay: false }],
    at - 86_400_000,
    at + 86_400_000,
    Date.now(),
  );
  const gid = Number(
    (db.prepare("select id from event where source = 'google'").get() as { id: number } | undefined)?.id,
  );
  db.close();
  const prefs = join(dir, 'google-calendar.json');
  try {
    // 설정 파일이 없으면 꺼짐
    assert.doesNotMatch(text(tool('list_events', { days: 2 })), /구글 저녁 약속/);
    assert.doesNotMatch(text(tool('today_overview', {})), /구글 저녁 약속/);
    assert.equal(tool('update_event', { id: gid, title: '바꿈' }).result?.isError, true);
    writeFileSync(prefs, JSON.stringify({ push: true, pull: true, ai: false }));
    assert.doesNotMatch(text(tool('list_events', { days: 2 })), /구글 저녁 약속/);
    // 켜면 보인다 (서버를 다시 띄우지 않아도 다음 부르기부터)
    writeFileSync(prefs, JSON.stringify({ push: true, pull: true, ai: true }));
    assert.match(text(tool('list_events', { days: 2 })), /23:50 구글 저녁 약속 \(구글 캘린더, 읽기 전용\)/);
    assert.match(text(tool('today_overview', {})), /구글 저녁 약속/);
    // 보여도 페어리에서는 읽기 전용: 고치기, 지우기는 거절
    for (const r of [tool('update_event', { id: gid, title: '바꿈' }), tool('delete_event', { id: gid })]) {
      assert.equal(r.result?.isError, true);
      assert.match(text(r), /구글 캘린더에서 가져온 일정/);
    }
    assert.match(text(tool('list_events', { days: 2 })), /23:50 구글 저녁 약속/);
    // 깨진 파일은 꺼짐
    writeFileSync(prefs, '{');
    assert.doesNotMatch(text(tool('list_events', { days: 2 })), /구글 저녁 약속/);
  } finally {
    rmSync(prefs, { force: true });
  }
});
