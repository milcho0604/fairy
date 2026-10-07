// 펫 MCP 서버 (v1). Claude Code, Codex 같은 AI 도구가 "펫 할 일에 넣어 줘"를 할 수 있게 한다.
// 짝꿍 실행 파일을 Node 로 돌려(ELECTRON_RUN_AS_NODE=1) 표준 입출력으로 MCP(JSON-RPC 2.0, 줄 단위)를 주고받는다.
// 짝꿍과 같은 저장 파일(jjakkung.db)을 연다. 짝꿍이 켜져 있으면 몇 초 안에 패널에 보인다 (data_version 을 본다).
// Electron 을 불러오지 않는다. 이 파일은 electron-vite 가 out/main/mcp-server.js 로 따로 낸다.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { type Db, SCHEMA_VERSION, schemaVersion } from '../shared/db-schema.ts';
import { EventStore } from '../shared/event-store.ts';
import { NoteStore } from '../shared/note-store.ts';
import { isRepeat, localDay, TodoStore } from '../shared/todo-store.ts';

const VERSION = '0.1.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** 짝꿍 메인과 같은 데이터 폴더 (index.ts 의 setPath 와 맞춘다). */
function userDataDir(): string {
  if (process.env.JJ_USER_DATA) return process.env.JJ_USER_DATA;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'jjakkung');
  if (process.platform === 'win32')
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'jjakkung');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'jjakkung');
}

let stores: { todos: TodoStore; notes: NoteStore; events: EventStore } | undefined;

/** 저장 파일은 짝꿍이 만들고 판을 올린다. 여기서는 열기만 하고 판이 다르면 거절한다 (덮어쓰지 않게). */
function open() {
  if (stores) return stores;
  const file = join(userDataDir(), 'jjakkung.db');
  if (!existsSync(file)) throw new Error('짝꿍 저장 파일이 없어. 짝꿍을 한 번 켜 줘.');
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 3000;');
  const v = schemaVersion(db as unknown as Db);
  if (v !== SCHEMA_VERSION)
    throw new Error(`저장 파일(${v}판)과 이 서버(${SCHEMA_VERSION}판)의 판이 달라. 짝꿍을 최신으로 켜 줘.`);
  const d = db as unknown as Db;
  stores = { todos: new TodoStore(d), notes: new NoteStore(d), events: new EventStore(d) };
  return stores;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const TOOLS: Tool[] = [
  {
    name: 'add_todo',
    description: '짝꿍(데스크톱 펫) 할 일 목록에 할 일을 넣는다. 끝내면 사용자가 코인을 받는다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '할 일 제목 (200자까지)' },
        due: { type: 'string', description: '마감일 YYYY-MM-DD (현지 날짜). 없으면 마감 없음' },
        important: { type: 'boolean', description: '중요 표시' },
        repeat: { type: 'string', enum: ['daily', 'weekdays', 'weekly'], description: '반복' },
      },
      required: ['title'],
    },
    run: (a) => {
      const title = str(a.title);
      if (!title) throw new Error('title 이 비었어');
      const due = str(a.due);
      if (due && !DAY_RE.test(due)) throw new Error('due 는 YYYY-MM-DD 로 줘');
      const t = open().todos.add(
        {
          title,
          due: due || null,
          important: a.important === true,
          repeat: isRepeat(a.repeat) ? a.repeat : null,
        },
        Date.now(),
      );
      return `할 일을 넣었어 (id ${t.id}): ${t.title}${t.due ? `, 마감 ${t.due}` : ''}${t.repeat ? `, 반복 ${t.repeat}` : ''}`;
    },
  },
  {
    name: 'list_todos',
    description: '짝꿍의 안 끝낸 할 일과 오늘 끝낸 할 일을 본다.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const now = Date.now();
      const { open: list, doneToday } = open().todos.list(now);
      const line = (t: { id: number; title: string; due: string | null; important: boolean }) =>
        `- [${t.id}] ${t.important ? '(중요) ' : ''}${t.title}${t.due ? ` (마감 ${t.due})` : ''}`;
      return [
        `오늘 ${localDay(now)}`,
        `안 끝낸 할 일 ${list.length}개:`,
        ...list.map(line),
        `오늘 끝낸 일 ${doneToday.length}개:`,
        ...doneToday.map(line),
      ].join('\n');
    },
  },
  {
    name: 'complete_todo',
    description: '짝꿍 할 일을 끝낸 것으로 표시한다. id 는 list_todos 에서.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: '할 일 id' } },
      required: ['id'],
    },
    run: (a) => {
      const id = Number(a.id);
      const s = open();
      const t = s.todos.get(id);
      if (!t) throw new Error(`id ${id} 할 일이 없어`);
      if (t.doneAt !== null) return `이미 끝낸 할 일이야: ${t.title}`;
      const coins = s.todos.complete(id, Date.now());
      return `끝냈어: ${t.title}${coins > 0 ? ` (코인 ${coins}개)` : ''}`;
    },
  },
  {
    name: 'add_note',
    description: '짝꿍 메모에 마크다운 메모를 남긴다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '제목 (없으면 본문 첫 줄이 제목처럼 보인다)' },
        body: { type: 'string', description: '본문 (마크다운)' },
      },
      required: ['body'],
    },
    run: (a) => {
      const body = typeof a.body === 'string' ? a.body : '';
      if (!body.trim()) throw new Error('body 가 비었어');
      const n = open().notes.add({ title: str(a.title), body, source: 'ai' }, Date.now());
      return `메모를 남겼어 (id ${n.id})`;
    },
  },
  {
    name: 'add_event',
    description: '짝꿍 일정에 넣는다. 시작 전에 펫이 말풍선으로 알린다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: '시작 시각, 현지 시간 YYYY-MM-DDTHH:mm' },
        duration_min: { type: 'number', description: '길이(분)' },
        remind_min: { type: 'number', description: '몇 분 전에 알릴지 (기본 10)' },
      },
      required: ['title', 'start'],
    },
    run: (a) => {
      const title = str(a.title);
      const m = LOCAL_RE.exec(str(a.start));
      if (!title) throw new Error('title 이 비었어');
      if (!m) throw new Error('start 는 YYYY-MM-DDTHH:mm (현지 시간) 로 줘');
      const startAt = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
      ).getTime();
      const dur = Number(a.duration_min);
      const e = open().events.add(
        {
          title,
          startAt,
          endAt: Number.isFinite(dur) && dur > 0 ? startAt + dur * 60_000 : null,
          remindMin: Number.isFinite(Number(a.remind_min)) ? Number(a.remind_min) : undefined,
        },
        Date.now(),
      );
      return `일정을 넣었어 (id ${e.id}): ${str(a.start)} ${e.title}`;
    },
  },
  {
    name: 'list_events',
    description: '짝꿍 일정을 본다 (오늘부터 며칠).',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: '며칠 치 (기본 7, 최대 60)' } },
    },
    run: (a) => {
      const days = Math.max(1, Math.min(60, Number(a.days) || 7));
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const list = open().events.between(from.getTime(), from.getTime() + days * 86_400_000);
      if (list.length === 0) return `앞으로 ${days}일 안에 일정이 없어.`;
      const p = (n: number) => String(n).padStart(2, '0');
      return list
        .map((e) => {
          const d = new Date(e.startAt);
          return `- [${e.id}] ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${e.title}`;
        })
        .join('\n');
    },
  },
];

type Json = Record<string, unknown>;

/** 요청 하나를 처리해 응답(알림이면 undefined)을 돌려준다. 시험에서도 부른다. */
export function handle(msg: Json): Json | undefined {
  // null, 숫자, 배열(일괄 요청) 한 줄에 서버가 죽지 않게. 일괄 요청은 지원하지 않는다
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg))
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  const id = msg.id;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return undefined; // 알림 (notifications/initialized 등)
  const params = (msg.params ?? {}) as Json;
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'jjakkung', version: VERSION },
        instructions: '데스크톱 펫 짝꿍의 할 일, 메모, 일정을 다룬다. 사용자가 펫에 넣어 달라고 할 때 쓴다.',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `모르는 도구: ${String(params.name)}`);
      try {
        const text = tool.run((params.arguments ?? {}) as Json);
        return reply({ content: [{ type: 'text', text }] });
      } catch (err) {
        return reply({
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, `모르는 요청: ${String(msg.method)}`);
  }
}

function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '읽을 수 없는 JSON' } })}\n`,
      );
      return;
    }
    let out: Json | undefined;
    try {
      out = handle(msg);
    } catch (err) {
      // 도구 하나가 던져도 서버는 살아 있게
      const id = typeof msg === 'object' && msg !== null && !Array.isArray(msg) ? (msg.id ?? null) : null;
      out = {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      };
    }
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
}

// 시험에서 불러올 때는 서버를 띄우지 않는다.
if (process.argv[1]?.endsWith('mcp-server.js')) main();
