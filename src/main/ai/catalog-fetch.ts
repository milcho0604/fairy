// 모델 목록(catalog/models.json) 받기 (버그잡이 4). Electron 없이 돌아 시험에서 그대로 부른다.
// 예전에는 시간 상한도 크기 상한도 없이 res.json() 으로 읽어, 걸린 연결은 끝없이 매달리고(하루에 하나씩 쌓임)
// 아주 큰 응답도 통째로 메모리에 올렸다.
import { readCapped } from '../read-capped.ts';

/** 목록 크기 상한 (지금 목록은 몇 KB) */
export const CATALOG_MAX_BYTES = 256 * 1024;
/** 답을 기다리는 시간 상한 */
export const CATALOG_TIMEOUT_MS = 20_000;

export type CatalogFetch = (url: string, init: RequestInit) => Promise<Response>;

export type CatalogResult =
  | { ok: true; json: unknown }
  | { ok: false; why: 'status'; status: number }
  | { ok: false; why: 'big' | 'json' | 'failed' };

/** 목록을 받아 JSON 으로. 모양 검사는 부르는 쪽(parseCatalog)이 한다 */
export async function fetchCatalogJson(
  fetch: CatalogFetch,
  url: string,
  o: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<CatalogResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? CATALOG_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, ...(o.headers ? { headers: o.headers } : {}) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, why: 'status', status: res.status };
    }
    const text = await readCapped(res, CATALOG_MAX_BYTES);
    if (text === undefined) return { ok: false, why: 'big' };
    try {
      return { ok: true, json: JSON.parse(text) };
    } catch {
      return { ok: false, why: 'json' };
    }
  } catch {
    return { ok: false, why: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
