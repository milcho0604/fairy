import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts, setLang, setLineOverrides, t } from './i18n/index.ts';
import { checkLine, renderTemplate, varsOf } from './line-template.ts';
import {
  buildCatalog,
  emptyOverrides,
  LINE_GROUPS,
  type LineOverrides,
  parseOverrides,
  pruneOverrides,
  resetOverride,
  setOverride,
  templateOf,
} from './lines.ts';
import { setVoiceSource, voiced } from './persona-voice.ts';

// 펫 대사 편집 (#125)

const looseT = t as unknown as (key: string, vars?: Record<string, string | number>) => string;

test('틀 채우기: 값과 조사, 값이 없으면 그대로', () => {
  assert.equal(renderTemplate('{name:은} 여기 있어. {n}개', { name: '콩', n: 3 }), '콩은 여기 있어. 3개');
  assert.equal(renderTemplate('{name:은} 여기 있어', { name: '밤' }), '밤은 여기 있어');
  assert.equal(renderTemplate('{name:이} 좋아', { name: '밤' }), '밤이 좋아');
  assert.equal(renderTemplate('{name:이} 좋아', { name: '콩' }), '콩이 좋아');
  assert.equal(renderTemplate('{x} 와 {name}', { name: '콩' }), '{x} 와 콩');
  assert.equal(renderTemplate('{name:모름}', { name: '콩' }), '{name:모름}');
  assert.deepEqual(varsOf('{name:은} {n} {name}'), ['name', 'n']);
});

test('사전 함수는 값 자리가 {이름} 과 {이름:조사} 인 틀로 풀린다', () => {
  assert.equal(templateOf(dicts.ko['idle.any.1']), '{name:은} 여기서 조용히 응원 중.');
  assert.equal(templateOf(dicts.ko['idle.morning.1']), '좋은 아침! {name}도 방금 일어났어.');
  assert.equal(templateOf(dicts.ko['idle.work.1']), '벌써 {workedH}시간 넘게 쉬지 않았어. 대단한데?');
  assert.equal(templateOf(dicts.ko['pet.fed']), '냠냠, 고마워!');
  assert.equal(
    templateOf(dicts.ko['companion.anniv.day']),
    '오늘이 우리 만난 지 {n}일째 되는 날이야! 앞으로도 {name} 잘 부탁해.',
  );
  // 틀로 다시 채우면 원래 함수와 같은 말이 나온다
  for (const lang of ['ko', 'en'] as const) {
    for (const def of buildCatalog(dicts[lang])) {
      const fn = dicts[lang][def.key as never] as unknown;
      if (typeof fn !== 'function') continue;
      for (const name of ['콩', '밤', 'Mochi', 'Bo']) {
        const vars = {
          name,
          open: 3,
          eventMin: 12,
          workedH: 2,
          done: 4,
          n: 5,
          days: 9,
          week: 6,
          hour: 3,
          title: '청소',
          yesterday: 7,
          streak: 4,
          focusMin: 50,
          coins: 2,
          popped: 8,
          food: '당근',
        };
        assert.equal(
          renderTemplate(def.base, vars),
          (fn as (v: unknown) => string)(vars),
          `${lang} ${def.key} ${name}`,
        );
      }
    }
  }
});

test('갈래가 있는 함수는 고칠 수 없는 대사로 빠진다', () => {
  assert.equal(
    templateOf((v: { n: number }) => (v.n === 1 ? '한 개' : `${v.n}개`)),
    undefined,
  );
  assert.equal(
    templateOf((v: { list: string[] }) => v.list[0] ?? ''),
    undefined,
  );
  assert.equal(
    templateOf(() => 'x'.repeat(3)),
    undefined,
  );
  assert.equal(templateOf(42), undefined);
});

test('카탈로그: 상황 묶음마다 있고 한국어와 영어 대사가 있다, 말투 변형은 빠진다', () => {
  const ko = buildCatalog(dicts.ko);
  const en = buildCatalog(dicts.en);
  assert.ok(ko.length > 100 && en.length > 100);
  for (const g of LINE_GROUPS) {
    assert.ok(
      ko.some((d) => d.group === g.id),
      `ko ${g.id}`,
    );
    assert.ok(
      en.some((d) => d.group === g.id),
      `en ${g.id}`,
    );
  }
  assert.ok(ko.every((d) => !d.key.startsWith('voice.')));
  assert.ok(!ko.some((d) => d.key === 'fun.five.button'));
  // 값 이름은 틀에서 온다
  assert.deepEqual(ko.find((d) => d.key === 'idle.any.1')?.vars, ['name']);
});

test('고친 글 검사: 값을 빼먹거나 새 값을 쓰거나 중괄호가 깨지면 거절한다', () => {
  const base = '{name:은} 여기서 응원 중. {n}번째';
  assert.deepEqual(checkLine(base, '  {name:은} 오늘도 응원 중. {n}번째\n'), {
    ok: true,
    text: '{name:은} 오늘도 응원 중. {n}번째',
  });
  assert.deepEqual(checkLine(base, '{name} 응원 중. {n}번째'), { ok: true, text: '{name} 응원 중. {n}번째' });
  assert.deepEqual(checkLine(base, '응원 중. {n}번째'), { ok: false, reason: 'missing', vars: ['name'] });
  assert.deepEqual(checkLine(base, '{name} {n} {foo}'), { ok: false, reason: 'unknown', vars: ['foo'] });
  assert.deepEqual(checkLine(base, '{name {n}'), { ok: false, reason: 'brace' });
  assert.deepEqual(checkLine(base, '{name:없는조사} {n}'), { ok: false, reason: 'particle' });
  assert.deepEqual(checkLine(base, '   '), { ok: false, reason: 'empty' });
  assert.deepEqual(checkLine('안녕!', 'a'.repeat(201)), { ok: false, reason: 'long' });
  assert.deepEqual(checkLine('안녕!', '안녕, 잘 지냈어?'), { ok: true, text: '안녕, 잘 지냈어?' });
  // 값이 없는 대사에 값을 쓰면 안 된다
  assert.deepEqual(checkLine('안녕!', '{name} 안녕'), { ok: false, reason: 'unknown', vars: ['name'] });
});

test('덮어쓰기: 고친 칸만 저장하고, 기본과 같아지면 칸을 지우고, 되돌리면 지운다', () => {
  const def = { key: 'pet.fed', base: '냠냠, 고마워!' };
  let o = emptyOverrides();
  const r1 = setOverride(o, 'ko', def, '맛있다! 고마워!');
  assert.ok(r1.ok);
  o = r1.ok ? r1.overrides : o;
  assert.deepEqual(o, { ko: { 'pet.fed': '맛있다! 고마워!' }, en: {} });
  // 영어 칸은 따로
  const r2 = setOverride(o, 'en', { key: 'pet.fed', base: 'Yum, thanks!' }, 'Tasty!');
  assert.ok(r2.ok);
  o = r2.ok ? r2.overrides : o;
  assert.deepEqual(o.en, { 'pet.fed': 'Tasty!' });
  // 기본과 같게 되돌려 쓰면 칸이 사라진다
  const r3 = setOverride(o, 'ko', def, '냠냠, 고마워!');
  assert.ok(r3.ok && Object.keys(r3.overrides.ko).length === 0);
  // 검사에 걸리면 덮어쓰기는 그대로
  const bad = setOverride(o, 'ko', { key: 'idle.any.1', base: '{name:은} 응원' }, '값 없음');
  assert.equal(bad.ok, false);
  assert.deepEqual(resetOverride(o, 'ko', 'pet.fed').ko, {});
  assert.deepEqual(resetOverride(o, 'ko').ko, {});
  assert.deepEqual(resetOverride(o, 'ko').en, { 'pet.fed': 'Tasty!' });
});

test('업데이트로 기본 대사가 바뀌어도 고친 칸은 그대로, 값이 새로 생겨 맞지 않는 칸만 버린다', () => {
  const mine: LineOverrides = {
    ko: {
      'pet.fed': '내가 고친 말',
      'idle.any.1': '{name:은} 내가 고친 응원',
      'idle.any.3': '값 없이 고친 말',
      'idle.없어진.1': '사라진 키',
      'voice.polite.pet.fed': '말투 변형은 안 쓴다',
    },
    en: {},
  };
  // 새 사전: pet.fed 기본 글이 바뀌었다(고친 칸 유지), idle.any.3 이 이제 {name} 을 쓴다(옛 수정은 값이 없어 버림),
  // idle.없어진.1 은 사전에서 사라졌다
  const next = {
    ko: {
      'pet.fed': '냠냠냠, 새 기본 대사!',
      'idle.any.1': (v: { name: string }) => `${v.name}이(가) 응원 중`,
      'idle.any.3': (v: { name: string }) => `${v.name} 물 마셔`,
    },
    en: {},
  };
  const pruned = pruneOverrides(mine, next as never);
  assert.deepEqual(pruned.ko, { 'pet.fed': '내가 고친 말', 'idle.any.1': '{name:은} 내가 고친 응원' });
  // 기본 대사가 바뀌어도 고친 칸의 글 자체는 건드리지 않는다
  assert.equal(pruned.ko['pet.fed'], '내가 고친 말');
});

test('파일에서 읽은 덮어쓰기는 믿지 않고 모양이 맞는 글 칸만 남긴다', () => {
  assert.deepEqual(parseOverrides(null), emptyOverrides());
  assert.deepEqual(parseOverrides('x'), emptyOverrides());
  assert.deepEqual(parseOverrides({ ko: { a: 'b', c: 3, d: '  ' }, en: 'x', jp: { z: 'z' } }), {
    ko: { a: 'b' },
    en: {},
  });
});

test('고친 대사가 실제 말에 쓰이고, 지우면 기본으로, 말투가 달라도 고친 글이 이긴다', () => {
  setLang('ko');
  try {
    assert.equal(looseT('idle.any.1', { name: '밤' }), '밤은 여기서 조용히 응원 중.');
    setLineOverrides({
      ko: { 'idle.any.1': '{name:이} 오늘도 응원 중!', 'pet.fed': '고마워 고마워' },
      en: {},
    });
    assert.equal(looseT('idle.any.1', { name: '밤' }), '밤이 오늘도 응원 중!');
    assert.equal(looseT('idle.any.1', { name: '콩' }), '콩이 오늘도 응원 중!');
    // 영어는 영향 없음
    setLang('en');
    assert.notEqual(looseT('pet.fed'), '고마워 고마워');
    setLang('ko');
    // 말투가 존댓말 비서여도 고친 글을 쓴다 (고치지 않은 키는 그 말투 변형)
    setVoiceSource(() => 'polite');
    assert.equal(voiced('pet.fed'), '고마워 고마워');
    assert.equal(voiced('pet.rest.1'), dicts.ko['voice.polite.pet.rest.1']);
    setLineOverrides({ ko: {}, en: {} });
    assert.equal(looseT('idle.any.1', { name: '밤' }), '밤은 여기서 조용히 응원 중.');
    assert.equal(voiced('pet.fed'), dicts.ko['voice.polite.pet.fed']);
  } finally {
    setLineOverrides({ ko: {}, en: {} });
    setVoiceSource(() => 'friend');
    setLang('ko');
  }
});
