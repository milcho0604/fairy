import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENERGY_BLINK,
  ENERGY_PACE,
  type EnergyStage,
  EnergyWatch,
  energyLookOf,
  energyOf,
  energyTalkKeys,
  FATIGUE_MIN,
  fatigueOf,
  rhythmAt,
  stageOf,
} from './energy.ts';

const MIN = 60_000;
/** 그날 h시 m분 (사용자 컴퓨터 시각) */
const at = (h: number, m = 0) => new Date(2026, 9, 8, h, m);
const stageAt = (h: number, m = 0, worked = 0) => energyOf(at(h, m), worked).stage;

test('하루 리듬: 아침엔 잠이 덜 깨고 낮엔 활발, 저녁엔 차분, 밤엔 졸림', () => {
  const want: [number, number, EnergyStage][] = [
    [2, 0, 'sleepy'],
    [6, 0, 'sleepy'],
    [7, 0, 'tired'], // 깨어나는 중
    [8, 30, 'normal'],
    [10, 0, 'lively'],
    [12, 0, 'lively'],
    [14, 0, 'normal'], // 점심 뒤 살짝 처진다
    [16, 0, 'lively'],
    [19, 0, 'normal'], // 저녁엔 차분
    [21, 30, 'tired'],
    [23, 0, 'sleepy'],
  ];
  for (const [h, m, stage] of want) assert.equal(stageAt(h, m), stage, `${h}:${m}`);
});

test('자정을 넘어도 리듬이 끊기지 않는다 (23:59 와 00:00 이 거의 같다)', () => {
  assert.ok(Math.abs(rhythmAt(23 * 60 + 59) - rhythmAt(0)) < 0.01);
  assert.equal(rhythmAt(-60), rhythmAt(23 * 60));
  assert.equal(rhythmAt(1440 + 600), rhythmAt(600));
  // 1분 단위로 훑어 봐도 한 번에 크게 뛰지 않는다 (단계가 들쭉날쭉하지 않게)
  for (let m = 1; m < 1440; m++) assert.ok(Math.abs(rhythmAt(m) - rhythmAt(m - 1)) < 0.01, `${m}`);
});

test('연속 작업 피로: 90분이면 살짝, 2시간이면 확실히. 한낮에도 지친 얼굴', () => {
  assert.equal(fatigueOf(89), 0);
  assert.equal(fatigueOf(FATIGUE_MIN[0]), 1);
  assert.equal(fatigueOf(FATIGUE_MIN[1]), 2);
  assert.equal(fatigueOf(600), 2);
  const fresh = energyOf(at(11), 30);
  assert.equal(fresh.stage, 'lively');
  assert.equal(fresh.worn, false);
  const bit = energyOf(at(11), 95);
  assert.equal(bit.stage, 'tired');
  assert.equal(bit.worn, false);
  const worn = energyOf(at(11), 130);
  assert.equal(worn.stage, 'tired');
  assert.equal(worn.worn, true);
  assert.ok(worn.level < bit.level);
});

test('밤샘: 밤 졸림에 피로가 겹치면 졸림과 녹초. 아침이 와도 쉬지 않았으면 지친 그대로', () => {
  const night = energyOf(at(2), 300);
  assert.equal(night.stage, 'sleepy');
  assert.equal(night.worn, true);
  assert.equal(night.level, 0);
  const morning = energyOf(at(10), 480);
  assert.equal(morning.stage, 'tired');
  assert.equal(morning.worn, true);
});

test('단계 경계와 값 고르기', () => {
  assert.equal(stageOf(1), 'lively');
  assert.equal(stageOf(0.85), 'lively');
  assert.equal(stageOf(0.84), 'normal');
  assert.equal(stageOf(0.62), 'normal');
  assert.equal(stageOf(0.61), 'tired');
  assert.equal(stageOf(0.35), 'tired');
  assert.equal(stageOf(0.34), 'sleepy');
  assert.equal(energyOf(at(12), -5).stage, 'lively');
  assert.deepEqual(energyLookOf({ stage: 'tired', worn: true }), { stage: 'tired', worn: true });
  assert.deepEqual(energyLookOf({ stage: 'sleepy' }), { stage: 'sleepy', worn: false });
  assert.equal(energyLookOf({ stage: 'hyper' }), undefined);
  assert.equal(energyLookOf(null), undefined);
  assert.equal(energyLookOf('tired'), undefined);
});

test('보통 단계는 예전 그대로 (걷기 35%, 앉기 17%, 빠르기 1, 깜빡임 180ms 네 틀 3~7초)', () => {
  assert.deepEqual(ENERGY_PACE.normal, { walk: 0.35, sit: 0.17, speed: 1, wait: 1 });
  assert.deepEqual(ENERGY_BLINK.normal, { ms: 180, every: 3000, spread: 4000, frames: 4 });
  // 졸릴수록 천천히 깜빡이고 천천히 걷는다
  assert.ok(ENERGY_BLINK.sleepy.ms > ENERGY_BLINK.tired.ms && ENERGY_BLINK.tired.ms > ENERGY_BLINK.normal.ms);
  assert.ok(ENERGY_PACE.sleepy.speed < ENERGY_PACE.tired.speed && ENERGY_PACE.lively.speed > 1);
});

/** 1분마다 tick. worked 는 그 분의 연속 작업 분, idle 은 입력 없는 초 */
function run(w: EnergyWatch, steps: { h: number; m: number; worked: number; idle?: number }[]) {
  return steps.map((s) => w.tick(at(s.h, s.m), s.worked, s.idle ?? 0));
}

test('혼잣말 대사: 녹초가 먼저, 그다음 졸림, 나른함, 활발. 보통과 꺼짐은 없다', () => {
  assert.deepEqual(energyTalkKeys({ stage: 'tired', worn: true }), [
    'idle.energy.worn.1',
    'idle.energy.worn.2',
  ]);
  assert.deepEqual(energyTalkKeys({ stage: 'sleepy', worn: false }), [
    'idle.energy.sleepy.1',
    'idle.energy.sleepy.2',
  ]);
  assert.deepEqual(energyTalkKeys({ stage: 'tired', worn: false }), [
    'idle.energy.tired.1',
    'idle.energy.tired.2',
  ]);
  assert.deepEqual(energyTalkKeys({ stage: 'lively', worn: false }), [
    'idle.energy.lively.1',
    'idle.energy.lively.2',
  ]);
  assert.deepEqual(energyTalkKeys({ stage: 'normal', worn: false }), []);
  assert.deepEqual(energyTalkKeys(undefined), []);
});

test('모습이 바뀐 틱만 changed (활발 → 지침 → 녹초)', () => {
  const w = new EnergyWatch();
  const r = run(w, [
    { h: 11, m: 0, worked: 80 },
    { h: 11, m: 10, worked: 90 },
    { h: 11, m: 11, worked: 91 },
    { h: 11, m: 40, worked: 120 },
    { h: 11, m: 41, worked: 121 },
  ]);
  assert.deepEqual(
    r.map((x) => x.changed),
    [true, true, false, true, false],
  );
});

test('지쳤다가 쉬고 돌아오면 개운함 한 번. 쉬는 동안은 미뤘다가 돌아온 첫 틱에', () => {
  const w = new EnergyWatch();
  const r = run(w, [
    { h: 15, m: 0, worked: 125 },
    { h: 15, m: 6, worked: 0, idle: 360 }, // 5분 넘게 자리 비움: 피로가 풀렸다
    { h: 15, m: 12, worked: 0, idle: 720 },
    { h: 15, m: 13, worked: 0, idle: 5 }, // 돌아왔다
    { h: 15, m: 14, worked: 1, idle: 2 },
  ]);
  assert.deepEqual(
    r.map((x) => x.fresh),
    [false, false, false, true, false],
  );
  // 다시 지쳤다가 쉬고 오면 또 개운하다
  const again = run(w, [
    { h: 16, m: 45, worked: 92 },
    { h: 16, m: 52, worked: 0, idle: 400 },
    { h: 16, m: 53, worked: 0, idle: 1 },
  ]);
  assert.deepEqual(
    again.map((x) => x.fresh),
    [false, false, true],
  );
});

test('지친 적이 없으면 쉬고 와도 개운함은 없다 (앱을 다시 켜면 피로는 0 부터)', () => {
  const w = new EnergyWatch();
  const r = run(w, [
    { h: 10, m: 0, worked: 40 },
    { h: 10, m: 10, worked: 0, idle: 600 },
    { h: 10, m: 11, worked: 0, idle: 3 },
  ]);
  assert.ok(r.every((x) => !x.fresh));
});

test('시각이 바뀌면(시계 맞춤, 잠자기 뒤) 다음 틱에 그 시각 리듬으로', () => {
  const w = new EnergyWatch();
  assert.equal(w.tick(at(12), 0, 0).energy.stage, 'lively');
  const jumped = w.tick(at(23, 30), 0, 0);
  assert.equal(jumped.energy.stage, 'sleepy');
  assert.equal(jumped.changed, true);
});

test('몸 시계(만나는 시간)를 주면 그 시각으로 읽는다: 13시에 시작하는 사람은 13시가 9시처럼', () => {
  // 13시 시작이면 몸 시계는 4시간 앞 (shared/routine.ts bodyClock)
  assert.equal(energyOf(at(13), 0, 9 * 60).stage, energyOf(at(9), 0).stage);
  assert.equal(energyOf(at(9), 0, 5 * 60).stage, 'sleepy');
  // 밤 근무: 새벽 1시가 몸 시계 11시면 활발
  assert.equal(energyOf(at(1), 0, 11 * 60).stage, 'lively');
  // 피로는 몸 시계와 상관없이 더한다
  assert.equal(energyOf(at(1), 130, 11 * 60).worn, true);
  const w = new EnergyWatch();
  assert.equal(w.tick(at(3), 0, 0, 11 * 60).energy.stage, 'lively');
  assert.equal(MIN, 60_000);
});
