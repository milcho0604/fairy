// 서버 코인 맞추기의 앱 쪽 장부 (기획서 6절, 이슈 #99). Electron 없이 돌아 시험에서 그대로 부른다.
// - 코인 장부(coin_log)에 새로 생긴 줄을 읽어 대기열에 쌓는다. 기록 번호는 "대기열 소금 + 장부 줄 번호" 라
//   같은 줄을 두 번 읽어도 번호가 같다 (서버가 한 번만 반영한다). 소금은 무작위이고 백업을 되살리면 새로 만든다.
// - 펫 MCP 서버(다른 프로세스)가 쓴 줄도 같은 장부라 같이 읽힌다.
// - 서버가 대답하면 사본 잔액을 "서버 잔액 + 아직 안 보낸 기록" 으로 맞춘다. 차이는 'server-sync' 한 줄로 적는다
//   (장부를 지우지 않는다. 하루 상한과 기록이 장부를 센다). 산 물건도 "서버 물건 + 아직 안 보낸 구매" 로 맞춰,
//   서버가 거절한 구매는 물건이 빠지고 코인은 돌아온다.
import { createHash, randomBytes } from 'node:crypto';
import { spendRule } from '../shared/coin-rules.ts';
import type { Db } from '../shared/db-schema.ts';
import type { Items } from '../shared/server-account.ts';
import { type ItemStore, RESET_ITEMS } from '../shared/shop.ts';
import type { TodoStore } from '../shared/todo-store.ts';

/** 맞추기로 적는 줄의 까닭. 서버로 보내지 않는다 */
export const SYNC_REASON = 'server-sync';
/** 할 일에 딸린 기록 (서버가 하루 할 일 상한을 서로 다른 ref 수로 센다) */
const REF_REASONS = new Set(['todo', 'early', 'undo']);

export interface QueueEntry {
  /** 서버로 보내는 기록 번호 (8~64자 [A-Za-z0-9_-]) */
  id: string;
  /** coin_log.id */
  logId: number;
  reason: string;
  amount: number;
  /** 현지 날짜 YYYY-MM-DD */
  day: string;
  /** 장부에 적은 때 (커스텀 먹이 이름표를 찾는다) */
  at: number;
  /** 할 일 번호의 지문 (원래 번호는 보내지 않는다) */
  ref?: string;
}

/** 대기열 상태 (server-state.json 에 같이 둔다) */
export interface CoinQueue {
  /** 기록 번호 앞머리. 백업을 되살리면 바꾼다 */
  salt: string;
  /** 할 일 번호 지문의 소금 (설치마다 다르고 바꾸지 않는다) */
  refSalt: string;
  /** 대기열에 넣은 마지막 장부 줄 번호 */
  scanned: number;
  queue: QueueEntry[];
}

export const newSalt = (): string => randomBytes(9).toString('base64url');

export function emptyQueue(): CoinQueue {
  return { salt: newSalt(), refSalt: newSalt(), scanned: 0, queue: [] };
}

/** 할 일 번호의 지문: sha256(소금 + 번호) 앞 16자 */
export const refOf = (refSalt: string, refId: number): string =>
  createHash('sha256').update(`${refSalt}:${refId}`).digest('hex').slice(0, 16);

interface LogRow {
  id: number;
  amount: number;
  reason: string;
  ref_id: number | null;
  day: string;
  at: number;
}

/** 거절된 구매로 되돌린 것 (펫이 알린다) */
export interface Reverted {
  reason: string;
  amount: number;
}

export class ServerCoins {
  #db: Db;
  #todos: TodoStore;
  #shop: ItemStore;
  #day: (ms: number) => string;

  constructor(db: Db, todos: TodoStore, shop: ItemStore, day: (ms: number) => string) {
    this.#db = db;
    this.#todos = todos;
    this.#shop = shop;
    this.#day = day;
  }

  maxLogId(): number {
    return Number(
      (this.#db.prepare('select coalesce(max(id), 0) as m from coin_log').get() as { m: number }).m,
    );
  }

  /**
   * 새 장부 줄을 대기열에 넣는다. 넣은 수를 돌려준다.
   * 장부의 마지막 줄 번호가 읽은 곳보다 작으면 저장 파일이 바뀐 것(백업 되살리기, 깨진 파일)이라 새로 시작한다
   */
  scan(q: CoinQueue): number {
    const max = this.maxLogId();
    if (max < q.scanned) this.restart(q);
    const rows = this.#db
      .prepare('select id, amount, reason, ref_id, day, at from coin_log where id > ? order by id')
      .all(q.scanned) as LogRow[];
    let added = 0;
    for (const r of rows) {
      q.scanned = Math.max(q.scanned, Number(r.id));
      if (r.reason === SYNC_REASON || (Number(r.amount) === 0 && r.reason !== RESET_ITEMS)) continue;
      q.queue.push({
        id: `${q.salt}-${r.id}`,
        logId: Number(r.id),
        reason: r.reason,
        amount: Number(r.amount),
        day: r.day,
        at: Number(r.at),
        ...(REF_REASONS.has(r.reason) && r.ref_id !== null
          ? { ref: refOf(q.refSalt, Number(r.ref_id)) }
          : {}),
      });
      added++;
    }
    return added;
  }

  /**
   * 저장 파일이 바뀌었다 (백업 되살리기): 지금 장부 줄은 이미 반영된 것으로 보고 새 소금으로 이어 간다.
   * 대기열에 남은 기록은 번호가 그대로라 그대로 보낸다
   */
  restart(q: CoinQueue): void {
    q.salt = newSalt();
    q.scanned = this.maxLogId();
  }

  /** 기존 잔액 옮기기에 올릴 것: 잔액, 산 물건, 그때까지의 장부 줄 번호 (한 시점) */
  snapshot(): { balance: number; items: Items; maxId: number } {
    this.#db.exec('begin');
    try {
      const out = {
        balance: Math.max(0, this.#todos.balance()),
        items: this.#shop.ownedItems(),
        maxId: this.maxLogId(),
      };
      this.#db.exec('commit');
      return out;
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
  }

  /**
   * 서버 정본에 맞춘다. 먼저 새 장부 줄을 대기열에 넣고(같은 묶음 안이라 다른 프로세스가 끼지 못한다)
   * 잔액 = 서버 잔액 + 대기열 합(0 밑으로는 안 간다), 물건 = 서버 물건 + 대기열의 구매.
   * rejected: 이번에 서버가 거절한 구매 (커스텀 먹이는 만든 먹이를 지운다). 바뀐 잔액 차이를 돌려준다
   */
  reconcile(
    q: CoinQueue,
    server: { balance: number; items: Items },
    rejected: readonly QueueEntry[],
    now: number,
    /** 서버 사본이 아직 없다 (처음 맞추기): 서버 대답만으로 로컬 물건을 빼지 않는다 */
    keepLocalItems = false,
  ): { delta: number; itemsChanged: boolean } {
    this.#db.exec('begin immediate');
    try {
      this.scan(q);
      const pending = q.queue.reduce((s, e) => s + e.amount, 0);
      const target = Math.max(0, server.balance + pending);
      const delta = target - this.#todos.balance();
      if (delta !== 0) {
        const r = this.#db
          .prepare('insert into coin_log (amount, reason, ref_id, day, at) values (?, ?, null, ?, ?)')
          .run(delta, SYNC_REASON, this.#day(now), now);
        q.scanned = Math.max(q.scanned, Number(r.lastInsertRowid));
      }
      let items = withPending(server.items, q.queue);
      if (keepLocalItems) items = mergeItems(this.#shop.ownedItems(), items);
      const itemsChanged = this.#shop.setOwnedItems(items, now);
      for (const e of rejected)
        if (e.reason === 'custom-food')
          this.#db
            .prepare(`delete from item where kind = 'food' and key = ?`)
            .run(`custom-${e.at.toString(36)}`);
      this.#db.exec('commit');
      return { delta, itemsChanged };
    } catch (err) {
      this.#db.exec('rollback');
      throw err;
    }
  }
}

/** 둘을 합친다 (이름마다 큰 쪽) */
export function mergeItems(a: Items, b: Items): Items {
  const out: Items = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, n);
  return out;
}

/** 서버 물건에 아직 안 보낸 구매를 더한다 (집은 큰 단계). 안 보낸 물건 초기화가 있으면 그 앞은 비운다 */
export function withPending(server: Items, queue: readonly QueueEntry[]): Items {
  let out: Items = { ...server };
  for (const e of queue) {
    if (e.reason === RESET_ITEMS) {
      out = {};
      continue;
    }
    const rule = spendRule(e.reason);
    if (rule?.kind !== 'buy') continue;
    const count = rule.level ?? 1;
    out[rule.item] = Math.max(out[rule.item] ?? 0, count);
  }
  return out;
}

/** 서버가 거절해 앱이 되돌리는 쓰기인지 (잔액 모자람, 이미 가짐, 값이 다름) */
export const revertable = (reason: string): boolean => {
  const rule = spendRule(reason);
  return rule !== undefined && rule.kind !== 'takeBack';
};
