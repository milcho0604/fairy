// 펫 MCP 서버(out/main/mcp-server.js)를 띄우는 명령. 설정 창의 "다른 AI 에 붙이기" 안내와 채팅의 짝꿍 도구가 같이 쓴다.
import { join, sep } from 'node:path';
import { app } from 'electron';
import type { McpLaunch } from '../shared/ai/types.ts';

/** 서버 스크립트 경로. 설치판에서는 asar 밖에 풀어 둔 사본을 쓴다 (electron-builder asarUnpack) */
export function mcpScriptPath(): string {
  return join(app.getAppPath(), 'out', 'main', 'mcp-server.js').replace(
    `app.asar${sep}`,
    `app.asar.unpacked${sep}`,
  );
}

/**
 * 짝꿍 실행 파일을 Node 로 돌려 서버를 띄운다. 데이터 폴더를 같이 넘겨
 * 시험 인스턴스(JJ_USER_DATA)도 자기 저장 파일만 만지게 한다
 */
export function jjMcpLaunch(): McpLaunch {
  return {
    command: process.execPath,
    args: [mcpScriptPath()],
    env: { ELECTRON_RUN_AS_NODE: '1', JJ_USER_DATA: app.getPath('userData') },
  };
}
