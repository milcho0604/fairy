import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { type Db, migrate } from './db-schema.ts';
import type { CalEvent } from './event-store.ts';
import {
  csvCell,
  defaultExportName,
  type ExportTodo,
  eventsIcs,
  exportPath,
  icsFold,
  icsText,
  icsUtc,
  mdInline,
  noteFileNames,
  noteMarkdown,
  notesMarkdown,
  readExportTodos,
  safeFileName,
  todosCsv,
  todosMarkdown,
} from './export.ts';
import { setLang } from './i18n/index.ts';
import type { Note } from './note-store.ts';
import { localDay, TodoStore } from './todo-store.ts';

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const NOW = Date.UTC(2026, 9, 11, 5, 0);

const ev = (o: Partial<CalEvent>): CalEvent => ({
  id: 1,
  title: '회의',
  startAt: Date.UTC(2026, 9, 12, 1, 0),
  endAt: null,
  reminds: [],
  remindMin: 0,
  notifiedAt: null,
  source: 'local',
  allDay: false,
  pinnedAt: null,
  ...o,
});

test('CSV 칸: 쉼표, 따옴표, 줄바꿈은 따옴표로 싸고, 수식처럼 보이는 글은 글로', () => {
  assert.equal(csvCell('보고서'), '보고서');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('그가 "안녕"'), '"그가 ""안녕"""');
  assert.equal(csvCell('줄\n바꿈'), '"줄\n바꿈"');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-'), "'-");
  assert.equal(csvCell('@me'), "'@me");
  assert.equal(csvCell(3), '3');
  assert.equal(csvCell(null), '');
});

test('할 일 CSV 와 마크다운: 머리줄, BOM, CRLF, 단계, 끝낸 것', () => {
  setLang('ko');
  const todos: ExportTodo[] = [
    {
      id: 1,
      title: '보고서, 초안',
      due: '2026-10-12',
      dueMin: 15 * 60,
      important: true,
      repeat: null,
      createdAt: NOW,
      doneAt: null,
      steps: [
        { title: '자료 모으기', done: true },
        { title: '쓰기', done: false },
      ],
    },
    {
      id: 2,
      title: '물 *마시기*',
      due: null,
      dueMin: null,
      important: false,
      repeat: 'daily',
      createdAt: NOW,
      doneAt: NOW,
      steps: [],
    },
  ];
  const csv = todosCsv(todos);
  assert.ok(csv.startsWith('\uFEFF제목,'));
  assert.ok(csv.endsWith('\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 4); // 머리, 둘, 끝 빈 줄
  assert.ok(lines[1]?.startsWith('"보고서, 초안",남음,2026-10-12,15:00,'));
  assert.match(lines[1] ?? '', /"\[x\] 자료 모으기\n\[ \] 쓰기"/);
  assert.match(lines[2] ?? '', /^물 \*마시기\*,끝냄,,,,매일,/);

  const md = todosMarkdown(todos, NOW);
  // 머리 날짜는 현지 날짜다 (시간대에 따라 2026-10-10 이나 10-11)
  assert.ok(md.startsWith(`# 할 일 (${localDay(NOW)})`));
  assert.match(
    md,
    /- \[ \] 보고서, 초안 \(마감 2026-10-12 15:00, 중요\)\n {2}- \[x\] 자료 모으기\n {2}- \[ \] 쓰기/,
  );
  assert.match(md, /## 끝낸 할 일 \(1\)\n\n- \[x\] 물 \\\*마시기\\\* \(매일\)/);
  assert.equal(mdInline('a_b [c] <d>\n#e'), 'a\\_b \\[c\\] \\<d\\> \\#e');
});

test('저장 파일에서 내보낼 할 일: 지운 것은 빼고 끝낸 것과 단계는 넣는다', () => {
  const db = new DatabaseSync(':memory:') as unknown as Db;
  migrate(db);
  const store = new TodoStore(db, utcDay);
  const a = store.add({ title: '열린 것', due: '2026-10-12', dueMin: 600 }, NOW);
  store.addStep(a.id, '단계', NOW);
  const b = store.add({ title: '끝낸 것' }, NOW);
  store.complete(b.id, NOW + 1000);
  const c = store.add({ title: '지운 것' }, NOW);
  store.remove(c.id, NOW);
  const rows = readExportTodos(db);
  assert.deepEqual(
    rows.map((r) => [r.title, r.doneAt !== null, r.dueMin, r.steps.length]),
    [
      ['열린 것', false, 600, 1],
      ['끝낸 것', true, null, 0],
    ],
  );
});

test('메모 마크다운: 파일 하나에 묶기, 메모마다 파일(앞머리), 본문 머리는 한 단계 내린다', () => {
  setLang('ko');
  const notes: Note[] = [
    {
      id: 1,
      title: '회의 "메모"',
      body: '# 안건\n- 하나',
      source: 'me',
      createdAt: NOW,
      updatedAt: NOW,
      pinnedAt: null,
    },
    { id: 2, title: '', body: '장보기\n우유', source: 'ai', createdAt: NOW, updatedAt: NOW, pinnedAt: null },
  ];
  const one = notesMarkdown(notes, NOW);
  assert.match(one, /^# 페어리 메모/);
  assert.match(one, /## 회의 "메모"\n\n_.+_\n\n## 안건\n- 하나/);
  assert.match(one, /\n---\n\n## 장보기/);
  const file = noteMarkdown(notes[0] as Note);
  assert.match(file, /^---\ntitle: "회의 \\"메모\\""\ncreated: 2026-10-11T05:00:00.000Z\n/);
  assert.match(file, /---\n\n# 회의 "메모"\n\n# 안건\n- 하나\n$/);
  const ai = noteMarkdown(notes[1] as Note);
  assert.match(ai, /source: ai\n---\n\n장보기\n우유\n$/);
});

test('파일 이름: 금지 글자, 예약 이름, 겹치는 이름', () => {
  assert.equal(safeFileName('a/b:c*?"<>|d'), 'a b c d');
  assert.equal(safeFileName('  ..숨김.  '), '숨김');
  assert.equal(safeFileName('CON'), '_CON');
  assert.equal(safeFileName('nul.txt'), '_nul.txt');
  assert.equal(safeFileName('\u0001\u0002'), 'memo');
  assert.equal([...safeFileName('가'.repeat(200))].length, 80);
  const n = (title: string): Note => ({
    id: 1,
    title,
    body: '',
    source: 'me',
    createdAt: 0,
    updatedAt: 0,
    pinnedAt: null,
  });
  assert.deepEqual(noteFileNames([n('메모'), n('메모'), n('MEMO'), n('memo')]), [
    '메모.md',
    '메모 (2).md',
    'MEMO.md',
    'memo (2).md',
  ]);
});

test('ics 글: 띄우기와 75 옥텟 접기 (한글을 반으로 자르지 않는다)', () => {
  assert.equal(icsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = `SUMMARY:${'가'.repeat(40)}`;
  const folded = icsFold(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  const enc = new TextEncoder();
  for (const p of parts) assert.ok(enc.encode(p).length <= 75, p);
  assert.ok(parts.slice(1).every((p) => p.startsWith(' ')));
  assert.equal(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join(''), long);
  assert.equal(icsFold('짧은 줄'), '짧은 줄');
  assert.equal(icsUtc(Date.UTC(2026, 9, 11, 5, 3, 9, 500)), '20261011T050309Z');
});

test('ics: 시각 일정은 UTC, 종일은 현지 날짜(끝 날 다음 날), 알림은 VALARM, CRLF', () => {
  setLang('ko');
  const out = eventsIcs(
    [
      ev({ id: 7, title: '회의, 1층', endAt: Date.UTC(2026, 9, 12, 2, 30), reminds: [60, 10] }),
      // 하루 종일 (endAt 없음)
      ev({ id: 8, title: '생일', allDay: true, startAt: Date.UTC(2026, 9, 14), reminds: [-540] }),
      // 여러 날 (10/20~10/22, 끝은 10/23 0시)
      ev({
        id: 9,
        title: '제주',
        allDay: true,
        startAt: Date.UTC(2026, 9, 20),
        endAt: Date.UTC(2026, 9, 23),
      }),
      ev({ id: 10, title: '끝 없음' }),
    ],
    NOW,
    { day: utcDay },
  );
  assert.ok(out.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:'));
  assert.ok(out.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(out), '줄 끝은 모두 CRLF');
  assert.match(
    out,
    /UID:jjakkung-event-7@jjakkung\.local\r\nDTSTAMP:20261011T050000Z\r\nDTSTART:20261012T010000Z\r\nDTEND:20261012T023000Z\r\nSUMMARY:회의\\, 1층/,
  );
  assert.match(
    out,
    /TRIGGER:-PT60M\r\nEND:VALARM\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:회의\\, 1층\r\nTRIGGER:-PT10M/,
  );
  assert.match(out, /DTSTART;VALUE=DATE:20261014\r\nDTEND;VALUE=DATE:20261015/);
  assert.match(out, /TRIGGER:PT540M/);
  assert.match(out, /DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261023/);
  // 끝 없는 시각 일정은 DTEND 를 쓰지 않는다
  assert.match(
    out,
    /UID:jjakkung-event-10@jjakkung\.local\r\nDTSTAMP:\d+T\d+Z\r\nDTSTART:20261012T010000Z\r\nSUMMARY:끝 없음/,
  );
  assert.equal((out.match(/BEGIN:VEVENT/g) ?? []).length, 4);
  assert.equal((out.match(/END:VEVENT/g) ?? []).length, 4);
});

test('저장 경로: 절대 경로만, 확장자는 붙인다, 기본 이름', () => {
  assert.equal(exportPath('/Users/me/todos', '.csv'), '/Users/me/todos.csv');
  assert.equal(exportPath('/Users/me/todos.CSV', '.csv'), '/Users/me/todos.CSV');
  assert.equal(exportPath('C:\\Users\\me\\events', '.ics'), 'C:\\Users\\me\\events.ics');
  assert.equal(exportPath('relative/todos.csv', '.csv'), undefined);
  assert.equal(exportPath('/tmp/a\0b.csv', '.csv'), undefined);
  assert.equal(exportPath('/tmp/', '.csv'), undefined);
  assert.equal(exportPath(undefined, '.csv'), undefined);
  assert.match(defaultExportName('events-ics', NOW), /^fairy-events-\d{8}\.ics$/);
});
