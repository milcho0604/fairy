import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, net } from 'electron';
import { CATALOG_URL, type Catalog, DEFAULT_CATALOG, parseCatalog } from '../../shared/ai/catalog.ts';

const DAY_MS = 86_400_000;
const cacheFile = () => join(app.getPath('userData'), 'ai-catalog.json');

/**
 * 모델 목록 (v2). 켜고 2분 뒤, 그 뒤 하루에 한 번 레포의 catalog/models.json 을 받는다.
 * 받은 것은 검사해서 이 컴퓨터에 남겨 두고, 못 받거나 이상하면 남겨 둔 것, 그것도 없으면 앱 기본값.
 * 사용자 정보는 보내지 않는다.
 */
export function watchCatalog(log: (tag: string, ...rest: unknown[]) => void) {
  let current: Catalog = DEFAULT_CATALOG;
  try {
    current = parseCatalog(JSON.parse(readFileSync(cacheFile(), 'utf8'))) ?? DEFAULT_CATALOG;
  } catch {
    // 처음이거나 깨졌으면 기본값
  }

  async function refresh(): Promise<void> {
    try {
      const res = await net.fetch(CATALOG_URL, {
        headers: { 'user-agent': `fairy/${app.getVersion()}` },
      });
      if (!res.ok) {
        log('catalog', '못 받음', res.status);
        return;
      }
      const json: unknown = await res.json();
      const parsed = parseCatalog(json);
      if (!parsed) {
        log('catalog', '모양이 이상해서 버림');
        return;
      }
      current = parsed;
      writeFileSync(cacheFile(), JSON.stringify(json));
      log('catalog', '받음', parsed.local.map((m) => m.id).join(','));
    } catch (err) {
      log('catalog', '실패', err instanceof Error ? err.message : String(err));
    }
  }

  setTimeout(() => void refresh(), 120_000).unref();
  setInterval(() => void refresh(), DAY_MS).unref();
  return {
    get: (): Catalog => current,
    refresh,
  };
}
