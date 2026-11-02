// GET /v1/features 의 요청 한도: 토큰이 있으면 계정별, 없으면 IP 별 (공유 IP 에서 서로 막지 않는다)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { client, type Harness, ip, startHarness } from './helpers';

let h: Harness;
const { api, newDevice, session } = client(() => h);
before(async () => {
  h = await startHarness({ features: { sync: 'everyone' } });
});
after(async () => {
  await h?.stop();
});

test('같은 IP 에서 토큰을 든 계정이 40번 물어도 막히지 않고, 계정마다 따로 센다', async () => {
  const shared = ip();
  for (const _ of [1, 2]) {
    const d = await newDevice();
    const tok = await session(d.id);
    const codes: number[] = [];
    for (let i = 0; i < 40; i++)
      codes.push((await api('GET', '/v1/features', { token: tok, ip: shared })).status);
    assert.equal(codes.filter((c) => c === 429).length, 0);
  }
});

test('계정 한도(1분 120번)를 넘으면 429 와 retry_after 초를 준다', async () => {
  const d = await newDevice();
  const tok = await session(d.id);
  const shared = ip();
  let last = 200;
  let body: { retry_after?: number } = {};
  for (let i = 0; i < 125 && last !== 429; i++) {
    const r = await api('GET', '/v1/features', { token: tok, ip: shared });
    last = r.status;
    body = r.body;
  }
  assert.equal(last, 429);
  assert.ok(
    typeof body.retry_after === 'number' && body.retry_after >= 1 && body.retry_after <= 60,
    String(body.retry_after),
  );
});

test('토큰이 없는 요청은 IP 한도(10분 600번)로 센다', async () => {
  const a = ip();
  let last = 200;
  for (let i = 0; i < 605 && last !== 429; i++) last = (await api('GET', '/v1/features', { ip: a })).status;
  assert.equal(last, 429);
  const other = await api('GET', '/v1/features', { ip: ip() });
  assert.equal(other.status, 200, '다른 IP 는 영향 없음');
});
