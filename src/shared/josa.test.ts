import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang, t } from './i18n/index.ts';
import { hasFinalConsonant, withParticle } from './josa.ts';

test('한글 이름: 받침에 따라 조사가 바뀐다', () => {
  assert.equal(withParticle('콩이', '이랑'), '콩이랑');
  assert.equal(withParticle('밤', '이랑'), '밤이랑');
  assert.equal(withParticle('콩이', '과'), '콩이와');
  assert.equal(withParticle('밤', '과'), '밤과');
  assert.equal(withParticle('콩이', '이'), '콩이가');
  assert.equal(withParticle('밤', '이'), '밤이');
  assert.equal(withParticle('콩이', '은'), '콩이는');
  assert.equal(withParticle('밤', '을'), '밤을');
  assert.equal(withParticle('콩이', '아'), '콩이야');
  assert.equal(withParticle('밤', '아'), '밤아');
});

test('영어 이름은 흔한 읽기로 추정한다', () => {
  assert.equal(withParticle('Max', '이랑'), 'Max랑'); // 맥스
  assert.equal(withParticle('Sam', '이랑'), 'Sam이랑'); // 샘
  assert.equal(withParticle('Bill', '과'), 'Bill과'); // 빌
  assert.equal(withParticle('Ben', '은'), 'Ben은'); // 벤
  assert.equal(withParticle('King', '이'), 'King이'); // 킹
  assert.equal(withParticle('Jack', '이'), 'Jack이'); // 잭
  assert.equal(withParticle('Bob', '이'), 'Bob이'); // 밥
  assert.equal(withParticle('Nik', '이'), 'Nik이'); // 닉
  assert.equal(withParticle('Pat', '이'), 'Pat이'); // 팻
  assert.equal(withParticle('Mark', '이'), 'Mark가'); // 마크
  assert.equal(withParticle('Coco', '과'), 'Coco와'); // 코코
});

test('숫자로 끝나는 이름은 우리말 읽기를 따른다', () => {
  assert.equal(withParticle('펫1', '이랑'), '펫1이랑'); // 일
  assert.equal(withParticle('펫2', '이랑'), '펫2랑'); // 이
  assert.equal(withParticle('펫3', '과'), '펫3과'); // 삼
  assert.equal(withParticle('펫9', '이'), '펫9가'); // 구
  assert.equal(withParticle('펫10', '이'), '펫10이'); // 십
  assert.equal(withParticle('펫0', '이'), '펫0이'); // 영
});

test('끝의 문장 부호와 이모지는 건너뛴다', () => {
  assert.equal(withParticle('콩이!', '이랑'), '콩이!랑');
  assert.equal(withParticle('밤🌰', '과'), '밤🌰과');
  assert.equal(withParticle('밤 ', '이'), '밤 이');
});

test('판단할 글자가 없으면 두 형태를 같이 쓴다', () => {
  assert.equal(hasFinalConsonant('🐶'), undefined);
  assert.equal(withParticle('🐶', '이랑'), '🐶(이)랑');
  assert.equal(withParticle('', '과'), '와(과)');
});

test('으로/로: 받침 있으면 으로, 없거나 ㄹ 받침이면 로', () => {
  assert.equal(withParticle('콩', '으로'), '콩으로');
  assert.equal(withParticle('콩이', '으로'), '콩이로');
  assert.equal(withParticle('서울', '으로'), '서울로');
  assert.equal(withParticle('Claude', '으로'), 'Claude로');
  assert.equal(withParticle('Codex', '으로'), 'Codex로');
  assert.equal(withParticle('Gemini', '으로'), 'Gemini로');
  assert.equal(withParticle('Cursor', '으로'), 'Cursor로');
  assert.equal(withParticle('Bill', '으로'), 'Bill로');
  assert.equal(withParticle('Sam', '으로'), 'Sam으로');
  assert.equal(withParticle('GPT 7', '으로'), 'GPT 7로');
  assert.equal(withParticle('GPT 3', '으로'), 'GPT 3으로');
  assert.equal(withParticle('???', '으로'), '???(으)로');
});

test('기본 캐릭터 밀크, 초코(영어 Milk, Choco)는 받침이 없다', () => {
  for (const name of ['밀크', '초코', 'Milk', 'Choco']) {
    assert.equal(hasFinalConsonant(name), false, name);
    assert.equal(withParticle(name, '이'), `${name}가`);
    assert.equal(withParticle(name, '을'), `${name}를`);
    assert.equal(withParticle(name, '이랑'), `${name}랑`);
    assert.equal(withParticle(name, '아'), `${name}야`);
    assert.equal(withParticle(name, '으로'), `${name}로`);
  }
});

test('말끝이 바로 붙는 자리: 받침 있으면 이, 없으면 아무것도 (회의잖아, 점심 약속이잖아)', () => {
  assert.equal(withParticle('회의', '이다'), '회의');
  assert.equal(withParticle('점심 약속', '이다'), '점심 약속이');
  assert.equal(withParticle('🎉', '이다'), '🎉(이)');
  setLang('ko');
  const ev = (title: string) => t('note.eventAllDay', { p: 'tsundere', time: '', title });
  assert.equal(ev('회의'), '오늘 종일 회의잖아. 까먹지 마.');
  assert.equal(ev('점심 약속'), '오늘 종일 점심 약속이잖아. 까먹지 마.');
});

test('이름 뒤 "한테"에는 이/가를 붙이지 않는다 (콩이한테, 밀크가한테가 아니다)', () => {
  setLang('ko');
  assert.match(t('bond.journey.nudge.quick', { name: '콩' }), /콩한테 넘길/);
  assert.match(t('bond.journey.nudge.quick', { name: '밀크' }), /밀크한테 넘길/);
});
