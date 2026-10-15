import { app } from 'electron';
import { serverUrl } from '../shared/server-url.ts';

// 빌드할 때 electron.vite.config.ts 가 JJ_SERVER_URL 을 넣는다. 없으면 빈 글 (서버 기능이 꺼진다)
declare const __JJ_SERVER_URL__: string | undefined;
const BUILT = typeof __JJ_SERVER_URL__ === 'string' ? __JJ_SERVER_URL__ : '';

/** 이 앱이 쓸 페어리 서버 주소. 빈 글이면 서버 기능을 모두 끈다 (2단계부터 쓴다) */
export function appServerUrl(): string {
  return serverUrl(BUILT, process.env.JJ_SERVER_URL_OVERRIDE, app.isPackaged);
}
