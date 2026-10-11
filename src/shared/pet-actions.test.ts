import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPetAction, PET_ACTIONS_MAX, parsePetAction, parsePetActions } from './pet-actions.ts';

test('편지함의 것을 검사한다: 모르는 도구, 틀린 id, 빈 고치기는 버린다', () => {
  assert.deepEqual(parsePetAction({ tool: 'delete_todo', id: 3 }), { tool: 'delete_todo', id: 3 });
  assert.equal(parsePetAction({ tool: 'drop_table', id: 3 }), undefined);
  assert.equal(parsePetAction({ tool: 'delete_todo', id: '3' }), undefined);
  assert.equal(parsePetAction({ tool: 'update_todo', id: 3, patch: {} }), undefined);
  assert.equal(parsePetAction({ tool: 'update_todo', id: 3, patch: { due: '내일' } }), undefined);
  assert.deepEqual(parsePetAction({ tool: 'update_todo', id: 3, patch: { due: null, dueMin: 600 } }), {
    tool: 'update_todo',
    id: 3,
    patch: { due: null, dueMin: 600 },
  });
  assert.equal(parsePetAction({ tool: 'append_note', id: 1, text: '  ' }), undefined);
  assert.equal(parsePetActions('nope').length, 0);
});

test('같은 것은 한 번, 넘치면 옛것부터 버린다', () => {
  let list = addPetAction([], { tool: 'delete_todo', id: 1 });
  list = addPetAction(list, { tool: 'delete_todo', id: 1 });
  assert.equal(list.length, 1);
  for (let i = 2; i < PET_ACTIONS_MAX + 5; i++) list = addPetAction(list, { tool: 'delete_event', id: i });
  assert.equal(list.length, PET_ACTIONS_MAX);
  assert.ok(!list.some((a) => a.tool === 'delete_todo'));
});
