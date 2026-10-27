import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settlePeekRequest } from './peek-request.ts';

test('키우기 IPC가 거절된 뒤 놓은 상태면 일반 클릭 복구 경로로 보낸다', async () => {
  const calls: string[] = [];
  await settlePeekRequest(
    () => Promise.reject(new Error('window unavailable')),
    () => 'released',
    (restoreClick) => calls.push(`unavailable:${restoreClick}`),
    (shouldEnd) => calls.push(`available:${shouldEnd}`),
  );
  assert.deepEqual(calls, ['unavailable:true']);
});

test('키우기 IPC가 거절됐을 때 아직 누르고 있으면 놓은 클릭을 미리 보내지 않는다', async () => {
  const calls: string[] = [];
  await settlePeekRequest(
    () => Promise.resolve(false),
    () => 'holding',
    (restoreClick) => calls.push(`unavailable:${restoreClick}`),
    (shouldEnd) => calls.push(`available:${shouldEnd}`),
  );
  assert.deepEqual(calls, ['unavailable:false']);
});

test('키우기에 성공한 뒤 놓았다면 복구 클릭 대신 원상 복구 경로로 보낸다', async () => {
  const calls: string[] = [];
  await settlePeekRequest(
    () => Promise.resolve(true),
    () => 'released',
    (restoreClick) => calls.push(`unavailable:${restoreClick}`),
    (shouldEnd) => calls.push(`available:${shouldEnd}`),
  );
  assert.deepEqual(calls, ['available:true']);
});

test('드래그 취소 뒤 키우기 요청이 거절돼도 클릭을 복구하지 않는다', async () => {
  const calls: string[] = [];
  await settlePeekRequest(
    () => Promise.reject(new Error('peek unavailable')),
    () => 'cancelled',
    (restoreClick) => {
      if (restoreClick) calls.push('click');
    },
    (shouldEnd) => calls.push(`end:${shouldEnd}`),
  );
  assert.deepEqual(calls, []);
});

test('IPC 호출이 동기 예외를 던져도 실패 경로로 보낸다', async () => {
  const calls: boolean[] = [];
  await settlePeekRequest(
    () => {
      throw new Error('renderer is closing');
    },
    () => 'released',
    (restoreClick) => calls.push(restoreClick),
    (shouldEnd) => calls.push(shouldEnd),
  );
  assert.deepEqual(calls, [true]);
});
