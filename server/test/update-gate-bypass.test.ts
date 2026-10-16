// 업데이트 관문 우회 시험 (이슈 #120, PR #127 버그잡이): 대소문자, 절대 형식 경로, 인코딩된 슬래시, 점 조각,
// 긴 머리, 미리 나온 판(-beta)과 앞자리 0 머리. 실제 HTTP 줄을 그대로 보내 Express 까지 간다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { client, type Harness, startHarness } from './helpers';

const ADMIN_TOKEN = 'd'.repeat(20) + randomUUID().replaceAll('-', '');
const ADMIN_SUB = `admin-sub-${randomUUID()}`;
let h: Harness;
let release: Server;
let adminSession = '';
let tok = '';
const { api, newDevice, session } = client(() => h);

/** 원시 HTTP 줄로 요청한다 (경로를 그대로 보낸다, 정리하지 않는다). 대답 상태 코드만 돌려준다 */
function raw(method: string, path: string, headers: Record<string, string> = {}): Promise<number> {
  const u = new URL(h.base);
  return new Promise((res, rej) => {
    const r = request({ host: u.hostname, port: u.port, method, path, headers }, (x) => {
      x.resume();
      x.on('end', () => res(x.statusCode ?? 0));
    });
    r.on('error', rej);
    r.end();
  });
}

before(async () => {
  release = createServer((_q, s) => {
    s.setHeader('content-type', 'application/json');
    s.end(
      JSON.stringify({
        tag_name: 'v0.5.0',
        html_url: 'https://github.com/milcho0604/fairy-releases/releases/latest',
      }),
    );
  });
  await new Promise<void>((r) => release.listen(0, '127.0.0.1', r));
  const port = (release.address() as AddressInfo).port;
  h = await startHarness({
    adminToken: ADMIN_TOKEN,
    adminSubs: [ADMIN_SUB],
    releasesApi: `http://127.0.0.1:${port}/latest`,
  });
  const admin = await newDevice('18+', '운영자');
  adminSession = await session(admin.id, ADMIN_SUB);
  tok = (await newDevice('18+', '우회시험')).token;
  // 기능 제한 0.4.5 를 건다 (최신 0.5.0 이하)
  const r = await api('POST', '/v1/admin/versions', {
    token: adminSession,
    body: { minVersion: '0.4.0', restrictVersion: '0.4.5', confirm: 'yes' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

after(async () => {
  await h?.stop();
  release?.close();
});

const auth = () => ({ authorization: `Bearer ${tok}` });

describe('경로 우회 막기', () => {
  test('머리가 없으면 기능이 426 으로 막힌다 (기준선)', async () => {
    assert.equal(await raw('GET', '/v1/features', auth()), 426);
  });

  test('대문자 /V1/ 로 와도 막힌다 (Express 는 대소문자를 가리지 않는다)', async () => {
    assert.equal(await raw('GET', '/V1/features', auth()), 426);
  });

  test('절대 형식 요청 줄(http://host/v1/..)로 와도 막힌다', async () => {
    assert.equal(await raw('GET', `${h.base}/v1/features`, auth()), 426);
  });

  test('인코딩된 슬래시와 점 조각으로 기능에 닿지 못한다', async () => {
    assert.notEqual(await raw('GET', '/v1%2Ffeatures', auth()), 200);
    assert.notEqual(await raw('GET', '/v1/admin/%2E%2E/features', auth()), 200);
    assert.notEqual(await raw('GET', ['/v1/admin', '..', 'features'].join('/'), auth()), 200);
  });
});

describe('머리 값 읽기', () => {
  test('긴 머리는 낡은 판으로 보고 막는다', async () => {
    assert.equal(await raw('GET', '/v1/features', { ...auth(), 'x-fairy-version': '9'.repeat(8000) }), 426);
  });

  test('미리 나온 판(-beta)은 그 숫자 판으로 본다 (0.5.0-beta → 0.5.0, 기준 0.4.5 이상이라 통과)', async () => {
    assert.equal(await raw('GET', '/v1/features', { ...auth(), 'x-fairy-version': '0.5.0-beta' }), 200);
  });

  test('미리 나온 판이라도 기준보다 낮으면 막힌다 (0.4.4-beta → 0.4.4 < 0.4.5)', async () => {
    assert.equal(await raw('GET', '/v1/features', { ...auth(), 'x-fairy-version': '0.4.4-beta.1' }), 426);
  });

  test('앞자리 0 이 붙은 판은 숫자로 같다 (0000.0005.0000 = 0.5.0)', async () => {
    assert.equal(await raw('GET', '/v1/features', { ...auth(), 'x-fairy-version': '0000.0005.0000' }), 200);
  });

  test('빌드 표시(+build)도 떼고 본다', async () => {
    assert.equal(await raw('GET', '/v1/features', { ...auth(), 'x-fairy-version': '0.5.0+abc123' }), 200);
    assert.equal(await raw('GET', '/v1/features', { ...auth(), 'x-fairy-version': '0.4.4+abc123' }), 426);
  });
});

describe('공지 파일 머리 요청', () => {
  test('HEAD 로 공지 파일을 받아도 관문을 건너 파일 확인이 된다', async () => {
    assert.notEqual(await raw('HEAD', '/v1/notices.json', {}), 426);
    assert.notEqual(await raw('HEAD', '/v1/events.json', {}), 426);
  });
});
