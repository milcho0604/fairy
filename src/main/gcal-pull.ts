// 구글 캘린더 읽어 오기 (이슈 #54): 한 차례. 일렉트론 없이 돈다 (시험에서 API 를 흉내 낸다).
// 범위(지난 7일 ~ 앞으로 60일)를 쪽마다 다 읽은 뒤 저장 파일과 맞춘다. 다 못 읽으면 아무것도 바꾸지 않는다.
import type { EventStore } from '../shared/event-store.ts';
import type { GcalProblem } from '../shared/gcal.ts';
import {
  fromGoogle,
  isFromFairy,
  listPath,
  PULL_MAX_PAGES,
  type PulledEvent,
  pullWindow,
} from '../shared/gcal-pull.ts';
import type { ApiResult } from './gcal-auth.ts';
import { GcalLost, reasonOf } from './gcal-sync.ts';

export type GcalGet = (method: 'GET', path: string) => Promise<ApiResult>;

export type PullResult =
  | { ok: true; count: number; added: number; updated: number; removed: number; hidden: number }
  | { ok: false; stop: GcalProblem | 'scope' | 'stale' };

export async function pullPass(d: {
  events: EventStore;
  api: GcalGet;
  calendarId: string;
  now: () => number;
  /** 페어리가 구글로 보낸 일정의 iCalUID 들 (GcalStore.sentUids). 되돌아온 것은 넣지 않는다 */
  ours: ReadonlySet<string>;
  /** 제목 없는 일정의 이름 */
  untitled: string;
  /** 다 읽은 뒤 맞추기 전에 묻는다: 그새 끄거나 캘린더를 바꿨으면 false (그때는 stale 로 아무것도 바꾸지 않는다) */
  current?: () => boolean;
  log?: (tag: string, ...rest: unknown[]) => void;
}): Promise<PullResult> {
  const now = d.now();
  const w = pullWindow(now);
  const list: PulledEvent[] = [];
  let page: string | undefined;
  for (let n = 0; ; n++) {
    if (n >= PULL_MAX_PAGES) {
      // 너무 많다: 덜 읽은 채로 맞추면 못 읽은 일정을 지운 것으로 본다. 이번에는 그만둔다
      d.log?.('gcal', '가져오기 쪽이 너무 많음', n);
      return { ok: false, stop: 'failed' };
    }
    let r: ApiResult;
    try {
      r = await d.api('GET', listPath(d.calendarId, w, page));
    } catch (err) {
      // 연결이 끝났다: 보내기와 같이 그대로 던진다 (gcal.ts 가 멈춘다)
      if (err instanceof GcalLost) throw err;
      d.log?.('gcal', '가져오기 실패', err instanceof Error ? err.name : 'error');
      return { ok: false, stop: 'offline' };
    }
    if (r.kind !== 'ok') {
      d.log?.('gcal', '가져오기 안 됨', r.status, reasonOf(r.json));
      return {
        ok: false,
        stop:
          r.kind === 'scope'
            ? 'scope'
            : r.kind === 'notFound' || r.kind === 'forbidden'
              ? 'calendar'
              : r.kind === 'retry' || r.kind === 'auth'
                ? 'offline'
                : 'failed',
      };
    }
    const json = r.json as { items?: unknown; nextPageToken?: unknown } | undefined;
    if (!json || (json.items !== undefined && !Array.isArray(json.items)))
      return { ok: false, stop: 'failed' };
    for (const item of (json.items as unknown[] | undefined) ?? []) {
      if (isFromFairy(item, d.ours)) continue;
      const e = fromGoogle(item, d.untitled);
      if (e) list.push(e);
    }
    page = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : undefined;
    if (!page) break;
  }
  if (d.current && !d.current()) return { ok: false, stop: 'stale' };
  const r = d.events.syncExternal('google', list, w.from, w.to, now);
  // 같은 일정이 캘린더 가져오기(.ics)로도 들어와 있으면 걷어 낸다 (둘씩 보이지 않게)
  const hidden = d.events.hideIcsDupes(
    new Set(list.map((e) => e.icalUid).filter((v): v is string => !!v)),
    now,
  );
  return { ok: true, count: list.length, ...r, hidden };
}
