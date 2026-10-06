// 메모 (v1). 마크다운 글. 펫 패널 메모 탭과 AI 답 저장(답을 메모로)에서 쓴다.
import type { Db } from './db-schema.ts';
import { t } from './i18n/index.ts';

export type NoteSource = 'me' | 'ai';

export interface Note {
  id: number;
  title: string;
  body: string;
  source: NoteSource;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: number;
  title: string;
  body: string;
  source: string;
  created_at: number;
  updated_at: number;
}

const toNote = (r: Row): Note => ({
  id: Number(r.id),
  title: r.title,
  body: r.body,
  source: r.source === 'ai' ? 'ai' : 'me',
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
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
    .map((l) => l.replace(/^\s*(#+|[-*]|\d+\.)\s*/, '').trim())
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

  remove(id: number, now: number): void {
    this.#db.prepare('update note set deleted_at = ? where id = ?').run(now, id);
  }

  /** 지운 것 되살리기 (지우고 몇 초 안에 되돌리기) */
  restore(id: number): void {
    this.#db.prepare('update note set deleted_at = null where id = ?').run(id);
  }
}
