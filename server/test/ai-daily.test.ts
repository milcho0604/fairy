// 통합 시험 (버그잡이 #113): GIFT_HMAC_KEY 가 없는 개발, 시험 서버에서 하루 질문 수는 계정 번호로 센다.
// 합쳐진 계정의 수도 남는 쪽 가족 전체로 더해, 합치기로 하루 수가 초기화되지 않는다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { client, type Harness, startHarness } from './helpers';

let h: Harness;
const { api, newDevice, session } = client(() => h);
const accountKey = (id: string) => createHash('sha256').update(`account:${id}`).digest();

before(async () => {
  h = await startHarness({
    ai: {
      apiKey: '',
      baseUrl: 'http://127.0.0.1:9',
      model: 'claude-haiku-5-5',
      monthlyBudgetMicros: 1_000_000,
      dailyLimit: 5,
      maxInputChars: 8000,
      giftKey: '',
    },
  });
  await h.pool.query(`UPDATE feature_flag SET mode = 'everyone' WHERE key = 'ai_chat'`);
});

after(async () => {
  await h?.stop();
});

test('합쳐진 계정의 오늘 질문 수도 남는 쪽에 센다 (합치기로 하루 상한이 풀리지 않는다)', async () => {
  const a = await newDevice('18+');
  const b = await newDevice('18+');
  const s = await session(b.id);
  await h.pool.query(
    `INSERT INTO ai_daily (key_hmac, day, used) VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, 3)`,
    [accountKey(a.id)],
  );
  await h.pool.query('UPDATE account SET merged_into = $2, closed_at = now() WHERE id = $1', [a.id, b.id]);
  const r = await api('GET', '/v1/ai', { token: s });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.usedToday, 3);
});
