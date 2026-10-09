import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_INPUTS, moodOf } from '../../shared/pet-mood.ts';
import { energyFace, sulkStage } from './draw.ts';

test('토라짐(pout)만 있어도 삐진 모습, 잠과 집중이 먼저다', () => {
  assert.equal(moodOf({ ...INITIAL_INPUTS, pout: 2 }, 0), 'sulky');
  assert.equal(moodOf({ ...INITIAL_INPUTS, pout: 3, focusTimer: true }, 0), 'sleeping');
  assert.equal(moodOf({ ...INITIAL_INPUTS, pout: 0 }, 0), 'idle');
});

test('삐진 모습 세기: 날 삐짐만이면 1, 토라짐 단계 그대로(3 까지), 같이 보기 중에는 1, 안 삐졌으면 0', () => {
  assert.equal(sulkStage({ mood: 'idle', pout: 3 }), 0);
  assert.equal(sulkStage({ mood: 'sulky' }), 1);
  assert.equal(sulkStage({ mood: 'sulky', pout: 0 }), 1);
  assert.equal(sulkStage({ mood: 'sulky', pout: 2 }), 2);
  assert.equal(sulkStage({ mood: 'sulky', pout: 3 }), 3);
  assert.equal(sulkStage({ mood: 'sulky', pout: 9 }), 3);
  assert.equal(sulkStage({ mood: 'sulky', pout: 3, peer: { dir: { x: 1, y: 0 } } }), 1);
});

test('삐진 동안은 기운(피곤) 표정을 얹지 않는다 (삐진 얼굴이 먼저)', () => {
  const energy = { stage: 'sleepy' as const, worn: true };
  assert.equal(energyFace({ mood: 'sulky', energy }), undefined);
  assert.deepEqual(energyFace({ mood: 'idle', energy }), energy);
});
