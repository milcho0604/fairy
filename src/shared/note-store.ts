// 메모 (v1). 마크다운 글. 펫 패널 메모 탭과 AI 답 저장(답을 메모로)에서 쓴다.
import type { Db } from './db-schema.ts';
import { t } from './i18n/index.ts';
import { pinAt } from './pin.ts';

export type NoteSource = 'me' | 'ai';

export interface Note {
  id: number;
  title: string;
  body: string;
  source: NoteSource;
  createdAt: number;
  updatedAt: number;
  /** 고정한 시각 (13판, shared/pin.ts). 고정 안 했거나 값이 깨졌으면 null */
  pinnedAt: number | null;
}

interface Row {
  id: number;
  title: string;
  body: string;
  source: string;
  created_at: number;
  updated_at: number;
  pinned_at?: unknown;
}

const toNote = (r: Row): Note => ({
  id: Number(r.id),
  title: r.title,
  body: r.body,
  source: r.source === 'ai' ? 'ai' : 'me',
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  pinnedAt: pinAt(r.pinned_at),
});

export const NOTE_TITLE_MAX = 80;
export const NOTE_BODY_MAX = 50_000;

/** 제목이 비면 본문 첫 줄(마크다운 머리 기호를 뺀)을 제목으로 보여 준다. */
export function noteTitle(n: Pick<Note, 'title' | 'body'>): string {
  if (n.title.trim()) return n.title.trim();
  const first = n.body.split('\n').find((l) => l.trim()) ?? '';
  return first.replace(/^\s*(#+|[-*]|\d+\.)\s*/, '').slice(0, NOTE_TITLE_MAX) || t('panel.note.empty');
}

/** 목록에 보일 본문 한 줄. 제목으로 쓴 첫 줄과 마크다운 기호는 뺀다. */
export function notePreview(n: Pick<Note, 'title' | 'body'>): string {
  const lines = n.body
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(#+|>|[-*](?=\s)|\d+\.(?=\s))\s*/, '')
        // 줄 안의 굵게, 기울임, 코드, 지움, 링크 기호도 뺀다 ("**굵게**" 가 "*굵게**" 로 보이던 것)
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|$)/g, '$1$2')
        .trim(),
    )
    .filter(Boolean);
  if (!n.title.trim()) lines.shift();
  return lines.join(' ').slice(0, 80);
}

export class NoteStore {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** 최근에 고친 것부터 */
  list(): Note[] {
    return (
      this.#db
        .prepare('select * from note where deleted_at is null order by updated_at desc, id desc')
        .all() as Row[]
    ).map(toNote);
  }

  get(id: number): Note | undefined {
    const r = this.#db.prepare('select * from note where id = ? and deleted_at is null').get(id) as
      | Row
      | undefined;
    return r ? toNote(r) : undefined;
  }

  add(input: { title?: string; body?: string; source?: NoteSource }, now: number): Note {
    const r = this.#db
      .prepare('insert into note (title, body, source, created_at, updated_at) values (?, ?, ?, ?, ?)')
      .run(
        (input.title ?? '').trim().slice(0, NOTE_TITLE_MAX),
        (input.body ?? '').slice(0, NOTE_BODY_MAX),
        input.source === 'ai' ? 'ai' : 'me',
        now,
        now,
      );
    return this.get(Number(r.lastInsertRowid)) as Note;
  }

  update(id: number, patch: { title?: string; body?: string }, now: number): Note | undefined {
    const n = this.get(id);
    if (!n) return undefined;
    const title = patch.title === undefined ? n.title : patch.title.trim().slice(0, NOTE_TITLE_MAX);
    const body = patch.body === undefined ? n.body : patch.body.slice(0, NOTE_BODY_MAX);
    if (title === n.title && body === n.body) return n;
    this.#db
      .prepare('update note set title = ?, body = ?, updated_at = ? where id = ?')
      .run(title, body, now, id);
    return this.get(id);
  }

  /**
   * 고정과 풀기 (13판). 고친 시각(updated_at)은 그대로 둔다 (고정은 글을 고친 것이 아니다).
   * 이미 고정한 것을 다시 고정하면 처음 자리를 지킨다. 지운 메모는 바꾸지 않는다
   */
  pin(id: number, on: boolean, now: number): Note | undefined {
    const n = this.get(id);
    if (!n) return undefined;
    if (on && n.pinnedAt !== null) return n;
    this.#db.prepare('update note set pinned_at = ? where id = ?').run(on ? now : null, id);
    return this.get(id);
  }

  remove(id: number, now: number): void {
    this.#db.prepare('update note set deleted_at = ? where id = ?').run(now, id);
  }

  /** 지운 것 되살리기 (지우고 몇 초 안에 되돌리기) */
  restore(id: number): void {
    this.#db.prepare('update note set deleted_at = null where id = ?').run(id);
  }
}

// ---- 메모 찾기 ----

/** 찾기 비교용: 자모가 풀린 한글(맥 파일 이름, 붙여 넣은 글)을 합치고(NFC) 대소문자를 무시한다 */
const fold = (s: string) => s.normalize('NFC').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HANGUL = 0xac00;
const HANGUL_LAST = 0xd7a3;
/** 첫소리 자음 (호환 자모). 순서가 한글 음절 배열 순서다 */
const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const u = (code: number) => `\\u{${code.toString(16)}}`;

/**
 * 아직 조합 중인 마지막 글자를 넓게 본다. "가" 는 받침이 붙을 수 있어 "가~갛", 홀로 선 자음 "ㅇ" 은 "아~잏".
 * 받침 있는 글자("강")는 다음 글자로 넘어갈 수도 있지만 드물어 그대로 둔다.
 */
function composingChar(c: string): string {
  const cho = CHOSEONG.indexOf(c);
  if (cho >= 0) {
    const from = HANGUL + cho * 21 * 28;
    return `(?:${escapeRe(c)}|[${u(from)}-${u(from + 21 * 28 - 1)}])`;
  }
  const code = c.codePointAt(0) ?? 0;
  if (code >= HANGUL && code <= HANGUL_LAST && (code - HANGUL) % 28 === 0)
    return `[${u(code)}-${u(code + 27)}]`;
  return escapeRe(c);
}

/** 찾는 말을 정규식으로. 사이 띄어쓰기는 줄바꿈까지 아무 빈칸이나. 빈 말이면 null */
export function noteQuery(query: string, composing = false): RegExp | null {
  const chars = [...fold(query).replace(/\s+/g, ' ').trim()];
  if (chars.length === 0) return null;
  const last = composing ? composingChar(chars.pop() as string) : '';
  const head = chars.map((c) => (c === ' ' ? '\\s+' : escapeRe(c))).join('');
  return new RegExp(head + last, 'u');
}

/** 찾은 곳 앞에 보일 글자 수 (목록 한 줄에 찾은 부분이 보이게 짧게) */
const SNIPPET_BEFORE = 10;
const SNIPPET_AFTER = 60;

/**
 * 메모 찾기: 보이는 제목(noteTitle)과 본문 전체. 제목에서 찾으면 그대로, 본문에서만 찾으면 찾은 곳 둘레 글을 돌려준다.
 * 순서는 받은 목록 순서 그대로 (최근에 고친 것부터).
 */
export function searchNotes(
  notes: Pick<Note, 'id' | 'title' | 'body'>[],
  query: string,
  composing = false,
): { id: number; snippet?: string; mark?: [number, number] }[] {
  const re = noteQuery(query, composing);
  if (!re) return notes.map((n) => ({ id: n.id }));
  const hits: { id: number; snippet?: string; mark?: [number, number] }[] = [];
  for (const n of notes) {
    if (re.test(fold(noteTitle(n)))) {
      hits.push({ id: n.id });
      continue;
    }
    const body = n.body.normalize('NFC');
    const folded = fold(body);
    const m = re.exec(folded);
    if (!m) continue;
    // 소문자로 바꿔 길이가 달라지는 글자(드묾)가 있으면 바꾼 글에서 자른다 (자리가 어긋나지 않게)
    const src = folded.length === body.length ? body : folded;
    const at = m.index;
    const end = at + m[0].length;
    const from = Math.max(0, at - SNIPPET_BEFORE);
    const to = Math.min(src.length, end + SNIPPET_AFTER);
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    const before = `${from > 0 ? '…' : ''}${flat(src.slice(from, at)).trimStart()}`;
    const hit = flat(src.slice(at, end));
    const after = `${flat(src.slice(end, to)).trimEnd()}${to < src.length ? '…' : ''}`;
    hits.push({ id: n.id, snippet: before + hit + after, mark: [before.length, before.length + hit.length] });
  }
  return hits;
}
