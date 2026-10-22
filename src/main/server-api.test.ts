// 서버 요청 함수 시험 (이슈 #120, PR #127 버그잡이): 모든 요청이 앱 판 머리를 보내고, 426 을 알리는지.
// 머리는 한 곳(gated)에서만 붙으므로, 요청 함수를 하나씩 불러 나간 요청을 모두 검사한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminLogFilter, adminQuery, gated, serverApi } from './server-api.ts';

const item = {
  id: 1,
  size: 1,
  sha256: 'a'.repeat(64),
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: '2026-01-02T00:00:00Z',
  soon: false,
};

test('서버 요청 함수는 전부 앱 판 머리를 보낸다 (채팅, 백업 올리기와 받기 포함)', async () => {
  const seen: { key: string; version: string | undefined }[] = [];
  const raw = async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    seen.push({
      key: `${init.method} ${new URL(url).pathname}`,
      version: h.get('x-fairy-version') ?? undefined,
    });
    return new Response('{"error":"x"}', { status: 500, headers: { 'content-type': 'application/json' } });
  };
  const api = serverApi('http://x', raw, { appVersion: '0.5.0' });
  const fns = Object.entries(api).filter(([, v]) => typeof v === 'function') as [
    string,
    (...a: unknown[]) => unknown,
  ][];
  for (const [, fn] of fns) {
    try {
      // 인자는 모양만 맞춘다 (토큰, 본문, 콜백, 중단 신호는 비움). 요청이 나가는 데 필요한 것만
      await fn('fd_x', item, () => {}, undefined);
    } catch {
      // 모양이 안 맞는 인자는 그 함수 안에서 던진다. 요청이 나갔는지만 본다
    }
  }
  assert.ok(seen.length >= 20, `요청이 충분히 나갔다 (${seen.length}개, 함수 ${fns.length}개)`);
  for (const s of seen) assert.equal(s.version, '0.5.0', s.key);
  assert.ok(
    seen.some((s) => s.key.includes('/v1/ai/chat')),
    '채팅 요청 포함',
  );
  assert.ok(
    seen.some((s) => s.key.startsWith('PUT /v1/backup')),
    '백업 올리기 포함',
  );
  assert.ok(
    seen.some((s) => s.key.startsWith('GET /v1/backup/')),
    '백업 받기 포함',
  );
  // 구글 일정 연결 (#115): 기기의 연결 표시를 바꾸는 요청도 머리를 달고 나간다
  assert.ok(
    seen.some((s) => s.key === 'PATCH /v1/account'),
    '구글 일정 연결 바꾸기 포함',
  );
});

test('판을 모르면 머리를 보내지 않는다 (시험용 서버 기준 없음)', async () => {
  let version: string | null = 'unset';
  const raw = async (_url: string, init: RequestInit) => {
    version = new Headers(init.headers).get('x-fairy-version');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await serverApi('http://x', raw).me('fd_x');
  assert.equal(version, null);
});

test('426 은 단계와 필요한 판을 알리고, 통과한 요청은 막힌 것을 푼다 (채팅 포함)', async () => {
  const got: unknown[] = [];
  let status = 426;
  const raw = async () =>
    status === 426
      ? new Response(JSON.stringify({ error: 'update_required', need: '0.4.4', level: 'restrict' }), {
          status: 426,
          headers: { 'content-type': 'application/json' },
        })
      : new Response('{"balance":1,"items":{},"results":[]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
  const f = gated(raw, '0.4.3', (g) => got.push(g));
  await f('http://x/v1/ai/chat', { method: 'POST' });
  assert.deepEqual(got, [{ level: 'restrict', need: '0.4.4' }]);
  status = 200;
  await f('http://x/v1/sync', { method: 'POST' });
  assert.deepEqual(got.at(-1), null);
  // 설정 칸의 자리(/v1/me)는 관문을 건너므로 막힌 것을 풀지 않는다
  status = 426;
  await f('http://x/v1/features', { method: 'GET' });
  status = 200;
  await f('http://x/v1/me', { method: 'GET' });
  assert.equal(got.length, 3);
});

test('운영자 개요 주소: 계정 찾기와 운영 기록 찾기 칸만 붙고, 비면 붙지 않는다 (#155)', () => {
  assert.equal(adminQuery(), '');
  assert.equal(adminQuery('', {}), '');
  assert.equal(adminQuery('F-1111-2222'), '?q=F-1111-2222');
  assert.equal(
    adminQuery(undefined, { user: '고양이', action: 'event.end', text: 'a b', page: 3 }),
    '?user=%EA%B3%A0%EC%96%91%EC%9D%B4&action=event.end&text=a+b&page=3',
  );
  assert.equal(adminQuery(undefined, { page: 1 }), '');
});

test('운영 기록 찾기 칸은 글자만 받고 길이를 자른다 (#155)', () => {
  assert.equal(adminLogFilter(undefined), undefined);
  assert.equal(adminLogFilter([]), undefined);
  assert.deepEqual(adminLogFilter({ user: ' 가나 ', action: 'x'.repeat(99), text: 5, page: 2.5 }), {
    user: '가나',
    action: 'x'.repeat(40),
    text: '',
  });
  assert.deepEqual(adminLogFilter({ page: 4 }), { user: '', action: '', text: '', page: 4 });
});

test('운영자 개요 요청은 찾기 칸을 서버 주소에 싣는다 (#155)', async () => {
  const urls: string[] = [];
  const raw = async (url: string) => {
    urls.push(url);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const api = serverApi('http://x', raw, { appVersion: '0.5.0' });
  await api.adminOverview('fs_t', 'q1', { user: 'u', action: 'ai.block' });
  assert.equal(urls[0], 'http://x/v1/admin/overview?q=q1&user=u&action=ai.block');
});
