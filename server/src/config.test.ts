import assert from 'node:assert/strict';
import test from 'node:test';
import { googleEnabled, readConfig } from './config';

test('DATABASE_URL 이 없으면 뜨지 않는다', () => {
  assert.throws(() => readConfig({}), /DATABASE_URL/);
});

test('PORT 는 기본 3002, 숫자가 아니면 거절', () => {
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).port, 3002);
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x', PORT: '4000' }).port, 4000);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PORT: 'abc' }), /PORT/);
});

test('PUBLIC_URL 은 기본 fairy-api.moilga.com, https 만 (127.0.0.1 은 http 허락)', () => {
  assert.equal(readConfig({ DATABASE_URL: 'postgres://x' }).publicUrl, 'https://fairy-api.moilga.com');
  assert.equal(
    readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'https://a.example/' }).publicUrl,
    'https://a.example',
  );
  assert.equal(
    readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://127.0.0.1:9' }).publicUrl,
    'http://127.0.0.1:9',
  );
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'http://a.example' }), /https/);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgres://x', PUBLIC_URL: 'nope' }), /PUBLIC_URL/);
});

test('구글 로그인은 클라이언트 번호와 비밀이 둘 다 있어야 켜진다', () => {
  assert.equal(googleEnabled(readConfig({ DATABASE_URL: 'postgres://x' })), false);
  assert.equal(googleEnabled(readConfig({ DATABASE_URL: 'postgres://x', GOOGLE_CLIENT_ID: 'a' })), false);
  assert.equal(
    googleEnabled(
      readConfig({ DATABASE_URL: 'postgres://x', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }),
    ),
    true,
  );
});

test('AI 대화권: 기본은 공식 주소와 Haiku, 월 80달러, 하루 20번. 주소는 https 만, 모델 이름 검사', () => {
  assert.deepEqual(readConfig({ DATABASE_URL: 'postgres://x' }).ai, {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    monthlyBudgetMicros: 80_000_000,
    dailyLimit: 20,
  });
  assert.deepEqual(
    readConfig({
      DATABASE_URL: 'postgres://x',
      ANTHROPIC_API_KEY: ' k ',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/',
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      AI_MONTHLY_BUDGET_USD: '0.5',
      AI_DAILY_LIMIT: '3',
    }).ai,
    {
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:9',
      model: 'claude-sonnet-5-5',
      monthlyBudgetMicros: 500_000,
      dailyLimit: 3,
    },
  );
  const env = { DATABASE_URL: 'postgres://x' };
  assert.throws(() => readConfig({ ...env, ANTHROPIC_BASE_URL: 'http://api.example' }), /https/);
  assert.throws(() => readConfig({ ...env, ANTHROPIC_MODEL: 'bad model' }), /ANTHROPIC_MODEL/);
  assert.throws(() => readConfig({ ...env, AI_DAILY_LIMIT: '1.5' }), /AI_DAILY_LIMIT/);
  assert.throws(() => readConfig({ ...env, AI_MONTHLY_BUDGET_USD: '-1' }), /AI_MONTHLY_BUDGET_USD/);
});
