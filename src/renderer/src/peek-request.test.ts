import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settlePeekRequest } from './peek-request.ts';

test('키우기 IPC가 거절된 뒤 놓은 상태면 일반 클릭 복구 경로로 보낸다', async () => {
  const calls: string[] = [];
  await settlePeekRequest(
    Promise.reject(new Error('window unavailable')),
    () => true,
    (released) => calls.push(`unavailable:${released}`),
    (released) => calls.push(`available:${released}`),
  );
  assert.deepEqual(calls, ['unavailable:true']);
});

test('키우기 IPC가 거절됐을 때 아직 누르고 있으면 놓은 클릭을 미리 보내지 않는다', async () => {
  const calls: string[] = [];
  await settlePeekRequest(
    Promise.resolve(false),
    () => false,
    (released) => calls.push(`unavailable:${released}`),
    (released) => calls.push(`available:${released}`),
  );
  assert.deepEqual(calls, ['unavailable:false']);
});

test('키우기에 성공한 뒤 놓았다면 복구 클릭 대신 원상 복구 경로로 보낸다', async () => {
  const calls: string[] = [];
  await settlePeekRequest(
    Promise.resolve(true),
    () => true,
    (released) => calls.push(`unavailable:${released}`),
    (released) => calls.push(`available:${released}`),
  );
  assert.deepEqual(calls, ['available:true']);
});
