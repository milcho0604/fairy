import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  allowedLink,
  applies,
  forceNotice,
  inVersionRange,
  markConfirmed,
  markShown,
  NOTICES_MAX_BYTES,
  NOTICES_URL,
  type Notice,
  type NoticeSeen,
  noticesUrl,
  type PickContext,
  parseNotice,
  parseNotices,
  pickNotice,
  pruneSeen,
  readSeen,
  sameMinVersion,
} from './notices.ts';
import { SITE_URL } from './update-policy.ts';

const text = (s: string) => ({ ko: `${s} 한국어`, en: `${s} English` });
const raw = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  kind: 'info',
  title: text('제목'),
  body: text('본문'),
  ...over,
});
const file = (notices: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, notices, ...extra });

test('홈페이지에 올리는 공지 파일은 지금 아무것도 띄우지 않고 잠그지도 않는다', () => {
  const f = parseNotices(readFileSync(new URL('../../site/notices.json', import.meta.url), 'utf8'));
  assert.deepEqual(f, { notices: [] });
  assert.equal(NOTICES_URL, `${SITE_URL}/notices.json`);
});

test('파일 전체를 못 읽으면 아무것도 (잠그지도 않는다)', () => {
  assert.equal(parseNotices('{'), undefined);
  assert.equal(parseNotices(''), undefined);
  assert.equal(parseNotices(null), undefined);
  assert.equal(parseNotices('[]'), undefined);
  assert.equal(parseNotices(JSON.stringify({ version: 1 })), undefined);
  assert.equal(parseNotices(JSON.stringify({ version: 2, notices: [], minVersion: '0.4.4' })), undefined);
  assert.equal(parseNotices(JSON.stringify({ notices: [], minVersion: '0.4.4' })), undefined);
  // 64KB 를 넘으면 (한글은 글자당 3바이트라 글자 수가 아니라 바이트로 잰다)
  const big = file([raw()], { pad: 'a'.repeat(NOTICES_MAX_BYTES) });
  assert.equal(parseNotices(big), undefined);
  const bigKo = file([raw()], { pad: '가'.repeat(Math.ceil(NOTICES_MAX_BYTES / 3)) });
  assert.ok(bigKo.length < NOTICES_MAX_BYTES);
  assert.equal(parseNotices(bigKo), undefined);
  assert.ok(parseNotices(file([raw()], { pad: 'a'.repeat(1000) })));
});

test('minVersion: 숫자 셋만, 이상하면 없는 것으로', () => {
  assert.equal(parseNotices(file([], { minVersion: '0.4.4' }))?.minVersion, '0.4.4');
  for (const bad of ['0.4', 'v0.4.4', '0.4.4-beta', 44, null, '0.4.4 ', '<0.4.4'])
    assert.equal(parseNotices(file([], { minVersion: bad }))?.minVersion, undefined, String(bad));
});

test('깨진 공지와 모르는 kind 는 그것만 버린다', () => {
  const f = parseNotices(
    file([
      raw({ id: 'ok1' }),
      raw({ id: 'k', kind: 'popup' }),
      raw({ id: 'no-en', title: { ko: '한국어만' } }),
      raw({ id: 'empty', body: { ko: '  ', en: 'x' } }),
      raw({ id: 'long', title: text('가'.repeat(100)) }),
      raw({ id: 'bad id!' }),
      raw({ id: 'time', from: '어제' }),
      raw({ id: 'order', from: '2026-10-20T00:00:00+09:00', until: '2026-10-19T00:00:00+09:00' }),
      raw({ id: 'ver', versions: '~0.4' }),
      raw({ id: 'plat', platforms: ['beos'] }),
      raw({ id: 'plat2', platforms: 'darwin' }),
      'not an object',
      null,
      [],
      raw({ id: 'ok1', kind: 'important' }),
      raw({ id: 'ok2', kind: 'force' }),
    ]),
  );
  assert.deepEqual(
    f?.notices.map((n) => `${n.id}:${n.kind}`),
    ['ok1:info', 'ok2:force'],
  );
});

test('본문은 글자만: 제어 문자를 지우고 HTML 은 글자 그대로 둔다', () => {
  const n = parseNotice(raw({ body: { ko: '<b>굵게</b>\u0007\r\n둘째 줄\u001b', en: 'a\tb' } }));
  assert.equal(n?.body.ko, '<b>굵게</b>\n둘째 줄');
  assert.equal(n?.body.en, 'ab');
});

test('링크는 홈페이지와 github.com/milcho0604 아래만', () => {
  assert.equal(allowedLink('https://fairy.moilga.com/news/1'), 'https://fairy.moilga.com/news/1');
  assert.equal(
    allowedLink('https://github.com/milcho0604/fairy-releases/releases'),
    'https://github.com/milcho0604/fairy-releases/releases',
  );
  assert.equal(allowedLink('https://github.com/milcho0604'), 'https://github.com/milcho0604');
  for (const bad of [
    'http://fairy.moilga.com/',
    'https://fairy.moilga.com.evil.example/',
    'https://evil.example/?https://fairy.moilga.com',
    'https://user:pw@fairy.moilga.com/',
    'https://fairy.moilga.com:8443/',
    'https://github.com/milcho0604evil/x',
    'https://github.com/milcho0604/../someone/x',
    'https://github.com/milcho0604/%2e%2e/someone',
    'https://gist.github.com/milcho0604/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '//fairy.moilga.com/x',
    `https://fairy.moilga.com/${'a'.repeat(600)}`,
    42,
  ])
    assert.equal(allowedLink(bad), undefined, String(bad));
  // 허용하지 않는 링크는 링크만 버리고 공지는 남긴다
  const n = parseNotice(raw({ link: 'https://evil.example/' }));
  assert.ok(n);
  assert.equal(n.link, undefined);
});

test('대상 버전 범위', () => {
  assert.ok(inVersionRange('0.4.3', '<0.5.0'));
  assert.ok(!inVersionRange('0.5.0', '<0.5.0'));
  assert.ok(inVersionRange('0.5.0', '<=0.5.0'));
  assert.ok(inVersionRange('0.4.3', '>=0.4.0 <0.5.0'));
  assert.ok(!inVersionRange('0.3.9', '>=0.4.0 <0.5.0'));
  assert.ok(inVersionRange('0.4.3', '0.4.3'));
  assert.ok(inVersionRange('0.4.3', '=0.4.3'));
  assert.ok(!inVersionRange('0.4.4', '0.4.3'));
  assert.ok(inVersionRange('0.4.4', '>0.4.3'));
  assert.ok(!inVersionRange('0.4.3', '<0.5'));
  assert.ok(!inVersionRange('개발판', '<0.5.0'));
});

const at = { version: '0.4.3', platform: 'darwin', now: Date.parse('2026-10-20T12:00:00+09:00') };
const notice = (over: Partial<Notice> = {}): Notice => ({
  id: 'n1',
  kind: 'info',
  title: text('제목'),
  body: text('본문'),
  ...over,
});

test('해당하는 공지: 기간, 버전, 운영체제', () => {
  assert.ok(applies(notice(), at));
  assert.ok(!applies(notice({ from: at.now + 1 }), at));
  assert.ok(applies(notice({ from: at.now }), at));
  assert.ok(!applies(notice({ until: at.now }), at));
  assert.ok(!applies(notice({ versions: '>=0.5.0' }), at));
  assert.ok(!applies(notice({ platforms: ['win32'] }), at));
  assert.ok(applies(notice({ platforms: ['win32', 'darwin'] }), at));
  // 파일에서 읽은 시각은 시간대를 지킨다
  const n = parseNotice(raw({ from: '2026-10-20T00:00:00+09:00', until: '2026-10-27T00:00:00+09:00' }));
  assert.equal(n?.from, Date.parse('2026-10-19T15:00:00Z'));
  assert.ok(n && applies(n, at));
});

const ctx = (over: Partial<PickContext> = {}): PickContext => ({
  ...at,
  today: '2026-10-20',
  seen: { done: [], shownDay: {} },
  shownThisRun: new Set(),
  newerAvailable: true,
  recommendVersion: '0.5.0',
  focusing: false,
  ...over,
});

test('띄울 차례: 중요, 권장, 알림. 강제는 고르지 않는다', () => {
  const list = [
    notice({ id: 'i', kind: 'info' }),
    notice({ id: 'u', kind: 'update' }),
    notice({ id: 'f', kind: 'force' }),
    notice({ id: 'm', kind: 'important' }),
  ];
  assert.equal(pickNotice(list, ctx())?.id, 'm');
  assert.equal(pickNotice(list, ctx({ seen: { done: ['m'], shownDay: {} } }))?.id, 'u');
  assert.equal(
    pickNotice(list, ctx({ seen: { done: ['m'], shownDay: {} }, newerAvailable: false }))?.id,
    'i',
  );
  assert.equal(pickNotice([notice({ id: 'f', kind: 'force' })], ctx()), undefined);
  assert.equal(forceNotice(list, at)?.id, 'f');
  assert.equal(forceNotice(list, { ...at, platform: 'linux' })?.id, 'f');
  assert.equal(forceNotice([notice({ kind: 'force', versions: '>=0.5.0' })], at), undefined);
});

test('집중 중에는 미룬다', () => {
  assert.equal(pickNotice([notice({ kind: 'important' })], ctx({ focusing: true })), undefined);
  assert.equal(pickNotice([notice()], ctx({ focusing: true })), undefined);
});

test('알림은 한 번, 알림과 권장은 합쳐 하루 한 번', () => {
  const list = [notice({ id: 'a' }), notice({ id: 'b' }), notice({ id: 'u', kind: 'update' })];
  let seen: NoticeSeen = { done: [], shownDay: {} };
  const first = pickNotice(list, ctx({ seen, newerAvailable: false }));
  assert.equal(first?.id, 'a');
  seen = markShown(seen, first as Notice, '2026-10-20');
  assert.deepEqual(seen.done, ['a']);
  // 같은 날은 더 없다
  assert.equal(pickNotice(list, ctx({ seen })), undefined);
  // 다음 날: 권장이 먼저, 그다음 날 남은 알림
  const day2 = pickNotice(list, ctx({ seen, today: '2026-10-21' }));
  assert.equal(day2?.id, 'u');
  seen = markShown(seen, day2 as Notice, '2026-10-21');
  assert.equal(pickNotice(list, ctx({ seen, today: '2026-10-21' })), undefined);
  // 권장은 다음 날 다시 (나중에), 알림 a 는 다시 안 뜬다
  assert.equal(pickNotice(list, ctx({ seen, today: '2026-10-22' }))?.id, 'u');
  assert.equal(pickNotice(list, ctx({ seen, today: '2026-10-22', newerAvailable: false }))?.id, 'b');
});

test('권장은 받을 새 버전이 있고 앱이 권장 버전보다 낮을 때만', () => {
  const list = [notice({ kind: 'update' })];
  assert.equal(pickNotice(list, ctx({ newerAvailable: false })), undefined);
  assert.equal(pickNotice(list, ctx({ recommendVersion: undefined })), undefined);
  // 앱은 0.4.3: 권장 0.4.3 과 같거나 0.4.0 보다 높으면 안 뜬다
  assert.equal(pickNotice(list, ctx({ recommendVersion: '0.4.3' })), undefined);
  assert.equal(pickNotice(list, ctx({ recommendVersion: '0.4.0' })), undefined);
  assert.equal(pickNotice(list, ctx({ recommendVersion: '0.4.4' }))?.kind, 'update');
});

test('파일의 권장 버전은 x.y.z 일 때만 읽는다', () => {
  const file = (v: unknown) => parseNotices(JSON.stringify({ version: 1, recommendVersion: v, notices: [] }));
  assert.equal(file('0.5.0')?.recommendVersion, '0.5.0');
  assert.equal(file('0.5')?.recommendVersion, undefined);
  assert.equal(file(5)?.recommendVersion, undefined);
});

test('중요는 확인을 누를 때까지 켤 때마다 한 번, 하루 상한과 상관없다', () => {
  const list = [notice({ id: 'm', kind: 'important' })];
  let seen: NoticeSeen = { done: [], shownDay: {}, dailyDay: '2026-10-20' };
  assert.equal(pickNotice(list, ctx({ seen }))?.id, 'm');
  seen = markShown(seen, list[0] as Notice, '2026-10-20');
  // 이번 실행에서 이미 띄웠으면 다시 안 뜬다 (닫고 확인 안 함)
  assert.equal(pickNotice(list, ctx({ seen, shownThisRun: new Set(['m']) })), undefined);
  // 다음에 켜면 다시
  assert.equal(pickNotice(list, ctx({ seen }))?.id, 'm');
  seen = markConfirmed(seen, 'm');
  assert.equal(pickNotice(list, ctx({ seen })), undefined);
});

test('본 기록 읽기와 정리', () => {
  assert.deepEqual(readSeen(undefined), { done: [], shownDay: {} });
  assert.deepEqual(
    readSeen({ done: ['a', 3, 'bad id!'], shownDay: { u: '2026-10-20', x: 1 }, dailyDay: 'd' }),
    {
      done: ['a'],
      shownDay: { u: '2026-10-20' },
      dailyDay: 'd',
    },
  );
  const f = parseNotices(file([raw({ id: 'a' })]));
  assert.ok(f);
  assert.deepEqual(pruneSeen({ done: ['a', 'gone'], shownDay: { gone: 'd', a: 'd' } }, f), {
    done: ['a'],
    shownDay: { a: 'd' },
  });
});

test('두 번 받은 최소 버전이 같아야 한다', () => {
  const a = parseNotices(file([], { minVersion: '0.4.4' }));
  const b = parseNotices(file([], { minVersion: '0.4.4' }));
  const c = parseNotices(file([], { minVersion: '0.4.5' }));
  assert.ok(sameMinVersion(a, b));
  assert.ok(!sameMinVersion(a, c));
  assert.ok(!sameMinVersion(a, undefined));
});

test('시험 주소는 개발 실행의 이 컴퓨터 http 만', () => {
  assert.equal(noticesUrl(undefined, false), NOTICES_URL);
  assert.equal(noticesUrl('http://127.0.0.1:9000/notices.json', false), 'http://127.0.0.1:9000/notices.json');
  assert.equal(noticesUrl('http://localhost/notices.json', false), 'http://localhost/notices.json');
  assert.equal(noticesUrl('http://127.0.0.1:9000/notices.json', true), NOTICES_URL);
  assert.equal(noticesUrl('https://evil.example/notices.json', false), NOTICES_URL);
  assert.equal(noticesUrl('http://127.0.0.1.evil.example/x', false), NOTICES_URL);
});
