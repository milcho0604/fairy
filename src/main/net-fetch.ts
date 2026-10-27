// 메인 프로세스 공용 fetch (설명은 net-fetch-core.ts). 바깥 http(s) 요청은 전부 이걸 쓴다. Node 의 전역 fetch 를 쓰지 않는다.
// 스트리밍 몸통, AbortSignal, 리다이렉트, 헤더는 net.fetch 가 fetch 표준대로 처리한다 (예전 호출처가 이미 net.fetch 를 썼다).
import { app, net } from 'electron';
import { createMainFetch, type FetchFn, guardGlobalFetch } from './net-fetch-core.ts';

export type { FetchFn } from './net-fetch-core.ts';

/** 메인 프로세스 공용 fetch. ready 전에 불려도 ready 를 기다렸다 보낸다 */
export const mainFetch: FetchFn = createMainFetch({
  ready: () => app.whenReady().then(() => {}),
  fetch: (input, init) => net.fetch(input as string, init),
});

/** 전역 fetch(Node undici)를 공용 fetch 로 돌려놓는다. 메인 프로세스 시작 때 한 번 */
export function guardMainGlobalFetch(): void {
  guardGlobalFetch(globalThis as { fetch: FetchFn }, mainFetch);
}
