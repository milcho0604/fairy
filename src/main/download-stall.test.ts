import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

// download.ts 는 공용 fetch(net-fetch.ts, electron 의 net.fetch)로 받는다. 시험에서는 Node fetch 를 net 으로 끼운다
register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: 'data:text/javascript,export const net = { fetch: (u, i) => fetch(u, i) }; export const app = { whenReady: () => Promise.resolve() };', shortCircuit: true };
  return next(spec, ctx);
}`)}`,
);
const { ensureVerified } = await import('./download.ts');
const { DownloadError } = await import('../shared/download-error.ts');

const dir = mkdtempSync(join(tmpdir(), 'jj-stall-'));
// 머리말과 앞 1KB 만 보내고 멈추는 서버 (연결은 열린 채)
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-length': '100000' });
  res.write(Buffer.alloc(1024, 1));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('받다가 바이트가 끊기면 정한 시간 뒤 "연결 문제"로 끝내고, 이어 받지 않는 반쪽 파일은 지운다 (버그잡이 4)', async () => {
  const path = join(dir, 'model.bin');
  const t0 = Date.now();
  await assert.rejects(
    ensureVerified(
      { path, url: `http://127.0.0.1:${port}/m`, sha256: 'a'.repeat(64), bytes: 100000, stallMs: 300 },
      () => {},
    ),
    (err: unknown) => err instanceof DownloadError && err.reason === 'network',
  );
  assert.ok(Date.now() - t0 < 5000);
  assert.deepEqual(readdirSync(dir), []);
});

test('이어 받는 파일은 멈춰도 받은 만큼 .part 를 남긴다', async () => {
  const path = join(dir, 'big.bin');
  await assert.rejects(
    ensureVerified(
      {
        path,
        url: `http://127.0.0.1:${port}/b`,
        sha256: 'b'.repeat(64),
        bytes: 100000,
        stallMs: 300,
        resume: true,
      },
      () => {},
    ),
    (err: unknown) => err instanceof DownloadError && err.reason === 'network',
  );
  const parts = readdirSync(dir).filter((n) => n.endsWith('.part'));
  assert.equal(parts.length, 1);
  assert.ok(existsSync(join(dir, parts[0] ?? '')));
});
