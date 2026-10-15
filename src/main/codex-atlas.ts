// Codex 펫 그림(PNG, WebP) 풀기와 칸 자르기 (codex-pet.ts AtlasDecoder). Electron nativeImage 는 WebP 를 풀지 못해서
// (빈 그림이 나온다) 보이지 않는 창의 Chromium 으로 푼다. 새 의존성 없이 Chromium 의 그림 풀개를 쓰고, 그 창은
// 샌드박스, Node 없음, 미리 부르는 스크립트 없음, 빈 페이지라 남이 준 그림을 풀다 무슨 일이 생겨도 메인 밖이다.
// 칸마다 알파를 보고(8 아래는 투명) 그림이 있는 칸만 PNG 로 다시 만들어 돌려준다

import { BrowserWindow } from 'electron';
import { CODEX_ATLAS, CODEX_ROWS } from '../shared/codex-pet.ts';
import type { Atlas } from './codex-pet.ts';

/** 푸는 데 기다리는 상한. 넘으면 창을 닫고 못 푼 것으로 */
const DECODE_TIMEOUT_MS = 15_000;

/** 창 안에서 도는 함수 (글로 넘긴다). 칸 PNG 는 data URL, 빈 칸은 null */
const IN_PAGE = `async (url, cw, ch, frames) => {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(cw, ch);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const toUrl = (b) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(b); });
  const cells = [];
  for (let r = 0; r < frames.length; r++) {
    const row = [];
    for (let c = 0; c < frames[r]; c++) {
      g.clearRect(0, 0, cw, ch);
      g.drawImage(bmp, c * cw, r * ch, cw, ch, 0, 0, cw, ch);
      const d = g.getImageData(0, 0, cw, ch).data;
      let any = false;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) { any = true; break; }
      row.push(any ? await toUrl(await canvas.convertToBlob({ type: 'image/png' })) : null);
    }
    cells.push(row);
  }
  const out = { width: bmp.width, height: bmp.height, cells };
  bmp.close();
  return out;
}`;

const PNG_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

export async function decodeAtlas(bytes: Buffer, kind: 'png' | 'webp'): Promise<Atlas | undefined> {
  const win = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    paintWhenInitiallyHidden: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 빈 페이지에서 밖으로 나가지 못하게 (그림 안 주소 같은 것이 있어도)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    await win.loadURL('about:blank');
    const url = `data:image/${kind};base64,${bytes.toString('base64')}`;
    const frames = CODEX_ROWS.map((r) => r.frames);
    const run = win.webContents.executeJavaScript(
      `(${IN_PAGE})(${JSON.stringify(url)}, ${CODEX_ATLAS.cellW}, ${CODEX_ATLAS.cellH}, ${JSON.stringify(frames)})`,
    );
    const late = new Promise<undefined>((ok) => {
      timer = setTimeout(() => ok(undefined), DECODE_TIMEOUT_MS);
    });
    const got: unknown = await Promise.race([run, late]);
    return atlasOf(got);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** 창이 돌려준 값을 다시 검사한다 (모양, 칸 PNG) */
function atlasOf(v: unknown): Atlas | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as { width?: unknown; height?: unknown; cells?: unknown };
  if (typeof r.width !== 'number' || typeof r.height !== 'number' || !Array.isArray(r.cells))
    return undefined;
  const cells = r.cells.slice(0, CODEX_ATLAS.rows).map((row: unknown) =>
    (Array.isArray(row) ? row.slice(0, CODEX_ATLAS.cols) : []).map((u: unknown) => {
      const m = typeof u === 'string' ? PNG_URL.exec(u) : null;
      return m ? Buffer.from(m[1] ?? '', 'base64') : undefined;
    }),
  );
  return { width: r.width, height: r.height, cells };
}
