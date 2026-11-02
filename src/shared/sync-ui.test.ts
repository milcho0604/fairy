import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts } from './i18n/index.ts';
import type { ServerStatus } from './server-account.ts';
import {
  codeWhy,
  FRESH_MS,
  sizeText,
  syncBoxMode,
  syncErrorKey,
  syncLines,
  syncShown,
  syncUnavailable,
  usageRatio,
} from './sync-ui.ts';
import type { SyncView } from './sync-view.ts';

const view = (o: Partial<SyncView> = {}): SyncView => ({
  phase: 'on',
  problem: null,
  lastAt: null,
  offline: false,
  pending: 0,
  held: 0,
  usage: null,
  soon: false,
  running: false,
  ...o,
});

/** 서버 계정을 켜고 로그인했고 기능 키 sync 가 켜진 상태 */
const status = (o: Partial<ServerStatus> = {}): ServerStatus =>
  ({
    enabled: true,
    age: 'adult',
    on: true,
    signedIn: true,
    features: { sync: true },
    sync: view({ phase: 'off' }),
    ...o,
  }) as ServerStatus;

test('칸은 서버 계정 켬, 로그인, 기능 키 sync, 엔진 상태가 모두 있을 때만 보인다', () => {
  assert.equal(syncShown(status()), true);
  assert.equal(syncShown(undefined), false);
  assert.equal(syncShown(status({ enabled: false })), false, '서버 주소 없음');
  assert.equal(syncShown(status({ on: false })), false, '서버 계정 꺼짐');
  assert.equal(syncShown(status({ age: 'under14' })), false, '만 14세 미만');
  assert.equal(syncShown(status({ signedIn: false })), false, '로그인 안 함');
  assert.equal(syncShown(status({ features: { sync: false } })), false, '기능 키 꺼짐');
  assert.equal(syncShown(status({ features: {} })), false, '기능 키 모름');
  assert.equal(syncShown(status({ features: null })), false, '서버에 아직 닿지 않음');
  const { sync: _s, ...noEngine } = status();
  assert.equal(syncShown(noEngine as ServerStatus), false, '엔진 상태 없음');
});

test('기능 키가 꺼져도 이 기기가 켜 둔 상태면 칸이 보이고 쓸 수 없다고만 한다', () => {
  const off = (phase: SyncView['phase']) => status({ features: { sync: false }, sync: view({ phase }) });
  assert.equal(syncShown(off('off')), false, '꺼 둔 기기에는 숨김');
  for (const p of ['on', 'needCode', 'askUpload', 'enabling'] as const) {
    assert.equal(syncShown(off(p)), true, p);
    assert.equal(syncUnavailable(off(p)), true, p);
  }
  assert.equal(syncUnavailable(status({ sync: view({ phase: 'on' }) })), false, '키가 켜져 있으면 평소 모양');
  assert.equal(
    syncShown(status({ features: null, sync: view({ phase: 'on' }), signedIn: false })),
    false,
    '로그인 안 함',
  );
  assert.match(dicts.ko['sync.unavailable'], /지금은 동기화를 쓸 수 없어/);
});

test('크기는 서버 상한과 같은 1024 기준: 100MB 상한이 100MB 로 보인다', () => {
  assert.equal(sizeText(100 * 1024 * 1024), '100MB');
  assert.equal(sizeText(1620), '2KB');
  assert.equal(sizeText(1.5 * 1048576), '1.5MB');
  assert.equal(sizeText(0), '1KB');
});

test('칸 모양은 엔진 단계를 그대로 따른다', () => {
  assert.equal(syncBoxMode(view({ phase: 'off' })), 'off');
  assert.equal(syncBoxMode(view({ phase: 'enabling' })), 'enabling');
  assert.equal(syncBoxMode(view({ phase: 'needCode' })), 'code');
  assert.equal(syncBoxMode(view({ phase: 'askUpload' })), 'ask');
  assert.equal(syncBoxMode(view({ phase: 'on' })), 'on');
});

test('복구 코드 넣기 말은 멈춘 까닭을 따른다 (epoch 와 gen 은 따로)', () => {
  assert.equal(codeWhy(view({ phase: 'needCode', problem: 'epoch' })), 'sync.need.epoch');
  assert.equal(codeWhy(view({ phase: 'needCode', problem: 'gen' })), 'sync.need.gen');
  assert.equal(codeWhy(view({ phase: 'needCode' })), 'sync.need.lede');
  assert.match(dicts.ko['sync.need.epoch'], /다른 곳에서 동기화를 다시 시작했어. 복구 코드를 넣어 줘/);
});

test('상태 줄: 처음, 방금, 한참 전, 인터넷 없음, 보낼 것, 못 맞춘 것', () => {
  const now = 1_000_000_000;
  assert.deepEqual(
    syncLines(view(), now).map((l) => l.key),
    ['sync.on.never'],
  );
  assert.deepEqual(
    syncLines(view({ lastAt: now - 5000 }), now).map((l) => l.key),
    ['sync.on.fresh'],
  );
  const old = syncLines(view({ lastAt: now - FRESH_MS - 1 }), now);
  assert.deepEqual(
    old.map((l) => l.key),
    ['sync.on.at'],
  );
  assert.equal(old[0]?.at, now - FRESH_MS - 1);
  assert.deepEqual(
    syncLines(view({ running: true }), now).map((l) => l.key),
    ['sync.on.running'],
  );
  const off = syncLines(view({ offline: true, lastAt: now, pending: 3, held: 2 }), now);
  assert.deepEqual(
    off.map((l) => l.key),
    ['sync.on.offline', 'sync.on.pending', 'sync.on.held'],
  );
  assert.equal(off[1]?.n, 3);
  assert.equal(off[2]?.n, 2);
  assert.equal(off[2]?.tone, 'warn');
});

test('상태 줄: 사용량 80% 부터 경고, 곧 지워짐, 멈춘 까닭', () => {
  const now = 1_000_000_000;
  const use = (items: number, bytes: number) => ({ items, bytes, maxItems: 100, maxBytes: 1000 });
  assert.equal(usageRatio(view()), null);
  assert.equal(usageRatio(view({ usage: use(10, 900) })), 0.9, '개수와 크기 중 큰 쪽');
  const keys = (u: SyncView['usage']) => syncLines(view({ lastAt: now, usage: u }), now).map((l) => l.key);
  assert.ok(!keys(use(79, 790)).includes('sync.usage.warn'));
  assert.ok(keys(use(80, 100)).includes('sync.usage.warn'));
  assert.equal(syncLines(view({ lastAt: now, usage: use(95, 0) }), now).find((l) => l.pct)?.pct, 95);
  assert.equal(syncLines(view({ lastAt: now, usage: use(500, 0) }), now).find((l) => l.pct)?.pct, 100);
  assert.ok(syncLines(view({ lastAt: now, soon: true }), now).some((l) => l.key === 'sync.soon'));
  const full = syncLines(view({ lastAt: now, problem: 'full' }), now);
  assert.equal(full[0]?.key, 'sync.problem.full');
  assert.equal(full[0]?.tone, 'warn');
  assert.equal(syncLines(view({ lastAt: now, problem: 'login' }), now)[0]?.tone, 'error');
});

test('엔진 오류 코드는 말의 키로, 모르는 것은 일반 실패', () => {
  assert.equal(syncErrorKey('code'), 'sync.need.bad');
  assert.equal(syncErrorKey('offline'), 'sync.err.offline');
  assert.equal(syncErrorKey('secure'), 'sync.err.secure');
  assert.equal(syncErrorKey('epoch'), 'sync.need.epoch');
  assert.equal(syncErrorKey('whatever'), 'sync.err.failed');
});

test('화면이 쓰는 모든 동기화 말이 ko, en 에 있고 "모드" 와 한글(en)이 섞이지 않는다', () => {
  const ko = dicts.ko as Record<string, unknown>;
  const en = dicts.en as Record<string, unknown>;
  for (const k of Object.keys(ko).filter((x) => x.startsWith('sync.') || x.startsWith('note.conflictCopy'))) {
    assert.equal(typeof en[k], 'string', `${k} 영어 없음`);
    assert.ok(!String(ko[k]).includes('모드'), k);
    if (k !== 'sync.searchKeys') assert.ok(!/[가-힣]/.test(String(en[k])), `${k} 영어에 한글`);
  }
  assert.equal(ko['sync.need.bad'], '코드가 맞지 않아.');
  assert.equal(ko['note.conflictCopy'], '충돌 사본');
});

test('기능 키를 아직 못 받았으면(null) 켜 둔 기기도 "쓸 수 없음" 이 아니라 평소 모양이다', () => {
  const s = status({ features: null, sync: view({ phase: 'on' }) });
  assert.equal(syncUnavailable(s), false);
  assert.equal(syncShown(s), true, '켜 둔 기기는 모를 때도 보인다');
  assert.equal(syncShown(status({ features: null })), false, '꺼 둔 기기는 모르면 숨김');
});

test('서버가 준 feature_off, update_required 는 각자 말로', () => {
  assert.equal(syncErrorKey('feature_off'), 'sync.problem.feature');
  assert.equal(syncErrorKey('update_required'), 'sync.problem.update');
});
