// 개발 서버(electron-vite dev) 주소. 설치판은 이 값을 읽지 않는다: 누가 ELECTRON_RENDERER_URL 을 심어
// 짝꿍을 켜면 설치판 창이 남의 웹 페이지를 preload(짝꿍 IPC) 와 함께 열게 되기 때문이다 (2026-10-11 보안 점검).
import { app } from 'electron';

/** 개발 실행이면 렌더러 개발 서버 주소, 설치판이거나 없으면 undefined */
export function devRendererUrl(): string | undefined {
  if (app.isPackaged) return undefined;
  return process.env.ELECTRON_RENDERER_URL || undefined;
}
