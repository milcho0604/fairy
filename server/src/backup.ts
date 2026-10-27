import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { lockAccount } from './accounts';
import { CLOCK, CONFIG } from './app.tokens';
import type { BackupConfig, Config } from './config';
import { Db } from './db';

// 서버 백업 (기획서 7, 13절, 5단계, 이슈 #102).
// - 사용자가 누를 때만 올린다. 로그인(세션)한 사람만, 별도 동의(consent)를 받은 요청만.
// - 형식은 개인 백업 파일(.fairybackup, zip) 그대로. 서버는 zip 머리만 보고 풀지 않는다.
// - 파일 하나 최대 20MB. 본문은 흘려 받아(스트리밍) 바로 암호화해 디스크에 쓴다. 메모리에 통째로 올리지 않는다.
// - 디스크에는 AES-256-GCM 으로 암호화해 둔다 (키 BACKUP_ENC_KEY). 키가 없으면 백업 경로만 503 backup_off.
//   파일 모양: "FBK1"(4) + iv(12) + 암호문 + tag(16). AAD 는 파일 이름이라 파일을 바꿔 끼우면 풀리지 않는다.
// - DB(backup 표)에는 메타만: 계정, 크기, sha256, 만든 때, 마지막으로 올리거나 받은 때.
// - 계정마다 최근 2개. 새로 올리면 가장 오래된 것을 지운다 (계정 잠금 안의 트랜잭션).
// - 마지막으로 올리거나 받은 뒤 1년이 지나면 지운다. 30일 전부터 목록에 soon 을 붙여 앱이 "곧 지워짐"을 보인다.
//   TODO(#101): 쪽지함(inbox)이 생기면 30일 전 알림을 쪽지로도 보낸다.
// - 탈퇴하면 줄과 파일을 바로 지운다. 합치면 남는 쪽으로 옮기고 두 계정 것 중 최근 2개만 남긴다 (21절).
// - 코인은 백업에서 되살리지 않는다: 앱이 되살린 뒤 서버 정본으로 맞춘다 (7절).

export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
/** 올리는 중 바이트가 이만큼 오지 않으면 끊는다 */
export const BACKUP_STALL_MS = 60_000;
export const BACKUP_KEEP = 2;
export const BACKUP_IDLE_DAYS = 365;
export const BACKUP_NOTICE_DAYS = 30;
const DAY_MS = 86_400_000;
const MAGIC = Buffer.from('FBK1');
const IV_LEN = 12;
const TAG_LEN = 16;
const HEAD_LEN = MAGIC.length + IV_LEN;
/** zip 파일 머리 (PK\x03\x04) */
const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** 상한을 넘은 본문은 이만큼까지만 버리며 읽어 413 을 돌려준다. 그보다 크면 연결을 끊는다 */
const DRAIN_MAX = 2 * BACKUP_MAX_BYTES;
/** 줄 없는 파일, 쓰다 만 파일을 지우기 전에 기다리는 시간 (올리는 중인 파일을 지우지 않게) */
const ORPHAN_GRACE_MS = 10 * 60_000;
const SWEEP_MS = 60 * 60_000;
const FILE = /^[0-9a-f]{32}$/;

export interface BackupItem {
  id: number;
  size: number;
  sha256: string;
  createdAt: string;
  lastAccessAt: string;
  /** 이때 지운다 (마지막으로 올리거나 받은 때 + 1년) */
  expiresAt: string;
  /** 30일 안에 지워진다 */
  soon: boolean;
}

interface Row {
  id: string;
  file: string;
  size: number;
  sha256: Buffer;
  created_at: Date;
  last_access_at: Date;
  /** 계정 활동 (account.last_active_at). 지우는 기준 */
  active_at: Date;
}

/** 줄을 읽을 때 같이 읽는 칸 (계정 활동 포함) */
const COLS = `b.id, b.file, b.size, b.sha256, b.created_at, b.last_access_at,
  (SELECT last_active_at FROM account WHERE id = b.account_id) AS active_at`;

/** 올리는 본문: 크기를 세고, sha256 을 내고, 앞 4바이트가 zip 인지 본다. 상한을 넘으면 더 넘기지 않고 버린다 */
class Meter extends Transform {
  size = 0;
  over = false;
  bad = false;
  readonly hash = createHash('sha256');
  #head = Buffer.alloc(0);

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > DRAIN_MAX) {
      cb(new Error('too_big_drop'));
      return;
    }
    if (!this.over && !this.bad && this.size > BACKUP_MAX_BYTES) this.over = true;
    if (!this.over && !this.bad && this.#head.length < ZIP_HEAD.length) {
      this.#head = Buffer.concat([this.#head, chunk]).subarray(0, ZIP_HEAD.length);
      if (!ZIP_HEAD.subarray(0, this.#head.length).equals(this.#head)) this.bad = true;
    }
    if (this.over || this.bad) {
      cb();
      return;
    }
    this.hash.update(chunk);
    cb(null, chunk);
  }
}

const fail = (status: HttpStatus, error: string) => new HttpException({ error }, status);

/** express 요청의 일부 (본문 스트림과 머리) */
export type UploadReq = NodeJS.ReadableStream & {
  headers: Record<string, string | string[] | undefined>;
  destroy(): void;
};

@Injectable()
export class Backups implements OnModuleInit, OnModuleDestroy {
  #sweep: NodeJS.Timeout | undefined;
  private readonly clock: () => number;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly db: Db,
    @Optional() @Inject(CLOCK) clock?: () => number,
  ) {
    this.clock = clock ?? Date.now;
  }

  private get cfg(): BackupConfig | undefined {
    return this.config.backup;
  }

  /** 키가 있다 (백업 경로를 연다) */
  get enabled(): boolean {
    return !!this.cfg?.key && !!this.cfg.dir;
  }

  private key(): Buffer {
    const k = this.cfg?.key;
    if (!k || !this.cfg?.dir) throw fail(HttpStatus.SERVICE_UNAVAILABLE, 'backup_off');
    return k;
  }

  private path(file: string): string {
    return join(this.cfg?.dir ?? '', `${file}.fbk`);
  }

  onModuleInit(): void {
    if (!this.cfg?.key) console.warn('[backup] BACKUP_ENC_KEY 가 비어 서버 백업을 끈다 (503 backup_off)');
    const run = () =>
      void this.sweep().catch((err) => console.warn('[backup] 정리 실패:', (err as Error).message));
    run();
    this.#sweep = setInterval(run, SWEEP_MS);
    this.#sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }

  private item(r: Row): BackupItem {
    const expires = r.active_at.getTime() + BACKUP_IDLE_DAYS * DAY_MS;
    return {
      id: Number(r.id),
      size: r.size,
      sha256: r.sha256.toString('hex'),
      createdAt: r.created_at.toISOString(),
      lastAccessAt: r.last_access_at.toISOString(),
      expiresAt: new Date(expires).toISOString(),
      soon: expires - this.clock() <= BACKUP_NOTICE_DAYS * DAY_MS,
    };
  }

  /**
   * 목록 (새것부터). 지우는 때(expiresAt)는 계정 활동 + 1년이다. 토큰을 든 요청이 오면 활동이 하루 한 번 고쳐지므로,
   * "곧 지워짐"은 앱을 오래 켜지 않은 계정에서만 서버 기록에 남는다 (TODO(#101): 쪽지함 알림)
   */
  async list(accountId: string): Promise<BackupItem[]> {
    this.key();
    const r = await this.db.pool.query<Row>(
      `SELECT ${COLS} FROM backup b WHERE b.account_id = $1 ORDER BY b.created_at DESC, b.id DESC`,
      [accountId],
    );
    return r.rows.map((x) => this.item(x));
  }

  /**
   * 올리기. 본문을 흘려 받아 암호화해 임시 파일에 쓰고, 다 받으면 이름을 바꾸고 줄을 넣는다.
   * 그다음 계정 잠금 안에서 최근 2개만 남기고 나머지 줄을 지운 뒤, 트랜잭션이 끝나면 그 파일을 지운다
   */
  async upload(accountId: string, req: UploadReq): Promise<BackupItem> {
    const key = this.key();
    const dir = this.cfg?.dir as string;
    const len = Number(req.headers['content-length'] ?? '');
    if (Number.isFinite(len) && len > BACKUP_MAX_BYTES) throw fail(HttpStatus.PAYLOAD_TOO_LARGE, 'too_big');
    // 서버 전체 상한: 이미 찼으면 받지 않는다 (정확한 검사는 아래 트랜잭션에서 한 번 더)
    if ((await this.totalBytes(this.db.pool)) >= this.totalMax)
      throw fail(HttpStatus.INSUFFICIENT_STORAGE, 'storage_full');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = randomBytes(16).toString('hex');
    const part = join(dir, `${file}.part`);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`fairy-backup:${file}`));
    const meter = new Meter();
    const out = createWriteStream(part, { mode: 0o600 });
    out.write(Buffer.concat([MAGIC, iv]));
    // 바이트가 이만큼 멈추면 끊는다 (느린 회선은 기다리되 멈춘 연결은 잡아 두지 않는다)
    const stallMs = this.cfg?.stallMs ?? BACKUP_STALL_MS;
    let stalled = false;
    const cut = () => {
      stalled = true;
      req.destroy();
    };
    let stall = setTimeout(cut, stallMs);
    const bump = () => {
      clearTimeout(stall);
      stall = setTimeout(cut, stallMs);
    };
    req.on('data', bump);
    try {
      try {
        await pipeline(req, meter, cipher, out);
      } catch (err) {
        // 멈춰서 끊었다 (연결이 닫혀 이 답은 가지 않는다. 기록만 조용히)
        if (stalled) throw fail(HttpStatus.REQUEST_TIMEOUT, 'stalled');
        if ((err as Error).message === 'too_big_drop') {
          // 아주 큰 본문: 더 읽지 않고 끊는다
          req.destroy();
          throw fail(HttpStatus.PAYLOAD_TOO_LARGE, 'too_big');
        }
        throw err;
      }
      if (meter.over) throw fail(HttpStatus.PAYLOAD_TOO_LARGE, 'too_big');
      if (meter.size === 0) throw fail(HttpStatus.BAD_REQUEST, 'empty');
      if (meter.bad || meter.size < ZIP_HEAD.length) throw fail(HttpStatus.BAD_REQUEST, 'format');
      await appendFile(part, cipher.getAuthTag());
      await rename(part, this.path(file));
    } catch (err) {
      await unlink(part).catch(() => {});
      throw err;
    } finally {
      clearTimeout(stall);
    }
    const sha = meter.hash.digest();
    let drop: string[] = [];
    let row: Row | undefined;
    try {
      const r = await this.db.tx(async (c) => {
        // 계정별 잠금만으로는 전체 저장 한도를 지킬 수 없다: 다른 계정의 업로드는 서로의 미커밋 줄을
        // totalBytes 에서 보지 못하고 함께 통과할 수 있다. 최종 합계 검사부터 커밋까지 전역으로 직렬화한다.
        await c.query('SELECT pg_advisory_xact_lock($1, $2)', [0x46414952, 0x4241434b]);
        const a = await lockAccount(c, accountId);
        const ins = await c.query<Row>(
          `INSERT INTO backup (account_id, file, size, sha256, created_at, last_access_at)
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
          [a.id, file, meter.size, sha, new Date(this.clock())],
        );
        const drop = await keepRecent(c, a.id);
        // 이 계정의 가장 오래된 것을 지운 뒤에도 서버 전체가 상한을 넘으면 되돌린다
        if ((await this.totalBytes(c)) > this.totalMax)
          throw fail(HttpStatus.INSUFFICIENT_STORAGE, 'storage_full');
        const got = await c.query<Row>(`SELECT ${COLS} FROM backup b WHERE b.id = $1`, [ins.rows[0]?.id]);
        return { row: got.rows[0], drop };
      });
      row = r.row;
      drop = r.drop;
    } catch (err) {
      await unlink(this.path(file)).catch(() => {});
      throw err;
    }
    await this.removeFiles(drop);
    if (!row) throw new Error('백업 줄을 못 넣었다');
    return this.item(row);
  }

  /**
   * 받기: 그 계정의 백업 하나를 풀며 흘려 보낸다. tag 검사는 끝에서야 되므로, 틀리면 응답을 끊는다
   * (앱은 받은 크기와 sha256 을 목록 값과 맞춰 본다). 받으면 마지막 쓴 때를 고친다
   */
  async download(
    accountId: string,
    id: unknown,
    res: {
      setHeader(name: string, value: string): unknown;
      status(code: number): unknown;
      destroy(err?: Error): unknown;
    } & NodeJS.WritableStream,
  ): Promise<void> {
    const key = this.key();
    const row = await this.find(accountId, id);
    const path = this.path(row.file);
    let total: number;
    let tag: Buffer;
    let iv: Buffer;
    try {
      total = (await stat(path)).size;
      if (total < HEAD_LEN + TAG_LEN) throw new Error('짧다');
      const fh = await open(path, 'r');
      try {
        const head = Buffer.alloc(HEAD_LEN);
        await fh.read(head, 0, HEAD_LEN, 0);
        if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('머리');
        iv = head.subarray(MAGIC.length);
        tag = Buffer.alloc(TAG_LEN);
        await fh.read(tag, 0, TAG_LEN, total - TAG_LEN);
      } finally {
        await fh.close();
      }
    } catch (err) {
      console.warn('[backup] 백업 파일을 못 읽음:', row.id, (err as Error).message);
      throw fail(HttpStatus.NOT_FOUND, 'not_found');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`fairy-backup:${row.file}`));
    decipher.setAuthTag(tag);
    await this.db.pool.query('UPDATE backup SET last_access_at = $2 WHERE id = $1', [
      row.id,
      new Date(this.clock()),
    ]);
    res.status(200);
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', String(row.size));
    res.setHeader('x-backup-sha256', row.sha256.toString('hex'));
    res.setHeader('cache-control', 'no-store');
    try {
      await pipeline(createReadStream(path, { start: HEAD_LEN, end: total - TAG_LEN - 1 }), decipher, res);
    } catch (err) {
      console.warn('[backup] 백업 보내기 실패:', row.id, (err as Error).message);
      res.destroy();
    }
  }

  async remove(accountId: string, id: unknown): Promise<void> {
    this.key();
    const row = await this.find(accountId, id);
    await this.db.pool.query('DELETE FROM backup WHERE id = $1', [row.id]);
    await this.removeFiles([row.file]);
  }

  private async find(accountId: string, id: unknown): Promise<Row> {
    if (typeof id !== 'string' || !/^\d{1,18}$/.test(id)) throw fail(HttpStatus.NOT_FOUND, 'not_found');
    const r = await this.db.pool.query<Row>(
      `SELECT ${COLS} FROM backup b WHERE b.id = $1 AND b.account_id = $2`,
      [id, accountId],
    );
    const row = r.rows[0];
    if (!row) throw fail(HttpStatus.NOT_FOUND, 'not_found');
    return row;
  }

  /** 줄을 지운 백업 파일을 지운다 (못 지우면 정리 작업이 줄 없는 파일로 다시 지운다) */
  async removeFiles(files: readonly string[]): Promise<void> {
    if (!this.cfg?.dir) return;
    for (const f of files) {
      if (!FILE.test(f)) continue;
      await unlink(this.path(f)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') console.warn('[backup] 파일 못 지움:', err.code);
      });
    }
  }

  /** 서버 전체 백업 크기 상한 (BACKUP_TOTAL_MAX_GB) */
  private get totalMax(): number {
    return this.cfg?.totalMaxBytes ?? Number.POSITIVE_INFINITY;
  }

  private async totalBytes(c: { query: Db['pool']['query'] } | PoolClient): Promise<number> {
    const r = await (c as PoolClient).query<{ n: string }>('SELECT COALESCE(sum(size), 0) AS n FROM backup');
    return Number(r.rows[0]?.n ?? 0);
  }

  /**
   * 정리: 계정 활동(토큰을 든 요청)이 1년 동안 없으면 그 계정의 서버 백업을 지우고,
   * 줄 없는 파일과 쓰다 만 파일(10분 넘음)을 지운다. 시험은 now 를 넘겨 1년 뒤를 흉내 낸다
   */
  async sweep(now = this.clock()): Promise<{ expired: number; orphans: number }> {
    const old = await this.db.pool.query<{ file: string }>(
      `DELETE FROM backup b USING account a
        WHERE a.id = b.account_id AND a.last_active_at < $1 RETURNING b.file`,
      [new Date(now - BACKUP_IDLE_DAYS * DAY_MS)],
    );
    await this.removeFiles(old.rows.map((r) => r.file));
    return { expired: old.rowCount ?? 0, orphans: await this.sweepOrphans(now) };
  }

  /** 줄 없는 파일 지우기 (합치기로 줄이 빠진 파일도 여기서 지운다) */
  async sweepOrphans(now = this.clock()): Promise<number> {
    const dir = this.cfg?.dir;
    if (!dir) return 0;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return 0;
    }
    const known = new Set(
      (await this.db.pool.query<{ file: string }>('SELECT file FROM backup')).rows.map((r) => r.file),
    );
    let n = 0;
    for (const name of names) {
      const m = /^([0-9a-f]{32})\.(fbk|part)$/.exec(name);
      if (!m || (m[2] === 'fbk' && known.has(m[1] as string))) continue;
      try {
        const st = await stat(join(dir, name));
        if (now - st.mtimeMs < ORPHAN_GRACE_MS) continue;
        await unlink(join(dir, name));
        n++;
      } catch {}
    }
    return n;
  }
}

/** 계정의 백업 중 최근 BACKUP_KEEP 개만 남기고 줄을 지운다. 지운 파일 이름을 돌려준다 (계정이 잠긴 트랜잭션에서) */
export async function keepRecent(c: PoolClient, accountId: string): Promise<string[]> {
  const r = await c.query<{ file: string }>(
    `DELETE FROM backup WHERE id IN (
       SELECT id FROM backup WHERE account_id = $1 ORDER BY created_at DESC, id DESC OFFSET $2
     ) RETURNING file`,
    [accountId, BACKUP_KEEP],
  );
  return r.rows.map((x) => x.file);
}

/** 계정(과 이 계정에 합쳐진 닫힌 계정)의 백업 파일 이름 (탈퇴 때 줄이 지워지기 전에 읽는다) */
export async function backupFilesOf(c: PoolClient, accountId: string): Promise<string[]> {
  const r = await c.query<{ file: string }>(
    `SELECT file FROM backup WHERE account_id = $1
        OR account_id IN (SELECT id FROM account WHERE merged_into = $1)`,
    [accountId],
  );
  return r.rows.map((x) => x.file);
}
