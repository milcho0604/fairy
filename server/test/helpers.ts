// 통합 시험 공용 손잡이 (#101): 서버 띄우기, JSON 요청, 기기 계정, 세션(가짜 구글 로그인을 DB 로), 운영자 브라우저 흉내.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import type { AppDeps } from '../src/app.module';
import type { Config } from '../src/config';
import { runMigrations, startPg } from './pg';

export const HOUR = 3_600_000;
const rand = () => Math.floor(Math.random() * 250);
export const ip = () => `10.${rand()}.${rand()}.${rand()}`;
export const today = () => new Date().toISOString().slice(0, 10);
/** 운영자 화면의 datetime-local 값 (한국 시간) */
export const kstInput = (ms: number) => new Date(ms + 9 * HOUR).toISOString().slice(0, 16);

// biome-ignore lint/suspicious/noExplicitAny: 시험은 응답 JSON 을 바로 읽는다
export type Res = { status: number; body: any; text: string; headers: Headers };

export interface Harness {
  base: string;
  pool: Pool;
  config: Config;
  app: NestExpressApplication;
  stop: () => Promise<void>;
}

/** 시험용 Postgres 와 서버. config 의 publicUrl 은 띄운 주소로 바뀐다 (운영자 화면의 같은 출처 검사) */
export async function startHarness(extra: Partial<Config> = {}, deps: AppDeps = {}): Promise<Harness> {
  const pg = await startPg();
  await runMigrations(pg.databaseUrl);
  const pool = new Pool({ connectionString: pg.databaseUrl, max: 3 });
  const config: Config = {
    port: 0,
    databaseUrl: pg.databaseUrl,
    publicUrl: 'http://127.0.0.1:1',
    googleClientId: '',
    googleClientSecret: '',
    ...extra,
  };
  const app = await createApp(config, deps);
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  config.publicUrl = base;
  return {
    base,
    pool,
    config,
    app,
    stop: async () => {
      await app.close().catch(() => {});
      await pool.end().catch(() => {});
      pg.stop();
    },
  };
}

export function client(h: () => Harness) {
  async function api(
    method: string,
    path: string,
    o: { token?: string; body?: unknown; ip?: string; headers?: Record<string, string> } = {},
  ): Promise<Res> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.body !== undefined && typeof o.body !== 'string') headers['content-type'] = 'application/json';
    if (o.ip) headers['cf-connecting-ip'] = o.ip;
    const res = await fetch(`${h().base}${path}`, {
      method,
      headers,
      body: o.body === undefined ? undefined : typeof o.body === 'string' ? o.body : JSON.stringify(o.body),
      redirect: 'manual',
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { status: res.status, body, text, headers: res.headers };
  }

  async function newDevice(
    age = '14+',
    nickname?: string,
  ): Promise<{ token: string; id: string; code: string }> {
    const r = await api('POST', '/v1/device', { body: { age, ...(nickname ? { nickname } : {}) }, ip: ip() });
    assert.equal(r.status, 201, r.text);
    return { token: r.body.token, id: String(r.body.account.id), code: r.body.account.code };
  }

  /** 구글 로그인 한 바퀴를 DB 로 흉내: 계정에 (google, sub) 로그인과 세션 토큰을 붙인다 */
  async function session(accountId: string, sub = `sub-${randomUUID()}`): Promise<string> {
    const token = `fs_${randomBytes(32).toString('base64url')}`;
    await h().pool.query(
      `INSERT INTO login (service, sub, account_id) VALUES ('google', $1, $2) ON CONFLICT (service, sub) DO NOTHING`,
      [sub, accountId],
    );
    await h().pool.query('INSERT INTO session (account_id, token_hash) VALUES ($1, $2)', [
      accountId,
      createHash('sha256').update(token).digest(),
    ]);
    return token;
  }

  /** 같은 계정에 기기 하나 더 (같은 계정의 두 번째 기기) */
  async function secondDevice(accountId: string): Promise<string> {
    const token = `fd_${randomBytes(32).toString('base64url')}`;
    await h().pool.query('INSERT INTO device (account_id, token_hash) VALUES ($1, $2)', [
      accountId,
      createHash('sha256').update(token).digest(),
    ]);
    return token;
  }

  const balanceOf = async (id: string) =>
    Number((await h().pool.query('SELECT balance FROM account WHERE id = $1', [id])).rows[0]?.balance);
  const ledgerSum = async (id: string) =>
    Number(
      (
        await h().pool.query('SELECT COALESCE(sum(amount), 0) AS s FROM coin_entry WHERE account_id = $1', [
          id,
        ])
      ).rows[0]?.s,
    );
  const lastLog = async (action: string) =>
    (
      await h().pool.query(
        'SELECT actor, target, detail FROM admin_log WHERE action = $1 ORDER BY id DESC LIMIT 1',
        [action],
      )
    ).rows[0];

  return { api, newDevice, session, secondDevice, balanceOf, ledgerSum, lastLog };
}

/** 운영자 브라우저 흉내: 쿠키와 CSRF 를 들고 다닌다 */
export class AdminBrowser {
  cookie = '';
  csrf = '';
  readonly from = ip();

  constructor(
    private readonly h: () => Harness,
    private readonly api: ReturnType<typeof client>['api'],
    private readonly token: () => string,
  ) {}

  async login(token = this.token()): Promise<Res> {
    const r = await this.post('/admin/login', { token }, false);
    const set = r.headers.get('set-cookie') ?? '';
    if (r.status === 303) this.cookie = set.split(';')[0] ?? '';
    return r;
  }

  /**
   * 운영자 화면 한 장 (다섯 칸이 한 문서). 옛 탭 이름('/users?q=..', '/log?user=..')을 주면 그 조건을 새 주소로 바꿔 부른다.
   * 옛 주소 자체의 돌려보내기는 raw: true 로 본다
   */
  async page(query = '', raw = false): Promise<Res> {
    let url = query;
    const legacy = /^\/(users|grants|notices|events|features|ai|log)(\?.*)?$/.exec(query);
    if (legacy && !raw) {
      const p = new URLSearchParams(legacy[2] ?? '');
      if (legacy[1] === 'log')
        for (const [from, to] of [
          ['user', 'lu'],
          ['action', 'la'],
          ['text', 'lt'],
          ['page', 'lp'],
        ] as const) {
          const v = p.get(from);
          if (v !== null) {
            p.delete(from);
            p.set(to, v);
          }
        }
      const q = p.toString();
      url = q ? `?${q}` : '';
    }
    const r = await this.api('GET', `/admin${url}`, { headers: { cookie: this.cookie }, ip: this.from });
    const m = /name="csrf" value="([^"]+)"/.exec(r.text);
    if (m?.[1]) this.csrf = m[1];
    return r;
  }

  async post(
    path: string,
    fields: Record<string, string | string[]>,
    csrf = true,
    origin = this.h().base,
  ): Promise<Res> {
    const form = new URLSearchParams();
    if (csrf) form.append('csrf', this.csrf);
    for (const [k, v] of Object.entries(fields))
      for (const x of ([] as string[]).concat(v)) form.append(k, x);
    return this.api('POST', path, {
      body: form.toString(),
      ip: this.from,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookie, origin },
    });
  }

  /**
   * 지급과 공지의 확정은 미리보기를 거친 것만 받는다. 작성 값으로 미리보기를 만들고 확정 폼의 숨은 칸(번호 포함)에
   * 호출한 칸을 덮어 보낸다. 미리보기가 거절되면(값이 틀림) 그 응답을 돌려준다 (결과 글은 다음 화면에 있다)
   */
  async confirmPost(
    path: string,
    fields: Record<string, string | string[]>,
    csrf = true,
    origin = this.h().base,
  ): Promise<Res> {
    const previewPath = path === '/admin/grants/batch' ? '/admin/grants/preview' : '/admin/notices/preview';
    const first = await this.post(previewPath, fields, csrf, origin);
    if (first.status !== 303) return first;
    const page = await this.page();
    const m = new RegExp(`<form method="post" action="${path}"[^>]*>([\\s\\S]*?)</form>`).exec(page.text);
    if (!m) return this.post(previewPath, fields, csrf, origin);
    const hidden: Record<string, string> = {};
    for (const x of (m[1] ?? '').matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g))
      if (x[1] !== 'csrf') hidden[x[1] as string] = (x[2] as string).replaceAll('&#10;', '\n');
    return this.post(path, { ...hidden, ...fields, flow: hidden.flow ?? '' }, csrf, origin);
  }

  /** 쓰기 하나 뒤 화면의 결과 글 */
  async act(path: string, fields: Record<string, string | string[]>): Promise<{ ok: boolean; text: string }> {
    const flow = path === '/admin/grants/batch' || path === '/admin/notices';
    const r = flow ? await this.confirmPost(path, fields) : await this.post(path, fields);
    assert.equal(r.status, 303, r.text);
    const p = await this.page();
    const m =
      /<p class="flash( error)?( wide)?" role="(?:status|alert)"(?: id="form-(?:error|ok)")?>([^<]*)<\/p>/.exec(
        p.text,
      );
    return { ok: !!m && !m[1], text: m?.[3] ?? '' };
  }
}
