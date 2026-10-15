import { createHash, createHmac } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { familyIds, lockAccount } from './accounts';
import { AdminAccess } from './admin-access';
import { AiAdmin, type SubscriptionInfo } from './ai-admin';
import {
  AI_GIFT,
  AI_MAX_OUTPUT_TOKENS,
  AI_REPORT_KEEP_DAYS,
  type AiChatRequest,
  costMicros,
  reserveMicros,
  seoulDay,
  systemPrompt,
  withPersona,
} from './ai-rules';
import { CONFIG } from './app.tokens';
import type { AuthInfo } from './auth.guard';
import type { AiConfig, Config } from './config';
import { Db } from './db';

// AI 대화권 (기획서 8절, 이슈 #100). 서버가 차감과 Claude 중계를 같이 한다. 앱은 API 키를 모른다.
// - 만 18세 이상이고 로그인한 세션만. 첫 로그인 계정에 10개를 한 번 준다 (로그인마다 HMAC 키를 ai_gift_seen 에, 탈퇴해도 남는다)
// - 차감(pending) → 중계(스트리밍) → 끝나면 ok, 실패(업스트림 오류, 끊김, 시간 넘김)하면 되돌림(refunded)
// - 대화 내용은 어디에도 저장하지 않는다. 사용량 숫자(토큰, 추정 비용)만 ai_usage 에. 기록에도 글을 남기지 않는다
// - 사람별 하루 상한, 서버 전체 월 추정 비용 상한 (넘으면 503 budget, 앱은 내 컴퓨터 AI 로 안내)

/** 답의 첫 글자가 이만큼 안 오면 그만두고 되돌린다 */
export const AI_FIRST_TEXT_MS = 30_000;
/** 답 전체 시간 상한 */
export const AI_TOTAL_MS = 120_000;
/** 답을 받는 중(pending)인 채 이만큼 지나면(서버가 중간에 죽음) 되돌린다 */
const PENDING_STALE_MIN = 10;
const SWEEP_MS = 10 * 60_000;
/** 신고는 계정마다 하루 이만큼 */
const REPORTS_PER_DAY = 20;
/** 월 상한을 세는 동안 다른 질문이 끼지 않게 잡는 잠금 번호 (아무 고정 수) */
const BUDGET_LOCK = 7_302_100;

export interface AiStatus {
  tickets: number;
  dailyLimit: number;
  usedToday: number;
  /** 운영자가 건 정기 지급 (없으면 null) */
  subscription: Pick<SubscriptionInfo, 'monthly' | 'mode' | 'nextFill'> | null;
}

interface Usage {
  input: number;
  output: number;
}

/** 스트리밍 응답에 쓰는 express 응답의 일부 */
export interface StreamRes {
  headersSent: boolean;
  writableEnded: boolean;
  status(code: number): StreamRes;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
  flushHeaders(): void;
  write(chunk: string): boolean;
  end(): unknown;
  on(event: 'close', listener: () => void): unknown;
}

const fail = (status: HttpStatus, body: Record<string, unknown>) => new HttpException(body, status);

/** 모델마다 다른 요청 칸. Haiku 5.5 (와 같은 5.x 줄): 생각 끄기, effort low */
export function requestShape(model: string): {
  thinking?: { type: 'disabled' };
  output_config?: { effort: 'low' };
} {
  return /^claude-haiku-5/.test(model)
    ? { thinking: { type: 'disabled' }, output_config: { effort: 'low' } }
    : {};
}

@Injectable()
export class Ai implements OnModuleInit, OnModuleDestroy {
  #client: Anthropic | undefined;
  #sweep: NodeJS.Timeout | undefined;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly db: Db,
    private readonly admin: AiAdmin,
    private readonly access: AdminAccess,
  ) {}

  private get ai(): AiConfig | undefined {
    return this.config.ai;
  }

  onModuleInit(): void {
    if (this.ai && !this.ai.giftKey)
      console.warn(
        '[ai] GIFT_HMAC_KEY 가 비어 첫 로그인 선물을 끈다 (대화는 된다, 하루 상한은 계정 번호로 센다)',
      );
    void this.sweep().catch((err) => console.warn('[ai] 정리 실패:', (err as Error).message));
    this.#sweep = setInterval(() => {
      void this.sweep().catch((err) => console.warn('[ai] 정리 실패:', (err as Error).message));
    }, SWEEP_MS);
    this.#sweep.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.#sweep);
  }

  private client(ai: AiConfig): Anthropic {
    // 재시도는 한 번만 (첫 연결 실패, 429, 5xx). 그 뒤는 실패로 보고 되돌린다
    this.#client ??= new Anthropic({
      apiKey: ai.apiKey,
      baseURL: ai.baseUrl,
      maxRetries: 1,
      timeout: AI_TOTAL_MS,
    });
    return this.#client;
  }

  /** 선물과 하루 수를 세는 키: HMAC-SHA256(GIFT_HMAC_KEY, '<서비스>:<sub>'). 비밀이 없으면 undefined */
  private loginKey(service: string, sub: string): Buffer | undefined {
    const key = this.ai?.giftKey;
    return key ? createHmac('sha256', key).update(`${service}:${sub}`).digest() : undefined;
  }

  /**
   * 하루 수를 세는 키 (계정의 첫 로그인). 탈퇴하고 같은 구글 계정으로 다시 가입해도 같은 키라 그날 수가 이어진다.
   * GIFT_HMAC_KEY 가 없으면 계정 번호로 센다
   */
  private async dailyKeys(c: PoolClient, accountId: string): Promise<Buffer[]> {
    const logins = await c.query<{ service: string; sub: string }>(
      'SELECT service, sub FROM login WHERE account_id = $1 ORDER BY service, sub',
      [accountId],
    );
    const keys = logins.rows.flatMap((r) => this.loginKey(r.service, r.sub) ?? []);
    if (keys.length > 0) return keys;
    // GIFT_HMAC_KEY 가 없는 개발, 시험 서버: 계정 번호로 센다. 합쳐진 계정 것도 더해 합치기로 하루 수가 초기화되지 않게
    // (첫 키가 남는 쪽이라 새 질문은 그 키에 센다. 운영은 GIFT_HMAC_KEY 가 없으면 뜨지 않는다, config.ts)
    const fam = await familyIds(c, accountId);
    return [accountId, ...fam.filter((id) => id !== accountId)].map((id) =>
      createHash('sha256').update(`account:${id}`).digest(),
    );
  }

  /**
   * 쓸 수 있는 계정인지 보고 계정을 잠근다. 세션(로그인) 토큰만, 만 18세 이상만.
   * 처음이면 선물 10개를 준다: 계정의 로그인 중 하나라도 ai_gift_seen 에 있으면(탈퇴한 옛 계정 것이어도) 주지 않는다.
   * GIFT_HMAC_KEY 가 없으면 선물만 끈다. 계정 행을 잠근 뒤라 같은 계정의 동시 요청도 한 번만 준다
   */
  private async gate(
    c: PoolClient,
    auth: AuthInfo,
  ): Promise<{ id: string; remaining: number; keys: Buffer[] }> {
    if (auth.via !== 'session') throw fail(HttpStatus.FORBIDDEN, { error: 'login' });
    const a = await lockAccount(c, auth.accountId);
    const age = (await c.query<{ age: string }>('SELECT age FROM account WHERE id = $1', [a.id])).rows[0]
      ?.age;
    if (age !== '18+') throw fail(HttpStatus.FORBIDDEN, { error: 'age' });
    const logins = await c.query<{ service: string; sub: string }>(
      'SELECT service, sub FROM login WHERE account_id = $1 ORDER BY service, sub',
      [a.id],
    );
    if (logins.rows.length === 0) throw fail(HttpStatus.FORBIDDEN, { error: 'login' });
    // 운영자 스위치 (#101): off 면 503 ai_off, allowlist 인데 목록에도 운영자 계정에도 없으면 403 not_allowed,
    // 이 계정만 막았으면 403 blocked. 허용되지 않은 계정은 첫 로그인 선물도 받지 않는다 (허용된 뒤 처음 물을 때 한 번)
    const mode = (await this.admin.settings(c)).mode;
    if (mode === 'off') throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: 'ai_off' });
    if (
      mode === 'allowlist' &&
      !(await this.admin.allowed(c, a.id)) &&
      !(await this.access.isAdminAccount(a.id))
    )
      throw fail(HttpStatus.FORBIDDEN, { error: 'not_allowed' });
    if (await this.admin.blocked(c, a.id)) throw fail(HttpStatus.FORBIDDEN, { error: 'blocked' });
    // 정책 (#101): 처음이면 "매달 100장까지 채우기" 를 저절로 건다. 자리가 차면 403 waitlisted (대기 목록)
    if ((await this.admin.ensureSeat(c, a.id, await this.access.isAdminAccount(a.id))) === 'waitlisted')
      throw fail(HttpStatus.FORBIDDEN, { error: 'waitlisted' });
    // 정기 지급의 이번 달 쪽지 (시간마다 도는 것보다 먼저 물었으면 여기서)
    await this.admin.fillAccount(c, a.id);
    const giftKeys = logins.rows.flatMap((r) => this.loginKey(r.service, r.sub) ?? []);
    let gift = 0;
    // 첫 로그인 선물은 운영자가 켰을 때만 (#101 정책, 기본 꺼짐)
    if (giftKeys.length > 0 && (await this.admin.settings(c)).firstGift) {
      const had = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM ai_gift_seen WHERE key_hmac = ANY($1)',
        [giftKeys],
      );
      if ((had.rows[0]?.n ?? 0) === 0) {
        // 처음 넣은 쪽만 선물 (다른 트랜잭션이 같은 키를 먼저 넣었으면 0줄)
        const ins = await c.query(
          'INSERT INTO ai_gift_seen (key_hmac) SELECT unnest($1::bytea[]) ON CONFLICT (key_hmac) DO NOTHING',
          [giftKeys],
        );
        if (ins.rowCount === giftKeys.length) gift = AI_GIFT;
      } else
        await c.query(
          'INSERT INTO ai_gift_seen (key_hmac) SELECT unnest($1::bytea[]) ON CONFLICT (key_hmac) DO NOTHING',
          [giftKeys],
        );
    }
    const r = await c.query<{ remaining: number }>(
      `INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET remaining = ai_ticket.remaining + EXCLUDED.remaining,
         updated_at = CASE WHEN EXCLUDED.remaining > 0 THEN now() ELSE ai_ticket.updated_at END
       RETURNING remaining`,
      [a.id, gift],
    );
    return { id: a.id, remaining: r.rows[0]?.remaining ?? 0, keys: await this.dailyKeys(c, a.id) };
  }

  /** 오늘(한국 날짜) 쓴 수: 계정의 로그인 키마다 센 수의 합 */
  private async usedToday(c: PoolClient, keys: Buffer[]): Promise<number> {
    const r = await c.query<{ n: number }>(
      'SELECT COALESCE(sum(used), 0)::int AS n FROM ai_daily WHERE key_hmac = ANY($1) AND day = $2',
      [keys, seoulDay()],
    );
    return r.rows[0]?.n ?? 0;
  }

  /** 남은 대화권과 오늘 쓴 수 (처음이면 선물도 여기서 받는다) */
  async status(auth: AuthInfo): Promise<AiStatus> {
    return this.waitlisted(auth, () => this.statusTx(auth));
  }

  /** 자리가 없어 거절되면 (트랜잭션이 되돌려진 뒤) 대기 목록에 넣는다 */
  private async waitlisted<T>(auth: AuthInfo, f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (err) {
      if (err instanceof HttpException && (err.getResponse() as { error?: unknown }).error === 'waitlisted')
        await this.admin.waitlistAdd(auth.accountId).catch(() => {});
      throw err;
    }
  }

  private async statusTx(auth: AuthInfo): Promise<AiStatus> {
    return this.db.tx(async (c) => {
      const g = await this.gate(c, auth);
      const sub = await this.admin.subscription(c, g.id);
      return {
        tickets: g.remaining,
        dailyLimit: (await this.admin.settings(c)).dailyLimit,
        usedToday: await this.usedToday(c, g.keys),
        subscription: sub ? { monthly: sub.monthly, mode: sub.mode, nextFill: sub.nextFill } : null,
      };
    });
  }

  /** 질문 하나를 시작한다: 검사 → 대화권 하나 빼기 → 사용량 줄(pending, 가장 큰 비용을 잡아 둠) */
  async begin(auth: AuthInfo, req: AiChatRequest): Promise<{ usageId: string; tickets: number }> {
    const ai = this.ai;
    if (!ai?.apiKey) throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: 'ai_off' });
    return this.waitlisted(auth, () => this.beginTx(ai, auth, req));
  }

  private async beginTx(
    ai: AiConfig,
    auth: AuthInfo,
    req: AiChatRequest,
  ): Promise<{ usageId: string; tickets: number }> {
    return this.db.tx(async (c) => {
      const g = await this.gate(c, auth);
      const limits = await this.admin.settings(c);
      if (g.remaining <= 0) throw fail(HttpStatus.CONFLICT, { error: 'no_tickets', tickets: 0 });
      if ((await this.usedToday(c, g.keys)) >= limits.dailyLimit)
        throw fail(HttpStatus.TOO_MANY_REQUESTS, { error: 'daily_limit', tickets: g.remaining });
      const reserve = reserveMicros(ai.model, req);
      await c.query('SELECT pg_advisory_xact_lock($1)', [BUDGET_LOCK]);
      const month = await c.query<{ total: string }>(
        `SELECT COALESCE(sum(cost_micros), 0) AS total FROM ai_usage
          WHERE created_at >= date_trunc('month', now(), 'UTC')`,
      );
      if (Number(month.rows[0]?.total ?? 0) + reserve > limits.monthlyBudgetMicros)
        throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: 'budget', tickets: g.remaining });
      const t = await c.query<{ remaining: number }>(
        'UPDATE ai_ticket SET remaining = remaining - 1, updated_at = now() WHERE account_id = $1 RETURNING remaining',
        [g.id],
      );
      await c.query(
        `INSERT INTO ai_daily (key_hmac, day, used) VALUES ($1, $2, 1)
         ON CONFLICT (key_hmac, day) DO UPDATE SET used = ai_daily.used + 1`,
        [g.keys[0], seoulDay()],
      );
      const u = await c.query<{ id: string }>(
        `INSERT INTO ai_usage (account_id, day, model, status, cost_micros)
         VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
        [g.id, seoulDay(), ai.model, reserve],
      );
      return { usageId: u.rows[0]?.id as string, tickets: t.rows[0]?.remaining ?? 0 };
    });
  }

  /** 답을 다 받았다: 실제 토큰과 비용을 적는다 */
  async finish(usageId: string, usage: Usage): Promise<void> {
    const model = this.ai?.model ?? '';
    await this.db.pool.query(
      `UPDATE ai_usage SET status = 'ok', input_tokens = $2, output_tokens = $3, cost_micros = $4, finished_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [usageId, usage.input, usage.output, costMicros(model, usage.input, usage.output)],
    );
  }

  /**
   * 실패: 대화권과 그날 수를 돌려준다. 실제로 쓴 토큰이 있으면 비용은 남긴다(월 상한에 센다).
   * usage 를 모르면(서버가 중간에 죽어 정리 때) 잡아 둔 예약금을 비용으로 그대로 남긴다.
   * 그사이 합쳐졌으면 남는 쪽에, 탈퇴했으면(계정 번호가 비었다) 돌려줄 곳이 없다. 돌려준 뒤 남은 수
   */
  async refund(usageId: string, usage?: Usage): Promise<number | undefined> {
    const model = this.ai?.model ?? '';
    return this.db.tx(async (c) => {
      const r = await c.query<{ account_id: string | null; day: string }>(
        `UPDATE ai_usage SET status = 'refunded', input_tokens = $2, output_tokens = $3,
                cost_micros = COALESCE($4, cost_micros), finished_at = now()
          WHERE id = $1 AND status = 'pending' RETURNING account_id, to_char(day, 'YYYY-MM-DD') AS day`,
        [
          usageId,
          usage?.input ?? 0,
          usage?.output ?? 0,
          usage ? costMicros(model, usage.input, usage.output) : null,
        ],
      );
      const row = r.rows[0];
      if (!row?.account_id) return undefined;
      const a = await lockAccount(c, row.account_id).catch(() => undefined);
      if (!a) return undefined;
      // 하루 사용 수는 되돌리지 않는다 (버그잡이 #113): 실패도 업스트림을 부른 것이라 하루 상한이 막아야 한다
      const t = await c.query<{ remaining: number }>(
        `INSERT INTO ai_ticket (account_id, remaining) VALUES ($1, 1)
         ON CONFLICT (account_id) DO UPDATE SET remaining = ai_ticket.remaining + 1, updated_at = now()
         RETURNING remaining`,
        [a.id],
      );
      return t.rows[0]?.remaining;
    });
  }

  /**
   * 질문 하나를 Claude 에 중계한다 (Server-Sent Events).
   *   event: text  data: {"text": "..."}     (답 조각, 여러 번)
   *   event: done  data: {"tickets": n, "stop": "end_turn"}
   *   event: error data: {"error": "upstream" | "timeout", "tickets": n, "refunded": true}
   * 첫 조각 전에 실패하면 SSE 대신 502 upstream / 504 timeout JSON. 앱이 연결을 끊으면 업스트림도 멈추고,
   * 그때까지 받은 글이 없으면 되돌린다(받은 글이 있으면 쓴 것으로 센다)
   */
  async relay(auth: AuthInfo, req: AiChatRequest, res: StreamRes): Promise<void> {
    const ai = this.ai;
    if (!ai?.apiKey) throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: 'ai_off' });
    const started = await this.begin(auth, req);
    const ac = new AbortController();
    let why: 'timeout' | 'client' | undefined;
    const stop = (w: 'timeout' | 'client') => {
      why ??= w;
      ac.abort();
    };
    const firstTimer = setTimeout(() => stop('timeout'), ai.firstTextMs ?? AI_FIRST_TEXT_MS);
    const totalTimer = setTimeout(() => stop('timeout'), ai.totalMs ?? AI_TOTAL_MS);
    res.on('close', () => {
      if (!res.writableEnded) stop('client');
    });
    const send = (event: string, data: unknown) => {
      if (!res.headersSent) {
        res.status(200);
        res.setHeader('content-type', 'text/event-stream; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-accel-buffering', 'no');
        res.flushHeaders();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const usage: Usage = { input: 0, output: 0 };
    let delivered = false;
    try {
      const stream = this.client(ai).messages.stream(
        {
          model: ai.model,
          max_tokens: AI_MAX_OUTPUT_TOKENS,
          // Haiku 5.5 는 생각이 기본으로 켜지고(adaptive) 그 토큰도 max_tokens 에 든다. 짧은 채팅이라 끄고 effort low
          // (disabled 는 effort high 이하에서만 받는다). 샘플링 값(temperature 등)은 보내지 않는다 (기본값 아니면 400)
          ...requestShape(ai.model),
          // system 은 서버 고정 문구만. 앱이 보낸 말투는 첫 사용자 차례 앞의 참고 자료 블록으로
          system: systemPrompt(req.lang),
          messages: withPersona(req.messages, req.lang, req.persona),
        },
        { signal: ac.signal },
      );
      for await (const ev of stream) {
        if (ev.type === 'message_start') {
          usage.input = ev.message.usage.input_tokens;
          usage.output = ev.message.usage.output_tokens;
        } else if (ev.type === 'message_delta') {
          usage.output = ev.usage.output_tokens;
          if (typeof ev.usage.input_tokens === 'number') usage.input = ev.usage.input_tokens;
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
          clearTimeout(firstTimer);
          delivered = true;
          send('text', { text: ev.delta.text });
        }
      }
      const final = await stream.finalMessage();
      usage.input = final.usage.input_tokens;
      usage.output = final.usage.output_tokens;
      if (why) throw new Error(why);
      // 안전 분류기 거절 (Haiku 5.5 는 서버 폴백이 없다): 이용권을 되돌리고 앱이 안내한다. 쓴 토큰 비용은 남긴다
      if (final.stop_reason === 'refusal') {
        const tickets = await this.refund(started.usageId, usage).catch(() => undefined);
        console.warn('[ai] 거절됨 (되돌림)');
        send('error', { error: 'refusal', tickets: tickets ?? started.tickets + 1, refunded: true });
        res.end();
        return;
      }
      // max_tokens 로 끊긴 답은 받은 데까지 보여 주고 차감은 그대로
      await this.finish(started.usageId, usage);
      send('done', { tickets: started.tickets, stop: final.stop_reason ?? 'end_turn' });
      res.end();
    } catch (err) {
      const kept = why === 'client' && delivered;
      const tickets = kept ? undefined : await this.refund(started.usageId, usage).catch(() => undefined);
      if (kept) await this.finish(started.usageId, usage).catch(() => {});
      // 글은 남기지 않는다: 까닭의 종류와 상태 번호만
      console.warn(
        '[ai] 중계 실패:',
        why ?? (err instanceof Anthropic.APIError ? `api ${err.status ?? 'connection'}` : 'stream'),
        kept ? '(받은 글이 있어 차감 유지)' : '(되돌림)',
      );
      if (why === 'client') return;
      const error = why === 'timeout' ? 'timeout' : 'upstream';
      const body = { error, tickets: tickets ?? started.tickets + 1, refunded: true };
      if (!res.headersSent) res.status(error === 'timeout' ? 504 : 502).json(body);
      else {
        send('error', body);
        res.end();
      }
    } finally {
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
    }
  }

  /** 신고: 사용자가 따로 동의한 대화 하나만 30일 둔다 (8절, 13절) */
  async report(auth: AuthInfo, r: { question: string; answer: string }): Promise<void> {
    await this.db.tx(async (c) => {
      const g = await this.gate(c, auth);
      const n = await c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM ai_report WHERE account_id = $1 AND created_at > now() - interval '1 day'",
        [g.id],
      );
      if ((n.rows[0]?.n ?? 0) >= REPORTS_PER_DAY)
        throw fail(HttpStatus.TOO_MANY_REQUESTS, { error: 'rate_limited' });
      await c.query('INSERT INTO ai_report (account_id, question, answer) VALUES ($1, $2, $3)', [
        g.id,
        r.question,
        r.answer,
      ]);
    });
  }

  /** 정리: 오래 걸린 pending 은 되돌리고(서버가 중간에 죽음), 30일 지난 신고는 지운다 */
  async sweep(): Promise<void> {
    const stale = await this.db.pool.query<{ id: string }>(
      `SELECT id FROM ai_usage WHERE status = 'pending' AND created_at < now() - interval '${PENDING_STALE_MIN} minutes'
        ORDER BY id LIMIT 500`,
    );
    for (const row of stale.rows) await this.refund(row.id);
    await this.db.pool.query('DELETE FROM ai_gift_seen WHERE expires_at < now()');
    await this.db.pool.query("DELETE FROM ai_daily WHERE day < (now() AT TIME ZONE 'Asia/Seoul')::date - 2");
    await this.db.pool.query(
      `DELETE FROM ai_report WHERE created_at < now() - interval '${AI_REPORT_KEEP_DAYS} days'`,
    );
  }
}
