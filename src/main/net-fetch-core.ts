// 메인 프로세스의 바깥 요청은 전부 Electron net.fetch(크로미움 네트워크 스택)로 보낸다 (2026-10 Node 보안 릴리스, CVE-2026-111497).
// Node 의 전역 fetch(undici)는 `content-encoding: br` 응답을 Node zlib 의 Brotli 풀개로 자동으로 푼다. 이 풀개에
// 범위 밖 쓰기 취약점이 있어, 악의적인 서버(예: 사용자가 구독한 .ics 주소)가 메인 프로세스에서 코드를 돌릴 수 있었다.
// 크로미움은 br 를 자기 코드로 풀어서 Node zlib 을 거치지 않는다.
//
// 이 파일은 Electron 을 가져오지 않아 시험에서 그대로 부른다 (net-fetch.ts 가 진짜 net 을 끼운다).
//
// 왜 "전역 fetch 에 accept-encoding 을 gzip, deflate 로 보내고 br 응답이면 거절"로는 안 되는가 (2026-10-27 실측):
// undici 는 헤더를 받는 순간 content-encoding 을 보고 Brotli 풀개를 만들고, 같은 틱에 온 본문 바이트를 바로 먹인다.
// fetch() 의 promise 가 돌아와 우리가 헤더를 보는 시점에는 이미 풀개의 _transform 이 불렸다 (본문을 읽지 않아도).
// 서버는 accept-encoding 을 무시하고 br 를 보낼 수 있다. 그래서 래퍼에서 거절하는 방식은 안전하지 않다.

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type NetTransport = {
  /** 요청을 보내도 되는 때까지 (앱 ready). net.fetch 는 ready 전에 못 부른다 */
  ready: () => Promise<void>;
  /** 크로미움 네트워크 스택으로 보내는 fetch (Electron net.fetch) */
  fetch: FetchFn;
};

/** 메인 프로세스 공용 fetch. 크로미움 네트워크 스택으로만 나간다 */
export function createMainFetch(t: NetTransport): FetchFn {
  return async (input, init) => {
    await t.ready();
    return t.fetch(input, init);
  };
}

/** 요청 주소의 스킴. 읽지 못하면 undefined */
function schemeOf(input: string | URL | Request): string | undefined {
  try {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(href).protocol;
  } catch {
    return undefined;
  }
}

export type FetchHost = { fetch: FetchFn };

/**
 * 전역 fetch 를 막는다. http(s) 요청은 공용 fetch(크로미움)로 돌리고, 읽을 수 없는 주소는 거절한다.
 * 의존 패키지나 앞으로 짜는 코드가 전역 fetch 를 불러도 Node zlib 의 Brotli 풀개에 닿지 않게 하는 안전망이다.
 * data:, blob: 같은 네트워크가 아닌 주소만 원래 fetch 로 보낸다 (content-encoding 이 없다).
 * 돌려주는 함수는 원래대로 되돌린다 (시험용)
 */
export function guardGlobalFetch(host: FetchHost, main: FetchFn): () => void {
  const original = host.fetch;
  const guarded: FetchFn = (input, init) => {
    const scheme = schemeOf(input);
    if (scheme === 'http:' || scheme === 'https:') return main(input, init);
    if (scheme === 'data:' || scheme === 'blob:') return original.call(host, input, init);
    return Promise.reject(new TypeError('fetch failed: unsupported url'));
  };
  host.fetch = guarded;
  return () => {
    host.fetch = original;
  };
}
