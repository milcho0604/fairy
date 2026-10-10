import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANCELLED, createAskQueue, type WorkerIn, type WorkerOut } from './llm-worker.ts';

const ask = (id: string): WorkerIn => ({
  type: 'ask',
  id,
  modelPath: '/m.gguf',
  system: '',
  history: [],
  text: '안녕',
  noThink: false,
  maxTokens: 10,
});

const tick = () => new Promise((r) => setTimeout(r, 0));

test('줄에서 기다리다 멈춘 질문도 끝을 알린다 (메인이 바쁨을 놓게)', async () => {
  const out: WorkerOut[] = [];
  let release: (v: string) => void = () => {};
  const handle = createAskQueue(
    (o) => out.push(o),
    (m) => (m.id === 'a' ? new Promise<string>((r) => (release = r)) : Promise.resolve('b답')),
  );
  handle(ask('a'));
  handle(ask('b'));
  handle({ type: 'cancel', id: 'b' }); // b 는 아직 줄에 있다
  await tick();
  release('a답');
  await tick();
  await tick();
  assert.deepEqual(out, [
    { type: 'done', id: 'a', text: 'a답' },
    { type: 'error', id: 'b', message: CANCELLED },
  ]);
});

test('답하는 중에 멈추면 신호를 끊고 그때까지 글로 끝낸다', async () => {
  const out: WorkerOut[] = [];
  const handle = createAskQueue(
    (o) => out.push(o),
    (_m, signal, onDelta) =>
      new Promise<string>((r) => {
        onDelta('반');
        signal.addEventListener('abort', () => r('반'));
      }),
  );
  handle(ask('a'));
  await tick();
  handle({ type: 'cancel', id: 'a' });
  await tick();
  assert.deepEqual(out, [
    { type: 'delta', id: 'a', text: '반' },
    { type: 'done', id: 'a', text: '반' },
  ]);
});
