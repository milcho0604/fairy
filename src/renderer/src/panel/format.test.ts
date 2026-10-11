import assert from 'node:assert/strict';
import { test } from 'node:test';

// 서머타임이 있는 시간대로 센다 (이 파일만 따로 도는 프로세스라 다른 시험에 번지지 않는다)
process.env.TZ = 'America/New_York';
const { addedText, ago } = await import('./format.ts');
const { t } = await import('../../../shared/i18n/index.ts');

test('ago: 서머타임이 끝나는 날(25시간) 이른 시각도 다음 날에는 "어제"다', () => {
  // 2026-11-01 은 미국 동부 서머타임이 끝나 하루가 25시간이다
  const ms = new Date(2026, 10, 1, 0, 30).getTime();
  const now = new Date(2026, 10, 2, 10, 0).getTime();
  assert.equal(ago(ms, now), t('panel.ago.yesterday'));
});

test('ago: 서머타임이 시작하는 날(23시간) 늦은 시각을 이틀 뒤에 "어제"라 하지 않는다', () => {
  // 2026-03-08 은 하루가 23시간이다. 3월 7일 23:30 은 3월 9일에 보면 어제가 아니다
  const ms = new Date(2026, 2, 7, 23, 30).getTime();
  assert.notEqual(ago(ms, new Date(2026, 2, 9, 0, 10).getTime()), t('panel.ago.yesterday'));
  assert.equal(ago(ms, new Date(2026, 2, 8, 22, 0).getTime()), t('panel.ago.yesterday'));
});

test('addedText: 모레 뒤 마감은 요일까지 보인다 (주말에 적은 "이번 주 금요일"이 어느 금요일인지)', () => {
  const sat = '2026-10-17';
  const r = { ok: true as const, kind: 'todo' as const, id: 1 };
  assert.equal(addedText({ ...r, due: '2026-10-23' }, sat), '할 일에 넣었어 (10월 23일 (금)까지)');
  assert.equal(addedText({ ...r, due: '2026-10-18' }, sat), '할 일에 넣었어 (내일까지)');
  assert.equal(addedText({ ...r, due: null }, sat), '할 일에 넣었어');
});
