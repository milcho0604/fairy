import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts, getLang, locale, resolveLang, setLang, t } from './index.ts';

// 사전에 없는 키를 시험할 때 쓰는 느슨한 t
const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

// 함수 값에 넣어 볼 값: 글처럼도 숫자처럼도 쓰인다 (String 객체 '2')
const sample = new Proxy({}, { get: () => new String('2') }) as never;
const render = (v: unknown) => (typeof v === 'function' ? (v as (vars: never) => string)(sample) : v);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('영어 사전은 한국어 사전의 키를 모두 갖고 빈 값이 없다', () => {
  const ko = dicts.ko as Record<string, unknown>;
  const en = dicts.en as Record<string, unknown>;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  for (const [key, koValue] of Object.entries(ko)) {
    const enValue = en[key];
    assert.equal(typeof enValue, typeof koValue, key);
    for (const v of [koValue, enValue]) {
      const out = render(v);
      assert.equal(typeof out, 'string', key);
      assert.ok((out as string).trim().length > 0, `${key} 가 비었다`);
      assert.ok(!/undefined|\[object /.test(out as string), `${key}: ${out}`);
    }
    if (typeof koValue === 'string')
      assert.deepEqual(placeholders(enValue as string), placeholders(koValue), `${key} 의 {} 가 다르다`);
  }
});

test('사전 글에 긴 줄표와 가운뎃점을 쓰지 않는다', () => {
  for (const dict of [dicts.ko, dicts.en])
    for (const [key, v] of Object.entries(dict)) {
      const out = String(render(v));
      assert.ok(!/[\u2014\u00b7]/.test(out), `${key}: ${out}`);
    }
});

test('기본은 한국어, 영어로 바꾸면 영어, 모르는 말은 한국어', () => {
  assert.equal(getLang(), 'ko');
  assert.equal(t('common.ok'), '확인');
  setLang('en');
  assert.equal(t('common.ok'), 'OK');
  assert.equal(locale(), 'en-US');
  setLang('fr' as never);
  assert.equal(getLang(), 'ko');
  assert.equal(locale(), 'ko-KR');
});

test('지금 말에 키가 없으면 한국어, 그것도 없으면 키', () => {
  const en = dicts.en as Record<string, unknown>;
  const saved = en['common.ok'];
  delete en['common.ok'];
  try {
    setLang('en');
    assert.equal(t('common.ok'), '확인');
    assert.equal(looseT('nope.key'), 'nope.key');
  } finally {
    en['common.ok'] = saved;
    setLang('ko');
  }
});

test('글 안의 {이름} 을 채우고 모르는 이름은 그대로 둔다', () => {
  const ko = dicts.ko as Record<string, unknown>;
  ko['test.vars'] = '{name} 안녕 {n}개 {x}';
  try {
    assert.equal(looseT('test.vars', { name: '콩', n: 3 }), '콩 안녕 3개 {x}');
  } finally {
    delete ko['test.vars'];
  }
});

test('자동이면 운영체제 첫 말이 한국어일 때만 한국어', () => {
  assert.equal(resolveLang('auto', ['ko-KR', 'en-US']), 'ko');
  assert.equal(resolveLang('auto', ['ko']), 'ko');
  assert.equal(resolveLang('auto', ['en-US', 'ko-KR']), 'en');
  assert.equal(resolveLang('auto', ['ja-JP']), 'en');
  assert.equal(resolveLang('auto', []), 'en');
  assert.equal(resolveLang('ko', ['en-US']), 'ko');
  assert.equal(resolveLang('en', ['ko-KR']), 'en');
});
