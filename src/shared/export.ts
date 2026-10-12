// 내보내기 (2026-10-11): 메모는 마크다운(하나로 묶거나 메모마다 파일), 할 일은 CSV 와 마크다운 체크리스트, 일정은 .ics (RFC 5545).
// 백업(backup.ts)은 짝꿍끼리 옮기는 것이고, 이것은 다른 앱(메모장, 엑셀, 구글 캘린더, 옵시디언)에서 읽게 하는 것이다.
// 글 만들기는 여기서(시험), 저장 대화상자와 쓰기는 메인(main/day-tools.ts)이 한다.
import type { Db } from './db-schema.ts';
import type { CalEvent } from './event-store.ts';
import { t } from './i18n/index.ts';
import type { Note } from './note-store.ts';
import { noteTitle } from './note-store.ts';
import { isRepeat, localDay, type Repeat } from './todo-store.ts';

export type ExportKind = 'notes-md' | 'notes-files' | 'todos-csv' | 'todos-md' | 'events-ics';
export const EXPORT_KINDS: readonly ExportKind[] = [
  'notes-md',
  'notes-files',
  'todos-csv',
  'todos-md',
  'events-ics',
];
export const isExportKind = (v: unknown): v is ExportKind => EXPORT_KINDS.includes(v as ExportKind);

/** 내보낼 할 일 (지운 것은 빼고, 끝낸 것도 넣는다) */
export interface ExportTodo {
  id: number;
  title: string;
  due: string | null;
  dueMin: number | null;
  important: boolean;
  repeat: Repeat | null;
  createdAt: number;
  doneAt: number | null;
  steps: { title: string; done: boolean }[];
}

/** 저장 파일에서 내보낼 할 일을 읽는다: 안 끝난 것 먼저(마감 순), 끝낸 것은 최근 것부터 */
export function readExportTodos(db: Db): ExportTodo[] {
  const rows = db
    .prepare(
      `select id, title, due, due_min, important, repeat, created_at, done_at from todo where deleted_at is null
       order by done_at is not null, case when done_at is null then 0 else -done_at end,
       due is null, due, due_min is null, due_min, created_at, id`,
    )
    .all() as {
    id: number;
    title: string;
    due: string | null;
    due_min: number | null;
    important: number;
    repeat: string | null;
    created_at: number;
    done_at: number | null;
  }[];
  const steps = new Map<number, { title: string; done: boolean }[]>();
  for (const s of db
    .prepare('select todo_id, title, done from todo_step order by todo_id, ord, id')
    .all() as {
    todo_id: number;
    title: string;
    done: number;
  }[]) {
    const list = steps.get(Number(s.todo_id)) ?? [];
    list.push({ title: s.title, done: Number(s.done) === 1 });
    steps.set(Number(s.todo_id), list);
  }
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    due: r.due,
    dueMin: r.due && r.due_min !== null ? Number(r.due_min) : null,
    important: Number(r.important) === 1,
    repeat: isRepeat(r.repeat) ? r.repeat : null,
    createdAt: Number(r.created_at),
    doneAt: r.done_at === null ? null : Number(r.done_at),
    steps: steps.get(Number(r.id)) ?? [],
  }));
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
/** 현지 날짜와 시각 "2026-10-11 14:05" */
function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${localDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- CSV (RFC 4180) ----

/**
 * CSV 칸 하나. 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 싸고 따옴표는 둘로. 엑셀이 식으로 읽는 첫 글자(= + - @ 탭)는
 * 앞에 ' 를 붙여 글로 둔다 (CSV 수식 끼워 넣기 막기)
 */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 줄은 CRLF, 맨 앞에 BOM (엑셀이 한글을 UTF-8 로 읽게) */
export function toCsv(rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const repeatLabel = (r: Repeat | null) => (r ? t(`panel.repeat.${r}`) : '');

export function todosCsv(todos: readonly ExportTodo[]): string {
  const head = [
    t('export.col.title'),
    t('export.col.status'),
    t('export.col.due'),
    t('export.col.dueTime'),
    t('export.col.important'),
    t('export.col.repeat'),
    t('export.col.steps'),
    t('export.col.created'),
    t('export.col.done'),
  ];
  const rows = todos.map((x) => [
    x.title,
    x.doneAt === null ? t('export.status.open') : t('export.status.done'),
    x.due ?? '',
    x.dueMin === null ? '' : hhmm(x.dueMin),
    x.important ? t('export.yes') : '',
    repeatLabel(x.repeat),
    x.steps.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join('\n'),
    localStamp(x.createdAt),
    x.doneAt === null ? '' : localStamp(x.doneAt),
  ]);
  return toCsv([head, ...rows]);
}

// ---- 마크다운 ----

/** 목록 한 줄 안에서 마크다운 기호로 읽힐 글자를 띄운다 */
export function mdInline(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

export function todosMarkdown(todos: readonly ExportTodo[], now: number): string {
  const line = (x: ExportTodo) => {
    const tags = [
      x.due ? `${t('export.col.due')} ${x.due}${x.dueMin === null ? '' : ` ${hhmm(x.dueMin)}`}` : '',
      x.important ? t('export.col.important') : '',
      repeatLabel(x.repeat),
    ].filter(Boolean);
    const head = `- [${x.doneAt === null ? ' ' : 'x'}] ${mdInline(x.title)}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    return [head, ...x.steps.map((s) => `  - [${s.done ? 'x' : ' '}] ${mdInline(s.title)}`)].join('\n');
  };
  const open = todos.filter((x) => x.doneAt === null);
  const done = todos.filter((x) => x.doneAt !== null);
  const parts = [`# ${t('export.todos.title')} (${localDay(now)})`, ''];
  parts.push(`## ${t('export.todos.open')} (${open.length})`, '');
  parts.push(open.length ? open.map(line).join('\n') : `_${t('export.empty')}_`, '');
  if (done.length)
    parts.push(`## ${t('export.todos.done')} (${done.length})`, '', done.map(line).join('\n'), '');
  return `${parts.join('\n').trimEnd()}\n`;
}

/** YAML 앞머리 값 (따옴표로 싸고 \ 와 " 는 띄운다) */
const yamlStr = (s: string) =>
  `"${s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')}"`;

/** 메모 하나를 파일 하나로: 앞머리(제목, 만든 때, 고친 때)와 제목, 본문 그대로 (본문은 원래 마크다운) */
export function noteMarkdown(n: Note): string {
  const title = noteTitle(n);
  const front = [
    '---',
    `title: ${yamlStr(title)}`,
    `created: ${new Date(n.createdAt).toISOString()}`,
    `updated: ${new Date(n.updatedAt).toISOString()}`,
    ...(n.source === 'ai' ? ['source: ai'] : []),
    '---',
    '',
  ];
  // 제목 칸이 비었으면 본문 첫 줄이 제목이라 다시 쓰지 않는다
  const body = n.title.trim() ? [`# ${n.title.trim()}`, '', n.body.trim()] : [n.body.trim()];
  return `${[...front, ...body].join('\n').trimEnd()}\n`;
}

/**
 * 묶은 파일에서 메모 머리(##) 아래에 둘 본문. 제목 칸이 비었으면 머리가 본문 첫 줄이라 그 줄은 뺀다
 * (noteMarkdown 과 같다. "## 장보기" 아래에 "장보기" 가 또 나왔다). 목록 줄이거나 길어서 잘린 제목이면 본문 그대로
 */
function bodyUnderTitle(n: Note): string {
  const body = n.body.trim();
  if (n.title.trim()) return body;
  const [first = '', ...rest] = body.split('\n');
  if (/^\s*([-*]|\d+\.)\s/.test(first)) return body;
  if (first.replace(/^\s*#+\s*/, '').trim() !== noteTitle(n)) return body;
  return rest.join('\n').trim();
}

/** 메모를 마크다운 하나로 묶는다 (최근에 고친 것부터, 메모 사이에 가로줄) */
export function notesMarkdown(notes: readonly Note[], now: number): string {
  const head = [
    `# ${t('export.notes.title')}`,
    '',
    `_${t('export.notes.at', { day: localDay(now), n: notes.length })}_`,
  ];
  const items = notes.map((n) =>
    [
      `## ${noteTitle(n).replace(/[\r\n]+/g, ' ')}`,
      '',
      `_${t('export.notes.updated', { at: localStamp(n.updatedAt) })}_`,
      '',
      // 본문 안의 큰 머리(#)가 메모 머리(##)보다 커지지 않게 한 단계씩 내린다
      bodyUnderTitle(n).replace(/^(#{1,5}) /gm, '#$1 '),
    ]
      .join('\n')
      .trimEnd(),
  );
  return `${[head.join('\n'), ...items].join('\n\n---\n\n').trimEnd()}\n`;
}

const WIN_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const NAME_MAX = 80;
/** 파일 이름 앞부분 바이트 상한 (UTF-8). 255 에서 " (9999).md" 자리를 뺀다 */
const NAME_MAX_BYTES = 240;
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** 파일 이름으로 쓸 수 있게: 금지 글자와 제어 글자를 빼고, 앞뒤 점과 빈칸을 떼고, 윈도우 예약 이름을 피한다 */
export function safeFileName(raw: string, fallback = 'memo'): string {
  let s = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 파일 이름에서 제어 글자를 뺀다
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  s = [...s].slice(0, NAME_MAX).join('').trim();
  // 파일 이름은 대부분 255바이트까지다 (리눅스 ext4 등). 그림 글자(4바이트) 80개면 320바이트라 쓰기가 실패하고
  // 메모 내보내기가 중간에 멈췄다. 겹침 표시(" (12)")와 .md 를 붙일 자리를 남기고 글자 단위로 줄인다
  while (utf8Bytes(s) > NAME_MAX_BYTES) s = [...s].slice(0, -1).join('');
  s = s.trim();
  if (!s) s = fallback;
  if (WIN_RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** 메모마다 파일 이름 (겹치면 " (2)", 대소문자만 다른 것도 겹친 것으로 본다) */
export function noteFileNames(notes: readonly Note[]): string[] {
  const used = new Set<string>();
  return notes.map((n) => {
    const base = safeFileName(noteTitle(n), t('export.notes.file'));
    let name = `${base}.md`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i}).md`;
    used.add(name.toLowerCase());
    return name;
  });
}

// ---- iCalendar (RFC 5545) ----

/** TEXT 값 띄우기: \ ; , 와 줄바꿈 (3.3.11) */
export function icsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** 한 줄은 75 옥텟까지, 넘으면 CRLF + 빈칸으로 접는다 (3.1). UTF-8 글자 가운데서 자르지 않는다 */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // 이어지는 줄은 앞의 빈칸 1 옥텟을 뺀 74 까지
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** UTC 날짜시각 "20261011T050000Z" */
export function icsUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** 날짜 "20261011" (YYYY-MM-DD 에서) */
const icsDate = (day: string) => day.replace(/-/g, '');

function plusOneDay(day: string): string {
  const [y = 2000, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** 미리 알림을 VALARM 트리거로: 시작보다 before 분 앞 (음수면 뒤, 종일 일정의 "당일 아침 9시") */
const trigger = (before: number) => `${before >= 0 ? '-' : ''}PT${Math.abs(Math.round(before))}M`;

/**
 * 일정들을 .ics 하나로. 시각 일정은 UTC(Z)로 적어 어느 시간대 캘린더에서 열어도 같은 때다.
 * 종일 일정은 현지 날짜(VALUE=DATE)로, 끝 날은 마지막 날 다음 날(들지 않음, 짝꿍 저장과 같다).
 * UID 는 짝꿍 일정 id 로 정해 다시 내보내 가져와도 같은 일정으로 본다. 미리 알림은 VALARM 으로 옮긴다
 */
export function eventsIcs(
  events: readonly CalEvent[],
  now: number,
  o: { day?: (ms: number) => string; calName?: string } = {},
): string {
  const day = o.day ?? localDay;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//fairy//fairy//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(o.calName ?? t('export.ics.calName'))}`,
  ];
  for (const e of events) {
    // UID 는 예전 이름 그대로: 바꾸면 이미 가져간 캘린더 앱이 같은 일정을 새 일정으로 겹쳐 넣는다
    lines.push('BEGIN:VEVENT', `UID:jjakkung-event-${e.id}@jjakkung.local`, `DTSTAMP:${icsUtc(now)}`);
    if (e.allDay) {
      const first = day(e.startAt);
      const end = e.endAt !== null && e.endAt > e.startAt ? day(e.endAt) : plusOneDay(first);
      lines.push(
        `DTSTART;VALUE=DATE:${icsDate(first)}`,
        `DTEND;VALUE=DATE:${icsDate(end > first ? end : plusOneDay(first))}`,
      );
    } else {
      lines.push(`DTSTART:${icsUtc(e.startAt)}`);
      if (e.endAt !== null && e.endAt > e.startAt) lines.push(`DTEND:${icsUtc(e.endAt)}`);
    }
    lines.push(`SUMMARY:${icsText(e.title)}`, 'TRANSP:OPAQUE');
    for (const before of e.reminds)
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsText(e.title)}`,
        `TRIGGER:${trigger(before)}`,
        'END:VALARM',
      );
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

// ---- 저장 경로 ----

const EXT: Record<Exclude<ExportKind, 'notes-files'>, string> = {
  'notes-md': '.md',
  'todos-md': '.md',
  'todos-csv': '.csv',
  'events-ics': '.ics',
};

export const exportExt = (kind: Exclude<ExportKind, 'notes-files'>) => EXT[kind];

/**
 * 저장 대화상자가 준 경로를 쓸 수 있는지 본다: 절대 경로이고 NUL 이 없어야 한다. 확장자가 다르거나 없으면 붙인다
 * (".md" 로 고른 줄 알았는데 "메모" 로 저장되면 다른 앱이 못 연다). 못 쓰면 undefined
 */
export function exportPath(picked: string | undefined, ext: string): string | undefined {
  if (!picked || picked.includes('\0')) return undefined;
  if (!/^(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(picked)) return undefined;
  if (/[\\/]$/.test(picked)) return undefined;
  return picked.toLowerCase().endsWith(ext) ? picked : `${picked}${ext}`;
}

/** 대화상자에 미리 넣을 파일 이름 "fairy-todos-20261011.csv" */
export function defaultExportName(kind: Exclude<ExportKind, 'notes-files'>, now: number): string {
  const stem = { 'notes-md': 'memos', 'todos-md': 'todos', 'todos-csv': 'todos', 'events-ics': 'events' }[
    kind
  ];
  return `fairy-${stem}-${localDay(now).replace(/-/g, '')}${EXT[kind]}`;
}
