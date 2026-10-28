import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts, getLang, locale, resolveLang, setLang, t } from './index.ts';

// 사전에 없는 키를 시험할 때 쓰는 느슨한 t
const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

// 함수 값에 넣어 볼 값: 글처럼도 숫자처럼도 쓰인다 (String 객체 '2')
const sample = new Proxy({}, { get: () => new String('2') }) as never;
const render = (v: unknown) => (typeof v === 'function' ? (v as (vars: never) => string)(sample) : v);
// {이름} 과 {이름:은} 모두 같은 자리로 센다
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)(?::[^{}]*)?\}/g)].map((m) => m[1]).sort();

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

test('새 버전 글은 버전 번호 끝 소리에 맞는 조사를 붙인다', () => {
  setLang('ko');
  assert.equal(t('main.update.bubble', { version: '1.0.2' }), '새 버전 1.0.2가 나왔어.');
  assert.equal(t('main.update.bubble', { version: '1.0.0' }), '새 버전 1.0.0이 나왔어.');
  assert.match(t('main.update.ready', { version: '1.0.2' }), /1\.0\.2를 받아/);
  assert.match(t('main.update.readyRestart', { version: '1.0.0' }), /1\.0\.0을 받아.*다시 켜면/);
  assert.match(t('main.update.forced', { version: '1.0.1', min: '1.0.0' }), /1\.0\.1로 업데이트/);
  assert.match(t('main.update.forced', { version: '1.0.3', min: '1.0.0' }), /1\.0\.3으로 업데이트/);
});

test('맥 화면 기록 안내는 메뉴 위치와, 켜져 있는데도 막힐 때 지우고 다시 허용하는 길을 함께 알려 준다', () => {
  // 서명 없는 앱은 업데이트하면 설정에 켜짐으로 보여도 거절된다. 껐다 켜기로는 안 풀린다
  const keys = ['chat.look.permissionMac', 'onboarding.look.howTo'] as const;
  const path = {
    ko: '시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 녹음',
    en: 'System Settings > Privacy & Security > Screen & System Audio Recording',
  };
  for (const lang of ['ko', 'en'] as const)
    for (const key of keys) {
      const out = String(render((dicts[lang] as Record<string, unknown>)[key]));
      assert.ok(out.includes(path[lang]), `${lang} ${key}: 메뉴 위치`);
      assert.ok(out.includes('−'), `${lang} ${key}: 빼기 버튼`);
      // 대화상자 detail 과 첫 실행 카드(480px 창, 12px)에 넘치지 않을 만큼
      assert.ok(out.length <= (lang === 'ko' ? 200 : 320), `${lang} ${key}: ${out.length}자, 너무 길다`);
    }
});

test('영문, 숫자, 단위 뒤의 조사는 띄우지 않고 붙인다 (PIN으로, 8MB까지, AI는)', () => {
  // 함수 값의 자리에는 한글을 넣는다. 그 자리 조사는 withParticle 이 붙이고, '2 이 모습' 같은 지시어를 조사로 잘못 보지 않게
  const word = new Proxy({}, { get: () => new String('콩') }) as never;
  const particle =
    /[A-Za-z0-9%)\]] (은|는|이|가|을|를|으로|로|와|과|의|에|에서|에게|도|까지|나|이나|랑|이랑|만|부터|보다|처럼|이에요|예요|라면|이라면)(만|도|는)?(?=[\s.,!?'")\]]|$)/;
  for (const [key, v] of Object.entries(dicts.ko)) {
    const out = String(typeof v === 'function' ? (v as (vars: never) => string)(word) : v);
    const m = out.match(particle);
    assert.ok(!m, `${key}: "${m?.[0]}" 조사를 붙여 써야 한다`);
  }
});

test('영어 하나일 때 단수: 어제 끝낸 할 일 쪽지, 링크로 넣은 할 일', () => {
  setLang('en');
  try {
    assert.equal(t('pet.url.todos', { n: 1 }), 'Added 1 to-do');
    assert.equal(t('pet.url.todos', { n: 3 }), 'Added 3 to-dos');
    for (const p of ['friend', 'polite'] as const) {
      const one = t('note.yesterday', { p, n: 1 });
      assert.ok(!/1 to-dos/.test(one), one);
      assert.match(t('note.yesterday', { p, n: 4 }), /4 to-dos/);
    }
  } finally {
    setLang('ko');
  }
});

test('영어 하나일 때 단수: 오늘 일정 수, 메모 찾기, 습관 횟수, 보낼 일정, 진단 기록, 내보낸 메모, 비눗방울', () => {
  setLang('en');
  try {
    assert.equal(t('plan.sheet.events', { n: 1 }), '1 event today');
    assert.equal(t('plan.sheet.events', { n: 2 }), '2 events today');
    assert.equal(t('panel.note.searchIn', { n: 1 }), 'Search 1 note');
    assert.equal(t('panel.note.searchIn', { n: 4 }), 'Search 4 notes');
    assert.equal(t('habit.total', { n: 1 }), '1 time so far');
    assert.equal(t('habit.total', { n: 3 }), '3 times so far');
    assert.equal(t('gcal.state.pending', { n: 1 }), '1 event left to send');
    assert.equal(t('feedback.summary', { n: 1, hidden: 1 }), 'Last 1 line, 1 spot hidden');
    assert.equal(t('feedback.summary', { n: 20, hidden: 0 }), 'Last 20 lines, 0 spots hidden');
    assert.equal(t('export.notes.at', { day: '2026-10-12', n: 1 }), 'Exported 2026-10-12, 1 note');
    assert.match(t('settings.report.first', { first: '2026-10-12', day: 1, used: 1 }), /opened on 1 day$/);
    assert.match(t('play.bubbles.end', { popped: 1 }), /^Pop! 1 bubble\./);
    assert.match(t('play.bubbles.endCoins', { popped: 1, coins: 1 }), /^Pop! 1 bubble\. 1 coin\.$/);
  } finally {
    setLang('ko');
  }
  // 한국어는 그대로
  assert.equal(t('plan.sheet.events', { n: 1 }), '오늘 일정 1개');
  assert.equal(t('habit.total', { n: 2 }), '지금까지 2번');
});

test('서버 계정 이름 통일: 서버 칸 문구에 "모드", "서버 기능", "맞추기" 가 없고 단추는 코인 동기화', () => {
  const ko = dicts.ko as Record<string, unknown>;
  const en = dicts.en as Record<string, unknown>;
  const serverKeys = Object.keys(ko).filter((k) => /^(server|backup|ticket|events|coupon|friends)\./.test(k));
  assert.ok(serverKeys.length > 100);
  for (const k of [...serverKeys, 'help.pack.serverOff']) {
    const text = String(render(ko[k]));
    assert.ok(!/모드|서버 기능|코인 맞추기|지금 맞추기/.test(text), `${k}: ${text}`);
    const textEn = String(render(en[k]));
    assert.ok(!/\bmode\b|server feature|Sync now/i.test(textEn), `${k}: ${textEn}`);
  }
  assert.equal(ko['server.syncNow'], '코인 동기화');
  assert.equal(ko['server.group.sync'], '코인 동기화');
  assert.equal(en['server.syncNow'], 'Sync coins');
  assert.equal(ko['settings.friends'], '페어리 공유');
  assert.equal(ko['settings.tab.data'], '데이터와 계정');
  assert.equal(en['settings.tab.data'], 'Data and account');
});
