import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dicts, setLang, setMutedLines } from './i18n/index.ts';
import { type IdleFacts, type IdleKey, IdleTalk } from './idle-talk.ts';
import { withParticle } from './josa.ts';
import { buildLinesState, emptyMuted, MUTED_MAX, parseMuted, pruneMuted, setMuted } from './lines.ts';
import { setSpeechSource, setVoiceRandom, voiced } from './persona-voice.ts';
import { DEFAULT_STYLE, type SpeechStyle } from './speech-style.ts';
import { VariantPicker } from './variants.ts';

const style = (s: Partial<SpeechStyle>): SpeechStyle => ({ ...DEFAULT_STYLE, ownRate: 'always', ...s });
const say = (key: string, s: SpeechStyle, vars: Record<string, string | number> = { name: '콩이' }) =>
  voiced(key as never, vars, 'custom', s);

test('나, 저 뒤 조사: 내가, 제가, 나는, 내 (이름은 그대로)', () => {
  assert.equal(withParticle('나', '이'), '내가');
  assert.equal(withParticle('저', '이'), '제가');
  assert.equal(withParticle('나', '은'), '나는');
  assert.equal(withParticle('저', '은'), '저는');
  assert.equal(withParticle('나', '을'), '나를');
  assert.equal(withParticle('나', '의'), '내');
  assert.equal(withParticle('저', '의'), '제');
  assert.equal(withParticle('콩이', '의'), '콩이의');
  assert.equal(withParticle('콩이', '이'), '콩이가');
  assert.equal(withParticle('밤', '이'), '밤이');
});

test('펫 1인칭: 이름 대신 나, 저, 직접 쓴 말로 (한국어만)', () => {
  setLang('ko');
  setSpeechSource({ style: () => DEFAULT_STYLE, petName: () => '콩이' });
  assert.equal(say('idle.any.17', style({})), '콩이는 방금 한 바퀴 돌았어. 기분 전환 끝!');
  assert.equal(say('idle.any.17', style({ self: 'me' })), '나는 방금 한 바퀴 돌았어. 기분 전환 끝!');
  assert.equal(say('idle.any.20', style({ self: 'me' })), '내가 옆에서 같이 일하는 중이야. 조용히, 열심히.');
  // 옛 함수 대사도 (withParticle 을 거친다)
  assert.equal(say('idle.hungry.1', style({ self: 'me' })), '내 배에서 꼬르륵 소리가 나.');
  assert.equal(say('idle.any.2', style({ self: 'custom', selfText: '저' })), '제가 보기엔 지금 잘하고 있어.');
  assert.equal(
    say('idle.any.17', style({ self: 'custom', selfText: '이 몸' })),
    '이 몸은 방금 한 바퀴 돌았어. 기분 전환 끝!',
  );
  // 직접이 비면 이름 그대로
  assert.equal(
    say('idle.any.17', style({ self: 'custom', selfText: '' })),
    '콩이는 방금 한 바퀴 돌았어. 기분 전환 끝!',
  );
  // 영어는 늘 이름
  setLang('en');
  assert.equal(
    say('idle.any.17', style({ self: 'me' }), { name: 'Bean' }),
    'Bean just spun around once. Mood reset done!',
  );
  setLang('ko');
});

test('직접 쓴 말: 새 때 열 가지와 비슷한 때 대신 쓰기 (끝낸 직후는 칭찬, 돌아옴은 아침)', () => {
  setLang('ko');
  setSpeechSource({ style: () => DEFAULT_STYLE, petName: () => '콩이' });
  setVoiceRandom(() => 0);
  try {
    const lines = (over: Partial<Record<keyof SpeechStyle['lines'], string[]>>) => ({
      ...DEFAULT_STYLE.lines,
      ...over,
    });
    assert.equal(say('idle.lunch.1', style({ lines: lines({ lunch: ['밥이다!'] }) })), '밥이다!');
    assert.equal(say('idle.hungry.1', style({ lines: lines({ hungry: ['꼬르륵'] }) })), '꼬르륵');
    assert.equal(say('idle.evening.1', style({ lines: lines({ evening: ['저녁이다'] }) })), '저녁이다');
    assert.equal(
      say('panel.focus.breakDone', style({ lines: lines({ focusEnd: ['집중 끝!'] }) })),
      '집중 끝!',
    );
    // 끝낸 직후: 그 때 말이 없으면 칭찬 말
    assert.equal(say('idle.done.1', style({ lines: lines({ praise: ['최고야'] }) })), '최고야');
    assert.equal(
      say('idle.done.1', style({ lines: lines({ praise: ['최고야'], done: ['해냈다'] }) })),
      '해냈다',
    );
    // 돌아왔을 때: 그 때 말이 없으면 아침 인사
    assert.equal(say('idle.back.1', style({ lines: lines({ morning: ['어서 와'] }) })), '어서 와');
    // 말이 없는 때는 원래 말
    assert.notEqual(say('idle.lunch.1', style({})), '밥이다!');
  } finally {
    setVoiceRandom(Math.random);
  }
});

test('직접 쓴 말 빈도: 항상은 늘, 가끔은 30%만, 나머지는 원래 말', () => {
  setLang('ko');
  setSpeechSource({ style: () => DEFAULT_STYLE, petName: () => '콩이' });
  const own = { ...DEFAULT_STYLE.lines, lunch: ['밥이다!'] };
  const original = voiced('idle.lunch.1' as never, { name: '콩이' }, 'friend');
  try {
    setVoiceRandom(() => 0.95);
    assert.equal(say('idle.lunch.1', style({ lines: own, ownRate: 'always' })), '밥이다!');
    assert.equal(say('idle.lunch.1', style({ lines: own, ownRate: 'sometimes' })), original);
    assert.equal(say('idle.lunch.1', style({ lines: own, ownRate: 'often' })), original);
    setVoiceRandom(() => 0.2);
    assert.equal(say('idle.lunch.1', style({ lines: own, ownRate: 'sometimes' })), '밥이다!');
    setVoiceRandom(() => 0.5);
    assert.equal(say('idle.lunch.1', style({ lines: own, ownRate: 'often' })), '밥이다!');
    assert.equal(say('idle.lunch.1', style({ lines: own, ownRate: 'sometimes' })), original);
  } finally {
    setVoiceRandom(Math.random);
  }
});

test('안 쓰기: 읽기, 정리, 켜고 끄기, 목록 표시', () => {
  const raw = {
    ko: ['idle.any.17', 'idle.any.17', 7, 'nope.nothing', 'pet.fed.2', 'x'.repeat(200)],
    en: 'junk',
  };
  const m = parseMuted(raw);
  assert.deepEqual(m.ko, ['idle.any.17', 'pet.fed.2']);
  assert.deepEqual(m.en, []);
  assert.deepEqual(parseMuted(undefined), emptyMuted());
  const many = parseMuted({ ko: Array.from({ length: MUTED_MAX + 50 }, () => 'idle.any.17') });
  assert.equal(many.ko.length, 1);
  // 사전에서 사라진 키는 버린다
  const pruned = pruneMuted({ ko: ['idle.any.17', 'idle.any.9999'], en: ['idle.any.17'] }, dicts);
  assert.deepEqual(pruned, { ko: ['idle.any.17'], en: ['idle.any.17'] });
  // 켜고 끄기, 중복 없음
  let cur = setMuted(emptyMuted(), 'ko', 'idle.any.17', true);
  cur = setMuted(cur, 'ko', 'idle.any.17', true);
  assert.deepEqual(cur.ko, ['idle.any.17']);
  assert.deepEqual(cur.en, []);
  const state = buildLinesState(dicts.ko, 'ko', { ko: {}, en: {} }, '콩이', cur);
  assert.equal(state.mutedCount, 1);
  const row = state.groups.flatMap((g) => g.lines).find((l) => l.key === 'idle.any.17');
  assert.equal(row?.muted, true);
  assert.equal(state.groups.flatMap((g) => g.lines).find((l) => l.key === 'idle.any.18')?.muted, false);
  cur = setMuted(cur, 'ko', 'idle.any.17', false);
  assert.deepEqual(cur.ko, []);
});

test('안 쓰기로 한 혼잣말은 고르지 않는다 (수천 번 골라도)', () => {
  const muted = ['idle.any.17', 'idle.any.18', 'idle.any.19', 'idle.morning.5'];
  setMutedLines({ ko: muted, en: [] });
  try {
    const talk = new IdleTalk();
    let n = 0;
    const rand = () => ((n++ * 0.6180339887) % 1) as number;
    const f: IdleFacts = { now: new Date(2026, 9, 6, 9).getTime(), doneToday: 0 };
    for (let i = 0; i < 400; i++) {
      const key = talk.pick({ ...f, now: f.now + i * 60_000 }, rand) as IdleKey;
      assert.ok(!muted.includes(key), `${i}: ${key}`);
    }
  } finally {
    setMutedLines({ ko: [], en: [] });
  }
});

test('안 쓰기로 한 변형은 고르지 않고, 다 껐으면 그래도 하나는 말한다', () => {
  const picker = new VariantPicker();
  let n = 0;
  const rand = () => ((n++ * 0.37) % 1) as number;
  const all = Array.from({ length: 8 }, (_, i) => (i === 0 ? 'pet.fed' : `pet.fed.${i + 1}`));
  setMutedLines({ ko: ['pet.fed.2', 'pet.fed.3'], en: [] });
  try {
    for (let i = 0; i < 200; i++) {
      const k = picker.pick('pet.fed', rand);
      assert.ok(!['pet.fed.2', 'pet.fed.3'].includes(k), k);
    }
    setMutedLines({ ko: all, en: [] });
    assert.ok(all.includes(picker.pick('pet.fed', rand)));
  } finally {
    setMutedLines({ ko: [], en: [] });
  }
});
