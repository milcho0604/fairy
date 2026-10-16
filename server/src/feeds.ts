import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from './app.tokens';
import type { Config } from './config';
import { DEFAULT_RELEASES_API } from './config';
import { Db } from './db';
import { exportDoc, type NoticeDoc, readDoc, VERSION } from './notice-doc';
import { EVENTS_FORMAT, EVENTS_MAX, kstIso, type SiteEvent } from './shared/site-events';
import type { UpdateLevels } from './shared/update-levels';

// 홈페이지 정적 파일로 나갈 두 문서 (9, 23절): 이벤트 목록(events.json)과 공지(notices.json).
// 서버는 만들어 내주기만 한다. 홈페이지에 올리는 것은 공개 레포 Actions(.github/workflows/site-feeds.yml)다.

/** 정적 파일에 실을 이벤트: 끝난 지 30일 안의 것까지 (앱은 끝난 지 3일 안의 것만 보인다) */
const EXPORT_ENDED_DAYS = 30;

export interface EventsDoc {
  version: number;
  events: Array<Omit<SiteEvent, 'from' | 'until'> & { from: string; until: string }>;
}

export interface EventRow {
  id: string;
  kind: 'gift' | 'boost';
  title_ko: string;
  title_en: string;
  body_ko: string;
  body_en: string;
  starts: string;
  ends: string;
  coins: number | null;
  boost_reasons: string[] | null;
  boost_times: number | null;
}

export const EVENT_COLUMNS = `id, kind, title_ko, title_en, body_ko, body_en,
  (extract(epoch FROM starts_at) * 1000)::bigint AS starts, (extract(epoch FROM ends_at) * 1000)::bigint AS ends,
  coins, boost_reasons, boost_times`;

/** 표의 한 줄을 정적 파일 모양으로 (src/shared/site-events.ts parseEvent 가 읽는 모양) */
export function eventJson(r: EventRow): EventsDoc['events'][number] {
  const e: EventsDoc['events'][number] = {
    id: r.id,
    kind: r.kind,
    title: { ko: r.title_ko, en: r.title_en },
    body: { ko: r.body_ko, en: r.body_en },
    from: kstIso(Number(r.starts)),
    until: kstIso(Number(r.ends)),
  };
  if (r.kind === 'gift' && r.coins) e.coins = r.coins;
  if (r.kind === 'boost' && r.boost_reasons && r.boost_times)
    e.boost = { reasons: r.boost_reasons as ('meet' | 'focus')[], times: r.boost_times };
  return e;
}

/** 업데이트 기준을 담아 두는 시간 (이슈 #120, 관문이 요청마다 읽지 않게) */
export const LEVELS_CACHE_MS = 5_000;

/** 공지 문서의 세 기준 (정한 것만) */
export function levelsOf(doc: NoticeDoc): UpdateLevels {
  const out: UpdateLevels = {};
  if (doc.recommendVersion) out.recommend = doc.recommendVersion;
  if (doc.restrictVersion) out.restrict = doc.restrictVersion;
  if (doc.minVersion) out.min = doc.minVersion;
  return out;
}

@Injectable()
export class Feeds {
  #latest: { at: number; version: string | undefined } | undefined;
  #levels: { at: number; value: UpdateLevels } | undefined;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async events(): Promise<EventsDoc> {
    const r = await this.db.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM event WHERE ends_at > now() - make_interval(days => $1)
        ORDER BY starts_at, id LIMIT $2`,
      [EXPORT_ENDED_DAYS, EVENTS_MAX],
    );
    return { version: EVENTS_FORMAT, events: r.rows.map(eventJson) };
  }

  /** 운영자 화면에서 저장한 공지 문서. 한 번도 저장하지 않았으면 undefined */
  async notices(): Promise<NoticeDoc | undefined> {
    const r = await this.db.pool.query<{ body: unknown }>(`SELECT body FROM site_doc WHERE name = 'notices'`);
    const row = r.rows[0];
    return row ? exportDoc(readDoc(row.body)) : undefined;
  }

  /**
   * 업데이트 세 기준 (이슈 #120). 공지 문서 한 곳에서 읽는다: /v1/notices.json, /v1/me, 관문(update-gate.ts)이 같이 쓴다.
   * 정하지 않은 기준은 빠진다
   */
  async levels(now = Date.now()): Promise<UpdateLevels> {
    // 요청마다 DB 를 읽지 않게 5초 담아 둔다. 운영자가 저장하면 forgetLevels 로 바로 비운다 (admin.ts editDoc)
    if (this.#levels && now - this.#levels.at < LEVELS_CACHE_MS) return this.#levels.value;
    const r = await this.db.pool.query<{ body: unknown }>(`SELECT body FROM site_doc WHERE name = 'notices'`);
    const value = levelsOf(readDoc(r.rows[0]?.body));
    this.#levels = { at: now, value };
    return value;
  }

  /** 공지 문서를 고쳤다: 기준을 다시 읽게 담아 둔 것을 버린다 */
  forgetLevels(): void {
    this.#levels = undefined;
  }

  /**
   * 지금 최신 릴리스 번호 (공개 레포의 GitHub 릴리스). 최소 버전과 권장 버전을 올릴 때 이보다 높으면 막는다.
   * 5분 동안 기억한다. 못 읽으면 undefined (그때는 올리기를 막는다)
   */
  async latestRelease(now = Date.now()): Promise<string | undefined> {
    if (this.#latest && now - this.#latest.at < 300_000 && this.#latest.version) return this.#latest.version;
    let version: string | undefined;
    try {
      const res = await fetch(this.config.releasesApi ?? DEFAULT_RELEASES_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'fairy-server' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const j = (await res.json()) as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
        const tag = typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : '';
        if (j.draft !== true && j.prerelease !== true && VERSION.test(tag)) version = tag;
      }
    } catch {
      version = undefined;
    }
    this.#latest = { at: now, version };
    return version;
  }
}
