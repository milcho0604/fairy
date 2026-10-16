import { Inject, Injectable, Optional } from '@nestjs/common';
import { CLOCK, CONFIG } from './app.tokens';
import { type Config, type FeatureMode, isFeatureMode } from './config';
import { Db } from './db';

type Q = Pick<Db['pool'], 'query'>;

// 기능 키 (#102). 기능마다 전체와 특정 계정으로 켜고 끈다.
// - off: 아무도 못 쓴다 / allowlist: feature_allow 에 넣은 계정만 / everyone: 모두
// - 기본값은 서버 설정(env FEATURE_<이름>). DB(feature_flag)에 줄이 있으면 DB 가 이긴다.
// - 읽기는 5초 담아 둔다. 바꾸는 함수는 담아 둔 것을 바로 버린다.
// TODO(#101): 운영자 화면이 setFeatureMode, allowAccount, disallowAccount, listFeatures 를 붙인다.
//   운영자 인증과 화면은 #101 몫이라 여기에는 경로를 두지 않는다.

/** 아는 기능 키와 기본값을 읽는 env 이름 */
export const FEATURES = {
  /** 카카오 로그인 (6단계). allowlist 면 이미 로그인한 허용 계정이 카카오를 "연결"하는 것만 된다 */
  kakao_login: { env: 'FEATURE_KAKAO_LOGIN' },
  /** 설정의 코인 초기화와 산 물건 초기화. off 면 맞추기의 reset, reset-items 기록을 feature_off 로 거절하고 앱은 단추를 숨긴다 */
  coin_reset: { env: 'FEATURE_COIN_RESET' },
  /**
   * 같은 계정의 다른 기기에서 구글 일정을 연결했다는 안내 (#115). 기본 allowlist 이고, 운영자 계정(ADMIN_GOOGLE_SUBS 의
   * 구글 로그인이 붙은 계정)은 허용 목록에 넣지 않아도 켜진다. off 면 앱이 연결 표시를 올리지도 안내하지도 않는다
   */
  calendar_link_hint: { env: 'FEATURE_CALENDAR_LINK_HINT', fallback: 'allowlist', admins: true },
  /** 친구 맺기 (#110). allowlist 면 허용 계정과 운영자 계정끼리만. 신청 받는 사람도 이 기능을 쓸 수 있어야 한다 */
  friends: { env: 'FEATURE_FRIENDS', fallback: 'allowlist', admins: true },
  /** 친구에게 코인, 채팅 이용권 선물 (#110). 보내는 사람 기준 */
  friend_gifts: { env: 'FEATURE_FRIEND_GIFTS', fallback: 'allowlist', admins: true },
  /** 친구에게 바쁜 시간 보여 주기 (#110 일정 공유 1차). 보여 주는 사람과 보는 사람 모두 */
  friend_calendar: { env: 'FEATURE_FRIEND_CALENDAR', fallback: 'allowlist', admins: true },
  /**
   * 친구에게 채팅 이용권 선물 (#110, 사용자 결정 2026-10-16). 보내는 사람과 받는 사람이 모두 허용돼야 한다. 지금 이용권은
   * 모두 운영자 지급분(정기 지급, 쪽지, 쿠폰, 첫 선물)이라 "운영자 지급분도 선물" 스위치를 따로 두면 기능이 비어 버려서,
   * 이 스위치의 허용 목록이 그 판단까지 맡는다. 사서 받은 이용권이 생기면 그 몫을 따로 센다
   */
  friend_gift_passes: { env: 'FEATURE_FRIEND_GIFT_PASSES', fallback: 'allowlist', admins: true },
} as const satisfies Record<string, FeatureDef>;

/** 기능 하나: 기본값을 읽는 env, env 가 비었을 때의 값(없으면 off), allowlist 에서 운영자 계정도 켜지는가 */
interface FeatureDef {
  env: string;
  fallback?: FeatureMode;
  admins?: boolean;
}
export type FeatureKey = keyof typeof FEATURES;
export const isFeatureKey = (v: unknown): v is FeatureKey => typeof v === 'string' && v in FEATURES;

/** 담아 두는 시간 */
export const FEATURE_CACHE_MS = 5_000;

export interface FeatureView {
  key: FeatureKey;
  mode: FeatureMode;
  /** 어디서 온 값인가: DB 줄이 있으면 db, 없으면 env */
  from: 'db' | 'env';
  /** allowlist 에 든 계정 번호 */
  accounts: number[];
}

@Injectable()
export class Features {
  #modes: { at: number; map: Map<string, FeatureMode> } | undefined;
  #allow = new Map<string, { at: number; ok: boolean }>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly db: Db,
    @Optional() @Inject(CLOCK) clock?: () => number,
  ) {
    this.clock = clock ?? Date.now;
  }

  private readonly clock: () => number;

  private envMode(key: FeatureKey): FeatureMode {
    const f: FeatureDef = FEATURES[key] as FeatureDef;
    return this.config.features?.[key] ?? f.fallback ?? 'off';
  }

  /** allowlist 모드에서도 운영자 계정은 켜지는 기능인가 (calendar_link_hint) */
  private async adminAllowed(key: FeatureKey, accountId: string): Promise<boolean> {
    const f: FeatureDef = FEATURES[key] as FeatureDef;
    const subs = this.config.adminSubs ?? [];
    if (!f.admins || subs.length === 0) return false;
    const r = await this.db.pool.query(
      `SELECT 1 FROM login WHERE account_id = $1 AND service = 'google' AND sub = ANY($2::text[]) LIMIT 1`,
      [accountId, subs],
    );
    return (r.rowCount ?? 0) > 0;
  }

  private async dbModes(): Promise<Map<string, FeatureMode>> {
    const now = this.clock();
    if (this.#modes && now - this.#modes.at < FEATURE_CACHE_MS) return this.#modes.map;
    const r = await this.db.pool.query<{ key: string; mode: string }>('SELECT key, mode FROM feature_flag');
    const map = new Map<string, FeatureMode>();
    for (const row of r.rows) if (isFeatureMode(row.mode)) map.set(row.key, row.mode);
    this.#modes = { at: now, map };
    return map;
  }

  /** 기능의 지금 모드 (DB 가 env 보다 먼저) */
  async featureMode(key: FeatureKey): Promise<FeatureMode> {
    return (await this.dbModes()).get(key) ?? this.envMode(key);
  }

  /**
   * 이 계정이 기능을 쓸 수 있는가. allowlist 면 그 계정만(admins 인 기능은 운영자 계정도), 계정이 없으면(로그인 전) false
   */
  async featureAllowed(key: FeatureKey, accountId: string | null): Promise<boolean> {
    const mode = await this.featureMode(key);
    if (mode === 'everyone') return true;
    if (mode === 'off' || accountId === null) return false;
    const k = `${key}:${accountId}`;
    const now = this.clock();
    const hit = this.#allow.get(k);
    if (hit && now - hit.at < FEATURE_CACHE_MS) return hit.ok;
    const r = await this.db.pool.query('SELECT 1 FROM feature_allow WHERE key = $1 AND account_id = $2', [
      key,
      accountId,
    ]);
    const ok = (r.rowCount ?? 0) > 0 || (await this.adminAllowed(key, accountId));
    if (this.#allow.size > 10_000) this.#allow.clear();
    this.#allow.set(k, { at: now, ok });
    return ok;
  }

  private forget() {
    this.#modes = undefined;
    this.#allow.clear();
  }

  /**
   * 모드 바꾸기 (DB 에 적는다). null 이면 DB 줄을 지워 env 기본값으로 돌린다: 0004 의 feature_allow 가 feature_flag 를
   * 가리켜(ON DELETE CASCADE) 허용 목록도 함께 지워진다. q 는 운영자 화면의 트랜잭션 (없으면 풀)
   */
  async setFeatureMode(key: FeatureKey, mode: FeatureMode | null, q: Q = this.db.pool): Promise<void> {
    if (mode === null) await q.query('DELETE FROM feature_flag WHERE key = $1', [key]);
    else
      await q.query(
        `INSERT INTO feature_flag (key, mode) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()`,
        [key, mode],
      );
    this.forget();
  }

  /**
   * allowlist 에 계정 넣기 (합쳐져 닫힌 계정이면 남는 쪽을 넣는다). feature_allow 가 feature_flag 줄을 가리키므로,
   * 줄이 없으면 지금 모드(env 기본값)로 먼저 만든다 (모드는 그대로다)
   */
  async allowAccount(key: FeatureKey, accountId: string, q: Q = this.db.pool): Promise<void> {
    await q.query('INSERT INTO feature_flag (key, mode) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [
      key,
      this.envMode(key),
    ]);
    await q.query(
      `INSERT INTO feature_allow (key, account_id)
       SELECT $1, COALESCE(merged_into, id) FROM account WHERE id = $2
       ON CONFLICT DO NOTHING`,
      [key, accountId],
    );
    this.forget();
  }

  async disallowAccount(key: FeatureKey, accountId: string, q: Q = this.db.pool): Promise<void> {
    await q.query('DELETE FROM feature_allow WHERE key = $1 AND account_id = $2', [key, accountId]);
    this.forget();
  }

  /** 모든 기능 키의 지금 값 (운영자 화면용, ai_chat 은 ai-admin.ts 가 따로 다룬다) */
  async listFeatures(): Promise<FeatureView[]> {
    this.forget();
    const modes = await this.dbModes();
    const allow = await this.db.pool.query<{ key: string; account_id: string }>(
      'SELECT key, account_id FROM feature_allow ORDER BY key, account_id',
    );
    return (Object.keys(FEATURES) as FeatureKey[]).map((key) => ({
      key,
      mode: modes.get(key) ?? this.envMode(key),
      from: modes.has(key) ? 'db' : 'env',
      accounts: allow.rows.filter((r) => r.key === key).map((r) => Number(r.account_id)),
    }));
  }
}
