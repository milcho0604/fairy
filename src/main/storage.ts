// 받은 모델 저장 공간 (6단계). 무료 AI 모델(수백 MB~1GB), 배경 제거(170MB), 깊이(27MB), 사진 AI 엔진(17MB)은 처음 쓸 때 받는다.
// 설정에서 크기를 보고 지울 수 있게 한다. 지워도 다음에 그 기능을 쓰면 다시 받는다.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { Catalog } from '../shared/ai/catalog.ts';
import { t } from '../shared/i18n/index.ts';
import type { StoredModel } from '../shared/ipc.ts';
import { localBusy, localModelPath, stopLocal } from './ai/local.ts';
import { BG_MODEL } from './bg-model.ts';
import { DEPTH_MODEL } from './depth-model.ts';
import { forgetVerified, isReceiving } from './download.ts';
import { localDrawBytes, removeLocalDraw } from './local-draw.ts';
import { ortWasmPath } from './ort-wasm.ts';
import { removeSdDraw, sdDrawBytes } from './sdcpp.ts';

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
    {
      // 배경 지우기와 2.5D 가 같이 쓰는 엔진 (17MB). 지우면 다음에 둘 중 하나를 쓸 때 다시 받는다
      id: 'ort',
      path: ortWasmPath(),
      label: t('settings.storage.ort'),
      kind: 'bg' as const,
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

/** 내 컴퓨터에서 그리기 mflux (uv, 파이썬, mflux, 줄인 모델이 든 local-draw/ 폴더 통째) */
const LOCAL_DRAW_ID = 'localDraw';
/** 내 컴퓨터에서 그리기 sd.cpp (sd-cli 와 모델 셋이 든 local-draw-sd/ 폴더 통째) */
const LOCAL_DRAW_SD_ID = 'localDrawSd';

/** 지금 디스크에 있는 모델 (받다 만 .part 도 같이 센다) */
export function storedModels(catalog: Catalog): StoredModel[] {
  const out: StoredModel[] = [];
  for (const k of known(catalog)) {
    const bytes = sizeOf(k.path) + sizeOf(`${k.path}.part`);
    if (bytes > 0) out.push({ id: k.id, label: k.label, kind: k.kind, bytes });
  }
  // 준비하다 멈춘 것(원본 받는 중)도 보여서 지울 수 있게
  const drawBytes = localDrawBytes();
  if (drawBytes > 0)
    out.push({ id: LOCAL_DRAW_ID, label: t('settings.storage.localDraw'), kind: 'draw', bytes: drawBytes });
  // macOS 를 14 로 올린 Apple 칩 Mac 은 둘 다 있을 수 있어 따로 보인다
  const sdBytes = sdDrawBytes();
  if (sdBytes > 0)
    out.push({
      id: LOCAL_DRAW_SD_ID,
      label: t('settings.storage.localDrawSd'),
      kind: 'draw',
      bytes: sdBytes,
    });
  // 목록에서 빠진 옛 무료 AI 모델 파일도 지울 수 있게
  const llmDir = join(modelsDir(), 'llm');
  if (existsSync(llmDir)) {
    const listed = new Set(known(catalog).map((k) => k.path));
    for (const f of readdirSync(llmDir, { withFileTypes: true })) {
      // 숨김 파일(.DS_Store)과 폴더는 모델이 아니다
      if (!f.isFile() || f.name.startsWith('.')) continue;
      const path = join(llmDir, f.name);
      if (listed.has(path) || listed.has(path.replace(/\.part$/, ''))) continue;
      out.push({
        id: `file:${f.name}`,
        label: t('settings.storage.oldFile', { name: f.name }),
        kind: 'llm',
        bytes: sizeOf(path),
      });
    }
  }
  return out;
}

/**
 * 모델 하나를 지운다. 받는 중이거나 무료 AI 가 답하는 중이면 지우지 않는다(false).
 * 무료 AI 는 먼저 일꾼을 끝낸다 (파일을 연 채라서, 윈도우는 열린 파일을 못 지운다).
 * 내 컴퓨터에서 그리기는 준비나 그리기가 돌고 있어도 먼저 멈추고 지운다 (몇 GB 를 쥔 채 기다리게 하지 않는다)
 */
export async function removeModel(
  catalog: Catalog,
  id: string,
  log?: (tag: string, ...rest: unknown[]) => void,
): Promise<boolean> {
  if (id === LOCAL_DRAW_ID) return removeLocalDraw(log);
  if (id === LOCAL_DRAW_SD_ID) return removeSdDraw(log);
  let path: string;
  let llm: boolean;
  if (id.startsWith('file:')) {
    const f = id.slice(5);
    if (!/^[\w-][\w.-]*$/.test(f)) return false;
    path = join(modelsDir(), 'llm', f);
    llm = true;
  } else {
    const k = known(catalog).find((x) => x.id === id);
    if (!k) return false;
    path = k.path;
    llm = k.kind === 'llm';
  }
  if (isReceiving(path) || (llm && localBusy())) return false;
  if (llm) stopLocal();
  try {
    rmSync(path, { force: true });
    rmSync(`${path}.part`, { force: true });
  } catch {
    return false;
  }
  forgetVerified(path);
  return true;
}
