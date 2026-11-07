import assert from 'node:assert/strict';
import { get } from 'node:http';
import { test } from 'node:test';
import { GCAL_APP_SCOPE, GCAL_LIST_SCOPE, GCAL_SCOPE } from '../shared/gcal.ts';
import { type FetchLike, parseTokenResponse, REVOKE_URL, TOKEN_URL } from './gcal-auth.ts';
import { runGrant } from './gcal-grant.ts';
import { accountFingerprint } from './gcal-todo-cal.ts';

const CLIENT = { id: '1234567890-abcdefghij.apps.googleusercontent.com', secret: 'not-really-secret' };
const ME = 'me@gmail.com';
const ALL = `${GCAL_SCOPE} ${GCAL_LIST_SCOPE} ${GCAL_APP_SCOPE}`;
const NOW = Date.UTC(2026, 9, 10);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Setup {
  /** 토큰 주소의 scope 글. undefined 면 scope 칸을 아예 안 준다 */
  scope?: string;
  noScope?: boolean;
  refresh?: boolean;
  primary?: string;
  listStatus?: number;
  tokenStatus?: number;
  /** 브라우저가 돌려주는 것 */
  browser?: 'code' | 'denied' | 'none';
}

function run(o: Setup = {}) {
  const calls: string[] = [];
  let asked = '';
  const f: FetchLike = async (url) => {
    calls.push(url.split('?')[0] ?? url);
    if (url === TOKEN_URL) {
      if (o.tokenStatus && o.tokenStatus >= 400) return json(o.tokenStatus, { error: 'invalid_grant' });
      return json(200, {
        access_token: 'ya29.NEW',
        expires_in: 3600,
        ...(o.refresh === false ? {} : { refresh_token: '1//NEW' }),
        ...(o.noScope ? {} : { scope: o.scope ?? ALL }),
      });
    }
    if (url === REVOKE_URL) return new Response('', { status: 200 });
    if (url.includes('/calendarList')) {
      if (o.listStatus && o.listStatus >= 400)
        return json(o.listStatus, { error: { errors: [{ reason: 'insufficientPermissions' }] } });
      return json(200, {
        items: [{ id: o.primary ?? ME, primary: true, accessRole: 'owner', summary: 'x' }],
      });
    }
    return json(404, {});
  };
  let cancelled = false;
  const result = runGrant({
    f,
    client: CLIENT,
    now: () => NOW,
    expectedAccount: accountFingerprint(ME),
    page: () => ({ title: 't', body: 'b' }),
    onCancel: () => {},
    stillMine: () => !cancelled,
    openExternal: async (url) => {
      asked = url;
      const u = new URL(url);
      const redirect = u.searchParams.get('redirect_uri') ?? '';
      const state = u.searchParams.get('state') ?? '';
      const mode = o.browser ?? 'code';
      if (mode === 'none') return;
      const q = mode === 'code' ? `code=abc&state=${state}` : `error=access_denied&state=${state}`;
      // 브라우저가 돌아오는 것을 흉내 낸다 (루프백 서버에 요청)
      await new Promise<void>((resolve) => {
        get(`${redirect}/?${q}`, (r) => {
          r.resume();
          r.on('end', resolve);
        }).on('error', () => resolve());
      });
    },
    timeoutMs: o.browser === 'none' ? 50 : undefined,
  });
  return { result, calls, asked: () => asked, cancel: () => (cancelled = true) };
}

test('토큰의 appScope 는 scope 글에 적혀 있을 때만 참이다 (글이 비어도 거짓)', () => {
  const p = (scope?: string) => {
    const r = parseTokenResponse(
      200,
      { access_token: 'A', expires_in: 3600, ...(scope === undefined ? {} : { scope }) },
      NOW,
    );
    assert.ok(r.ok);
    return r.tokens;
  };
  assert.equal(p(ALL).appScope, true);
  assert.equal(p(`${GCAL_SCOPE} ${GCAL_LIST_SCOPE}`).appScope, false);
  assert.equal(p('').appScope, false);
  assert.equal(p().appScope, false);
  // scope 칸이 아예 없으면 일정과 목록은 요청한 그대로 받은 것으로 치는 옛 규칙은 그대로
  assert.equal(p().scopeOk, true);
  assert.equal(p().listScope, true);
});

test('세 권한을 한 번에 묻는다', async () => {
  const r = run();
  await r.result;
  const scope = new URL(r.asked()).searchParams.get('scope')?.split(' ');
  assert.deepEqual(scope, [GCAL_SCOPE, GCAL_LIST_SCOPE, GCAL_APP_SCOPE]);
});

test('모두 허락하고 같은 계정이면 새 토큰과 지문을 돌려준다', async () => {
  const r = run();
  const g = await r.result;
  assert.equal(g.kind, 'granted');
  if (g.kind !== 'granted') return;
  assert.equal(g.tokens.refreshToken, '1//NEW');
  assert.equal(g.tokens.accessToken, 'ya29.NEW');
  assert.equal(g.account, accountFingerprint(ME));
  assert.ok(!r.calls.includes(REVOKE_URL));
});

/** 못 받은 경우는 새 토큰을 버리되 구글에 돌려주기(revoke)는 하지 않는다 (지금 연결이 끊어지지 않게) */
async function kept(o: Setup, problem: string) {
  const r = run(o);
  const g = await r.result;
  assert.deepEqual(g, { kind: 'kept', problem });
  assert.ok(!r.calls.includes(REVOKE_URL), '돌려주기를 부르면 안 된다');
}

test('캘린더 만들기 칸만 풀면 noApp', () => kept({ scope: `${GCAL_SCOPE} ${GCAL_LIST_SCOPE}` }, 'noApp'));
test('일정 칸만 풀면 noEvents', () => kept({ scope: `${GCAL_LIST_SCOPE} ${GCAL_APP_SCOPE}` }, 'noEvents'));
test('둘 다 풀면 noEvents', () => kept({ scope: GCAL_LIST_SCOPE }, 'noEvents'));
test('scope 글이 비어 있으면 아무것도 받은 것으로 치지 않는다', () => kept({ scope: '' }, 'noEvents'));
test('scope 칸이 아예 없어도 같다', () => kept({ noScope: true }, 'noApp'));
test('목록 칸만 풀면 같은 계정인지 볼 수 없어 noList', () =>
  kept({ scope: `${GCAL_SCOPE} ${GCAL_APP_SCOPE}`, listStatus: 403 }, 'noList'));
test('다른 구글 계정이면 account', () => kept({ primary: 'other@gmail.com' }, 'account'));
test('새 refresh token 이 없으면 failed', () => kept({ refresh: false }, 'failed'));
test('토큰 받기가 거절되면 failed', () => kept({ tokenStatus: 400 }, 'failed'));
test('허락 화면에서 거절하면 denied', () => kept({ browser: 'denied' }, 'denied'));
test('브라우저에서 오래 기다리면 timeout', () => kept({ browser: 'none' }, 'timeout'));

test('기다리는 동안 다른 요청이 대신했으면 cancelled 이고 아무것도 돌려주지 않는다', async () => {
  const r = run({ browser: 'none' });
  r.cancel();
  assert.deepEqual(await r.result, { kind: 'cancelled' });
});

test('브라우저를 열 수 없으면 failed', async () => {
  const g = await runGrant({
    f: async () => json(404, {}),
    client: CLIENT,
    now: () => NOW,
    expectedAccount: accountFingerprint(ME),
    page: () => ({ title: 't', body: 'b' }),
    onCancel: () => {},
    stillMine: () => true,
    openExternal: async () => {
      throw new Error('no browser');
    },
  });
  assert.deepEqual(g, { kind: 'kept', problem: 'failed' });
});

/** 브라우저 응답 뒤에 stillMine 을 바꾸는 시점을 고른다 */
async function cancelAt(when: 'start' | 'exchange' | 'list') {
  let mine = when !== 'start';
  const f: FetchLike = async (url) => {
    if (url === TOKEN_URL) {
      if (when === 'exchange') mine = false;
      return json(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600, scope: ALL });
    }
    if (when === 'list') mine = false;
    return json(200, { items: [{ id: ME, primary: true, accessRole: 'owner' }] });
  };
  return runGrant({
    f,
    client: CLIENT,
    now: () => NOW,
    expectedAccount: accountFingerprint(ME),
    page: () => ({ title: 't', body: 'b' }),
    onCancel: () => {},
    stillMine: () => mine,
    openExternal: async (url) => {
      const u = new URL(url);
      await new Promise<void>((resolve) => {
        get(`${u.searchParams.get('redirect_uri')}/?code=c&state=${u.searchParams.get('state')}`, (x) => {
          x.resume();
          x.on('end', resolve);
        }).on('error', () => resolve());
      });
    },
    timeoutMs: 200,
  });
}

test('토큰 받는 중, 목록 읽는 중, 서버가 열리기 전에 취소되면 granted 가 아니라 cancelled', async () => {
  assert.deepEqual(await cancelAt('exchange'), { kind: 'cancelled' });
  assert.deepEqual(await cancelAt('list'), { kind: 'cancelled' });
  assert.deepEqual(await cancelAt('start'), { kind: 'cancelled' });
});
