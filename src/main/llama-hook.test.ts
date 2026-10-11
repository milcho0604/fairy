import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { llamaResolve } from './llama-hook.ts';

test('엔진 패키지 이름 하나만 받아 둔 폴더로 돌린다', () => {
  const dir = join('/data', 'engines', 'llama-linux-x64-3.22.1');
  const resolve = llamaResolve(dir, 'linux-x64');
  const passed: string[] = [];
  const next = ((s: string) => {
    passed.push(s);
    return { url: `node:${s}` };
  }) as unknown as Parameters<typeof resolve>[2];
  const ctx = { conditions: [], importAttributes: {} } as unknown as Parameters<typeof resolve>[1];
  assert.deepEqual(resolve('@node-llama-cpp/linux-x64', ctx, next), {
    url: pathToFileURL(join(dir, 'dist', 'index.js')).href,
    format: 'module',
    shortCircuit: true,
  });
  resolve('@node-llama-cpp/linux-x64-cuda', ctx, next);
  resolve('fs', ctx, next);
  assert.deepEqual(passed, ['@node-llama-cpp/linux-x64-cuda', 'fs']);
});
