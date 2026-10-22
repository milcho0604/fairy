// 지난 대화 저장소. 사용자 데이터 폴더에 목차(chat-threads.json)와 대화마다 파일(chat-threads/<id>.json)을 둔다.
// 목록은 목차만 읽어 그리고(수백 개여도 파일 하나), 대화 본문은 열 때만 읽는다.
// 지우기는 파일을 진짜 지운다 (휴지통이나 복사본을 남기지 않는다). Electron 없이 돌아 시험에서 그대로 부른다.

import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseChat, type SavedChat } from '../shared/chat-state.ts';
import {
  isThreadId,
  listThreads,
  overflow,
  parseIndex,
  removeMeta,
  renameMeta,
  startThread,
  type ThreadIndex,
  type ThreadMeta,
  upsertMeta,
} from '../shared/chat-threads.ts';
import { type JsonTrouble, readJsonFile, writeJsonFile } from './json-file.ts';

export interface ThreadStore {
  /** 지금 열린 대화 id */
  readonly current: string | undefined;
  list(query?: string): ThreadMeta[];
  meta(id: string): ThreadMeta | undefined;
  read(id: string): SavedChat | undefined;
  /** 지금 대화를 저장한다. 메시지가 없으면 아무것도 쓰지 않는다. 지금 대화가 없으면 새로 만든다 */
  saveCurrent(saved: SavedChat, isolated: boolean): void;
  /** 새 대화: 지금 대화는 목록에 남기고 손을 뗀다 */
  detach(): void;
  /** 지난 대화를 지금 대화로 */
  attach(id: string): boolean;
  rename(id: string, title: string): boolean;
  /** 목차와 파일을 지운다. 지금 대화였으면 true */
  remove(id: string): boolean;
}

export function createThreadStore(
  dir: string,
  opts: {
    /** 켤 때 지금 대화 (chat-history). 목록에 없으면 첫 항목으로 넣는다 (옛 판 데이터 옮기기) */
    history: SavedChat;
    /** 옛 판 대화를 넣을 때 쓸 날짜 (chat-history 파일을 마지막으로 쓴 때) */
    historyAt?: number;
    isolated: boolean;
    now?: () => number;
    newId?: () => string;
    log?: (...rest: unknown[]) => void;
    onTrouble?: (t: JsonTrouble) => void;
  },
): ThreadStore {
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? randomUUID;
  const log = opts.log ?? (() => {});
  const indexPath = join(dir, 'chat-threads.json');
  const threadDir = join(dir, 'chat-threads');
  const fileOf = (id: string) => join(threadDir, `${id}.json`);

  const readFile = (path: string) => {
    const r = readJsonFile(path);
    if (r.trouble) opts.onTrouble?.(r.trouble);
    return r.value;
  };
  const rawIndex = readJsonFile(indexPath);
  if (rawIndex.trouble) opts.onTrouble?.(rawIndex.trouble);
  let index: ThreadIndex = parseIndex(rawIndex.value);
  const writeIndex = () => writeJsonFile(indexPath, index, { mode: 0o600 });
  const read = (id: string): SavedChat | undefined => {
    if (!isThreadId(id) || !index.threads.some((m) => m.id === id)) return undefined;
    const raw = readFile(fileOf(id));
    return raw === undefined ? undefined : parseChat(raw);
  };
  const removeFile = (id: string) => {
    if (isThreadId(id)) rmSync(fileOf(id), { force: true });
  };

  // 켤 때: 지금 대화가 목록의 어느 것인지 맞춘다. 옛 판에서 올라왔으면 지금 대화를 첫 항목으로 넣는다
  const start = startThread(index, opts.history, index.current ? read(index.current) : undefined);
  if (start === 'adopt') {
    const id = newId();
    const at = opts.historyAt ?? now();
    writeJsonFile(fileOf(id), opts.history, { mode: 0o600 });
    index = { ...upsertMeta(index, id, opts.history, at, opts.isolated), current: id };
    // 처음 들어온 대화는 만든 날도 그 파일 날짜로
    writeIndex();
    log('threads', 'adopt history', opts.history.messages.length);
  } else if (start === 'none' && index.current) {
    index = { threads: index.threads };
    writeIndex();
  }
  // 목차에 없는 대화 파일(쓰다 꺼짐, 지우다 꺼짐)은 남기지 않는다 (지운 대화가 파일로 남지 않게).
  // 목차를 제대로 읽었을 때만: 목차가 깨졌거나 없으면 대화 파일을 다 지우게 된다
  if (rawIndex.value !== undefined && !rawIndex.trouble)
    try {
      const known = new Set(index.threads.map((m) => `${m.id}.json`));
      for (const f of readdirSync(threadDir)) {
        if (f.endsWith('.json') && !known.has(f)) rmSync(join(threadDir, f), { force: true });
      }
    } catch {
      // 폴더가 아직 없다
    }

  return {
    get current() {
      return index.current;
    },
    list: (query) => listThreads(index, query),
    meta: (id) => index.threads.find((m) => m.id === id),
    read,
    saveCurrent(saved, isolated) {
      if (saved.messages.length === 0) return;
      const id = index.current ?? newId();
      writeJsonFile(fileOf(id), saved, { mode: 0o600 });
      index = { ...upsertMeta(index, id, saved, now(), isolated), current: id };
      const drop = overflow(index);
      for (const old of drop) {
        removeFile(old);
        index = removeMeta(index, old);
      }
      if (drop.length) log('threads', 'drop oldest', drop.length);
      writeIndex();
    },
    detach() {
      if (!index.current) return;
      index = { threads: index.threads };
      writeIndex();
    },
    attach(id) {
      if (!index.threads.some((m) => m.id === id)) return false;
      index = { ...index, current: id };
      writeIndex();
      return true;
    },
    rename(id, title) {
      if (!index.threads.some((m) => m.id === id)) return false;
      const prev = index;
      index = renameMeta(index, id, title, title.trim() ? undefined : read(id));
      try {
        writeIndex();
      } catch (err) {
        // 디스크에 못 쓰면 메모리 목록도 옛 이름으로 되돌린다 (화면과 파일이 어긋나지 않게)
        index = prev;
        log('threads', 'rename save failed', err instanceof Error ? err.message : String(err));
        return false;
      }
      return true;
    },
    remove(id) {
      if (!index.threads.some((m) => m.id === id)) return false;
      const wasCurrent = index.current === id;
      // 목차를 먼저 고친다: 파일 지우기가 실패해도 목록에서는 사라지고 다음에 켤 때 남은 파일을 치운다
      index = removeMeta(index, id);
      writeIndex();
      removeFile(id);
      return wasCurrent;
    },
  };
}
