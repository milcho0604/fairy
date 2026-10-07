// 받은 모델 저장 공간 (6단계). 무료 AI 모델(수백 MB~1GB), 배경 제거(170MB), 깊이(27MB)는 처음 쓸 때 받는다.
// 설정에서 크기를 보고 지울 수 있게 한다. 지워도 다음에 그 기능을 쓰면 다시 받는다.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { Catalog } from '../shared/ai/catalog.ts';
import { t } from '../shared/i18n/index.ts';
import type { StoredModel } from '../shared/ipc.ts';
import { localModelPath, stopLocal } from './ai/local.ts';
import { BG_MODEL } from './bg-model.ts';
import { DEPTH_MODEL } from './depth-model.ts';

const modelsDir = () => join(app.getPath('userData'), 'models');

/** 지울 수 있는 것: id 와 파일 경로, 이름 */
function known(catalog: Catalog): { id: string; path: string; label: string; kind: StoredModel['kind'] }[] {
  return [
    ...catalog.local.map((m) => ({
      id: `llm:${m.id}`,
      path: localModelPath(m),
      label: t('settings.storage.llm', { name: m.label }),
      kind: 'llm' as const,
    })),
    {
      id: 'bg',
      path: join(modelsDir(), BG_MODEL.file),
      label: t('settings.storage.bg'),
      kind: 'bg' as const,
    },
    {
      id: 'depth',
      path: join(modelsDir(), DEPTH_MODEL.file),
      label: t('settings.storage.depth'),
      kind: 'depth' as const,
    },
  ];
}

const sizeOf = (path: string) => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/** 지금 디스크에 있는 모델 (받다 만 .part 도 같이 센다) */
export function storedModels(catalog: Catalog): StoredModel[] {
  const out: StoredModel[] = [];
  for (const k of known(catalog)) {
    const bytes = sizeOf(k.path) + sizeOf(`${k.path}.part`);
    if (bytes > 0) out.push({ id: k.id, label: k.label, kind: k.kind, bytes });
  }
  // 목록에서 빠진 옛 무료 AI 모델 파일도 지울 수 있게
  const llmDir = join(modelsDir(), 'llm');
  if (existsSync(llmDir)) {
    const listed = new Set(known(catalog).map((k) => k.path));
    for (const f of readdirSync(llmDir)) {
      const path = join(llmDir, f);
      if (listed.has(path) || listed.has(path.replace(/\.part$/, ''))) continue;
      out.push({
        id: `file:${f}`,
        label: t('settings.storage.oldFile', { name: f }),
        kind: 'llm',
        bytes: sizeOf(path),
      });
    }
  }
  return out;
}

/** 모델 하나를 지운다. 무료 AI 는 먼저 일꾼을 끝낸다 (파일을 연 채라서) */
export function removeModel(catalog: Catalog, id: string): boolean {
  if (id.startsWith('file:')) {
    const f = id.slice(5);
    if (!/^[\w.-]+$/.test(f)) return false;
    stopLocal();
    rmSync(join(modelsDir(), 'llm', f), { force: true });
    return true;
  }
  const k = known(catalog).find((x) => x.id === id);
  if (!k) return false;
  if (k.kind === 'llm') stopLocal();
  rmSync(k.path, { force: true });
  rmSync(`${k.path}.part`, { force: true });
  return true;
}
