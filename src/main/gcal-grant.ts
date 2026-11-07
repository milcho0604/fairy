// 캘린더 만들기와 지우기 권한(calendar.app.created)을 따로 다시 받기 (docs/gcal-todo-plan.md 3절).
// connect() 와 달리 설정(보내기, 가져오기, 캘린더 선택, AI)을 건드리지 않고, 받은 새 토큰이 조건에 맞을 때만 돌려준다.
// 조건에 안 맞으면 새 토큰은 구글에 돌려주지(revoke) 않고 그냥 버린다: 구글의 돌려주기가 이 앱의 허락 전체를 거둘 수 있어서
// 지금 연결까지 끊어진다. 일렉트론 없이 돈다 (브라우저 열기는 받아서 쓴다).
import { GCAL_APP_SCOPE, GCAL_LIST_SCOPE, GCAL_SCOPE, type GcalGrantProblem } from '../shared/gcal.ts';
import { CALLIST_MAX_PAGES, calendarListPath, primaryIdOf } from '../shared/gcal-cals.ts';
import {
  authUrl,
  callApi,
  exchangeCode,
  type FetchLike,
  type GoogleClient,
  makePkce,
  newState,
  startLoopback,
  type Tokens,
} from './gcal-auth.ts';
import { accountFingerprint } from './gcal-todo-cal.ts';

export type GrantResult =
  | { kind: 'granted'; tokens: Tokens & { refreshToken: string }; account: string }
  /** 지금 연결을 그대로 두었다. 새 토큰은 버렸다 */
  | { kind: 'kept'; problem: GcalGrantProblem }
  /** 다른 요청이 이 허락을 대신했다 (취소됨) */
  | { kind: 'cancelled' };

/** 새 토큰으로 기본 캘린더의 id 를 읽는다. 목록 권한이 없으면 'noList', 그 밖의 실패는 'failed' */
async function primaryOf(
  f: FetchLike,
  access: string,
): Promise<{ id: string } | { problem: 'noList' | 'failed' | 'offline' }> {
  let page: string | undefined;
  for (let n = 0; n < CALLIST_MAX_PAGES; n++) {
    let r: Awaited<ReturnType<typeof callApi>>;
    try {
      r = await callApi(f, access, 'GET', calendarListPath(page));
    } catch {
      return { problem: 'offline' };
    }
    if (r.kind === 'scope') return { problem: 'noList' };
    if (r.kind === 'retry' || r.kind === 'auth') return { problem: 'offline' };
    if (r.kind !== 'ok') return { problem: 'failed' };
    const j = r.json as { items?: unknown; nextPageToken?: unknown } | undefined;
    const id = primaryIdOf(Array.isArray(j?.items) ? j.items : []);
    if (id) return { id };
    page = typeof j?.nextPageToken === 'string' && j.nextPageToken ? j.nextPageToken : undefined;
    if (!page) break;
  }
  return { problem: 'failed' };
}

/**
 * 세 권한을 한 번에 묻고, 받은 토큰이 쓸 만한지 따진다.
 * - 일정 칸을 풀었다: noEvents. 캘린더 만들기 칸을 풀었다(scope 글에 적혀 있지 않다, 글이 비어도): noApp
 * - 목록 칸을 풀어 같은 계정인지 볼 수 없다: noList. 다른 계정이다: account
 * - 모두 맞으면 granted. 호출한 쪽이 지금 토큰을 이것으로 바꾼다
 * expectedAccount 는 지금 연결의 계정 지문(알 수 없으면 허락 화면을 열기 전에 호출한 쪽이 막는다)
 */
export async function runGrant(d: {
  f: FetchLike;
  client: GoogleClient;
  now: () => number;
  expectedAccount: string;
  openExternal: (url: string) => Promise<void>;
  /** 브라우저에서 기다리는 동안 취소할 수 있게 돌려받는다 */
  onCancel: (cancel: () => void) => void;
  /** 이 허락을 아직 내가 맡고 있는가 (새 요청이 대신했으면 false) */
  stillMine: () => boolean;
  page: (ok: boolean) => { title: string; body: string };
  log?: (tag: string, ...rest: unknown[]) => void;
  timeoutMs?: number;
}): Promise<GrantResult> {
  const pkce = makePkce();
  const state = newState();
  const lb = await startLoopback({ state, page: d.page, timeoutMs: d.timeoutMs });
  d.onCancel(lb.cancel);
  d.log?.('gcal', '새 권한 받기 시작');
  let openFailed = false;
  try {
    await d.openExternal(
      authUrl({
        clientId: d.client.id,
        redirectUri: lb.redirectUri,
        challenge: pkce.challenge,
        state,
        scopes: [GCAL_SCOPE, GCAL_LIST_SCOPE, GCAL_APP_SCOPE],
      }),
    );
  } catch (err) {
    d.log?.('gcal', '브라우저 열기 실패', err instanceof Error ? err.name : 'error');
    openFailed = true;
    lb.cancel();
  }
  const r = await lb.result;
  if (!d.stillMine()) return { kind: 'cancelled' };
  if (openFailed) return { kind: 'kept', problem: 'failed' };
  if (r.kind === 'cancelled') return { kind: 'cancelled' };
  if (r.kind === 'timeout') return { kind: 'kept', problem: 'timeout' };
  if (r.kind === 'error') {
    d.log?.('gcal', '새 권한 허락 안 됨', r.error);
    return { kind: 'kept', problem: r.error === 'access_denied' ? 'denied' : 'failed' };
  }
  let got: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    got = await exchangeCode(d.f, {
      client: d.client,
      code: r.code,
      verifier: pkce.verifier,
      redirectUri: lb.redirectUri,
      now: d.now,
    });
  } catch (err) {
    d.log?.('gcal', '새 권한 토큰 받기 실패', err instanceof Error ? err.name : 'error');
    return { kind: 'kept', problem: 'offline' };
  }
  if (!got.ok) {
    d.log?.('gcal', '새 권한 토큰 받기 실패', got.error, got.status);
    return { kind: 'kept', problem: 'failed' };
  }
  const t = got.tokens;
  if (!t.scopeOk) return { kind: 'kept', problem: 'noEvents' };
  if (!t.appScope) return { kind: 'kept', problem: 'noApp' };
  if (!t.refreshToken) return { kind: 'kept', problem: 'failed' };
  const primary = await primaryOf(d.f, t.accessToken);
  if ('problem' in primary) return { kind: 'kept', problem: primary.problem };
  const account = accountFingerprint(primary.id);
  if (account !== d.expectedAccount) return { kind: 'kept', problem: 'account' };
  return { kind: 'granted', tokens: { ...t, refreshToken: t.refreshToken }, account };
}
