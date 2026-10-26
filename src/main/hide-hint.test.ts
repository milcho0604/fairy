import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { dicts, setLang, t } from '../shared/i18n/index.ts';
import { voiced } from '../shared/persona-voice.ts';
import { HIDE_HINT_TIMES, hideHintDelivery, hideHintFor, watchReopen } from './hide-hint.ts';

const base = { shown: 0, keys: '⌃⌥⇧P', osNotify: true, supported: true };

test('숨기기 안내: 단축키가 있으면 단축키와 다시 열기를 함께 알린다', () => {
  assert.deepEqual(hideHintFor(base), { key: 'pet.hideHint', keys: '⌃⌥⇧P' });
});

test('숨기기 안내: 단축키를 꺼 두어도 다시 열기 안내는 나온다', () => {
  assert.deepEqual(hideHintFor({ ...base, keys: '' }), { key: 'pet.hideHintNoKey' });
});

test('숨기기 안내: 횟수를 다 쓰거나 알림이 꺼졌거나 지원되지 않으면 없다', () => {
  assert.equal(hideHintFor({ ...base, shown: HIDE_HINT_TIMES - 1 })?.key, 'pet.hideHint');
  assert.equal(hideHintFor({ ...base, shown: HIDE_HINT_TIMES }), undefined);
  assert.equal(hideHintFor({ ...base, osNotify: false }), undefined);
  assert.equal(hideHintFor({ ...base, supported: false }), undefined);
  assert.equal(hideHintFor({ ...base, keys: '', osNotify: false }), undefined);
});

test('숨기기 안내 전달: 알림을 끈 경우 첫 한 번만 트레이 안내, 켜져 있으면 정해진 횟수까지 알림', () => {
  assert.equal(hideHintDelivery(0, false, true), 'tray');
  assert.equal(hideHintDelivery(1, false, true), 'none');
  assert.equal(hideHintDelivery(0, true, false), 'tray');
  assert.equal(hideHintDelivery(0, true, true), 'notification');
  assert.equal(hideHintDelivery(HIDE_HINT_TIMES - 1, true, true), 'notification');
  assert.equal(hideHintDelivery(HIDE_HINT_TIMES, true, true), 'none');
});

test('숨기기 안내 문구: ko, en 둘 다 다시 열기를 말하고 존댓말 비서도 같다', () => {
  for (const lang of ['ko', 'en'] as const) {
    setLang(lang);
    const reopen = lang === 'ko' ? /다시 (열|여)/ : /open the app again/i;
    for (const persona of ['friend', 'polite'] as const) {
      const withKey = voiced('pet.hideHint', { keys: 'K' }, persona);
      const noKey = voiced('pet.hideHintNoKey', undefined, persona);
      assert.match(withKey, reopen, `${lang} ${persona} ${withKey}`);
      assert.match(withKey, /K/);
      assert.match(noKey, reopen, `${lang} ${persona} ${noKey}`);
    }
  }
  assert.ok('voice.polite.pet.hideHintNoKey' in dicts.ko);
  assert.ok('voice.polite.pet.hideHintNoKey' in dicts.en);
  setLang('ko');
  assert.ok(t('pet.hideHintNoKey').length > 0);
});

test('다시 열기: 맥 activate 면 숨은 펫을 부른다', () => {
  const app = new EventEmitter();
  const calls: string[] = [];
  watchReopen(app, 'darwin', { takeArgv: () => false, bringBack: (w) => calls.push(w) });
  app.emit('activate', {}, false);
  assert.deepEqual(calls, ['activate']);
});

test('다시 열기: second-instance 는 주소나 파일을 넘긴 것이면 그것만 처리하고 펫은 그대로', () => {
  const app = new EventEmitter();
  const calls: string[] = [];
  let take = true;
  watchReopen(app, 'win32', { takeArgv: () => take, bringBack: (w) => calls.push(w) });
  app.emit('second-instance', {}, ['fairy', 'fairy://add?text=x'], '/');
  assert.deepEqual(calls, []);
  take = false;
  app.emit('second-instance', {}, ['fairy'], '/');
  assert.deepEqual(calls, ['second-instance']);
  // 맥이 아니면 activate 를 듣지 않는다 (윈도우는 오지 않지만 혹시 와도 겹쳐 부르지 않게)
  app.emit('activate');
  assert.deepEqual(calls, ['second-instance']);
});
