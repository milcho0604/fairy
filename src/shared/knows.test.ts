import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addFact,
  cleanBirthday,
  cleanFacts,
  cleanMeta,
  editMemory,
  editRule,
  factsForAi,
  factTalkHour,
  forgetAll,
  isBirthday,
  knowRows,
  type MemMeta,
  pickFactTalk,
  stampMemory,
} from './knows.ts';
import { memoryKey } from './pet-memory.ts';
import { applyPatch, DEFAULT_SETTINGS, parseSettings } from './settings.ts';

const mem = (petMemory: string[], petMemoryPending: string[] = [], petMemoryMeta: MemMeta = {}) => ({
  petMemory,
  petMemoryPending,
  petMemoryMeta,
});

test('출처 붙이기: 새 기억은 직접, 새 기다리는 것은 MCP, 원래 있던 것은 그대로', () => {
  const prev = mem(['커피 좋아함'], [], { [memoryKey('커피 좋아함')]: { src: 'chat', at: 5 } });
  const next = mem(['커피 좋아함', '아침엔 회의'], ['고양이 키움']);
  const meta = stampMemory(prev, { ...next, petMemoryMeta: prev.petMemoryMeta }, 100);
  assert.deepEqual(meta[memoryKey('커피 좋아함')], { src: 'chat', at: 5 });
  assert.deepEqual(meta[memoryKey('아침엔 회의')], { src: 'user', at: 100 });
  assert.deepEqual(meta[memoryKey('고양이 키움')], { src: 'mcp', at: 100 });
});

test('출처 붙이기: 기다리던 것을 허락하면 출처를 이어 받고 날짜는 허락한 때', () => {
  const k = memoryKey('밤에 일함');
  const prev = mem([], ['밤에 일함'], { [k]: { src: 'chat', at: 10 } });
  // 설정을 다시 읽으면 같은 값도 새 객체다
  const meta = stampMemory(prev, mem(['밤에 일함'], [], structuredClone(prev.petMemoryMeta)), 200);
  assert.deepEqual(meta[k], { src: 'chat', at: 200 });
});

test('출처 붙이기: 바꾸는 값에 출처를 같이 넣었으면 그것을 쓰고, 지운 기억의 출처는 남기지 않는다', () => {
  const prev = mem(['a 하나'], [], { [memoryKey('a 하나')]: { src: 'user', at: 1 } });
  const given = { [memoryKey('b 둘')]: { src: 'chat' as const, at: 7 } };
  const meta = stampMemory(prev, mem(['b 둘'], [], { ...prev.petMemoryMeta, ...given }), 99);
  assert.deepEqual(meta, given);
});

test('출처 표 고르기: 모르는 출처, 틀린 날짜, 없는 기억은 버린다', () => {
  const raw = {
    [memoryKey('있음')]: { src: 'mcp', at: 3.7 },
    [memoryKey('없음')]: { src: 'mcp', at: 3 },
    x: { src: 'evil', at: 3 },
    [memoryKey('있음2')]: { src: 'user', at: -1 },
  };
  assert.deepEqual(cleanMeta(raw, ['있음', '있음2']), { [memoryKey('있음')]: { src: 'mcp', at: 3 } });
  assert.deepEqual(cleanMeta([1, 2], ['있음']), {});
  assert.deepEqual(cleanMeta(null, ['있음']), {});
});

test('설정 파일: 출처와 알려 준 것을 읽고, 기억을 지우면 출처도 빠진다', () => {
  const s = parseSettings({
    petMemory: ['커피'],
    petMemoryMeta: { [memoryKey('커피')]: { src: 'user', at: 1 }, 남은것: { src: 'user', at: 1 } },
    petFacts: [{ kind: 'birthday', value: '3-5', at: 1 }],
  });
  assert.deepEqual(Object.keys(s.petMemoryMeta), [memoryKey('커피')]);
  assert.deepEqual(s.petFacts, [{ kind: 'birthday', value: '03-05', at: 1 }]);
  const next = applyPatch(s, { petMemory: [] });
  assert.deepEqual(next.petMemoryMeta, {});
  assert.equal(DEFAULT_SETTINGS.seasonWear, true);
  assert.equal(parseSettings({ seasonWear: false }).seasonWear, false);
});

test('생일: MM-DD 로 다듬고 없는 날은 받지 않는다 (2월 29일은 받는다)', () => {
  assert.equal(cleanBirthday('3-5'), '03-05');
  assert.equal(cleanBirthday('02-29'), '02-29');
  assert.equal(cleanBirthday('02-30'), undefined);
  assert.equal(cleanBirthday('13-01'), undefined);
  assert.equal(cleanBirthday('04-31'), undefined);
  assert.equal(cleanBirthday('2024-03-05'), undefined);
  assert.equal(cleanBirthday(305), undefined);
});

test('오늘이 생일인지: 2월 29일 생일은 평년에 2월 28일', () => {
  const f = cleanFacts([{ kind: 'birthday', value: '02-29', at: 1 }]);
  assert.equal(isBirthday(f, '2028-02-29'), true);
  assert.equal(isBirthday(f, '2027-02-28'), true);
  assert.equal(isBirthday(f, '2028-02-28'), false);
  assert.equal(isBirthday(cleanFacts([{ kind: 'birthday', value: '10-11' }]), '2026-10-11'), true);
  assert.equal(isBirthday([], '2026-10-11'), false);
});

test('알려 준 것: 생일과 간식은 하나, 좋아하는 것은 다섯까지, 같은 것과 틀린 값', () => {
  let list = addFact([], 'food', '  붕어빵 ', 1).list;
  assert.deepEqual(list, [{ kind: 'food', value: '붕어빵', at: 1 }]);
  list = addFact(list, 'food', '호떡', 2).list;
  assert.deepEqual(
    list.filter((f) => f.kind === 'food').map((f) => f.value),
    ['호떡'],
  );
  assert.equal(addFact(list, 'food', '호떡', 3).result, 'dupe');
  assert.equal(addFact(list, 'birthday', '2-30', 3).result, 'bad');
  assert.equal(addFact(list, 'like', '   ', 3).result, 'bad');
  for (const v of ['비', '눈', '산책', '고양이', '커피']) list = addFact(list, 'like', v, 4).list;
  assert.equal(addFact(list, 'like', '여섯째', 5).result, 'full');
  assert.equal(addFact(list, 'like', '산 책', 5).result, 'dupe');
  // 생일이 맨 앞, 간식, 좋아하는 것 순
  list = addFact(list, 'birthday', '12-25', 6).list;
  assert.deepEqual(
    list.map((f) => f.kind),
    ['birthday', 'food', 'like', 'like', 'like', 'like', 'like'],
  );
  // 30자에서 자른다
  assert.equal(addFact([], 'like', 'ㄱ'.repeat(50), 1).list[0]?.value.length, 30);
});

test('AI 에 보내는 줄과 한마디 고르기', () => {
  const f = cleanFacts([
    { kind: 'birthday', value: '03-05', at: 1 },
    { kind: 'food', value: '붕어빵', at: 1 },
  ]);
  const lines = factsForAi(f, (kind, v) => `${kind}:${v.m ?? ''}/${v.d ?? ''}:${v.value}`);
  assert.deepEqual(lines, ['birthday:3/5:03-05', 'food:/:붕어빵']);
  assert.equal(pickFactTalk([]), undefined);
  // 생일만 있으면 한마디는 없다 (생일은 그날 인사로)
  assert.equal(pickFactTalk([f[0] as (typeof f)[number]]), undefined);
  assert.deepEqual(
    pickFactTalk(f, () => 0),
    { kind: 'food', value: '붕어빵', variant: 1 },
  );
  assert.equal(factTalkHour(10), false);
  assert.equal(factTalkHour(11), true);
  assert.equal(factTalkHour(20), false);
});

test('화면 목록: 알려 준 것, 기억(최근 것 먼저), 기다리는 것, 규칙 줄', () => {
  const k = memoryKey('둘째');
  const rows = knowRows({
    petFacts: cleanFacts([{ kind: 'like', value: '비', at: 9 }]),
    petMemory: ['첫째', '둘째'],
    petMemoryPending: ['기다림'],
    petMemoryMeta: { [k]: { src: 'mcp', at: 4 } },
    petRules: '세 줄로\n\n반말로',
  });
  assert.deepEqual(
    rows.map((r) => [r.kind, r.text, r.src ?? '-']),
    [
      ['fact', '비', 'user'],
      ['memory', '둘째', 'mcp'],
      ['memory', '첫째', '-'],
      ['pending', '기다림', '-'],
      ['rule', '세 줄로', 'user'],
      ['rule', '반말로', 'user'],
    ],
  );
  assert.equal(rows.at(-1)?.line, 2);
});

test('규칙과 기억 고치기, 모두 잊기', () => {
  assert.equal(editRule('하나\n둘\n셋', 1, '  두울 '), '하나\n두울\n셋');
  assert.equal(editRule('하나\n둘\n셋', 1, ''), '하나\n셋');
  assert.equal(editRule('하나', 5, 'x'), '하나');
  assert.equal(editRule('하나\n둘', 0, 'a\nb'), 'a b\n둘');
  assert.deepEqual(editMemory(['가', '나'], '가', '다'), { list: ['다', '나'], result: 'changed' });
  assert.deepEqual(editMemory(['가', '나'], '가', '나'), { list: ['가', '나'], result: 'dupe' });
  assert.deepEqual(editMemory(['가', '나'], '가', ' '), { list: ['나'], result: 'removed' });
  assert.deepEqual(editMemory(['가'], '가', '가'), { list: ['가'], result: 'same' });
  assert.deepEqual(forgetAll(false), {
    petMemory: [],
    petMemoryPending: [],
    petMemoryMeta: {},
    petFacts: [],
  });
  assert.equal(forgetAll(true).petRules, '');
});
