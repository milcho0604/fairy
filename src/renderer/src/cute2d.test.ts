import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MOVES } from '../../shared/moves.ts';
import type { PetMood } from '../../shared/pet-mood.ts';
import { PET_KIND_IDS } from '../../shared/settings.ts';
import {
  ART_GROUND,
  CUTE_GEOM,
  CUTE_KINDS,
  CUTE_POSES,
  type CuteInput,
  type CutePose,
  cuteEyes,
  cutePose,
  isCuteKind,
  LOOK_SIDE,
  TALK_FLIP_MS,
} from './cute2d.ts';

// 모든 상태 (타입이 빠진 상태를 잡는다: PetMood 에 새 상태가 생기면 여기서 타입 오류)
const MOODS = {
  hidden: true,
  grabbed: true,
  thinking: true,
  talking: true,
  busy: true,
  excited: true,
  sleeping: true,
  dozing: true,
  sulky: true,
  idle: true,
} satisfies Record<PetMood, true>;
const moods = Object.keys(MOODS) as PetMood[];
const base: CuteInput = { mood: 'idle', elapsed: 0, stage: 0 };
const walk = (steps: number, dir: -1 | 1 = 1): CuteInput['act'] => ({
  type: 'walk',
  dir,
  phase: steps % 1,
  steps,
});

test('기본 페어리 여덟 모두 손그림 (2026-10-13)', () => {
  assert.deepEqual(
    PET_KIND_IDS.filter((k) => isCuteKind(k)),
    [...PET_KIND_IDS],
  );
  assert.equal(isCuteKind(undefined), false);
});

test('모든 상태와 행동, 몸짓이 그림이 있는 자세로 이어진다', () => {
  const acts: CuteInput['act'][] = [
    undefined,
    walk(0.3),
    walk(1.2, -1),
    { type: 'walk', dir: 1, phase: 0, steps: 0, facing: 'away' },
    { type: 'walk', dir: 1, phase: 0, steps: 0, facing: 'toward' },
    { type: 'sit' },
    { type: 'look', dir: 1 },
    ...MOVES.map((type) => ({ type, t: 0.5, dir: 1 as const })),
  ];
  for (const mood of moods)
    for (const act of acts)
      for (const stage of [0, 1, 2, 3])
        for (const hungry of [false, true])
          for (const trick of [
            undefined,
            { type: 'wave' as const, t: 0.5 },
            { type: 'dance' as const, t: 0.5 },
          ]) {
            const p = cutePose({ ...base, mood, act, stage, hungry, trick });
            assert.ok((CUTE_POSES as readonly string[]).includes(p.pose), `${mood} ${act?.type} ${p.pose}`);
          }
});

test('상태마다 맞는 자세', () => {
  const pose = (s: Partial<CuteInput>) => cutePose({ ...base, ...s }).pose;
  assert.equal(pose({}), 'idle');
  assert.equal(pose({ act: { type: 'sit' } }), 'sit');
  assert.equal(pose({ mood: 'sleeping' }), 'sleep');
  assert.equal(pose({ mood: 'dozing' }), 'doze');
  assert.equal(pose({ mood: 'excited' }), 'happy');
  assert.equal(pose({ mood: 'grabbed' }), 'grab');
  assert.equal(pose({ hungry: true }), 'hungry');
  assert.equal(pose({ trick: { type: 'wave', t: 0.3 } }), 'wave');
  assert.equal(pose({ act: { type: 'yawn', t: 0.5 } }), 'yawn');
  // 하품 처음과 끝은 입을 닫은 서기
  assert.equal(pose({ act: { type: 'yawn', t: 0.05 } }), 'idle');
  // 그림이 없는 상태는 가장 가까운 그림
  assert.equal(pose({ mood: 'thinking' }), 'idle');
  assert.equal(pose({ mood: 'busy' }), 'idle');
  assert.equal(pose({ act: { type: 'stretch', t: 0.5 } }), 'happy');
  assert.equal(pose({ trick: { type: 'dance', t: 0.5 } }), 'happy');
});

test('토라짐: 1, 2단계는 삐진 얼굴, 3단계는 등 돌림 (앉아 있어도)', () => {
  for (const stage of [1, 2]) assert.equal(cutePose({ ...base, mood: 'sulky', stage }).pose, 'sulky');
  assert.equal(cutePose({ ...base, mood: 'sulky', stage: 3 }).pose, 'back');
  assert.equal(cutePose({ ...base, mood: 'sulky', stage: 3, act: { type: 'sit' } }).pose, 'back');
});

test('말하기는 입 그림 둘을 번갈아', () => {
  const at = (ms: number) => cutePose({ ...base, mood: 'talking', elapsed: ms }).pose;
  assert.equal(at(0), 'talk-0');
  assert.equal(at(TALK_FLIP_MS + 1), 'talk-1');
  assert.equal(at(TALK_FLIP_MS * 2 + 1), 'talk-0');
});

test('걷기는 두 걸음에 여섯 장을 차례로 넘기고, 왼쪽으로 가면 뒤집는다', () => {
  const seen = [0, 1, 2, 3, 4, 5].map((i) => cutePose({ ...base, act: walk((i + 0.5) / 3) }).pose);
  assert.deepEqual(seen, ['walk-0', 'walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5']);
  assert.equal(cutePose({ ...base, act: walk(0.1) }).flip, false);
  assert.equal(cutePose({ ...base, act: walk(0.1, -1) }).flip, true);
  // 삐져도 걸을 때는 걷기 그림, 집으로 들어갈 때는 뒷모습
  assert.equal(cutePose({ ...base, mood: 'sulky', stage: 1, act: walk(0.1) }).pose, 'walk-0');
  assert.equal(
    cutePose({ ...base, act: { type: 'walk', dir: 1, phase: 0, steps: 0, facing: 'away' } }).pose,
    'back',
  );
});

test('그림 파일이 자세마다 있고 512 판, 이름표가 붙어 있다', () => {
  for (const kind of CUTE_KINDS)
    for (const pose of CUTE_POSES) {
      const svg = readFileSync(new URL(`./art/cute2d/${kind}/${pose}.svg`, import.meta.url), 'utf8');
      assert.match(svg, /^<svg [^>]*viewBox="0 0 512 512"><title>/, `${kind}/${pose}`);
    }
});

test('가장 큰 그림도 바닥(154)에 서서 펫 캔버스(160) 안에 든다', () => {
  for (const kind of CUTE_KINDS)
    for (const pose of CUTE_POSES) {
      const g = CUTE_GEOM[kind];
      const tall = (ART_GROUND - g.top(pose)) * g.scale;
      assert.ok(tall <= 150, `${kind} ${pose} ${tall}`);
      const h = g.head(pose as CutePose);
      assert.ok(h.y > g.top(pose) && h.y < ART_GROUND, `${kind} ${pose}`);
    }
});

test('서기 그림은 깜빡이고(감은 눈 장) 커서 쪽을 본다 (눈동자 옮긴 장). 다른 자세는 그대로', () => {
  assert.equal(cuteEyes('idle', -1, undefined), 'idle');
  // pet.ts 깜빡임 네 틀(0.25, 0.5, 0.75, 1) 가운데 앞 셋은 감은 눈
  for (const b of [0.25, 0.5, 0.75]) assert.equal(cuteEyes('idle', b, 1), 'blink');
  assert.equal(cuteEyes('idle', 1, undefined), 'idle');
  assert.equal(cuteEyes('idle', -1, -1), 'look-l');
  assert.equal(cuteEyes('idle', -1, 0.5), 'look-r');
  assert.equal(cuteEyes('idle', -1, LOOK_SIDE / 2), 'idle');
  for (const pose of ['sit', 'walk-2', 'happy', 'sleep'] as const) {
    assert.equal(cuteEyes(pose, 0.5, 1), pose);
  }
});

test('눈 바꾼 서기 그림은 서기와 눈만 다르다 (그림 파일)', () => {
  for (const kind of CUTE_KINDS) {
    const read = (p: string) =>
      readFileSync(new URL(`./art/cute2d/${kind}/${p}.svg`, import.meta.url), 'utf8');
    const idle = read('idle');
    for (const p of ['blink', 'look-l', 'look-r']) {
      const v = read(p);
      assert.notEqual(v, idle, `${kind} ${p}`);
      assert.equal(v.length > idle.length * 0.8 && v.length < idle.length * 1.2, true, `${kind} ${p}`);
    }
  }
});

test('걷기 그림의 머리와 꼭대기는 서기와 같은 높이 (걷기 시작할 때 머리가 튀지 않게)', () => {
  for (const kind of CUTE_KINDS) {
    const g = CUTE_GEOM[kind];
    for (let i = 0; i < 6; i++) {
      const pose = `walk-${i}` as CutePose;
      assert.ok(Math.abs(g.head(pose).y - g.head('idle').y) <= 4, `${kind} ${pose} 머리`);
      assert.ok(Math.abs(g.top(pose) - g.top('idle')) <= 12, `${kind} ${pose} 꼭대기 ${g.top(pose)}`);
    }
  }
});

test('콩이는 모든 자세에 머리 위 새싹이 있고, 서기에는 얼룩 같던 배 패치가 없다', () => {
  for (const pose of CUTE_POSES) {
    const svg = readFileSync(new URL(`./art/cute2d/kong/${pose}.svg`, import.meta.url), 'utf8');
    assert.match(svg, /fill="#b4dc78"/, `kong ${pose} 새싹`);
  }
  const idle = readFileSync(new URL('./art/cute2d/kong/idle.svg', import.meta.url), 'utf8');
  assert.doesNotMatch(idle, /rx="50" ry="40"/);
});

test('얼굴 아이콘: 콩이는 콩 모양으로 자르고, 졸기 머리 자리는 기울인 머리 가운데', () => {
  assert.ok(CUTE_GEOM.kong.faceShape, '콩 모양 자르기');
  const bean = CUTE_GEOM.kong.faceShape?.('idle');
  // 콩 그림(곰 몸 386, 80, 70): 꼭대기 172, 바닥 456, 아래 가로 141.4. 테두리 바깥까지 들어간다
  assert.ok(
    bean && bean.cy - bean.ryT <= 172 - 3.5 && bean.cy + bean.ryB >= 456 + 3.5 && bean.rxB >= 141.4 + 3.5,
  );
  const d = CUTE_GEOM.bunny.head('doze');
  assert.ok(Math.abs(d.x - 266) <= 1 && Math.abs(d.y - 273) <= 1, `${d.x} ${d.y}`);
});
