import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AT_EXPECTED,
  addDuration,
  DURATION_KEEP,
  downloadLeftSec,
  expectedMs,
  FALLBACK_MS,
  GUESS_CAP,
  guessLeftSec,
  guessPhase,
  guessRatio,
  leftUnit,
  loadExpected,
  parseDurations,
  ratioPhase,
  roundLeft,
  saveDuration,
} from './make-progress.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('예상 진행: 0 에서 시작해 예상 시간에 80%, 끝까지 상한(97%)을 넘지 않는다', () => {
  assert.equal(guessRatio(0, 30_000), 0);
  assert.equal(guessRatio(-5, 30_000), 0);
  assert.equal(guessRatio(1000, 0), 0);
  assert.equal(guessRatio(Number.NaN, 30_000), 0);
  near(guessRatio(30_000, 30_000), AT_EXPECTED);
  // 아주 오래 걸려도 100% 가 되지 않는다 (100% 는 진짜 끝났을 때만)
  assert.ok(guessRatio(30_000 * 1000, 30_000) < GUESS_CAP);
  assert.ok(guessRatio(30_000 * 1000, 30_000) > 0.96);
});

test('예상 진행은 늘 앞으로만 가고, 예상 시간 앞뒤로 끊기지 않는다', () => {
  let prev = -1;
  for (let ms = 0; ms <= 300_000; ms += 250) {
    const r = guessRatio(ms, 30_000);
    assert.ok(r > prev || ms === 0, `${ms}ms 에서 멈추거나 뒤로 갔다 (${prev} -> ${r})`);
    prev = r;
  }
  // 예상 시간 바로 앞과 뒤의 차이가 작다 (튀지 않는다)
  const before = guessRatio(29_999, 30_000);
  const after = guessRatio(30_001, 30_000);
  assert.ok(after - before < 1e-4, `${before} -> ${after}`);
});

test('예상보다 오래 걸려도 멈춰 보이지 않게 계속 움직인다', () => {
  // 30초 예상: 두 배(60초)에도 1초에 0.1% 넘게, 세 배(90초)에도 0.04% 넘게. 그 사이 초 세기와 "오래 걸리네" 글이 같이 산다
  const per = (ms: number) => guessRatio(ms + 1000, 30_000) - guessRatio(ms, 30_000);
  assert.ok(per(60_000) > 0.001, `${per(60_000)}`);
  assert.ok(per(90_000) > 0.0004, `${per(90_000)}`);
});

test('구간: 처음, 중간, 거의 다, 오래 걸림', () => {
  assert.equal(guessPhase(0, 30_000), 'start');
  assert.equal(guessPhase(8_000, 30_000), 'start');
  assert.equal(guessPhase(9_000, 30_000), 'middle');
  assert.equal(guessPhase(24_000, 30_000), 'almost');
  assert.equal(guessPhase(47_000, 30_000), 'almost');
  assert.equal(guessPhase(48_000, 30_000), 'long');
  assert.equal(guessPhase(5, 0), 'start');
  assert.equal(ratioPhase(0), 'start');
  assert.equal(ratioPhase(0.5), 'middle');
  assert.equal(ratioPhase(1), 'almost');
});

test('남은 시간은 5초(1분 넘으면 30초) 단위로 올리고, 예상의 80% 가 지나면 숨긴다', () => {
  assert.equal(roundLeft(0), 0);
  assert.equal(roundLeft(-3), 0);
  assert.equal(roundLeft(0.2), 5);
  assert.equal(roundLeft(12), 15);
  assert.equal(roundLeft(60), 60);
  assert.equal(roundLeft(61), 90);
  assert.equal(guessLeftSec(0, 30_000), 30);
  assert.equal(guessLeftSec(11_000, 30_000), 20);
  assert.equal(guessLeftSec(23_999, 30_000), 10);
  assert.equal(guessLeftSec(24_000, 30_000), undefined);
  assert.equal(guessLeftSec(99_000, 30_000), undefined);
  assert.equal(guessLeftSec(0, 0), undefined);
});

test('받기 남은 시간: 받은 빠르기로 어림, 너무 이르거나 다 받았으면 모른다', () => {
  assert.equal(downloadLeftSec(0.01, 10_000), undefined);
  assert.equal(downloadLeftSec(0.5, 1000), undefined);
  assert.equal(downloadLeftSec(1, 30_000), undefined);
  assert.equal(downloadLeftSec(Number.NaN, 30_000), undefined);
  // 10초에 25% 면 30초 남음
  assert.equal(downloadLeftSec(0.25, 10_000), 30);
  // 4초에 2% 면 196초 -> 210초
  assert.equal(downloadLeftSec(0.02, 4000), 210);
});

test('남은 시간 단위: 10초까지는 금방, 90초부터 분', () => {
  assert.deepEqual(leftUnit(5), { unit: 'soon', n: 5 });
  assert.deepEqual(leftUnit(10), { unit: 'soon', n: 10 });
  assert.deepEqual(leftUnit(15), { unit: 'sec', n: 15 });
  assert.deepEqual(leftUnit(60), { unit: 'sec', n: 60 });
  assert.deepEqual(leftUnit(90), { unit: 'min', n: 2 });
  assert.deepEqual(leftUnit(210), { unit: 'min', n: 4 });
});

test('걸린 시간 기록: 깨진 값과 이상한 값은 버리고 최근 다섯 개만', () => {
  assert.deepEqual(parseDurations(null), []);
  assert.deepEqual(parseDurations('not json'), []);
  assert.deepEqual(parseDurations('{"a":1}'), []);
  assert.deepEqual(parseDurations('[1000, "x", -5, 1e9, null, 2000]'), [1000, 2000]);
  let raw: string | null = null;
  for (let i = 1; i <= 8; i++) raw = addDuration(raw, i * 1000);
  assert.deepEqual(parseDurations(raw), [4000, 5000, 6000, 7000, 8000]);
  assert.equal(parseDurations(raw).length, DURATION_KEEP);
  // 이상한 값은 더하지 않는다
  assert.equal(addDuration('[1000]', Number.NaN), '[1000]');
  assert.equal(addDuration('[1000]', 50), '[1000]');
});

test('예상 시간: 가운데 값에 10% 여유, 기본값의 4분의 1과 세 배 사이', () => {
  assert.equal(expectedMs([], 35_000), 35_000);
  near(expectedMs([19_000, 33_000, 37_000], 35_000), 33_000 * 1.1);
  near(expectedMs([20_000, 30_000], 35_000), 25_000 * 1.1);
  // 한 번 아주 빨랐어도 기본의 4분의 1 아래로 안 간다
  assert.equal(expectedMs([1000], 35_000), 8750);
  // 그래픽 카드로 1~2초면 끝나는 배경 지우기는 짧게 따라간다 (기본 6초, 1.32초 대신 하한 1.5초)
  assert.equal(expectedMs([1016, 2461, 1200], 6000), 1500);
  near(expectedMs([1800, 2000, 2200], 6000), 2200);
  assert.equal(expectedMs([600_000], 35_000), 105_000);
});

test('저장소에서 읽고 쓴다. 저장소가 없거나 던져도 기본값으로', () => {
  const mem = new Map<string, string>();
  const store = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
  };
  assert.equal(loadExpected('figure', store), FALLBACK_MS.figure);
  saveDuration('figure', 20_000, store);
  saveDuration('figure', 22_000, store);
  saveDuration('figure', 24_000, store);
  near(loadExpected('figure', store), 22_000 * 1.1);
  // 다른 일과 섞이지 않는다
  assert.equal(loadExpected('cutout', store), FALLBACK_MS.cutout);
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(loadExpected('relief', broken), FALLBACK_MS.relief);
  assert.doesNotThrow(() => saveDuration('relief', 3000, broken));
  assert.equal(loadExpected('relief', undefined), FALLBACK_MS.relief);
});
