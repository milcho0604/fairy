import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts, setLang, t } from './i18n/index.ts';
import { IDLE_RECENT, IdleTalk, idleCandidates } from './idle-talk.ts';

// 2026-10-05 은 월요일, 10-09 는 금요일
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();

test('시각과 요일로 고른다: 월요일 아침, 점심, 금요일 오후, 늦은 밤', () => {
  assert.deepEqual(idleCandidates({ now: at(5, 9), doneToday: 0 }).fit, [
    'idle.morning.1',
    'idle.morning.2',
    'idle.monday.1',
  ]);
  assert.deepEqual(idleCandidates({ now: at(6, 9), doneToday: 0 }).fit, ['idle.morning.1', 'idle.morning.2']);
  assert.deepEqual(idleCandidates({ now: at(6, 12), doneToday: 0 }).fit, ['idle.lunch.1', 'idle.lunch.2']);
  assert.ok(idleCandidates({ now: at(9, 15), doneToday: 0 }).fit.includes('idle.friday.1'));
  assert.ok(!idleCandidates({ now: at(8, 15), doneToday: 0 }).fit.includes('idle.friday.1'));
  assert.deepEqual(idleCandidates({ now: at(6, 23, 30), doneToday: 0 }).fit, ['idle.late.1', 'idle.late.2']);
  assert.deepEqual(idleCandidates({ now: at(6, 2), doneToday: 0 }).fit, ['idle.late.1', 'idle.late.2']);
  // 사이 시간(13:30~14:00, 17:00~18:00)은 상황 대사가 없다
  assert.deepEqual(idleCandidates({ now: at(6, 13, 45), doneToday: 0 }).fit, []);
});

test('오늘 끝낸 수로 칭찬이 달라진다', () => {
  const fit = (n: number) => idleCandidates({ now: at(6, 13, 45), doneToday: n }).fit;
  assert.deepEqual(fit(0), []);
  assert.deepEqual(fit(1), ['idle.praise.1']);
  assert.deepEqual(fit(3), ['idle.praise.3']);
  assert.deepEqual(fit(7), ['idle.praise.5']);
});

test('최근에 한 말은 다시 고르지 않는다', () => {
  const talk = new IdleTalk();
  let i = 0;
  const rand = () => ((i++ * 0.37) % 1) as number;
  const picked: string[] = [];
  for (let n = 0; n < 40; n++) picked.push(talk.pick({ now: at(6, 9), doneToday: 1 }, rand) ?? '');
  assert.ok(picked.every((k) => k !== ''));
  for (let n = 1; n < picked.length; n++) {
    const window = picked.slice(Math.max(0, n - IDLE_RECENT), n);
    assert.ok(!window.includes(picked[n] ?? ''), `${n}: ${picked[n]} 가 최근 ${window} 에 있다`);
  }
});

test('대사마다 펫 이름이 자연스럽게 들어가고 조사가 맞는다', () => {
  setLang('ko');
  assert.equal(t('idle.any.1', { name: '콩이' }), '콩이는 여기서 조용히 응원 중.');
  assert.equal(t('idle.any.1', { name: '밤' }), '밤은 여기서 조용히 응원 중.');
  assert.equal(t('idle.any.4', { name: '밤' }), '심심하면 밤을 쓰다듬어 줘도 돼.');
  const keys = Object.keys(dicts.ko).filter((k) => k.startsWith('idle.'));
  const named = keys.filter((k) => (t as (k: string, v: object) => string)(k, { name: 'ZZ' }).includes('ZZ'));
  // 절반 넘게 이름이 들어간다
  assert.ok(named.length * 2 > keys.length, `${named.length}/${keys.length}`);
  setLang('en');
  assert.equal(t('idle.monday.1', { name: 'Bean' }), "It's Monday. Bean is sticking right by you.");
  setLang('ko');
});

test('펫 이름 뒤 조사가 받침에 맞고, 대사는 서로 다르다 (혼잣말, 친밀도, 놓친 알림)', () => {
  setLang('ko');
  const render = t as unknown as (k: string, v: object) => string;
  const keys = Object.keys(dicts.ko).filter((k) => k.startsWith('idle.') || k.startsWith('pet.unlock.'));
  // 받침 있는 이름, 없는 이름, ㄹ 받침, 영어 이름
  const cases: [string, boolean][] = [
    ['밤', true],
    ['콩이', false],
    ['달', true],
    ['Bean', true],
    ['Coco', false],
  ];
  for (const [name, final] of cases)
    for (const key of keys) {
      const text = render(key, { name });
      const at = text.indexOf(name);
      if (at < 0) continue;
      const next = text[at + name.length] ?? '';
      const wrong = final ? ['는', '가', '를', '와'] : ['은', '을', '과'];
      assert.ok(!wrong.includes(next), `${key} (${name}): ${text}`);
    }
  const texts = keys.map((k) => render(k, { name: '콩이' }));
  assert.equal(new Set(texts).size, texts.length);
  setLang('en');
  const en = keys.map((k) => render(k, { name: 'Bean' }));
  assert.equal(new Set(en).size, en.length);
  // 영어에 한글이 섞이지 않는다
  for (const s of en) assert.ok(!/[가-힣]/.test(s), s);
  setLang('ko');
});
