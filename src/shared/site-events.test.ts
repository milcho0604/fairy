import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkNickname, deviceCodeFrom, normalizeDeviceCode } from './account-profile.ts';
import {
  boostDays,
  COUPON_ALPHABET,
  EVENTS_MAX_BYTES,
  eventPhase,
  formatCoupon,
  kstDay,
  kstIso,
  normalizeCoupon,
  parseEvent,
  parseEvents,
  visibleEvents,
} from './site-events.ts';
import { checkEvents, checkNotices } from './site-feeds.ts';

const gift = {
  id: '2026-10-gift',
  kind: 'gift',
  title: { ko: '선물', en: 'Gift' },
  body: { ko: '코인을 받아', en: 'Get coins' },
  from: '2026-10-20T00:00:00+09:00',
  until: '2026-10-27T00:00:00+09:00',
  coins: 50,
};
const boost = {
  ...gift,
  id: 'boost-1',
  kind: 'boost',
  coins: undefined,
  boost: { reasons: ['meet', 'meet', 'focus'], times: 2 },
};

test('이벤트 하나: 선물과 배수, 깨진 칸은 그것만 버린다', () => {
  assert.equal(parseEvent(gift)?.coins, 50);
  assert.deepEqual(parseEvent(boost)?.boost, { reasons: ['meet', 'focus'], times: 2 });
  for (const bad of [
    { ...gift, id: 'x'.repeat(41) },
    { ...gift, id: '../x' },
    { ...gift, kind: 'lottery' },
    { ...gift, coins: 0 },
    { ...gift, coins: 1001 },
    { ...gift, until: gift.from },
    { ...gift, from: 'nope' },
    { ...gift, title: { ko: '선물' } },
    { ...gift, title: { ko: 'a'.repeat(61), en: 'a' } },
    { ...boost, boost: { reasons: ['todo'], times: 2 } },
    { ...boost, boost: { reasons: ['meet'], times: 5 } },
    { ...boost, boost: { reasons: [], times: 2 } },
  ])
    assert.equal(parseEvent(bad), undefined, JSON.stringify(bad).slice(0, 60));
});

test('파일: 형식 판, 크기, 같은 id, 버린 수', () => {
  const ok = parseEvents(JSON.stringify({ version: 1, events: [gift, gift, { ...gift, kind: 'x' }, boost] }));
  assert.equal(ok?.events.length, 2);
  assert.equal(ok?.dropped, 2);
  assert.equal(parseEvents(JSON.stringify({ version: 2, events: [] })), undefined);
  assert.equal(parseEvents('nope'), undefined);
  assert.equal(parseEvents(' '.repeat(EVENTS_MAX_BYTES + 1)), undefined);
});

test('보이는 이벤트와 때, 한국 날짜, 배수 날', () => {
  const e = parseEvent(gift);
  assert.ok(e);
  assert.equal(eventPhase(e, e.from - 1), 'soon');
  assert.equal(eventPhase(e, e.from), 'live');
  assert.equal(eventPhase(e, e.until), 'ended');
  assert.deepEqual(visibleEvents([e], e.from - 8 * 86_400_000), []);
  assert.equal(visibleEvents([e], e.until + 86_400_000).length, 1);
  assert.equal(kstDay(Date.parse('2026-10-19T15:00:00Z')), '2026-10-20');
  assert.equal(kstIso(Date.parse('2026-10-19T15:00:00Z')), '2026-10-20T00:00:00+09:00');
  assert.deepEqual(boostDays(e), { first: '2026-10-20', last: '2026-10-26' });
});

test('쿠폰 코드: 대소문자, 붙임표, 헷갈리는 글자 없음', () => {
  assert.equal(normalizeCoupon('abcd-efgh-jkmn'), 'ABCDEFGHJKMN');
  assert.equal(normalizeCoupon(' ABCD EFGH JKMN '), 'ABCDEFGHJKMN');
  for (const bad of ['ABCD-EFGH-JKM', 'ABCD-EFGH-JKMO', 'ABCD-EFGH-JKM1', 'ABCD-EFGH-JKMI', '', 3])
    assert.equal(normalizeCoupon(bad), undefined, String(bad));
  assert.equal(formatCoupon('ABCDEFGHJKMN'), 'ABCD-EFGH-JKMN');
  for (const c of '01ILOU') assert.ok(!COUPON_ALPHABET.includes(c));
});

test('닉네임: 2~12자, NFC, 금지 글자', () => {
  assert.deepEqual(checkNickname('  짝꿍  '), { ok: true, value: '짝꿍' });
  assert.deepEqual(checkNickname('한글'), { ok: true, value: '한글' });
  assert.deepEqual(checkNickname('Mr.Kim'), { ok: true, value: 'Mr.Kim' });
  const bad: [unknown, string][] = [
    ['a', 'length'],
    ['a'.repeat(13), 'length'],
    ['a\nb', 'chars'],
    ['a​b', 'chars'],
    ['a‮b', 'chars'],
    ['\u3164\u3164', 'chars'],
    ['\u2800\u2800', 'chars'],
    ['\u115F\u115F', 'chars'],
    ['\u1160\u1160', 'chars'],
    ['\uFFA0\uFFA0', 'chars'],
    ['a\u3164\u3164b', 'chars'],
    ['\u0301\u0301', 'chars'],
    ['me@x', 'at'],
    ['https://x', 'url'],
    ['www.abc', 'url'],
    ['shop.com', 'url'],
    [42, 'length'],
  ];
  for (const [v, e] of bad) assert.deepEqual(checkNickname(v), { ok: false, error: e }, String(v));
});

test('기기 코드: 모양, 사람이 친 값 맞추기', () => {
  const code = deviceCodeFrom(new Uint8Array([0, 1, 2, 3, 31, 32, 63, 255]));
  assert.equal(code, 'F-0123-Z0ZZ');
  assert.equal(normalizeDeviceCode('f-0123-z0zz'), code);
  assert.equal(normalizeDeviceCode('0123z0zz'), code);
  assert.equal(normalizeDeviceCode('F-O123-ZOZZ'), code);
  assert.equal(normalizeDeviceCode('F-0123-Z0'), undefined);
  assert.equal(normalizeDeviceCode('F-0123-Z0ZU'), undefined);
});

test('올리기 전 엄격한 검사: 앱이 하나라도 버리면 실패', () => {
  assert.equal(checkEvents(JSON.stringify({ version: 1, events: [gift] })).ok, true);
  assert.equal(checkEvents(JSON.stringify({ version: 1, events: [gift, { ...gift, kind: 'x' }] })).ok, false);
  const notice = {
    id: 'n1',
    kind: 'info',
    title: { ko: '알림', en: 'Note' },
    body: { ko: '본문', en: 'Body' },
    link: 'https://fairy.moilga.com/news/1',
  };
  assert.equal(checkNotices(JSON.stringify({ version: 1, minVersion: '0.4.3', notices: [notice] })).ok, true);
  assert.equal(
    checkNotices(JSON.stringify({ version: 1, notices: [{ ...notice, link: 'https://evil.example' }] })).ok,
    false,
  );
  assert.equal(checkNotices(JSON.stringify({ version: 1, minVersion: 'x', notices: [] })).ok, false);
  assert.equal(checkNotices('[]').ok, false);
});

test('레포의 홈페이지 정적 파일은 엄격한 검사를 통과한다', () => {
  const root = new URL('../../site/', import.meta.url);
  assert.equal(checkEvents(readFileSync(new URL('events.json', root), 'utf8')).ok, true);
  assert.equal(checkNotices(readFileSync(new URL('notices.json', root), 'utf8')).ok, true);
});
